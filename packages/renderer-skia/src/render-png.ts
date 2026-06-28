import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import CanvasKitInitModule from "canvaskit-wasm";
import type { Canvas, CanvasKit, CanvasKitInitOptions, Image, MallocObj, Typeface } from "canvaskit-wasm";
import type { ResolvedFrame, ResolvedLayer } from "../../core/src/index.ts";
import { LayerRasterCache } from "./layer-cache.ts";
import type { LayerRasterCacheOptions } from "./layer-cache.ts";
import { drawFrameToCanvas } from "./draw.ts";
import type { AssetProvider, DrawContext } from "./draw.ts";

type CanvasKitInitFn = (opts?: CanvasKitInitOptions) => Promise<CanvasKit>;
type SkSurface = NonNullable<ReturnType<CanvasKit["MakeSurface"]>>;

const CanvasKitInit = CanvasKitInitModule as unknown as CanvasKitInitFn;

let canvasKitPromise: Promise<CanvasKit> | undefined;
let defaultTypefacePromise: Promise<Typeface | null> | undefined;

export type RenderFrameOptions = {
  videoFrameCache?: VideoFrameCache;
  // Cross-frame raster cache for static group subtrees. RgbaFrameRenderer
  // supplies its own by default; pass `false` to disable for a call.
  layerCache?: LayerRasterCache | false;
  // Asset access; defaults to the Node provider (disk fonts/images, ffmpeg
  // video) when omitted.
  assetProvider?: AssetProvider;
};

export type VideoFrameCacheOptions = {
  ffmpegPath?: string;
  ffmpegArgsPrefix?: string[];
  // When set, decoded RGBA frames are persisted to this directory keyed by the
  // source path + mtime/size + time + dimensions. This survives across render
  // tasks (cross-task cache) and is shared between worker processes pointing at
  // the same directory (shared video-frame cache across workers).
  diskCacheDir?: string;
};

export type RgbaVideoFrame = {
  width: number;
  height: number;
  pixels: Buffer;
};

type VideoFrameSize = {
  width: number;
  height: number;
};

export class VideoFrameCache {
  readonly #entries = new Map<string, Promise<Buffer>>();
  readonly #rgbaEntries = new Map<string, Promise<RgbaVideoFrame>>();
  readonly #sizeEntries = new Map<string, Promise<VideoFrameSize>>();
  readonly #options: VideoFrameCacheOptions;

  constructor(options: VideoFrameCacheOptions = {}) {
    this.#options = options;
  }

  get size(): number {
    return this.#entries.size + this.#rgbaEntries.size;
  }

  clear(): void {
    this.#entries.clear();
    this.#rgbaEntries.clear();
  }

  async getSourceSize(src: string): Promise<VideoFrameSize> {
    const key = await buildVideoFrameCacheKey(src, 0, undefined, undefined, "size");
    const cached = this.#sizeEntries.get(key);
    if (cached) {
      return cached;
    }

    const pending = probeVideoFrameSize(src, this.#options).catch((error: unknown) => {
      this.#sizeEntries.delete(key);
      throw error;
    });
    this.#sizeEntries.set(key, pending);
    return pending;
  }

  async getFrame(src: string, timeMs: number): Promise<Buffer> {
    const key = await buildVideoFrameCacheKey(src, timeMs);
    const cached = this.#entries.get(key);
    if (cached) {
      return cached;
    }

    const pending = extractVideoFramePng(src, timeMs, this.#options).catch((error: unknown) => {
      this.#entries.delete(key);
      throw error;
    });
    this.#entries.set(key, pending);
    return pending;
  }

  async prefetch(src: string, timeMs: number): Promise<Buffer> {
    return await this.getFrame(src, timeMs);
  }

  async prefetchFrames(src: string, timeMsList: number[]): Promise<void> {
    const uniqueTimes = uniqueRoundedTimes(timeMsList);
    if (uniqueTimes.length === 0) {
      return;
    }

    const missing: Array<{ key: string; timeMs: number }> = [];
    for (const timeMs of uniqueTimes) {
      const key = await buildVideoFrameCacheKey(src, timeMs);
      if (!this.#entries.has(key)) {
        missing.push({ key, timeMs });
      }
    }

    if (missing.length === 0) {
      return;
    }

    if (!isUniformFrameSequence(missing.map((entry) => entry.timeMs))) {
      await Promise.all(missing.map((entry) => this.getFrame(src, entry.timeMs)));
      return;
    }

    const pendingFrames = extractVideoFramesPng(src, missing.map((entry) => entry.timeMs), this.#options)
      .catch((error: unknown) => {
        for (const entry of missing) {
          this.#entries.delete(entry.key);
        }
        throw error;
      });

    for (const [index, entry] of missing.entries()) {
      this.#entries.set(entry.key, pendingFrames.then((frames) => {
        const frame = frames[index];
        if (!frame) {
          throw new Error(`ffmpeg returned no video frame for time ${entry.timeMs}ms`);
        }
        return frame;
      }));
    }

    await Promise.all(missing.map((entry) => this.#entries.get(entry.key)));
  }

  async getRgbaFrame(src: string, timeMs: number, width: number, height: number): Promise<RgbaVideoFrame> {
    const key = await buildVideoFrameCacheKey(src, timeMs, width, height, "rgba");
    const cached = this.#rgbaEntries.get(key);
    if (cached) {
      return cached;
    }

    const dir = this.#options.diskCacheDir;
    const pending = (async () => {
      if (dir) {
        const onDisk = await readRgbaFrameFromDisk(dir, key);
        if (onDisk) {
          return onDisk;
        }
      }
      const frame = await extractVideoFrameRgba(src, timeMs, width, height, this.#options);
      if (dir) {
        await writeRgbaFrameToDisk(dir, key, frame);
      }
      return frame;
    })().catch((error: unknown) => {
      this.#rgbaEntries.delete(key);
      throw error;
    });
    this.#rgbaEntries.set(key, pending);
    return pending;
  }

  async prefetchRgbaFrames(src: string, timeMsList: number[], width: number, height: number): Promise<void> {
    const uniqueTimes = uniqueRoundedTimes(timeMsList);
    if (uniqueTimes.length === 0) {
      return;
    }

    const candidates: Array<{ key: string; timeMs: number }> = [];
    for (const timeMs of uniqueTimes) {
      const key = await buildVideoFrameCacheKey(src, timeMs, width, height, "rgba");
      if (!this.#rgbaEntries.has(key)) {
        candidates.push({ key, timeMs });
      }
    }

    if (candidates.length === 0) {
      return;
    }

    // Pull any frames already on disk (e.g. written by a prior task/worker)
    // straight from the cache directory instead of re-decoding them.
    const dir = this.#options.diskCacheDir;
    const missing: Array<{ key: string; timeMs: number }> = [];
    if (dir) {
      const misses = await Promise.all(candidates.map(async (entry) => {
        const onDisk = await readRgbaFrameFromDisk(dir, entry.key);
        if (onDisk) {
          this.#rgbaEntries.set(entry.key, Promise.resolve(onDisk));
          return undefined;
        }
        return entry;
      }));
      missing.push(...misses.filter((entry): entry is { key: string; timeMs: number } => entry !== undefined));
    } else {
      missing.push(...candidates);
    }

    if (missing.length === 0) {
      return;
    }

    if (!isUniformFrameSequence(missing.map((entry) => entry.timeMs))) {
      await Promise.all(missing.map((entry) => this.getRgbaFrame(src, entry.timeMs, width, height)));
      return;
    }

    const pendingFrames = extractVideoFramesRgba(src, missing.map((entry) => entry.timeMs), width, height, this.#options)
      .catch((error: unknown) => {
        for (const entry of missing) {
          this.#rgbaEntries.delete(entry.key);
        }
        throw error;
      });

    for (const [index, entry] of missing.entries()) {
      this.#rgbaEntries.set(entry.key, pendingFrames.then(async (frames) => {
        const frame = frames[index];
        if (!frame) {
          throw new Error(`ffmpeg returned no raw video frame for time ${entry.timeMs}ms`);
        }
        if (dir) {
          await writeRgbaFrameToDisk(dir, entry.key, frame);
        }
        return frame;
      }));
    }

    await Promise.all(missing.map((entry) => this.#rgbaEntries.get(entry.key)));
  }
}

export function createVideoFrameCache(options: VideoFrameCacheOptions = {}): VideoFrameCache {
  return new VideoFrameCache(options);
}

export type RgbaFrameRendererOptions = {
  // `false` disables the cross-frame static-layer raster cache; an object
  // tunes its byte budget.
  layerCache?: false | LayerRasterCacheOptions;
};

export function createRgbaFrameRenderer(options: RgbaFrameRendererOptions = {}): RgbaFrameRenderer {
  return new RgbaFrameRenderer(options);
}

export class RgbaFrameRenderer {
  #CanvasKit: CanvasKit | undefined;
  #surface: SkSurface | undefined;
  #canvas: Canvas | undefined;
  #pixels: MallocObj | undefined;
  #width = 0;
  #height = 0;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #layerCache: LayerRasterCache | undefined;

  constructor(options: RgbaFrameRendererOptions = {}) {
    if (options.layerCache !== false) {
      this.#layerCache = new LayerRasterCache(options.layerCache);
    }
  }

  layerCacheStats(): ReturnType<LayerRasterCache["stats"]> | undefined {
    return this.#layerCache?.stats();
  }

  // Renders share one surface and one pixel buffer, so concurrent calls are
  // serialized to keep callers safe.
  render(frame: ResolvedFrame, options: RenderFrameOptions = {}): Promise<Buffer> {
    const result = this.#queue.then(() => this.#render(frame, options));
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #render(frame: ResolvedFrame, options: RenderFrameOptions): Promise<Buffer> {
    const { CanvasKit, canvas } = await this.#surfaceFor(frame);
    const layerCache = options.layerCache === undefined ? this.#layerCache : options.layerCache;
    const ctx = await buildDrawContext(frame, options, layerCache);
    await drawFrameToCanvas(CanvasKit, canvas, frame, ctx);
    // readPixels writes straight into the persistent WASM-heap buffer; the
    // only per-frame copy is WASM heap → returned Node Buffer.
    const ok = canvas.readPixels(0, 0, {
      width: frame.composition.width,
      height: frame.composition.height,
      colorType: CanvasKit.ColorType.RGBA_8888,
      alphaType: CanvasKit.AlphaType.Unpremul,
      colorSpace: CanvasKit.ColorSpace.SRGB
    }, this.#pixels);
    if (!ok) {
      throw new Error("CanvasKit failed to read RGBA pixels from the frame");
    }
    return Buffer.from(this.#pixels!.toTypedArray() as Uint8Array);
  }

  dispose(): void {
    this.#disposeSurface();
    this.#layerCache?.dispose();
  }

  // Cached layer rasters live in layer-local space, so they survive a
  // composition-size change; only the frame surface is rebuilt.
  #disposeSurface(): void {
    this.#surface?.dispose();
    this.#surface = undefined;
    this.#canvas = undefined;
    if (this.#pixels && this.#CanvasKit) {
      this.#CanvasKit.Free(this.#pixels);
    }
    this.#pixels = undefined;
    this.#width = 0;
    this.#height = 0;
  }

  async #surfaceFor(frame: ResolvedFrame): Promise<{ CanvasKit: CanvasKit; surface: SkSurface; canvas: Canvas }> {
    const CanvasKit = this.#CanvasKit ?? await loadCanvasKit();
    this.#CanvasKit = CanvasKit;

    const width = frame.composition.width;
    const height = frame.composition.height;
    if (!this.#surface || !this.#canvas || this.#width !== width || this.#height !== height) {
      this.#disposeSurface();
      const surface = CanvasKit.MakeSurface(width, height);
      if (!surface) {
        throw new Error("CanvasKit failed to create a raster surface");
      }
      this.#surface = surface;
      this.#canvas = surface.getCanvas();
      this.#pixels = CanvasKit.Malloc(Uint8Array, width * height * 4);
      this.#width = width;
      this.#height = height;
    }

    return { CanvasKit, surface: this.#surface, canvas: this.#canvas };
  }
}

export async function renderPngFrame(frame: ResolvedFrame, options: RenderFrameOptions = {}): Promise<Buffer> {
  const { CanvasKit, surface } = await renderFrameSurface(frame, options);

  try {
    const image = surface.makeImageSnapshot();
    if (!image) {
      throw new Error("CanvasKit failed to snapshot the frame");
    }

    try {
      const pngBytes = image.encodeToBytes(CanvasKit.ImageFormat.PNG);
      if (!pngBytes) {
        throw new Error("CanvasKit failed to encode the frame as PNG");
      }

      return Buffer.from(pngBytes);
    } finally {
      image.delete();
    }
  } finally {
    surface.dispose();
  }
}

// Shared renderer for the standalone function API, so repeated calls reuse
// one surface/pixel buffer instead of allocating per frame. Calls are
// serialized inside RgbaFrameRenderer.
let sharedRgbaRenderer: RgbaFrameRenderer | undefined;

export async function renderRgbaFrame(frame: ResolvedFrame, options: RenderFrameOptions = {}): Promise<Buffer> {
  sharedRgbaRenderer ??= new RgbaFrameRenderer();
  return sharedRgbaRenderer.render(frame, options);
}

async function renderFrameSurface(frame: ResolvedFrame, options: RenderFrameOptions): Promise<{ CanvasKit: CanvasKit; surface: SkSurface; canvas: Canvas }> {
  const CanvasKit = await loadCanvasKit();
  const surface = CanvasKit.MakeSurface(frame.composition.width, frame.composition.height);
  if (!surface) {
    throw new Error("CanvasKit failed to create a raster surface");
  }

  const canvas = surface.getCanvas();

  try {
    const ctx = await buildDrawContext(frame, options);
    await drawFrameToCanvas(CanvasKit, canvas, frame, ctx);
    return { CanvasKit, surface, canvas };
  } catch (error) {
    surface.dispose();
    throw error;
  }
}

// Prepare the draw context for an entry point: prefetch async video frames (the
// draw tree is otherwise sync w.r.t. node) and pick the asset provider —
// defaulting to the Node backend (disk fonts/images, ffmpeg video) when none is
// supplied. This is the seam the moved drawFrameToCanvas used to own.
async function buildDrawContext(frame: ResolvedFrame, options: RenderFrameOptions, layerCache?: LayerRasterCache | false): Promise<DrawContext> {
  if (options.videoFrameCache) {
    await prefetchVideoFrames(frame, options.videoFrameCache);
  }
  const lc = layerCache ?? options.layerCache;
  return {
    assetProvider: options.assetProvider ?? createNodeAssetProvider(options.videoFrameCache),
    ...(lc !== undefined ? { layerCache: lc } : {})
  };
}


// The default Node asset provider: typefaces/images from disk, video frames via
// the ffmpeg-backed VideoFrameCache (or a direct ffmpeg extraction).
export function createNodeAssetProvider(videoFrameCache?: VideoFrameCache): AssetProvider {
  return {
    loadTypeface,
    loadEmojiTypeface,
    loadDefaultTypeface,
    loadImage: loadDecodedImage,
    async loadVideoImage(CanvasKit, layer, frameTimeMs) {
      const videoTimeMs = videoTimeForLayer(layer, frameTimeMs);
      const sourceSize = videoFrameCache && layer.width && layer.height
        ? await videoFrameCache.getSourceSize(layer.src)
        : undefined;
      return videoFrameCache && sourceSize
        ? makeImageFromRgbaFrame(CanvasKit, await videoFrameCache.getRgbaFrame(layer.src, videoTimeMs, sourceSize.width, sourceSize.height))
        : CanvasKit.MakeImageFromEncoded(videoFrameCache
          ? await videoFrameCache.getFrame(layer.src, videoTimeMs)
          : await extractVideoFramePng(layer.src, videoTimeMs));
    }
  };
}

async function loadCanvasKit(): Promise<CanvasKit> {
  if (!canvasKitPromise) {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("canvaskit-wasm/bin/canvaskit.wasm");
    const binDir = dirname(wasmPath);
    canvasKitPromise = CanvasKitInit({
      locateFile: (file: string) => resolve(binDir, file)
    });
  }

  return canvasKitPromise;
}

async function loadDefaultTypeface(CanvasKit: CanvasKit): Promise<Typeface | null> {
  if (!defaultTypefacePromise) {
    defaultTypefacePromise = loadTypefaceFromCandidates(CanvasKit);
  }
  return await defaultTypefacePromise;
}

const typefaceCache = new Map<string, Promise<Typeface | null>>();

// Named font registry: map a friendly name to a font file path so layers can
// set `font: "title"` instead of repeating absolute paths.
const fontRegistry = new Map<string, string>();

export function registerFont(name: string, path: string): void {
  fontRegistry.set(name, path);
}

export function unregisterFont(name: string): void {
  fontRegistry.delete(name);
}

export function clearFontRegistry(): void {
  fontRegistry.clear();
}

// Resolve a layer's `font` (a registered name or a direct path) to a path.
function resolveFontPath(font: string): string {
  return fontRegistry.get(font) ?? font;
}

// Per-layer font: a TextLayer/CaptionLayer may set `font` to a registered name
// or a font file path. Loaded once and cached; falls back to the default
// typeface if it fails.
async function loadTypeface(CanvasKit: CanvasKit, font?: string): Promise<Typeface | null> {
  if (!font) {
    return loadDefaultTypeface(CanvasKit);
  }
  const fontPath = resolveFontPath(font);
  let pending = typefaceCache.get(fontPath);
  if (!pending) {
    pending = readFile(fontPath)
      .then((data) => CanvasKit.Typeface.MakeTypefaceFromData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)))
      .catch(() => null);
    typefaceCache.set(fontPath, pending);
  }
  return (await pending) ?? (await loadDefaultTypeface(CanvasKit));
}

// Emoji fallback typeface — used to draw glyphs the primary font is missing.
let emojiTypefacePromise: Promise<Typeface | null> | undefined;
let emojiFontOverride: string | undefined;

export function registerEmojiFont(path: string): void {
  emojiFontOverride = path;
  emojiTypefacePromise = undefined;
}

async function loadEmojiTypeface(CanvasKit: CanvasKit): Promise<Typeface | null> {
  if (!emojiTypefacePromise) {
    const candidates = [
      emojiFontOverride,
      process.env.OPENHYPERCORE_EMOJI_FONT,
      "/System/Library/Fonts/Apple Color Emoji.ttc",
      "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
      "/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf",
      "/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf"
    ].filter((path): path is string => Boolean(path));
    emojiTypefacePromise = (async () => {
      for (const candidate of candidates) {
        try {
          const data = await readFile(candidate);
          const typeface = CanvasKit.Typeface.MakeTypefaceFromData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
          if (typeface) {
            return typeface;
          }
        } catch {
          // Try the next emoji-font candidate.
        }
      }
      return null;
    })();
  }
  return emojiTypefacePromise;
}

async function loadTypefaceFromCandidates(CanvasKit: CanvasKit): Promise<Typeface | null> {
  const candidates = [
    process.env.OPENHYPERCORE_FONT,
    // Neutral system fallback only — the per-composition `defaultFont` or
    // per-layer `font` chooses the typeface; nothing is hardcoded here.
    // CJK-capable defaults so Chinese/Japanese/Korean text renders out of the
    // box (their Latin glyphs are clean too). Latin-only fonts follow as
    // fallbacks for systems without a CJK family installed.
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/SFNS.ttf"
  ].filter((path): path is string => Boolean(path));

  for (const candidate of candidates) {
    try {
      const fontData = await readFile(candidate);
      const typeface = CanvasKit.Typeface.MakeTypefaceFromData(fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength));
      if (typeface) {
        return typeface;
      }
    } catch {
      // Try the next platform-specific candidate.
    }
  }

  return CanvasKit.Typeface.GetDefault();
}

const decodedImageCache = new Map<string, Promise<Image | null>>();
const DECODED_IMAGE_CACHE_MAX = 32;

async function loadDecodedImage(CanvasKit: CanvasKit, src: string): Promise<Image | null> {
  const key = resolve(src);
  let pending = decodedImageCache.get(key);
  if (pending) {
    decodedImageCache.delete(key);
    decodedImageCache.set(key, pending);
    return pending;
  }
  pending = readFile(key)
    .then((encoded) => CanvasKit.MakeImageFromEncoded(encoded))
    .catch(() => null);
  decodedImageCache.set(key, pending);
  if (decodedImageCache.size > DECODED_IMAGE_CACHE_MAX) {
    const oldest = decodedImageCache.entries().next().value;
    if (oldest) {
      decodedImageCache.delete(oldest[0]);
      void oldest[1].then((image) => image?.delete()).catch(() => undefined);
    }
  }
  return pending;
}

function makeImageFromRgbaFrame(CanvasKit: CanvasKit, frame: RgbaVideoFrame): NonNullable<ReturnType<CanvasKit["MakeImage"]>> | null {
  return CanvasKit.MakeImage({
    width: frame.width,
    height: frame.height,
    colorType: CanvasKit.ColorType.RGBA_8888,
    alphaType: CanvasKit.AlphaType.Unpremul,
    colorSpace: CanvasKit.ColorSpace.SRGB
  }, frame.pixels, frame.width * 4);
}

type VideoLayerAtTime = {
  layer: Extract<ResolvedLayer, { type: "video" }>;
  // Frame time on the layer's own timeline (group children live on the
  // group's local timeline).
  frameTimeMs: number;
};

function collectVideoLayers(layers: ResolvedLayer[], frameTimeMs: number, out: VideoLayerAtTime[] = []): VideoLayerAtTime[] {
  for (const layer of layers) {
    if (layer.type === "group") {
      collectVideoLayers(layer.layers, frameTimeMs - (layer.startMs ?? 0), out);
    } else if (layer.type === "video") {
      out.push({ layer, frameTimeMs });
    }
  }
  return out;
}

export async function prefetchVideoFrames(frame: ResolvedFrame, cache: VideoFrameCache): Promise<void> {
  const pending: Array<Promise<unknown>> = [];
  for (const { layer, frameTimeMs } of collectVideoLayers(frame.layers, frame.timeMs)) {
    if (layer.width && layer.height) {
      pending.push(cache.getSourceSize(layer.src).then((size) => cache.getRgbaFrame(layer.src, videoTimeForLayer(layer, frameTimeMs), size.width, size.height)));
      continue;
    }
    pending.push(cache.prefetch(layer.src, videoTimeForLayer(layer, frameTimeMs)));
  }

  await Promise.all(pending);
}

export async function prefetchVideoFrameBatch(frames: ResolvedFrame[], cache: VideoFrameCache): Promise<void> {
  const pngTimesBySource = new Map<string, number[]>();
  const rgbaGroups = new Map<string, { src: string; width: number; height: number; timeMsList: number[] }>();
  for (const frame of frames) {
    for (const { layer, frameTimeMs } of collectVideoLayers(frame.layers, frame.timeMs)) {
      const timeMs = videoTimeForLayer(layer, frameTimeMs);
      if (layer.width && layer.height) {
        const sourceSize = await cache.getSourceSize(layer.src);
        const key = `${layer.src}|${sourceSize.width}|${sourceSize.height}`;
        const group = rgbaGroups.get(key) ?? { src: layer.src, width: sourceSize.width, height: sourceSize.height, timeMsList: [] };
        group.timeMsList.push(timeMs);
        rgbaGroups.set(key, group);
        continue;
      }

      const times = pngTimesBySource.get(layer.src) ?? [];
      times.push(timeMs);
      pngTimesBySource.set(layer.src, times);
    }
  }

  await Promise.all([
    ...[...pngTimesBySource].map(([src, timeMsList]) => cache.prefetchFrames(src, timeMsList)),
    ...[...rgbaGroups.values()].map((group) => cache.prefetchRgbaFrames(group.src, group.timeMsList, group.width, group.height))
  ]);
}

// Map a frame time on the layer's timeline to a source time, honouring
// trimStart, playbackRate (speed) and loop. Exported for testing.
export function videoTimeForLayer(layer: Extract<ResolvedLayer, { type: "video" }>, frameTimeMs: number): number {
  const elapsed = Math.max(0, frameTimeMs - (layer.startMs ?? 0));
  const rate = layer.playbackRate && layer.playbackRate > 0 ? layer.playbackRate : 1;
  const trimStart = layer.trimStartMs ?? 0;
  let source = trimStart + elapsed * rate;
  // Loop the trimmed window so the source repeats for the layer's full span.
  if (layer.loop && layer.trimEndMs !== undefined) {
    const span = layer.trimEndMs - trimStart;
    if (span > 0) {
      source = trimStart + (((source - trimStart) % span) + span) % span;
    }
  }
  return Math.max(0, source);
}

function uniqueRoundedTimes(timeMsList: number[]): number[] {
  return [...new Set(timeMsList.map((timeMs) => Math.max(0, Math.round(timeMs))))].sort((a, b) => a - b);
}

function isUniformFrameSequence(timeMsList: number[]): boolean {
  if (timeMsList.length <= 1) {
    return true;
  }

  const stepMs = timeMsList[1]! - timeMsList[0]!;
  if (stepMs <= 0) {
    return false;
  }

  return timeMsList.every((timeMs, index) => index === 0 || Math.abs((timeMs - timeMsList[index - 1]!) - stepMs) <= 1);
}

// Persistent disk cache for decoded RGBA frames. Files are named by a hash of
// the (path + mtime/size + time + dims) cache key, so they are valid across
// processes and tasks and are safe to share between workers.
const DISK_RGBA_MAGIC = 0x4f48_5631; // "OHV1"

function diskCacheFilePath(dir: string, key: string): string {
  return join(dir, `${createHash("sha256").update(key).digest("hex")}.ohrgba`);
}

async function readRgbaFrameFromDisk(dir: string, key: string): Promise<RgbaVideoFrame | undefined> {
  try {
    const buffer = await readFile(diskCacheFilePath(dir, key));
    if (buffer.length < 12 || buffer.readUInt32LE(0) !== DISK_RGBA_MAGIC) {
      return undefined;
    }
    const width = buffer.readUInt32LE(4);
    const height = buffer.readUInt32LE(8);
    const pixels = buffer.subarray(12);
    if (width <= 0 || height <= 0 || pixels.length !== width * height * 4) {
      return undefined;
    }
    return { width, height, pixels: Buffer.from(pixels) };
  } catch {
    // Cache miss or unreadable entry — fall back to decoding.
    return undefined;
  }
}

async function writeRgbaFrameToDisk(dir: string, key: string, frame: RgbaVideoFrame): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const header = Buffer.alloc(12);
    header.writeUInt32LE(DISK_RGBA_MAGIC, 0);
    header.writeUInt32LE(frame.width, 4);
    header.writeUInt32LE(frame.height, 8);
    // Write to a unique temp file then rename, so concurrent workers never read
    // a half-written entry.
    const target = diskCacheFilePath(dir, key);
    const tmp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, Buffer.concat([header, frame.pixels]));
    await rename(tmp, target);
  } catch {
    // A best-effort cache: failures to persist must not break rendering.
  }
}

async function buildVideoFrameCacheKey(src: string, timeMs: number, width?: number, height?: number, format = "png"): Promise<string> {
  const resolvedSrc = resolve(src);
  const info = await stat(resolvedSrc);
  return [
    resolvedSrc,
    Math.max(0, Math.round(timeMs)),
    format,
    width ?? "source",
    height ?? "source",
    info.size,
    info.mtimeMs
  ].join("|");
}

async function extractVideoFramePng(src: string, timeMs: number, options: VideoFrameCacheOptions = {}): Promise<Buffer> {
  const ffmpegPath = options.ffmpegPath ?? await resolveDefaultFfmpegPath();
  const child = spawn(ffmpegPath, [
    ...(options.ffmpegArgsPrefix ?? []),
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    formatSeconds(timeMs / 1000),
    "-i",
    resolve(src),
    "-frames:v",
    "1",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "pipe:1"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const [exitCode, signal] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    const suffix = stderr ? `: ${stderr}` : signal ? `: signal ${signal}` : "";
    throw new Error(`ffmpeg video frame extraction failed with code ${exitCode}${suffix}`);
  }

  const png = Buffer.concat(stdoutChunks);
  if (png.length === 0) {
    throw new Error(`ffmpeg returned an empty video frame: ${src}`);
  }
  return png;
}

async function extractVideoFramesPng(src: string, timeMsList: number[], options: VideoFrameCacheOptions = {}): Promise<Buffer[]> {
  if (timeMsList.length === 0) {
    return [];
  }
  if (timeMsList.length === 1) {
    return [await extractVideoFramePng(src, timeMsList[0]!, options)];
  }

  const stepMs = timeMsList[1]! - timeMsList[0]!;
  const ffmpegPath = options.ffmpegPath ?? await resolveDefaultFfmpegPath();
  const child = spawn(ffmpegPath, [
    ...(options.ffmpegArgsPrefix ?? []),
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    formatSeconds(timeMsList[0]! / 1000),
    "-i",
    resolve(src),
    "-frames:v",
    String(timeMsList.length),
    "-vf",
    `fps=${formatNumber(1000 / stepMs)}`,
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "pipe:1"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const [exitCode, signal] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    const suffix = stderr ? `: ${stderr}` : signal ? `: signal ${signal}` : "";
    throw new Error(`ffmpeg video frame batch extraction failed with code ${exitCode}${suffix}`);
  }

  const frames = splitPngStream(Buffer.concat(stdoutChunks));
  if (frames.length !== timeMsList.length) {
    throw new Error(`ffmpeg returned ${frames.length} video frames, expected ${timeMsList.length}`);
  }
  return frames;
}

async function extractVideoFrameRgba(src: string, timeMs: number, width: number, height: number, options: VideoFrameCacheOptions = {}): Promise<RgbaVideoFrame> {
  const [frame] = await extractVideoFramesRgba(src, [timeMs], width, height, options);
  if (!frame) {
    throw new Error(`ffmpeg returned no raw video frame for time ${timeMs}ms`);
  }
  return frame;
}

async function extractVideoFramesRgba(src: string, timeMsList: number[], width: number, height: number, options: VideoFrameCacheOptions = {}): Promise<RgbaVideoFrame[]> {
  if (timeMsList.length === 0) {
    return [];
  }

  assertPositiveIntegerDimension(width, "width");
  assertPositiveIntegerDimension(height, "height");

  if (timeMsList.length === 1) {
    return await extractRgbaFrameSequence(src, timeMsList[0]!, 1, width, height, undefined, options);
  }

  const stepMs = timeMsList[1]! - timeMsList[0]!;
  return await extractRgbaFrameSequence(src, timeMsList[0]!, timeMsList.length, width, height, stepMs, options);
}

async function extractRgbaFrameSequence(
  src: string,
  startTimeMs: number,
  count: number,
  width: number,
  height: number,
  stepMs: number | undefined,
  options: VideoFrameCacheOptions
): Promise<RgbaVideoFrame[]> {
  const ffmpegPath = options.ffmpegPath ?? await resolveDefaultFfmpegPath();
  const filters = [`scale=${width}:${height}:flags=fast_bilinear`];
  if (stepMs !== undefined) {
    filters.unshift(`fps=${formatNumber(1000 / stepMs)}`);
  }

  const child = spawn(ffmpegPath, [
    ...(options.ffmpegArgsPrefix ?? []),
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    formatSeconds(startTimeMs / 1000),
    "-i",
    resolve(src),
    "-frames:v",
    String(count),
    "-vf",
    filters.join(","),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "pipe:1"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const [exitCode, signal] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    const suffix = stderr ? `: ${stderr}` : signal ? `: signal ${signal}` : "";
    throw new Error(`ffmpeg raw video frame extraction failed with code ${exitCode}${suffix}`);
  }

  const frameBytes = width * height * 4;
  const raw = Buffer.concat(stdoutChunks);
  const expectedBytes = frameBytes * count;
  if (raw.length !== expectedBytes) {
    throw new Error(`ffmpeg returned ${raw.length} raw video bytes, expected ${expectedBytes}`);
  }

  const frames: RgbaVideoFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    frames.push({
      width,
      height,
      pixels: Buffer.from(raw.subarray(index * frameBytes, (index + 1) * frameBytes))
    });
  }
  return frames;
}

function assertPositiveIntegerDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`VideoLayer ${name} must be a positive integer for raw RGBA decoding`);
  }
}

async function probeVideoFrameSize(src: string, options: VideoFrameCacheOptions = {}): Promise<VideoFrameSize> {
  const ffmpegPath = options.ffmpegPath ?? await resolveDefaultFfmpegPath();
  const child = spawn(ffmpegPath, [
    ...(options.ffmpegArgsPrefix ?? []),
    "-hide_banner",
    "-i",
    resolve(src),
    "-frames:v",
    "1",
    "-f",
    "null",
    "-"
  ], {
    stdio: ["ignore", "ignore", "pipe"]
  });

  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const [exitCode, signal] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  const size = parseVideoFrameSize(stderr);
  if (size) {
    return size;
  }

  const suffix = stderr.trim() ? `: ${stderr.trim()}` : signal ? `: signal ${signal}` : "";
  throw new Error(`ffmpeg could not probe video frame size for ${src} with code ${exitCode}${suffix}`);
}

function parseVideoFrameSize(stderr: string): VideoFrameSize | undefined {
  const videoLine = stderr.split(/\r?\n/).find((line) => line.includes("Video:"));
  const match = videoLine?.match(/,\s*(\d{1,5})x(\d{1,5})(?:\s*\[|[,\s]|$)/);
  if (!match) {
    return undefined;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}

function splitPngStream(stream: Buffer): Buffer[] {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const frames: Buffer[] = [];
  let offset = 0;

  while (offset < stream.length) {
    const start = stream.indexOf(signature, offset);
    if (start < 0) {
      break;
    }

    let cursor = start + signature.length;
    while (cursor + 12 <= stream.length) {
      const length = stream.readUInt32BE(cursor);
      const typeStart = cursor + 4;
      const type = stream.toString("ascii", typeStart, typeStart + 4);
      cursor += 8 + length + 4;
      if (type === "IEND") {
        frames.push(stream.subarray(start, cursor));
        offset = cursor;
        break;
      }
    }

    if (cursor > stream.length) {
      break;
    }
  }

  return frames;
}

async function resolveDefaultFfmpegPath(): Promise<string> {
  try {
    const ffmpegInstaller = await import("@ffmpeg-installer/ffmpeg");
    const candidate = (ffmpegInstaller.default as { path?: unknown } | undefined)?.path ?? (ffmpegInstaller as { path?: unknown }).path;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  } catch {
    // Fall back to PATH when the optional installer package is unavailable.
  }
  return "ffmpeg";
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

