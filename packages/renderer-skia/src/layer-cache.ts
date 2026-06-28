import type { Image, Surface } from "canvaskit-wasm";

export type LayerRasterCacheOptions = {
  // Total byte budget for cached raster pixels (width × height × 4 per entry).
  // Default 128 MiB — sized for 2–4 GB render servers.
  maxBytes?: number;
  // Caching engages only when the measured direct-draw time exceeds the
  // predicted blit time by this factor (default 1.5). 0 caches any repeated
  // content unconditionally (useful in tests).
  costRatio?: number;
  // Initial estimate of the per-pixel software blit cost. canvaskit-wasm
  // image draws cost ~17–25 ns/px on typical hardware (measured); the value
  // self-tunes from real blits afterwards.
  blitNsPerPx?: number;
};

export type LayerRasterEntry = {
  image: Image;
  // The snapshot's backing surface. On the CPU backend the image may share the
  // surface's pixels, so both live and die together; the surface is never
  // drawn to again after the snapshot.
  surface: Surface;
  // Top-left corner of the rastered bounds in the layer's LOCAL space — the
  // blit draws the image at (x, y) under the layer's current transform.
  x: number;
  y: number;
  bytes: number;
};

export type LayerRasterCacheStats = {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  rasters: number;
  evictions: number;
  rejected: number;
  blitNsPerPx: number;
};

type DrawRecord = {
  sightings: number;
  // Fastest observed direct draw — robust against one-off spikes (first-use
  // font loading, GC pauses), so caching engages only when even the BEST
  // direct draw loses to a blit.
  minMs: number;
};

const TRACK_LIMIT = 4096;

// Cross-frame raster cache for static layer subtrees (groups). Entries are
// keyed by a content hash of the resolved subtree, so a group whose children
// don't change between frames can be rastered once and blitted afterwards,
// while its own transform/opacity/reveal keep animating on the blit.
//
// A software blit is NOT free (~20ns/px in canvaskit-wasm — a full-frame blit
// often costs MORE than redrawing simple vector content), so the cache is
// cost-driven: it times every direct draw of a candidate subtree and rasters
// only content that repeatedly draws slower than the predicted blit.
export class LayerRasterCache {
  // Map iteration order doubles as LRU order: `get` re-inserts on hit.
  readonly #entries = new Map<string, LayerRasterEntry>();
  // Direct-draw timings per content key, recorded while the subtree is drawn
  // the normal way. LRU-capped.
  readonly #drawRecords = new Map<string, DrawRecord>();
  // Keys judged not worth caching (blit would be slower than drawing).
  readonly #rejected = new Set<string>();
  readonly #maxBytes: number;
  readonly #maxEntryBytes: number;
  readonly #costRatio: number;
  #blitNsPerPx: number;
  #bytes = 0;
  #hits = 0;
  #misses = 0;
  #rasters = 0;
  #evictions = 0;

  constructor(options: LayerRasterCacheOptions = {}) {
    this.#maxBytes = Math.max(0, options.maxBytes ?? 128 * 1024 * 1024);
    // A single entry may not hog the whole budget — it would evict everything
    // else for one layer's benefit.
    this.#maxEntryBytes = Math.floor(this.#maxBytes / 2);
    this.#costRatio = options.costRatio ?? 1.5;
    this.#blitNsPerPx = options.blitNsPerPx ?? 20;
  }

  get(key: string): LayerRasterEntry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) {
      this.#misses += 1;
      return undefined;
    }
    this.#hits += 1;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  // Record how long the subtree took to draw directly. Called on every
  // direct (non-cached) draw of a cacheable group.
  recordDraw(key: string, ms: number): void {
    if (this.#maxBytes === 0) {
      return;
    }
    const record = this.#drawRecords.get(key);
    if (record) {
      record.sightings += 1;
      record.minMs = Math.min(record.minMs, ms);
      this.#drawRecords.delete(key);
      this.#drawRecords.set(key, record);
      return;
    }
    this.#drawRecords.set(key, { sightings: 1, minMs: ms });
    if (this.#drawRecords.size > TRACK_LIMIT) {
      const oldest = this.#drawRecords.keys().next().value;
      if (oldest !== undefined) {
        this.#drawRecords.delete(oldest);
      }
    }
  }

  // Cheap pre-filter before computing bounds: the content repeated at least
  // twice (one clean timing past first-use costs) and wasn't already judged
  // a loss.
  shouldConsider(key: string): boolean {
    if (this.#maxBytes === 0 || this.#rejected.has(key)) {
      return false;
    }
    return (this.#drawRecords.get(key)?.sightings ?? 0) >= 2;
  }

  // Final decision once the raster size is known: does even the fastest
  // observed direct draw lose clearly to the predicted blit?
  worthRastering(key: string, areaPx: number): boolean {
    const record = this.#drawRecords.get(key);
    if (!record) {
      return false;
    }
    if (this.#costRatio <= 0) {
      return true;
    }
    const blitMs = this.predictedBlitMs(areaPx);
    return record.minMs > blitMs * this.#costRatio + 0.15;
  }

  predictedBlitMs(areaPx: number): number {
    return (areaPx * this.#blitNsPerPx) / 1e6;
  }

  // Feed back a measured blit so the per-pixel estimate tracks the actual
  // machine (EMA, weight 0.2).
  recordBlit(areaPx: number, ms: number): void {
    if (areaPx <= 0 || ms < 0) {
      return;
    }
    const observed = (ms * 1e6) / areaPx;
    this.#blitNsPerPx = this.#blitNsPerPx * 0.8 + observed * 0.2;
  }

  reject(key: string): void {
    this.#rejected.add(key);
    if (this.#rejected.size > TRACK_LIMIT) {
      const oldest = this.#rejected.values().next().value;
      if (oldest !== undefined) {
        this.#rejected.delete(oldest);
      }
    }
  }

  // Whether an entry of this size is admissible — checked BEFORE allocating
  // the raster surface so oversized layers skip the work entirely.
  admits(bytes: number): boolean {
    return bytes > 0 && bytes <= this.#maxEntryBytes;
  }

  set(key: string, entry: LayerRasterEntry): boolean {
    if (!this.admits(entry.bytes)) {
      return false;
    }
    const existing = this.#entries.get(key);
    if (existing) {
      this.#deleteEntry(key, existing);
    }
    while (this.#bytes + entry.bytes > this.#maxBytes && this.#entries.size > 0) {
      const oldest = this.#entries.entries().next().value;
      if (!oldest) {
        break;
      }
      this.#deleteEntry(oldest[0], oldest[1]);
      this.#evictions += 1;
    }
    this.#entries.set(key, entry);
    this.#bytes += entry.bytes;
    this.#rasters += 1;
    return true;
  }

  stats(): LayerRasterCacheStats {
    return {
      entries: this.#entries.size,
      bytes: this.#bytes,
      hits: this.#hits,
      misses: this.#misses,
      rasters: this.#rasters,
      evictions: this.#evictions,
      rejected: this.#rejected.size,
      blitNsPerPx: this.#blitNsPerPx
    };
  }

  clear(): void {
    for (const [key, entry] of [...this.#entries]) {
      this.#deleteEntry(key, entry);
    }
    this.#drawRecords.clear();
    this.#rejected.clear();
  }

  dispose(): void {
    this.clear();
  }

  #deleteEntry(key: string, entry: LayerRasterEntry): void {
    this.#entries.delete(key);
    this.#bytes -= entry.bytes;
    entry.image.delete();
    entry.surface.dispose();
  }
}

export function createLayerRasterCache(options: LayerRasterCacheOptions = {}): LayerRasterCache {
  return new LayerRasterCache(options);
}
