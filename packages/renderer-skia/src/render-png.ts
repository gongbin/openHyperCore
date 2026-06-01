import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import CanvasKitInitModule from "canvaskit-wasm";
import type { Canvas, CanvasKit, CanvasKitInitOptions, Paint, Typeface } from "canvaskit-wasm";
import type { ResolvedFrame, ResolvedLayer } from "../../core/src/index.ts";

type CanvasKitInitFn = (opts?: CanvasKitInitOptions) => Promise<CanvasKit>;
type SkSurface = NonNullable<ReturnType<CanvasKit["MakeSurface"]>>;

const CanvasKitInit = CanvasKitInitModule as unknown as CanvasKitInitFn;

let canvasKitPromise: Promise<CanvasKit> | undefined;
let defaultTypefacePromise: Promise<Typeface | null> | undefined;

export type RenderFrameOptions = {
  videoFrameCache?: VideoFrameCache;
};

export type VideoFrameCacheOptions = {
  ffmpegPath?: string;
  ffmpegArgsPrefix?: string[];
};

export class VideoFrameCache {
  readonly #entries = new Map<string, Promise<Buffer>>();
  readonly #options: VideoFrameCacheOptions;

  constructor(options: VideoFrameCacheOptions = {}) {
    this.#options = options;
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
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
}

export function createVideoFrameCache(options: VideoFrameCacheOptions = {}): VideoFrameCache {
  return new VideoFrameCache(options);
}

export function createRgbaFrameRenderer(): RgbaFrameRenderer {
  return new RgbaFrameRenderer();
}

export class RgbaFrameRenderer {
  #CanvasKit: CanvasKit | undefined;
  #surface: SkSurface | undefined;
  #canvas: Canvas | undefined;
  #width = 0;
  #height = 0;

  async render(frame: ResolvedFrame, options: RenderFrameOptions = {}): Promise<Buffer> {
    const { CanvasKit, canvas } = await this.#surfaceFor(frame);
    await drawFrameToCanvas(CanvasKit, canvas, frame, options);
    return Buffer.from(readRgbaPixels(CanvasKit, canvas, frame));
  }

  dispose(): void {
    this.#surface?.dispose();
    this.#surface = undefined;
    this.#canvas = undefined;
    this.#width = 0;
    this.#height = 0;
  }

  async #surfaceFor(frame: ResolvedFrame): Promise<{ CanvasKit: CanvasKit; surface: SkSurface; canvas: Canvas }> {
    const CanvasKit = this.#CanvasKit ?? await loadCanvasKit();
    this.#CanvasKit = CanvasKit;

    const width = frame.composition.width;
    const height = frame.composition.height;
    if (!this.#surface || !this.#canvas || this.#width !== width || this.#height !== height) {
      this.dispose();
      const surface = CanvasKit.MakeSurface(width, height);
      if (!surface) {
        throw new Error("CanvasKit failed to create a raster surface");
      }
      this.#surface = surface;
      this.#canvas = surface.getCanvas();
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

export async function renderRgbaFrame(frame: ResolvedFrame, options: RenderFrameOptions = {}): Promise<Buffer> {
  const { CanvasKit, surface, canvas } = await renderFrameSurface(frame, options);

  try {
    return Buffer.from(readRgbaPixels(CanvasKit, canvas, frame));
  } finally {
    surface.dispose();
  }
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

function readRgbaPixels(CanvasKit: CanvasKit, canvas: Canvas, frame: ResolvedFrame): Uint8Array {
  const pixels = canvas.readPixels(0, 0, {
    width: frame.composition.width,
    height: frame.composition.height,
    colorType: CanvasKit.ColorType.RGBA_8888,
    alphaType: CanvasKit.AlphaType.Unpremul,
    colorSpace: CanvasKit.ColorSpace.SRGB
  });

  if (!pixels) {
    throw new Error("CanvasKit failed to read RGBA pixels from the frame");
  }

  return pixels as Uint8Array;
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

async function loadTypefaceFromCandidates(CanvasKit: CanvasKit): Promise<Typeface | null> {
  const candidates = [
    process.env.OPENHYPERCORE_FONT,
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
  canvas.save();
  canvas.translate(layer.transform.x, layer.transform.y);
  canvas.scale(layer.transform.scale, layer.transform.scale);
  canvas.rotate(layer.transform.rotate, 0, 0);

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
      default:
        return;
    }
  } finally {
    canvas.restore();
  }
}

function drawShape(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "shape" }>): void {
  const paint = makePaint(CanvasKit, layer.fill ?? "#000", layer.transform.opacity);
  try {
    if (layer.stroke) {
      paint.setStyle(CanvasKit.PaintStyle.Stroke);
      paint.setStrokeWidth(layer.strokeWidth ?? 1);
      paint.setColor(parseColor(CanvasKit, layer.stroke, layer.transform.opacity));
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
  }
}

async function drawText(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "text" }>): Promise<void> {
  const paint = makePaint(CanvasKit, layer.color ?? "#000", layer.transform.opacity);
  const font = new CanvasKit.Font(await loadDefaultTypeface(CanvasKit), layer.size ?? 16);

  try {
    font.setEdging(CanvasKit.FontEdging.AntiAlias);
    canvas.drawText(layer.text, 0, 0, paint, font);
  } finally {
    font.delete();
    paint.delete();
  }
}

async function drawCaption(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "caption" }>): Promise<void> {
  const size = layer.size ?? 32;
  const lineHeight = layer.lineHeight ?? size * 1.2;
  const padding = layer.padding ?? 8;
  const textWidth = layer.maxWidth ?? estimateTextWidth(layer.text, size);
  const x = alignedX(layer.align, textWidth);

  if (layer.backgroundColor) {
    const backgroundPaint = makePaint(CanvasKit, layer.backgroundColor, layer.transform.opacity);
    try {
      canvas.drawRect(
        CanvasKit.XYWHRect(x - padding, -lineHeight - padding, textWidth + padding * 2, lineHeight + padding * 2),
        backgroundPaint
      );
    } finally {
      backgroundPaint.delete();
    }
  }

  const textPaint = makePaint(CanvasKit, layer.color ?? "#fff", layer.transform.opacity);
  const font = new CanvasKit.Font(await loadDefaultTypeface(CanvasKit), size);
  try {
    font.setEdging(CanvasKit.FontEdging.AntiAlias);
    canvas.drawText(layer.text, x, 0, textPaint, font);
  } finally {
    font.delete();
    textPaint.delete();
  }
}

async function drawImage(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "image" }>): Promise<void> {
  const src = resolve(layer.src);
  const encoded = await readFile(src);
  const image = CanvasKit.MakeImageFromEncoded(encoded);
  if (!image) {
    throw new Error(`CanvasKit failed to decode image: ${layer.src}`);
  }

  const paint = makePaint(CanvasKit, "#ffffff", layer.transform.opacity);
  try {
    const width = layer.width ?? image.width();
    const height = layer.height ?? image.height();
    canvas.drawImageRect(image, CanvasKit.XYWHRect(0, 0, image.width(), image.height()), CanvasKit.XYWHRect(0, 0, width, height), paint, false);
  } finally {
    paint.delete();
    image.delete();
  }
}

async function drawVideo(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "video" }>, frameTimeMs: number, options: RenderFrameOptions): Promise<void> {
  const videoTimeMs = videoTimeForLayer(layer, frameTimeMs);
  const encoded = options.videoFrameCache
    ? await options.videoFrameCache.getFrame(layer.src, videoTimeMs)
    : await extractVideoFramePng(layer.src, videoTimeMs);
  const image = CanvasKit.MakeImageFromEncoded(encoded);
  if (!image) {
    throw new Error(`CanvasKit failed to decode video frame: ${layer.src}`);
  }

  const paint = makePaint(CanvasKit, "#ffffff", layer.transform.opacity);
  try {
    const width = layer.width ?? image.width();
    const height = layer.height ?? image.height();
    canvas.drawImageRect(image, CanvasKit.XYWHRect(0, 0, image.width(), image.height()), CanvasKit.XYWHRect(0, 0, width, height), paint, false);
  } finally {
    paint.delete();
    image.delete();
  }
}

export async function prefetchVideoFrames(frame: ResolvedFrame, cache: VideoFrameCache): Promise<void> {
  await Promise.all(frame.layers.flatMap((layer) => {
    if (layer.type !== "video") {
      return [];
    }
    return [cache.prefetch(layer.src, videoTimeForLayer(layer, frame.timeMs))];
  }));
}

export async function prefetchVideoFrameBatch(frames: ResolvedFrame[], cache: VideoFrameCache): Promise<void> {
  const timesBySource = new Map<string, number[]>();
  for (const frame of frames) {
    for (const layer of frame.layers) {
      if (layer.type !== "video") {
        continue;
      }
      const times = timesBySource.get(layer.src) ?? [];
      times.push(videoTimeForLayer(layer, frame.timeMs));
      timesBySource.set(layer.src, times);
    }
  }

  await Promise.all([...timesBySource].map(([src, timeMsList]) => cache.prefetchFrames(src, timeMsList)));
}

function videoTimeForLayer(layer: Extract<ResolvedLayer, { type: "video" }>, frameTimeMs: number): number {
  return Math.max(0, frameTimeMs - (layer.startMs ?? 0) + (layer.trimStartMs ?? 0));
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

async function buildVideoFrameCacheKey(src: string, timeMs: number): Promise<string> {
  const resolvedSrc = resolve(src);
  const info = await stat(resolvedSrc);
  return [
    resolvedSrc,
    Math.max(0, Math.round(timeMs)),
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

function alignedX(align: Extract<ResolvedLayer, { type: "caption" }>["align"], width: number): number {
  if (align === "center") {
    return -width / 2;
  }
  if (align === "right") {
    return -width;
  }
  return 0;
}

function estimateTextWidth(text: string, size: number): number {
  return text.length * size * 0.6;
}

function makePaint(CanvasKit: CanvasKit, color: string, opacity: number): Paint {
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(CanvasKit.PaintStyle.Fill);
  paint.setColor(parseColor(CanvasKit, color, opacity));
  return paint;
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
