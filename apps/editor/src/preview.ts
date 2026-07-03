import CanvasKitInit from "canvaskit-wasm";
import type { CanvasKit, Canvas, Image, Surface, Typeface } from "canvaskit-wasm";
import canvaskitWasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";
import { resolveFrame } from "openhypercore";
import type { Composition } from "openhypercore";
import { drawFrameToCanvas } from "openhypercore/renderer-skia/draw";
import type { AssetProvider, ResolvedVideoLayer } from "openhypercore/renderer-skia/draw";
import { videoSourceTimeMs } from "./helpers.ts";
import type { AnyLayer } from "./helpers.ts";

// The editor preview runs the engine's REAL draw tree (openhypercore's
// browser-safe draw.ts) — the exact same code that renders the server MP4 — by
// pairing drawFrameToCanvas with a browser AssetProvider (fonts/images via
// fetch, video frames via a seeked <video> element).

// Default preview fonts, tried in order (the old skia-cdn Roboto now 403s).
// Noto Sans SC covers 中文 + latin so captions/titles preview correctly; the
// tiny Roboto WOFF is the fallback when the CJK download fails.
const DEFAULT_FONT_URLS = [
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
  "https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.1.0/files/roboto-latin-400-normal.woff"
];

function isAssetUrl(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

type VideoEntry = {
  el: HTMLVideoElement;
  ready: Promise<boolean>;
  lastTimeMs: number;
  lastImage: Image | null;
};

export class PreviewRenderer {
  #ck: CanvasKit;
  #surface: Surface;
  #canvas: Canvas;
  #provider: AssetProvider;
  #mediaSizes = new Map<string, { w: number; h: number }>();
  #videos = new Map<string, VideoEntry>();
  #typefaces = new Map<string, Promise<Typeface | null>>();
  #images = new Map<string, Promise<Image | null>>();

  constructor(ck: CanvasKit, surface: Surface) {
    this.#ck = ck;
    this.#surface = surface;
    this.#canvas = surface.getCanvas();
    this.#provider = this.#createProvider();
  }

  static async create(canvasEl: HTMLCanvasElement): Promise<PreviewRenderer> {
    const ck = await loadCanvasKit();
    const surface = ck.MakeSWCanvasSurface(canvasEl);
    if (!surface) throw new Error("canvaskit failed to create a surface for the preview canvas");
    const renderer = new PreviewRenderer(ck, surface);
    // Warm the default CJK font in the background so the first text layer
    // doesn't stall its first frame on an ~8MB download.
    void renderer.#defaultTypeface();
    return renderer;
  }

  /** Natural size of a decoded image/video source, once it has been seen. */
  mediaSize = (src: string): { w: number; h: number } | undefined => this.#mediaSizes.get(src);

  async renderFrame(composition: Composition, timeMs: number): Promise<void> {
    // Clamp defensively — a transient negative/NaN time must never kill the preview loop.
    const t = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
    const frame = resolveFrame(composition, t);
    await drawFrameToCanvas(this.#ck, this.#canvas, frame, { assetProvider: this.#provider });
    this.#surface.flush();
  }

  /** Recreate the surface after the <canvas> element's size attributes change. */
  resize(canvasEl: HTMLCanvasElement): void {
    const surface = this.#ck.MakeSWCanvasSurface(canvasEl);
    if (surface) {
      this.#surface = surface;
      this.#canvas = surface.getCanvas();
    }
  }

  #fetchTypeface(url: string): Promise<Typeface | null> {
    let p = this.#typefaces.get(url);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return this.#ck.Typeface.MakeFreeTypeFaceFromData(await res.arrayBuffer());
        } catch { return null; }
      })();
      this.#typefaces.set(url, p);
    }
    return p;
  }

  async #defaultTypeface(): Promise<Typeface | null> {
    for (const url of DEFAULT_FONT_URLS) {
      const tf = await this.#fetchTypeface(url);
      if (tf) return tf;
    }
    return null;
  }

  #videoEntry(src: string): VideoEntry {
    let entry = this.#videos.get(src);
    if (!entry) {
      const el = document.createElement("video");
      el.crossOrigin = "anonymous";
      el.muted = true;
      el.preload = "auto";
      el.src = src;
      const ready = new Promise<boolean>((resolve) => {
        el.addEventListener("loadeddata", () => {
          this.#mediaSizes.set(src, { w: el.videoWidth, h: el.videoHeight });
          resolve(true);
        }, { once: true });
        el.addEventListener("error", () => resolve(false), { once: true });
      });
      entry = { el, ready, lastTimeMs: -1, lastImage: null };
      this.#videos.set(src, entry);
    }
    return entry;
  }

  async #grabVideoFrame(src: string, sourceTimeMs: number): Promise<Image | null> {
    const entry = this.#videoEntry(src);
    if (!(await entry.ready)) return null;
    const el = entry.el;
    const durMs = Number.isFinite(el.duration) ? el.duration * 1000 : 0;
    const t = Math.max(0, Math.min(sourceTimeMs, Math.max(0, durMs - 1)));
    const quantized = Math.round(t);
    if (entry.lastImage && Math.abs(entry.lastTimeMs - quantized) < 8) return entry.lastImage;
    if (Math.abs(el.currentTime * 1000 - t) > 8) {
      el.currentTime = t / 1000;
      await new Promise<void>((resolve) => {
        const done = () => { el.removeEventListener("seeked", done); resolve(); };
        el.addEventListener("seeked", done);
        setTimeout(done, 900); // don't stall the preview on a slow seek
      });
    }
    try {
      const bmp = await createImageBitmap(el);
      const img = this.#ck.MakeImageFromCanvasImageSource(bmp);
      bmp.close();
      entry.lastImage?.delete();
      entry.lastImage = img;
      entry.lastTimeMs = quantized;
      return img;
    } catch {
      return entry.lastImage;
    }
  }

  #createProvider(): AssetProvider {
    return {
      loadTypeface: (_ck, font) => (typeof font === "string" && isAssetUrl(font)
        ? this.#fetchTypeface(font).then((tf) => tf ?? this.#defaultTypeface())
        : this.#defaultTypeface()),
      loadDefaultTypeface: () => this.#defaultTypeface(),
      loadEmojiTypeface: async () => null,
      loadImage: (_ck, src) => {
        let p = this.#images.get(src);
        if (!p) {
          p = (async () => {
            try {
              if (!isAssetUrl(src)) return null;
              const buf = await (await fetch(src)).arrayBuffer();
              const img = this.#ck.MakeImageFromEncoded(new Uint8Array(buf));
              if (img) this.#mediaSizes.set(src, { w: img.width(), h: img.height() });
              return img;
            } catch { return null; }
          })();
          this.#images.set(src, p);
        }
        return p;
      },
      loadVideoImage: async (_ck, layer: ResolvedVideoLayer, frameTimeMs: number) => {
        const src = layer.src;
        if (!isAssetUrl(src)) return null;
        const sourceMs = videoSourceTimeMs(layer as unknown as AnyLayer, frameTimeMs);
        return this.#grabVideoFrame(src, sourceMs);
      }
    };
  }
}

let ckPromise: Promise<CanvasKit> | undefined;
export function loadCanvasKit(): Promise<CanvasKit> {
  ckPromise ??= (CanvasKitInit as unknown as (o: { locateFile: () => string }) => Promise<CanvasKit>)({
    locateFile: () => canvaskitWasmUrl
  });
  return ckPromise;
}
