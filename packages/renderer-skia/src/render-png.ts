import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import CanvasKitInitModule from "canvaskit-wasm";
import type { Canvas, CanvasKit, CanvasKitInitOptions, Paint } from "canvaskit-wasm";
import type { ResolvedFrame, ResolvedLayer } from "../../core/src/index.ts";

type CanvasKitInitFn = (opts?: CanvasKitInitOptions) => Promise<CanvasKit>;

const CanvasKitInit = CanvasKitInitModule as unknown as CanvasKitInitFn;

let canvasKitPromise: Promise<CanvasKit> | undefined;

export async function renderPngFrame(frame: ResolvedFrame): Promise<Buffer> {
  const { CanvasKit, surface } = await renderFrameSurface(frame);

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

export async function renderRgbaFrame(frame: ResolvedFrame): Promise<Buffer> {
  const { CanvasKit, surface, canvas } = await renderFrameSurface(frame);

  try {
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

    return Buffer.from(pixels);
  } finally {
    surface.dispose();
  }
}

async function renderFrameSurface(frame: ResolvedFrame): Promise<{ CanvasKit: CanvasKit; surface: NonNullable<ReturnType<CanvasKit["MakeSurface"]>>; canvas: Canvas }> {
  const CanvasKit = await loadCanvasKit();
  const surface = CanvasKit.MakeSurface(frame.composition.width, frame.composition.height);
  if (!surface) {
    throw new Error("CanvasKit failed to create a raster surface");
  }

  const canvas = surface.getCanvas();
  canvas.clear(CanvasKit.TRANSPARENT);

  try {
    for (const layer of frame.layers) {
      await drawLayer(CanvasKit, canvas, layer, frame.timeMs);
    }

    surface.flush();
    return { CanvasKit, surface, canvas };
  } catch (error) {
    surface.dispose();
    throw error;
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

async function drawLayer(CanvasKit: CanvasKit, canvas: Canvas, layer: ResolvedLayer, frameTimeMs: number): Promise<void> {
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
        drawText(CanvasKit, canvas, layer);
        return;
      case "image":
        await drawImage(CanvasKit, canvas, layer);
        return;
      case "video":
        await drawVideo(CanvasKit, canvas, layer, frameTimeMs);
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

function drawText(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "text" }>): void {
  const paint = makePaint(CanvasKit, layer.color ?? "#000", layer.transform.opacity);
  const font = new CanvasKit.Font(null, layer.size ?? 16);

  try {
    font.setEdging(CanvasKit.FontEdging.AntiAlias);
    canvas.drawText(layer.text, 0, 0, paint, font);
  } finally {
    font.delete();
    paint.delete();
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

async function drawVideo(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "video" }>, frameTimeMs: number): Promise<void> {
  const videoTimeMs = Math.max(0, frameTimeMs - (layer.startMs ?? 0) + (layer.trimStartMs ?? 0));
  const encoded = await extractVideoFramePng(layer.src, videoTimeMs);
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

async function extractVideoFramePng(src: string, timeMs: number): Promise<Buffer> {
  const ffmpegPath = await resolveDefaultFfmpegPath();
  const child = spawn(ffmpegPath, [
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
