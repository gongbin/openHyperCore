import CanvasKitInit from "canvaskit-wasm";
import type { CanvasKit, Canvas, Image, Surface, Typeface } from "canvaskit-wasm";
import canvaskitWasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";
import { resolveFrame } from "openhypercore";
import type { Composition } from "openhypercore";
import { drawFrameToCanvas } from "openhypercore/renderer-skia/draw";
import type { AssetProvider } from "openhypercore/renderer-skia/draw";

// The editor preview now runs the engine's REAL draw tree (openhypercore's
// browser-safe draw.ts) — the exact same code that renders the server MP4 — by
// pairing drawFrameToCanvas with a browser AssetProvider (fonts/images via
// fetch). No more hand-maintained mirror, so preview == final output for the
// supported feature set. Video frames aren't decoded in-browser yet (the
// provider returns null, so video layers are skipped in preview).

// CanvasKit's own demo font — a stable, CORS-enabled TTF on the Skia CDN, used
// when a text layer doesn't point at its own web font.
const DEFAULT_FONT_URL = "https://storage.googleapis.com/skia-cdn/misc/Roboto-Regular.ttf";

function isAssetUrl(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

// Fetch-based asset provider. Fonts/images are fetched + decoded by CanvasKit
// and cached by URL so repeated frames don't re-download.
function createBrowserAssetProvider(): AssetProvider {
  const typefaces = new Map<string, Promise<Typeface | null>>();
  const images = new Map<string, Promise<Image | null>>();
  // In-browser video decode isn't wired yet; the engine's drawVideo requires an
  // image, so hand it a small translucent-grey placeholder (drawn into the video
  // layer's box) instead of throwing. The final MP4 renders real frames.
  let videoPlaceholder: Image | null | undefined;

  const fetchTypeface = (ck: CanvasKit, url: string): Promise<Typeface | null> => {
    let p = typefaces.get(url);
    if (!p) {
      p = (async () => {
        try {
          const buf = await (await fetch(url)).arrayBuffer();
          return ck.Typeface.MakeFreeTypeFaceFromData(buf);
        } catch {
          return null;
        }
      })();
      typefaces.set(url, p);
    }
    return p;
  };

  return {
    loadTypeface: (ck, font) => fetchTypeface(ck, typeof font === "string" && isAssetUrl(font) ? font : DEFAULT_FONT_URL),
    loadDefaultTypeface: (ck) => fetchTypeface(ck, DEFAULT_FONT_URL),
    loadEmojiTypeface: async () => null,
    loadImage: (ck, src) => {
      let p = images.get(src);
      if (!p) {
        p = (async () => {
          try {
            if (!isAssetUrl(src)) return null;
            const buf = await (await fetch(src)).arrayBuffer();
            return ck.MakeImageFromEncoded(new Uint8Array(buf));
          } catch {
            return null;
          }
        })();
        images.set(src, p);
      }
      return p;
    },
    loadVideoImage: async (ck) => {
      if (videoPlaceholder === undefined) {
        const w = 8, h = 8;
        const px = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i += 1) { px[i * 4] = 40; px[i * 4 + 1] = 44; px[i * 4 + 2] = 52; px[i * 4 + 3] = 180; }
        videoPlaceholder = ck.MakeImage({ width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, px, w * 4);
      }
      return videoPlaceholder;
    }
  };
}

let ckPromise: Promise<CanvasKit> | undefined;
export function loadCanvasKit(): Promise<CanvasKit> {
  ckPromise ??= (CanvasKitInit as unknown as (o: { locateFile: () => string }) => Promise<CanvasKit>)({
    locateFile: () => canvaskitWasmUrl
  });
  return ckPromise;
}

export class PreviewRenderer {
  #ck: CanvasKit;
  #surface: Surface;
  #canvas: Canvas;
  #provider: AssetProvider;

  constructor(ck: CanvasKit, surface: Surface) {
    this.#ck = ck;
    this.#surface = surface;
    this.#canvas = surface.getCanvas();
    this.#provider = createBrowserAssetProvider();
  }

  static async create(canvasEl: HTMLCanvasElement): Promise<PreviewRenderer> {
    const ck = await loadCanvasKit();
    const surface = ck.MakeSWCanvasSurface(canvasEl);
    if (!surface) {
      throw new Error("canvaskit failed to create a surface for the preview canvas");
    }
    return new PreviewRenderer(ck, surface);
  }

  // drawFrameToCanvas clears to transparent and draws via the real engine tree;
  // the dark editor backdrop shows through transparent areas (matching the
  // engine, which also outputs a transparent frame unless a background exists).
  async renderFrame(composition: Composition, timeMs: number): Promise<void> {
    const frame = resolveFrame(composition, timeMs);
    await drawFrameToCanvas(this.#ck, this.#canvas, frame, { assetProvider: this.#provider });
    this.#surface.flush();
  }
}
