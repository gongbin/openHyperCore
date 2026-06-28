import CanvasKitInit from "canvaskit-wasm";
import type { Canvas, CanvasKit, Font, Image, Paint, Shader, Surface, Typeface } from "canvaskit-wasm";
import canvaskitWasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";
import { resolveFrame } from "openhypercore";
import type { Composition, Fill, Gradient, ResolvedFrame, ResolvedLayer } from "openhypercore";

// Browser canvaskit-wasm preview of the openhypercore IR. Vector subset (shapes,
// gradients, groups, clip, blend, blur, motion blur, transform) plus text (via a
// fetched font) and images (via fetch). Video still falls back to a placeholder
// (in-browser decode is heavy); the render service produces the full MP4.

type CK = CanvasKit;
type TextLayer = Extract<ResolvedLayer, { type: "text" | "caption" }>;
type ImageLayer = Extract<ResolvedLayer, { type: "image" }>;

// CanvasKit's own demo font — a stable, CORS-enabled TTF on the Skia CDN. Used
// when a text layer doesn't point at its own web font.
const DEFAULT_FONT_URL = "https://storage.googleapis.com/skia-cdn/misc/Roboto-Regular.ttf";

const typefaceCache = new Map<string, Typeface | null>();
const imageCache = new Map<string, Image | null>();

function isAssetUrl(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

function fontUrlFor(layer: TextLayer): string {
  const f = (layer as { font?: unknown }).font;
  return typeof f === "string" && isAssetUrl(f) ? f : DEFAULT_FONT_URL;
}

async function loadTypeface(ck: CK, url: string): Promise<Typeface | null> {
  if (typefaceCache.has(url)) return typefaceCache.get(url) ?? null;
  let tf: Typeface | null = null;
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    tf = ck.Typeface.MakeFreeTypeFaceFromData(buf);
  } catch {
    tf = null;
  }
  typefaceCache.set(url, tf);
  return tf;
}

async function loadImage(ck: CK, src: string): Promise<Image | null> {
  if (imageCache.has(src)) return imageCache.get(src) ?? null;
  let img: Image | null = null;
  try {
    const buf = await (await fetch(src)).arrayBuffer();
    img = ck.MakeImageFromEncoded(new Uint8Array(buf));
  } catch {
    img = null;
  }
  imageCache.set(src, img);
  return img;
}

// Walk the frame and load every font / image it needs (cached), so the
// synchronous draw pass can look them up.
async function ensureAssets(ck: CK, frame: ResolvedFrame): Promise<void> {
  const fonts = new Set<string>();
  const images = new Set<string>();
  const walk = (layers: readonly ResolvedLayer[]): void => {
    for (const l of layers) {
      if (l.type === "text" || l.type === "caption") fonts.add(fontUrlFor(l));
      else if (l.type === "image" && typeof l.src === "string" && isAssetUrl(l.src)) images.add(l.src);
      else if (l.type === "group") walk(l.layers);
    }
  };
  walk(frame.layers);
  await Promise.all([
    ...[...fonts].map((u) => loadTypeface(ck, u)),
    ...[...images].map((s) => loadImage(ck, s))
  ]);
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

  constructor(ck: CanvasKit, surface: Surface) {
    this.#ck = ck;
    this.#surface = surface;
    this.#canvas = surface.getCanvas();
  }

  static async create(canvasEl: HTMLCanvasElement): Promise<PreviewRenderer> {
    const ck = await loadCanvasKit();
    const surface = ck.MakeSWCanvasSurface(canvasEl);
    if (!surface) {
      throw new Error("canvaskit failed to create a surface for the preview canvas");
    }
    return new PreviewRenderer(ck, surface);
  }

  async renderFrame(composition: Composition, timeMs: number): Promise<void> {
    const frame = resolveFrame(composition, timeMs);
    await ensureAssets(this.#ck, frame);
    this.#draw(frame);
  }

  #draw(frame: ResolvedFrame): void {
    const ck = this.#ck;
    const canvas = this.#canvas;
    canvas.clear(ck.Color(8, 11, 20, 1));
    for (const layer of frame.layers) {
      drawLayer(ck, canvas, layer);
    }
    this.#surface.flush();
  }
}

function drawLayer(ck: CK, canvas: Canvas, layer: ResolvedLayer): void {
  const mb = layer.motionBlur;
  if (mb && mb.distance > 0 && (mb.samples ?? 8) > 1) {
    const samples = Math.max(2, Math.min(64, Math.round(mb.samples ?? 8)));
    const rad = (mb.angle * Math.PI) / 180;
    const dx = Math.cos(rad) * mb.distance;
    const dy = Math.sin(rad) * mb.distance;
    for (let i = 0; i < samples; i += 1) {
      const off = i / (samples - 1) - 0.5;
      canvas.save();
      canvas.translate(dx * off, dy * off);
      const paint = new ck.Paint();
      paint.setAlphaf(1 / samples);
      canvas.saveLayer(paint);
      drawSample(ck, canvas, layer);
      canvas.restore();
      canvas.restore();
      paint.delete();
    }
    return;
  }
  drawSample(ck, canvas, layer);
}

function drawSample(ck: CK, canvas: Canvas, layer: ResolvedLayer): void {
  const t = layer.transform;
  canvas.save();
  canvas.translate(t.x, t.y);
  canvas.scale(t.scale * t.scaleX, t.scale * t.scaleY);
  canvas.rotate(t.rotate, 0, 0);

  const blend = layer.blendMode && layer.blendMode !== "normal" ? toBlendMode(ck, layer.blendMode) : undefined;
  const wantsBlur = layer.type !== "shape" && layer.blur !== undefined && layer.blur > 0;
  let wrapped = false;
  if (blend || wantsBlur) {
    const paint = new ck.Paint();
    if (blend) {
      paint.setBlendMode(blend);
    }
    if (wantsBlur && layer.blur) {
      const filter = ck.ImageFilter.MakeBlur(layer.blur, layer.blur, ck.TileMode.Decal, null);
      paint.setImageFilter(filter);
    }
    canvas.saveLayer(paint);
    paint.delete();
    wrapped = true;
  }

  if (layer.clip) {
    applyClip(ck, canvas, layer.clip);
  }

  if (layer.type === "shape") {
    drawShape(ck, canvas, layer);
  } else if (layer.type === "group") {
    drawGroup(ck, canvas, layer);
  } else if (layer.type === "text" || layer.type === "caption") {
    drawText(ck, canvas, layer);
  } else if (layer.type === "image") {
    drawImage(ck, canvas, layer);
  } else if (layer.type === "video") {
    // In-browser video decode is heavy; show a placeholder. The MP4 renders it.
    drawPlaceholder(ck, canvas, layer);
  }

  if (wrapped) {
    canvas.restore();
  }
  canvas.restore();
}

function drawPlaceholder(ck: CK, canvas: Canvas, layer: ResolvedLayer): void {
  let w = 160;
  let h = 60;
  if (layer.type === "image" || layer.type === "video") {
    w = layer.width ?? 320;
    h = layer.height ?? 180;
  } else if (layer.type === "text" || layer.type === "caption") {
    const size = layer.size ?? (layer.type === "caption" ? 32 : 16);
    w = Math.max(40, (layer.text.length || 4) * size * 0.6);
    h = size * 1.3;
  }
  const opacity = layer.transform.opacity;
  const fill = new ck.Paint();
  fill.setColor(ck.Color(120, 140, 170, 0.18 * opacity));
  canvas.drawRect(ck.XYWHRect(0, layer.type === "text" || layer.type === "caption" ? -h * 0.8 : 0, w, h), fill);
  fill.delete();
  const stroke = new ck.Paint();
  stroke.setStyle(ck.PaintStyle.Stroke);
  stroke.setStrokeWidth(1);
  stroke.setColor(ck.Color(150, 170, 200, 0.5 * opacity));
  const dash = ck.PathEffect.MakeDash([6, 4], 0);
  if (dash) {
    stroke.setPathEffect(dash);
  }
  canvas.drawRect(ck.XYWHRect(0, layer.type === "text" || layer.type === "caption" ? -h * 0.8 : 0, w, h), stroke);
  stroke.delete();
}

function measureLine(font: Font, line: string): number {
  if (!line) return 0;
  const ids = font.getGlyphIDs(line);
  const widths = font.getGlyphWidths(ids);
  let w = 0;
  for (const x of widths) w += x;
  return w;
}

function drawText(ck: CK, canvas: Canvas, layer: TextLayer): void {
  const typeface = typefaceCache.get(fontUrlFor(layer)) ?? null;
  if (!typeface) {
    drawPlaceholder(ck, canvas, layer);
    return;
  }
  const size = layer.size ?? (layer.type === "caption" ? 32 : 16);
  const opacity = layer.transform.opacity;
  const align = layer.align ?? (layer.type === "caption" ? "center" : "left");
  const font = new ck.Font(typeface, size);
  font.setSubpixel(true);
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(parseColor(ck, typeof layer.color === "string" ? layer.color : "#ffffff", opacity));

  const lineHeight = ((layer as { lineHeight?: number }).lineHeight ?? 1.3) * size;
  const lines = String(layer.text).split("\n");
  let y = size * 0.8;
  for (const line of lines) {
    const w = measureLine(font, line);
    const x = align === "center" ? -w / 2 : align === "right" ? -w : 0;
    const blob = ck.TextBlob.MakeFromText(line, font);
    if (blob) {
      canvas.drawTextBlob(blob, x, y, paint);
      blob.delete();
    }
    y += lineHeight;
  }
  font.delete();
  paint.delete();
}

function drawImage(ck: CK, canvas: Canvas, layer: ImageLayer): void {
  const image = typeof layer.src === "string" ? imageCache.get(layer.src) ?? null : null;
  if (!image) {
    drawPlaceholder(ck, canvas, layer);
    return;
  }
  const iw = image.width();
  const ih = image.height();
  const w = layer.width ?? iw;
  const h = layer.height ?? ih;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setAlphaf(layer.transform.opacity);
  canvas.drawImageRect(image, ck.XYWHRect(0, 0, iw, ih), ck.XYWHRect(0, 0, w, h), paint, false);
  paint.delete();
}

function drawGroup(ck: CK, canvas: Canvas, group: Extract<ResolvedLayer, { type: "group" }>): void {
  if (group.reveal && group.reveal.progress <= 0) {
    return;
  }
  const opacity = group.transform.opacity;
  if (opacity <= 0) {
    return;
  }
  if (group.reveal && group.reveal.progress < 1) {
    applyReveal(ck, canvas, group.reveal);
  }
  let layered = false;
  if (opacity < 1) {
    const paint = new ck.Paint();
    paint.setAlphaf(opacity);
    canvas.saveLayer(paint);
    paint.delete();
    layered = true;
  }
  for (const child of group.layers) {
    drawLayer(ck, canvas, child);
  }
  if (layered) {
    canvas.restore();
  }
}

function drawShape(ck: CK, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "shape" }>): void {
  const opacity = layer.transform.opacity;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  let shader: Shader | undefined;
  if (layer.stroke) {
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setStrokeWidth(layer.strokeWidth ?? 1);
    paint.setColor(parseColor(ck, layer.stroke, opacity));
  } else {
    paint.setStyle(ck.PaintStyle.Fill);
    shader = applyFill(ck, paint, layer.fill ?? "#000000", opacity);
  }
  if (layer.dash && layer.dash.length >= 2) {
    const dash = ck.PathEffect.MakeDash(layer.dash, layer.dashPhase ?? 0);
    if (dash) {
      paint.setPathEffect(dash);
    }
  }
  if (layer.blur && layer.blur > 0) {
    const blur = ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, layer.blur, false);
    paint.setMaskFilter(blur);
  }

  if (layer.shape === "circle") {
    const r = layer.radius ?? Math.min(layer.width ?? 0, layer.height ?? 0) / 2;
    canvas.drawCircle(r, r, r, paint);
  } else if (layer.shape === "path" && layer.path) {
    const path = ck.Path.MakeFromSVGString(layer.path);
    if (path) {
      canvas.drawPath(path, paint);
      path.delete();
    }
  } else {
    canvas.drawRect(ck.XYWHRect(0, 0, layer.width ?? 0, layer.height ?? 0), paint);
  }
  paint.delete();
  shader?.delete();
}

function applyFill(ck: CK, paint: Paint, fill: Fill, opacity: number): Shader | undefined {
  if (typeof fill === "string") {
    paint.setColor(parseColor(ck, fill, opacity));
    return undefined;
  }
  const shader = makeGradient(ck, fill, opacity);
  if (shader) {
    paint.setShader(shader);
  } else {
    paint.setColor(parseColor(ck, "#000000", opacity));
  }
  return shader;
}

function makeGradient(ck: CK, gradient: Gradient, opacity: number): Shader | undefined {
  const stops = [...gradient.stops].sort((a, b) => a.offset - b.offset);
  if (stops.length === 0) {
    return undefined;
  }
  const colors = stops.map((s) => parseColor(ck, s.color, opacity));
  const pos = stops.map((s) => s.offset);
  if (gradient.type === "linear") {
    return ck.Shader.MakeLinearGradient([gradient.from[0], gradient.from[1]], [gradient.to[0], gradient.to[1]], colors, pos, ck.TileMode.Clamp);
  }
  return ck.Shader.MakeRadialGradient([gradient.center[0], gradient.center[1]], gradient.radius, colors, pos, ck.TileMode.Clamp);
}

function applyClip(ck: CK, canvas: Canvas, clip: NonNullable<ResolvedLayer["clip"]>): void {
  if (clip.type === "circle") {
    const cx = clip.cx ?? clip.radius;
    const cy = clip.cy ?? clip.radius;
    canvas.clipRRect(ck.RRectXY(ck.XYWHRect(cx - clip.radius, cy - clip.radius, clip.radius * 2, clip.radius * 2), clip.radius, clip.radius), ck.ClipOp.Intersect, true);
  } else if (clip.type === "rect") {
    const x = clip.x ?? 0;
    const y = clip.y ?? 0;
    if (clip.radius && clip.radius > 0) {
      canvas.clipRRect(ck.RRectXY(ck.XYWHRect(x, y, clip.width, clip.height), clip.radius, clip.radius), ck.ClipOp.Intersect, true);
    } else {
      canvas.clipRect(ck.XYWHRect(x, y, clip.width, clip.height), ck.ClipOp.Intersect, true);
    }
  } else {
    const path = ck.Path.MakeFromSVGString(clip.path);
    if (path) {
      if (clip.fillRule === "evenodd") {
        path.setFillType(ck.FillType.EvenOdd);
      }
      canvas.clipPath(path, ck.ClipOp.Intersect, true);
      path.delete();
    }
  }
}

function applyReveal(ck: CK, canvas: Canvas, reveal: NonNullable<Extract<ResolvedLayer, { type: "group" }>["reveal"]>): void {
  const progress = Math.min(1, Math.max(0, reveal.progress));
  const { width, height } = reveal;
  if (reveal.type === "clock") {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.hypot(width, height) / 2;
    const builder = new ck.PathBuilder();
    builder.moveTo(cx, cy);
    builder.lineTo(cx, cy - radius);
    builder.arcToOval(ck.XYWHRect(cx - radius, cy - radius, radius * 2, radius * 2), -90, progress * 360, false);
    builder.close();
    const path = builder.detachAndDelete();
    canvas.clipPath(path, ck.ClipOp.Intersect, true);
    path.delete();
    return;
  }
  const direction = reveal.direction ?? "from-left";
  let rect;
  if (direction === "from-right") {
    rect = ck.XYWHRect(width * (1 - progress), 0, width * progress, height);
  } else if (direction === "from-top") {
    rect = ck.XYWHRect(0, 0, width, height * progress);
  } else if (direction === "from-bottom") {
    rect = ck.XYWHRect(0, height * (1 - progress), width, height * progress);
  } else {
    rect = ck.XYWHRect(0, 0, width * progress, height);
  }
  canvas.clipRect(rect, ck.ClipOp.Intersect, true);
}

function toBlendMode(ck: CK, mode: NonNullable<ResolvedLayer["blendMode"]>) {
  const b = ck.BlendMode;
  switch (mode) {
    case "multiply": return b.Multiply;
    case "screen": return b.Screen;
    case "overlay": return b.Overlay;
    case "darken": return b.Darken;
    case "lighten": return b.Lighten;
    case "add": return b.Plus;
    case "color-dodge": return b.ColorDodge;
    case "color-burn": return b.ColorBurn;
    case "soft-light": return b.SoftLight;
    case "hard-light": return b.HardLight;
    case "difference": return b.Difference;
    case "exclusion": return b.Exclusion;
    case "hue": return b.Hue;
    case "saturation": return b.Saturation;
    case "color": return b.Color;
    case "luminosity": return b.Luminosity;
    default: return b.SrcOver;
  }
}

function parseColor(ck: CK, color: string, opacity: number) {
  const t = color.trim();
  const hex = t.startsWith("#") ? t.slice(1) : "";
  if (hex.length === 3) {
    const r = parseInt(hex[0]! + hex[0]!, 16);
    const g = parseInt(hex[1]! + hex[1]!, 16);
    const b = parseInt(hex[2]! + hex[2]!, 16);
    return ck.Color(r, g, b, opacity);
  }
  if (hex.length === 6) {
    return ck.Color(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), opacity);
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(t);
  if (m) {
    const parts = m[1]!.split(",").map((p) => p.trim());
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const a = (parts[3] !== undefined ? Number(parts[3]) : 1) * opacity;
    return ck.Color(r, g, b, a);
  }
  return ck.Color(0, 0, 0, opacity);
}
