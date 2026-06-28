import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import CanvasKitInitModule from "canvaskit-wasm";
import type { Canvas, CanvasKit, CanvasKitInitOptions, EmbindEnumEntity, Font, Image, MallocObj, Paint, Shader, Typeface } from "canvaskit-wasm";
import type { BlendMode, Fill, Gradient, LayerClip, ResolvedFrame, ResolvedLayer, ResolvedTransform } from "../../core/src/index.ts";
import { LayerRasterCache } from "./layer-cache.ts";
import type { LayerRasterCacheOptions, LayerRasterEntry } from "./layer-cache.ts";

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
    const renderOptions = options.layerCache === undefined && this.#layerCache
      ? { ...options, layerCache: this.#layerCache }
      : options;
    await drawFrameToCanvas(CanvasKit, canvas, frame, renderOptions);
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
    await drawFrameToCanvas(CanvasKit, canvas, frame, options);
    return { CanvasKit, surface, canvas };
  } catch (error) {
    surface.dispose();
    throw error;
  }
}

async function drawFrameToCanvas(CanvasKit: CanvasKit, canvas: Canvas, frame: ResolvedFrame, options: RenderFrameOptions): Promise<void> {
  canvas.clear(CanvasKit.TRANSPARENT);

  if (options.videoFrameCache) {
    await prefetchVideoFrames(frame, options.videoFrameCache);
  }
  for (const layer of frame.layers) {
    await drawLayer(CanvasKit, canvas, layer, frame.timeMs, options);
  }
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

async function drawLayer(CanvasKit: CanvasKit, canvas: Canvas, layer: ResolvedLayer, frameTimeMs: number, options: RenderFrameOptions): Promise<void> {
  // Directional accumulation motion blur: draw the layer several times smeared
  // along the motion direction, each at reduced alpha.
  if (layer.motionBlur && layer.motionBlur.distance > 0 && (layer.motionBlur.samples ?? 8) > 1) {
    await drawMotionBlurred(CanvasKit, canvas, layer, frameTimeMs, options);
    return;
  }
  await drawLayerSample(CanvasKit, canvas, layer, frameTimeMs, options);
}

async function drawMotionBlurred(CanvasKit: CanvasKit, canvas: Canvas, layer: ResolvedLayer, frameTimeMs: number, options: RenderFrameOptions): Promise<void> {
  const { angle, distance } = layer.motionBlur!;
  const samples = Math.max(2, Math.min(64, Math.round(layer.motionBlur!.samples ?? 8)));
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) * distance;
  const dy = Math.sin(rad) * distance;
  const alpha = 1 / samples;
  // Strip motionBlur so each sample draws normally (no recursion).
  const { motionBlur: _omit, ...rest } = layer;
  const sampleLayer = rest as ResolvedLayer;

  for (let i = 0; i < samples; i += 1) {
    const offset = i / (samples - 1) - 0.5; // -0.5 .. 0.5 across the shutter
    const paint = new CanvasKit.Paint();
    paint.setAlphaf(alpha);
    canvas.save();
    canvas.translate(dx * offset, dy * offset);
    canvas.saveLayer(paint);
    try {
      await drawLayerSample(CanvasKit, canvas, sampleLayer, frameTimeMs, options);
    } finally {
      canvas.restore();
      canvas.restore();
      paint.delete();
    }
  }
}

async function drawLayerSample(CanvasKit: CanvasKit, canvas: Canvas, layer: ResolvedLayer, frameTimeMs: number, options: RenderFrameOptions): Promise<void> {
  canvas.save();
  canvas.translate(layer.transform.x, layer.transform.y);
  canvas.scale(layer.transform.scale * layer.transform.scaleX, layer.transform.scale * layer.transform.scaleY);
  canvas.rotate(layer.transform.rotate, 0, 0);

  // Blend mode + full-layer gaussian blur are applied by compositing the layer
  // through a single saveLayer paint. Shapes blur via their own mask filter, so
  // the layer-level blur skips them.
  const blend = layer.blendMode && layer.blendMode !== "normal" ? toBlendMode(CanvasKit, layer.blendMode) : undefined;
  const wantsBlur = layer.blur !== undefined && layer.blur > 0 && layer.type !== "shape";
  let wrapPaint: Paint | undefined;
  let blurFilter: ReturnType<CanvasKit["ImageFilter"]["MakeBlur"]> | undefined;
  if (blend !== undefined || wantsBlur) {
    wrapPaint = new CanvasKit.Paint();
    if (blend !== undefined) {
      wrapPaint.setBlendMode(blend);
    }
    if (wantsBlur) {
      blurFilter = CanvasKit.ImageFilter.MakeBlur(layer.blur!, layer.blur!, CanvasKit.TileMode.Decal, null);
      wrapPaint.setImageFilter(blurFilter);
    }
    canvas.saveLayer(wrapPaint);
  }

  // Arbitrary per-layer clip in the layer's local space; scoped by the
  // save()/restore() wrapping this draw, so it applies to the content below
  // (including a whole group subtree).
  if (layer.clip) {
    applyLayerClip(CanvasKit, canvas, layer.clip);
  }

  try {
    switch (layer.type) {
      case "shape":
        drawShape(CanvasKit, canvas, layer);
        return;
      case "text":
        await drawText(CanvasKit, canvas, layer);
        return;
      case "caption":
        await drawCaption(CanvasKit, canvas, layer);
        return;
      case "image":
        await drawImage(CanvasKit, canvas, layer);
        return;
      case "video":
        await drawVideo(CanvasKit, canvas, layer, frameTimeMs, options);
        return;
      case "group":
        await drawGroup(CanvasKit, canvas, layer, frameTimeMs, options);
        return;
      default:
        return;
    }
  } finally {
    if (wrapPaint) {
      canvas.restore();
      wrapPaint.delete();
      blurFilter?.delete();
    }
    canvas.restore();
  }
}

// Map an IR blend mode to a CanvasKit blend mode.
function toBlendMode(CanvasKit: CanvasKit, mode: BlendMode): EmbindEnumEntity {
  const B = CanvasKit.BlendMode;
  switch (mode) {
    case "multiply": return B.Multiply;
    case "screen": return B.Screen;
    case "overlay": return B.Overlay;
    case "darken": return B.Darken;
    case "lighten": return B.Lighten;
    case "add": return B.Plus;
    case "color-dodge": return B.ColorDodge;
    case "color-burn": return B.ColorBurn;
    case "soft-light": return B.SoftLight;
    case "hard-light": return B.HardLight;
    case "difference": return B.Difference;
    case "exclusion": return B.Exclusion;
    case "hue": return B.Hue;
    case "saturation": return B.Saturation;
    case "color": return B.Color;
    case "luminosity": return B.Luminosity;
    default: return B.SrcOver;
  }
}

async function drawGroup(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "group" }>, frameTimeMs: number, options: RenderFrameOptions): Promise<void> {
  // Children were resolved on the group's local timeline, so video time
  // lookups inside the group need the local frame time too.
  const localTimeMs = frameTimeMs - (layer.startMs ?? 0);
  // Reveal mask: clip the group to the revealed region. Fully hidden groups
  // skip drawing entirely; fully revealed ones skip the clip.
  if (layer.reveal && layer.reveal.progress <= 0) {
    return;
  }
  const opacity = layer.transform.opacity;
  if (opacity <= 0) {
    return;
  }

  // Static-subtree raster cache: when the group's resolved CONTENT repeats
  // across frames AND drawing it directly is measurably slower than blitting
  // a snapshot, the children are rastered once and blitted afterwards.
  // Transform, opacity and reveal progress stay live on the blit, so fades,
  // slides, flips and wipes over a cached scene keep hitting one entry. Video
  // children are excluded (their pixels change without the resolved IR
  // changing).
  const cache = options.layerCache || undefined;
  const cacheable = cache !== undefined && layer.cache !== false && !subtreeHasVideo(layer.layers);
  const key = cacheable ? groupContentKey(layer) : undefined;
  if (cache && key !== undefined) {
    let entry = cache.get(key);
    if (!entry && cache.shouldConsider(key)) {
      entry = await rasterGroupEntry(CanvasKit, cache, key, layer, localTimeMs, options);
    }
    if (entry) {
      if (layer.reveal && layer.reveal.progress < 1) {
        applyRevealClip(CanvasKit, canvas, layer.reveal);
      }
      const startedAt = performance.now();
      drawCachedEntry(CanvasKit, canvas, entry, opacity);
      cache.recordBlit(entry.bytes / 4, performance.now() - startedAt);
      return;
    }
  }

  if (layer.reveal && layer.reveal.progress < 1) {
    applyRevealClip(CanvasKit, canvas, layer.reveal);
  }
  // Group opacity composites the children as ONE unit (saveLayer with alpha),
  // so overlapping children fade together instead of double-blending.
  let layerPaint: Paint | undefined;
  if (opacity < 1) {
    layerPaint = new CanvasKit.Paint();
    layerPaint.setAlphaf(Math.max(0, opacity));
    canvas.saveLayer(layerPaint);
  }
  const startedAt = performance.now();
  try {
    for (const child of layer.layers) {
      await drawLayer(CanvasKit, canvas, child, localTimeMs, options);
    }
  } finally {
    if (layerPaint) {
      canvas.restore();
      layerPaint.delete();
    }
  }
  if (cache && key !== undefined) {
    cache.recordDraw(key, performance.now() - startedAt);
  }
}

function subtreeHasVideo(layers: ResolvedLayer[]): boolean {
  return layers.some((layer) => layer.type === "video" || (layer.type === "group" && subtreeHasVideo(layer.layers)));
}

// Hash of everything that affects the rastered pixels: the resolved children
// (with their transforms) and the group's non-transform props. The group's own
// transform and the reveal mask are applied at blit time, so they are excluded
// — animating them keeps hitting the same entry.
function groupContentKey(layer: Extract<ResolvedLayer, { type: "group" }>): string {
  // The group's own transform, reveal, clip, blend mode, blur and motion blur
  // are all applied at BLIT time (in drawLayerSample/drawGroup), not baked into
  // the cached child raster — so they are excluded here and animating them keeps
  // hitting the same entry.
  const { transform, reveal, clip, blendMode, blur, motionBlur, ...content } = layer;
  void transform;
  void reveal;
  void clip;
  void blendMode;
  void blur;
  void motionBlur;
  return createHash("sha1").update(JSON.stringify(content)).digest("base64");
}

async function rasterGroupEntry(
  CanvasKit: CanvasKit,
  cache: LayerRasterCache,
  key: string,
  layer: Extract<ResolvedLayer, { type: "group" }>,
  localTimeMs: number,
  options: RenderFrameOptions
): Promise<LayerRasterEntry | undefined> {
  const bounds = await groupContentBounds(CanvasKit, layer.layers);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    cache.reject(key);
    return undefined;
  }
  // Snap outwards to whole pixels with a 1px guard band for anti-aliasing.
  const x = Math.floor(bounds.x) - 1;
  const y = Math.floor(bounds.y) - 1;
  const width = Math.ceil(bounds.x + bounds.w) + 1 - x;
  const height = Math.ceil(bounds.y + bounds.h) + 1 - y;
  if (width > 8192 || height > 8192 || !cache.admits(width * height * 4)) {
    cache.reject(key);
    return undefined;
  }
  // The cost gate: blitting costs real CPU (~20ns/px in canvaskit-wasm), so
  // only content whose direct draw is clearly slower gets cached.
  if (!cache.worthRastering(key, width * height)) {
    cache.reject(key);
    return undefined;
  }

  const surface = CanvasKit.MakeSurface(width, height);
  if (!surface) {
    return undefined;
  }
  try {
    const rasterCanvas = surface.getCanvas();
    rasterCanvas.clear(CanvasKit.TRANSPARENT);
    rasterCanvas.translate(-x, -y);
    for (const child of layer.layers) {
      await drawLayer(CanvasKit, rasterCanvas, child, localTimeMs, options);
    }
    surface.flush();
    const image = surface.makeImageSnapshot();
    if (!image) {
      surface.dispose();
      return undefined;
    }
    const entry: LayerRasterEntry = { image, surface, x, y, bytes: width * height * 4 };
    if (!cache.set(key, entry)) {
      image.delete();
      surface.dispose();
      return undefined;
    }
    return entry;
  } catch (error) {
    surface.dispose();
    throw error;
  }
}

// Blit a cached snapshot in the group's local space. Paint alpha flattens the
// whole snapshot at once — the same semantics as the saveLayer path.
function drawCachedEntry(CanvasKit: CanvasKit, canvas: Canvas, entry: LayerRasterEntry, opacity: number): void {
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(true);
  if (opacity < 1) {
    paint.setAlphaf(Math.max(0, opacity));
  }
  try {
    canvas.drawImageOptions(entry.image, entry.x, entry.y, CanvasKit.FilterMode.Linear, CanvasKit.MipmapMode.None, paint);
  } finally {
    paint.delete();
  }
}

// Clip the canvas (already in the group's local space) to the reveal mask.
// The per-layer save()/restore() in drawLayer scopes the clip.
function applyRevealClip(CanvasKit: CanvasKit, canvas: Canvas, reveal: NonNullable<Extract<ResolvedLayer, { type: "group" }>["reveal"]>): void {
  const { width, height } = reveal;
  const progress = Math.min(1, Math.max(0, reveal.progress));

  if (reveal.type === "clock") {
    // Wedge sweeping clockwise from 12 o'clock around the box centre; the
    // radius covers the corners so the wedge always spans the full box.
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.hypot(width, height) / 2;
    const builder = new CanvasKit.PathBuilder();
    builder.moveTo(cx, cy);
    builder.lineTo(cx, cy - radius);
    builder.arcToOval(CanvasKit.XYWHRect(cx - radius, cy - radius, radius * 2, radius * 2), -90, progress * 360, false);
    builder.close();
    const path = builder.detachAndDelete();
    try {
      canvas.clipPath(path, CanvasKit.ClipOp.Intersect, true);
    } finally {
      path.delete();
    }
    return;
  }

  // Wipe: a rect sweeping across the box from `direction`.
  const direction = reveal.direction ?? "from-left";
  let rect;
  if (direction === "from-right") {
    rect = CanvasKit.XYWHRect(width * (1 - progress), 0, width * progress, height);
  } else if (direction === "from-top") {
    rect = CanvasKit.XYWHRect(0, 0, width, height * progress);
  } else if (direction === "from-bottom") {
    rect = CanvasKit.XYWHRect(0, height * (1 - progress), width, height * progress);
  } else {
    rect = CanvasKit.XYWHRect(0, 0, width * progress, height);
  }
  canvas.clipRect(rect, CanvasKit.ClipOp.Intersect, true);
}

// Clip the canvas (already in the layer's local space) to an arbitrary region.
function applyLayerClip(CanvasKit: CanvasKit, canvas: Canvas, clip: LayerClip): void {
  if (clip.type === "circle") {
    const cx = clip.cx ?? clip.radius;
    const cy = clip.cy ?? clip.radius;
    const rrect = CanvasKit.RRectXY(CanvasKit.XYWHRect(cx - clip.radius, cy - clip.radius, 2 * clip.radius, 2 * clip.radius), clip.radius, clip.radius);
    canvas.clipRRect(rrect, CanvasKit.ClipOp.Intersect, true);
    return;
  }
  if (clip.type === "rect") {
    const x = clip.x ?? 0;
    const y = clip.y ?? 0;
    if (clip.radius && clip.radius > 0) {
      const rrect = CanvasKit.RRectXY(CanvasKit.XYWHRect(x, y, clip.width, clip.height), clip.radius, clip.radius);
      canvas.clipRRect(rrect, CanvasKit.ClipOp.Intersect, true);
    } else {
      canvas.clipRect(CanvasKit.XYWHRect(x, y, clip.width, clip.height), CanvasKit.ClipOp.Intersect, true);
    }
    return;
  }
  const path = CanvasKit.Path.MakeFromSVGString(clip.path);
  if (!path) {
    return;
  }
  try {
    if (clip.fillRule === "evenodd") {
      path.setFillType(CanvasKit.FillType.EvenOdd);
    }
    canvas.clipPath(path, CanvasKit.ClipOp.Intersect, true);
  } finally {
    path.delete();
  }
}

function drawShape(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "shape" }>): void {
  const { paint, shader } = makeFillPaint(CanvasKit, layer.fill ?? "#000", layer.transform.opacity);
  let blur: ReturnType<CanvasKit["MaskFilter"]["MakeBlur"]> | undefined;
  let dash: ReturnType<CanvasKit["PathEffect"]["MakeDash"]> | undefined;
  try {
    if (layer.stroke) {
      // A stroke replaces the fill: drop any gradient shader so the outline
      // uses the solid stroke color.
      paint.setShader(null);
      paint.setStyle(CanvasKit.PaintStyle.Stroke);
      paint.setStrokeWidth(layer.strokeWidth ?? 1);
      paint.setColor(parseColor(CanvasKit, layer.stroke, layer.transform.opacity));
    }

    // Dashed stroke (e.g. paper-cut "marching ants" cutout rings).
    if (layer.dash && layer.dash.length >= 2) {
      dash = CanvasKit.PathEffect.MakeDash(layer.dash, layer.dashPhase ?? 0);
      if (dash) {
        paint.setPathEffect(dash);
      }
    }

    if (layer.blur && layer.blur > 0) {
      blur = CanvasKit.MaskFilter.MakeBlur(CanvasKit.BlurStyle.Normal, layer.blur, false);
      paint.setMaskFilter(blur);
    }

    if (layer.shape === "circle") {
      const radius = layer.radius ?? Math.min(layer.width ?? 0, layer.height ?? 0) / 2;
      canvas.drawCircle(radius, radius, radius, paint);
      return;
    }

    if (layer.shape === "path" && layer.path) {
      const path = CanvasKit.Path.MakeFromSVGString(layer.path);
      if (path) {
        try {
          canvas.drawPath(path, paint);
        } finally {
          path.delete();
        }
      }
      return;
    }

    canvas.drawRect(CanvasKit.XYWHRect(0, 0, layer.width ?? 0, layer.height ?? 0), paint);
  } finally {
    paint.delete();
    shader?.delete();
    blur?.delete();
    dash?.delete();
  }
}

type TextStyle = {
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowDx?: number;
  shadowDy?: number;
};

// A font stack: the primary typeface followed by emoji/default fallbacks. Each
// character is drawn with the first font in the stack that has a glyph for it,
// so emoji and missing CJK glyphs fall back instead of rendering as tofu.
type FontRun = { fontIndex: number; text: string };

function splitRuns(stack: Font[], text: string): FontRun[] {
  const runs: FontRun[] = [];
  for (const ch of text) {
    let fontIndex = 0;
    for (let i = 0; i < stack.length; i++) {
      const ids = stack[i]!.getGlyphIDs(ch);
      if (ids[0]) {
        fontIndex = i;
        break;
      }
    }
    const last = runs[runs.length - 1];
    if (last && last.fontIndex === fontIndex) {
      last.text += ch;
    } else {
      runs.push({ fontIndex, text: ch });
    }
  }
  return runs;
}

// Sum the advance widths of a string's glyphs in the given font — exact
// glyph measurement, used for auto-wrapping and per-line alignment.
function measureTextWidth(font: Font, text: string): number {
  if (text === "") {
    return 0;
  }
  const ids = font.getGlyphIDs(text);
  const widths = font.getGlyphWidths(ids);
  let sum = 0;
  for (const w of widths) {
    sum += w;
  }
  return sum;
}

// Total width of a string across the font stack (fallbacks included).
function measureStack(stack: Font[], text: string): number {
  let sum = 0;
  for (const run of splitRuns(stack, text)) {
    sum += measureTextWidth(stack[run.fontIndex]!, run.text);
  }
  return sum;
}

// Draw each run with its resolved font, advancing x by the run's width.
function drawRuns(canvas: Canvas, runs: FontRun[], stack: Font[], x: number, baselineY: number, paint: Paint): void {
  let cursor = x;
  for (const run of runs) {
    const font = stack[run.fontIndex]!;
    canvas.drawText(run.text, cursor, baselineY, paint, font);
    cursor += measureTextWidth(font, run.text);
  }
}

// Draws a styled line as: soft shadow → outline stroke → fill, so titles and
// captions read clearly against busy video. Per-character font fallback is
// applied via the font stack.
function drawStyledText(CanvasKit: CanvasKit, canvas: Canvas, text: string, x: number, baselineY: number, color: Fill, opacity: number, stack: Font[], style: TextStyle): void {
  const runs = splitRuns(stack, text);

  if (style.shadowColor) {
    const shadowPaint = makePaint(CanvasKit, style.shadowColor, opacity);
    const blur = CanvasKit.MaskFilter.MakeBlur(CanvasKit.BlurStyle.Normal, Math.max(0.1, style.shadowBlur ?? 6), false);
    shadowPaint.setMaskFilter(blur);
    try {
      drawRuns(canvas, runs, stack, x + (style.shadowDx ?? 0), baselineY + (style.shadowDy ?? 4), shadowPaint);
    } finally {
      blur.delete();
      shadowPaint.delete();
    }
  }

  if (style.stroke) {
    const strokePaint = makePaint(CanvasKit, style.stroke, opacity);
    strokePaint.setStyle(CanvasKit.PaintStyle.Stroke);
    strokePaint.setStrokeWidth(style.strokeWidth ?? 4);
    strokePaint.setStrokeJoin(CanvasKit.StrokeJoin.Round);
    strokePaint.setStrokeCap(CanvasKit.StrokeCap.Round);
    try {
      drawRuns(canvas, runs, stack, x, baselineY, strokePaint);
    } finally {
      strokePaint.delete();
    }
  }

  const { paint: fillPaint, shader: fillShader } = makeFillPaint(CanvasKit, color, opacity);
  try {
    drawRuns(canvas, runs, stack, x, baselineY, fillPaint);
  } finally {
    fillPaint.delete();
    fillShader?.delete();
  }
}

// Build the per-character fallback stack for a layer's font at a given size:
// [primary, emoji, default], de-duplicated by typeface identity.
async function loadFontStack(CanvasKit: CanvasKit, size: number, font?: string): Promise<Font[]> {
  const typefaces = [
    await loadTypeface(CanvasKit, font),
    await loadEmojiTypeface(CanvasKit),
    await loadDefaultTypeface(CanvasKit)
  ].filter((t, i, all): t is Typeface => t !== null && all.indexOf(t) === i);

  return typefaces.map((typeface) => {
    const f = new CanvasKit.Font(typeface, size);
    f.setEdging(CanvasKit.FontEdging.AntiAlias);
    return f;
  });
}

function deleteFontStack(stack: Font[]): void {
  for (const f of stack) {
    f.delete();
  }
}

// Atomic units that must not be split: optional leading spaces followed by
// either a single CJK/full-width char or a run of non-space, non-CJK chars
// (a "word"). Lets us greedily wrap Latin on word boundaries and CJK per char.
const WRAP_TOKEN = /\s*(?:[⺀-鿿　-〿＀-￯]|[^\s⺀-鿿　-〿＀-￯]+)/gu;

function wrapText(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    return text.split("\n");
  }
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const match of paragraph.matchAll(WRAP_TOKEN)) {
      const token = match[0];
      const candidate = line + token;
      if (line !== "" && measure(candidate) > maxWidth) {
        lines.push(line);
        line = token.replace(/^\s+/, "");
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

// Per-line x offset for the given alignment, resolved against each line's own
// measured width so multi-line blocks centre/right-align correctly.
function lineX(align: Extract<ResolvedLayer, { type: "caption" }>["align"], width: number): number {
  if (align === "center") {
    return -width / 2;
  }
  if (align === "right") {
    return -width;
  }
  return 0;
}

async function drawText(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "text" }>): Promise<void> {
  const size = layer.size ?? 16;
  const stack = await loadFontStack(CanvasKit, size, layer.font);

  try {
    const lineHeight = layer.lineHeight ?? size * 1.2;
    const lines = layer.maxWidth ? wrapText((t) => measureStack(stack, t), layer.text, layer.maxWidth) : layer.text.split("\n");
    lines.forEach((line, index) => {
      const x = lineX(layer.align, measureStack(stack, line));
      drawStyledText(CanvasKit, canvas, line, x, index * lineHeight, layer.color ?? "#000", layer.transform.opacity, stack, layer);
    });
  } finally {
    deleteFontStack(stack);
  }
}

async function drawCaption(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "caption" }>): Promise<void> {
  const size = layer.size ?? 32;
  const lineHeight = layer.lineHeight ?? size * 1.2;
  const padding = layer.padding ?? 8;

  const stack = await loadFontStack(CanvasKit, size, layer.font);
  try {
    const measure = (t: string) => measureStack(stack, t);
    const lines = layer.maxWidth ? wrapText(measure, layer.text, layer.maxWidth) : layer.text.split("\n");
    const blockWidth = layer.maxWidth ?? Math.max(0, ...lines.map(measure));

    if (layer.backgroundColor) {
      const bgX = lineX(layer.align, blockWidth);
      const { paint: backgroundPaint, shader: backgroundShader } = makeFillPaint(CanvasKit, layer.backgroundColor, layer.transform.opacity);
      try {
        canvas.drawRect(
          CanvasKit.XYWHRect(bgX - padding, -lineHeight - padding, blockWidth + padding * 2, lineHeight * lines.length + padding * 2),
          backgroundPaint
        );
      } finally {
        backgroundPaint.delete();
        backgroundShader?.delete();
      }
    }

    lines.forEach((line, index) => {
      const x = lineX(layer.align, measure(line));
      drawStyledText(CanvasKit, canvas, line, x, index * lineHeight, layer.color ?? "#fff", layer.transform.opacity, stack, layer);
    });
  } finally {
    deleteFontStack(stack);
  }
}

type Rect = { x: number; y: number; w: number; h: number };

// Map a source image into a destination box honouring `fit`:
//  - "fill" (default): stretch to the box (legacy behaviour)
//  - "cover": fill the box, centre-cropping the overflow
//  - "contain": fit entirely inside the box, letterboxed/centred
function fitRects(srcW: number, srcH: number, dstW: number, dstH: number, fit?: "cover" | "contain" | "fill"): { src: Rect; dst: Rect } {
  const full = { src: { x: 0, y: 0, w: srcW, h: srcH }, dst: { x: 0, y: 0, w: dstW, h: dstH } };
  if (!fit || fit === "fill" || srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return full;
  }
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (fit === "cover") {
    let cw = srcW;
    let ch = srcH;
    if (srcAspect > dstAspect) { cw = srcH * dstAspect; } else { ch = srcW / dstAspect; }
    return { src: { x: (srcW - cw) / 2, y: (srcH - ch) / 2, w: cw, h: ch }, dst: { x: 0, y: 0, w: dstW, h: dstH } };
  }
  // contain
  let dw = dstW;
  let dh = dstH;
  if (srcAspect > dstAspect) { dh = dstW / srcAspect; } else { dw = dstH * srcAspect; }
  return { src: { x: 0, y: 0, w: srcW, h: srcH }, dst: { x: (dstW - dw) / 2, y: (dstH - dh) / 2, w: dw, h: dh } };
}

// Decoded-image cache keyed by resolved path: image layers were previously
// re-read and re-decoded EVERY frame. Entries are owned by the cache (callers
// must not delete them) and evicted LRU beyond the cap.
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

async function drawImage(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "image" }>): Promise<void> {
  const image = await loadDecodedImage(CanvasKit, layer.src);
  if (!image) {
    throw new Error(`CanvasKit failed to decode image: ${layer.src}`);
  }

  const paint = makePaint(CanvasKit, "#ffffff", layer.transform.opacity);
  try {
    const width = layer.width ?? image.width();
    const height = layer.height ?? image.height();
    const { src: s, dst: d } = fitRects(image.width(), image.height(), width, height, layer.fit);
    canvas.drawImageRect(image, CanvasKit.XYWHRect(s.x, s.y, s.w, s.h), CanvasKit.XYWHRect(d.x, d.y, d.w, d.h), paint, false);
  } finally {
    paint.delete();
  }
}

// ---------------------------------------------------------------------------
// Conservative layer bounds — used to size the raster-cache surface for a
// group. Bounds are in the layer's LOCAL space (before its own transform) and
// deliberately generous: a few wasted pixels are fine, clipped content is not.
// `undefined` means "unknown" and disables caching for the subtree.
// ---------------------------------------------------------------------------

async function groupContentBounds(CanvasKit: CanvasKit, layers: ResolvedLayer[]): Promise<Rect | undefined> {
  let union: Rect | undefined;
  for (const layer of layers) {
    const local = await layerLocalBounds(CanvasKit, layer);
    if (!local) {
      return undefined;
    }
    if (local.w <= 0 || local.h <= 0) {
      continue;
    }
    const inParent = transformRect(local, layer.transform);
    union = union ? unionRect(union, inParent) : inParent;
  }
  return union ?? { x: 0, y: 0, w: 0, h: 0 };
}

async function layerLocalBounds(CanvasKit: CanvasKit, layer: ResolvedLayer): Promise<Rect | undefined> {
  switch (layer.type) {
    case "shape":
      return shapeBounds(CanvasKit, layer);
    case "text":
      return await textLayerBounds(CanvasKit, layer);
    case "caption":
      return await captionLayerBounds(CanvasKit, layer);
    case "image":
      return await imageLayerBounds(CanvasKit, layer);
    case "group":
      return await groupContentBounds(CanvasKit, layer.layers);
    case "audio":
      return { x: 0, y: 0, w: 0, h: 0 };
    default:
      // Video (and anything new) is not cacheable — its pixels change without
      // the resolved IR changing.
      return undefined;
  }
}

// Map a local rect through a resolved transform (translate → scale → rotate,
// matching drawLayer's canvas ops) and return the axis-aligned cover.
function transformRect(rect: Rect, t: ResolvedTransform): Rect {
  const sx = t.scale * t.scaleX;
  const sy = t.scale * t.scaleY;
  const rad = (t.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]] as const) {
    const X = t.x + (px * cos - py * sin) * sx;
    const Y = t.y + (px * sin + py * cos) * sy;
    minX = Math.min(minX, X);
    minY = Math.min(minY, Y);
    maxX = Math.max(maxX, X);
    maxY = Math.max(maxY, Y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function expandRect(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
}

function shapeBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "shape" }>): Rect | undefined {
  // Stroke is centred on the outline (half outside) and blur bleeds ~3 sigma.
  const pad = (layer.stroke ? (layer.strokeWidth ?? 1) : 0) + (layer.blur ? layer.blur * 3 : 0);
  if (layer.shape === "circle") {
    const radius = layer.radius ?? Math.min(layer.width ?? 0, layer.height ?? 0) / 2;
    return expandRect({ x: 0, y: 0, w: radius * 2, h: radius * 2 }, pad);
  }
  if (layer.shape === "path" && layer.path) {
    const path = CanvasKit.Path.MakeFromSVGString(layer.path);
    if (!path) {
      // Invalid SVG draws nothing.
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    try {
      const b = path.computeTightBounds();
      return expandRect({ x: b[0]!, y: b[1]!, w: b[2]! - b[0]!, h: b[3]! - b[1]! }, pad);
    } finally {
      path.delete();
    }
  }
  return expandRect({ x: 0, y: 0, w: layer.width ?? 0, h: layer.height ?? 0 }, pad);
}

// Padding for text styling: outline stroke, drop shadow offset + blur bleed,
// plus a small slack for fallback-font metric differences.
function textStylePad(layer: { stroke?: string; strokeWidth?: number; shadowColor?: string; shadowBlur?: number; shadowDx?: number; shadowDy?: number }, size: number): number {
  const strokePad = layer.stroke ? (layer.strokeWidth ?? 4) : 0;
  const shadowPad = layer.shadowColor
    ? Math.max(Math.abs(layer.shadowDx ?? 0), Math.abs(layer.shadowDy ?? 4)) + (layer.shadowBlur ?? 6) * 3
    : 0;
  return strokePad + shadowPad + size * 0.25;
}

// Bounds of the drawn text block: baselines run y = 0, lineHeight, …; allow a
// generous ascent above the first baseline and descent below the last.
async function textBlockBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "text" | "caption" }>, size: number, lineHeight: number): Promise<{ rect: Rect; lines: number; blockWidth: number }> {
  const stack = await loadFontStack(CanvasKit, size, layer.font);
  try {
    const measure = (t: string) => measureStack(stack, t);
    const lines = layer.maxWidth ? wrapText(measure, layer.text, layer.maxWidth) : layer.text.split("\n");
    let minX = 0;
    let maxX = 0;
    let maxWidth = 0;
    for (const line of lines) {
      const w = measure(line);
      const x = lineX(layer.align, w);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + w);
      maxWidth = Math.max(maxWidth, w);
    }
    const top = -size * 1.2;
    const bottom = (lines.length - 1) * lineHeight + size * 0.6;
    return {
      rect: { x: minX, y: top, w: maxX - minX, h: bottom - top },
      lines: lines.length,
      blockWidth: maxWidth
    };
  } finally {
    deleteFontStack(stack);
  }
}

async function textLayerBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "text" }>): Promise<Rect> {
  const size = layer.size ?? 16;
  const lineHeight = layer.lineHeight ?? size * 1.2;
  const { rect } = await textBlockBounds(CanvasKit, layer, size, lineHeight);
  return expandRect(rect, textStylePad(layer, size));
}

async function captionLayerBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "caption" }>): Promise<Rect> {
  const size = layer.size ?? 32;
  const lineHeight = layer.lineHeight ?? size * 1.2;
  const padding = layer.padding ?? 8;
  const { rect, lines, blockWidth } = await textBlockBounds(CanvasKit, layer, size, lineHeight);
  const bgWidth = layer.maxWidth ?? blockWidth;
  const background: Rect = {
    x: lineX(layer.align, bgWidth) - padding,
    y: -lineHeight - padding,
    w: bgWidth + padding * 2,
    h: lineHeight * lines + padding * 2
  };
  return expandRect(unionRect(rect, background), textStylePad(layer, size));
}

async function imageLayerBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "image" }>): Promise<Rect | undefined> {
  if (layer.width !== undefined && layer.height !== undefined) {
    return { x: 0, y: 0, w: layer.width, h: layer.height };
  }
  const image = await loadDecodedImage(CanvasKit, layer.src);
  if (!image) {
    return undefined;
  }
  return { x: 0, y: 0, w: layer.width ?? image.width(), h: layer.height ?? image.height() };
}

async function drawVideo(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "video" }>, frameTimeMs: number, options: RenderFrameOptions): Promise<void> {
  const videoTimeMs = videoTimeForLayer(layer, frameTimeMs);
  const sourceSize = options.videoFrameCache && layer.width && layer.height
    ? await options.videoFrameCache.getSourceSize(layer.src)
    : undefined;
  const image = options.videoFrameCache && sourceSize
    ? makeImageFromRgbaFrame(CanvasKit, await options.videoFrameCache.getRgbaFrame(layer.src, videoTimeMs, sourceSize.width, sourceSize.height))
    : CanvasKit.MakeImageFromEncoded(options.videoFrameCache
      ? await options.videoFrameCache.getFrame(layer.src, videoTimeMs)
      : await extractVideoFramePng(layer.src, videoTimeMs));
  if (!image) {
    throw new Error(`CanvasKit failed to create video frame image: ${layer.src}`);
  }

  const paint = makePaint(CanvasKit, "#ffffff", layer.transform.opacity);
  try {
    const width = layer.width ?? image.width();
    const height = layer.height ?? image.height();
    // The clip (e.g. a circular avatar crop) is applied generically in
    // drawLayer. Default to "cover" for circular crops so the avatar is filled,
    // not letterboxed; otherwise honour the explicit fit (stretch by default).
    const fit = layer.fit ?? (layer.clip?.type === "circle" ? "cover" : undefined);
    const { src: s, dst: d } = fitRects(image.width(), image.height(), width, height, fit);
    canvas.drawImageRect(image, CanvasKit.XYWHRect(s.x, s.y, s.w, s.h), CanvasKit.XYWHRect(d.x, d.y, d.w, d.h), paint, false);
  } finally {
    paint.delete();
    image.delete();
  }
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

function makePaint(CanvasKit: CanvasKit, color: string, opacity: number): Paint {
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(CanvasKit.PaintStyle.Fill);
  paint.setColor(parseColor(CanvasKit, color, opacity));
  return paint;
}

// Apply a solid color or gradient to a fill paint. Returns a Shader the caller
// must delete (or undefined for solid fills).
function applyFill(CanvasKit: CanvasKit, paint: Paint, fill: Fill, opacity: number): Shader | undefined {
  if (typeof fill === "string") {
    paint.setColor(parseColor(CanvasKit, fill, opacity));
    return undefined;
  }
  const shader = makeGradientShader(CanvasKit, fill, opacity);
  if (shader) {
    paint.setShader(shader);
  } else {
    paint.setColor(parseColor(CanvasKit, "#000", opacity));
  }
  return shader;
}

// Build a fill paint from a solid color or gradient (caller deletes both).
function makeFillPaint(CanvasKit: CanvasKit, fill: Fill, opacity: number): { paint: Paint; shader: Shader | undefined } {
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(CanvasKit.PaintStyle.Fill);
  const shader = applyFill(CanvasKit, paint, fill, opacity);
  return { paint, shader };
}

function makeGradientShader(CanvasKit: CanvasKit, gradient: Gradient, opacity: number): Shader | undefined {
  const stops = [...gradient.stops].sort((a, b) => a.offset - b.offset);
  if (stops.length === 0) {
    return undefined;
  }
  const colors = stops.map((stop) => parseColor(CanvasKit, stop.color, opacity));
  const positions = stops.map((stop) => stop.offset);
  if (gradient.type === "linear") {
    return CanvasKit.Shader.MakeLinearGradient(
      [gradient.from[0], gradient.from[1]],
      [gradient.to[0], gradient.to[1]],
      colors,
      positions,
      CanvasKit.TileMode.Clamp
    );
  }
  return CanvasKit.Shader.MakeRadialGradient(
    [gradient.center[0], gradient.center[1]],
    gradient.radius,
    colors,
    positions,
    CanvasKit.TileMode.Clamp
  );
}

function parseColor(CanvasKit: CanvasKit, color: string, opacity: number) {
  const trimmed = color.trim();
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : "";

  if (hex.length === 3) {
    const [r, g, b] = hex.split("").map((part) => parseInt(part + part, 16));
    return CanvasKit.Color(r ?? 0, g ?? 0, b ?? 0, opacity);
  }

  if (hex.length === 6) {
    return CanvasKit.Color(
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      opacity
    );
  }

  return CanvasKit.multiplyByAlpha(CanvasKit.parseColorString(trimmed), opacity);
}
