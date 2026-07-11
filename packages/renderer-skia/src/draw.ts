// Browser-safe draw tree for the openhypercore IR. NO node imports: fonts,
// images and video frames are fetched through an AssetProvider, so the exact
// same code renders the server-side MP4 (Node provider) and the editor's live
// preview (a browser fetch/<video> provider). Node-only concerns (CanvasKit
// init, ffmpeg, disk caches, the frame surface API) live in render-png.ts.
import type { Canvas, CanvasKit, EmbindEnumEntity, Font, Image, Paint, Shader, Typeface } from "canvaskit-wasm";
import type { BlendMode, Fill, Gradient, LayerClip, ResolvedFrame, ResolvedLayer, ResolvedTransform } from "../../core/src/index.ts";
import type { LayerRasterCache, LayerRasterEntry } from "./layer-cache.ts";

export type ResolvedVideoLayer = Extract<ResolvedLayer, { type: "video" }>;

// Pluggable asset access — decouples the draw logic from HOW fonts/images/video
// frames are fetched. The Node backend reads them from disk/ffmpeg (see
// createNodeAssetProvider); a browser host can supply fetch/<video>-based
// implementations so the SAME draw tree renders a live preview.
export type AssetProvider = {
  loadTypeface(CanvasKit: CanvasKit, font?: string): Promise<Typeface | null>;
  loadEmojiTypeface(CanvasKit: CanvasKit): Promise<Typeface | null>;
  loadDefaultTypeface(CanvasKit: CanvasKit): Promise<Typeface | null>;
  loadImage(CanvasKit: CanvasKit, src: string): Promise<Image | null>;
  loadVideoImage(CanvasKit: CanvasKit, layer: ResolvedVideoLayer, frameTimeMs: number): Promise<Image | null>;
  // When true the provider caches and reuses the Images it hands out, so the
  // draw tree must NOT delete them after drawing (browser preview provider).
  // Default (absent/false): each loadVideoImage result is caller-owned and
  // deleted after the draw (node provider decodes a fresh frame per call).
  retainsVideoFrames?: boolean;
};

// Everything the draw tree needs at render time. The host supplies the asset
// provider (required) and an optional cross-frame raster cache.
export type DrawContext = {
  assetProvider: AssetProvider;
  layerCache?: LayerRasterCache | false;
};

// Entry to the draw tree. Callers must have prefetched any async assets and set
// up the provider; this stays purely synchronous w.r.t. node concerns.
export async function drawFrameToCanvas(CanvasKit: CanvasKit, canvas: Canvas, frame: ResolvedFrame, options: DrawContext): Promise<void> {
  canvas.clear(CanvasKit.TRANSPARENT);
  for (const layer of frame.layers) {
    await drawLayer(CanvasKit, canvas, layer, frame.timeMs, options);
  }
}
async function drawLayer(CanvasKit: CanvasKit, canvas: Canvas, layer: ResolvedLayer, frameTimeMs: number, options: DrawContext): Promise<void> {
  // Directional accumulation motion blur: draw the layer several times smeared
  // along the motion direction, each at reduced alpha.
  if (layer.motionBlur && layer.motionBlur.distance > 0 && (layer.motionBlur.samples ?? 8) > 1) {
    await drawMotionBlurred(CanvasKit, canvas, layer, frameTimeMs, options);
    return;
  }
  await drawLayerSample(CanvasKit, canvas, layer, frameTimeMs, options);
}

async function drawMotionBlurred(CanvasKit: CanvasKit, canvas: Canvas, layer: ResolvedLayer, frameTimeMs: number, options: DrawContext): Promise<void> {
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

async function drawLayerSample(CanvasKit: CanvasKit, canvas: Canvas, layer: ResolvedLayer, frameTimeMs: number, options: DrawContext): Promise<void> {
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
        await drawText(CanvasKit, canvas, layer, options.assetProvider!);
        return;
      case "caption":
        await drawCaption(CanvasKit, canvas, layer, options.assetProvider!);
        return;
      case "image":
        await drawImage(CanvasKit, canvas, layer, options.assetProvider!);
        return;
      case "globe":
        await drawGlobe(CanvasKit, canvas, layer, options.assetProvider!);
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

async function drawGroup(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "group" }>, frameTimeMs: number, options: DrawContext): Promise<void> {
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
  return JSON.stringify(content);
}

async function rasterGroupEntry(
  CanvasKit: CanvasKit,
  cache: LayerRasterCache,
  key: string,
  layer: Extract<ResolvedLayer, { type: "group" }>,
  localTimeMs: number,
  options: DrawContext
): Promise<LayerRasterEntry | undefined> {
  const bounds = await groupContentBounds(CanvasKit, layer.layers, options.assetProvider!);
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
          // Animatable trim window: draw only the [trimStart, trimEnd]
          // fraction of the path's total length.
          const hasTrim = layer.trimStart !== undefined || layer.trimEnd !== undefined;
          const start = Math.min(1, Math.max(0, layer.trimStart ?? 0));
          const end = Math.min(1, Math.max(0, layer.trimEnd ?? 1));
          if (hasTrim && end <= start) {
            return; // nothing visible
          }
          const trimmed = hasTrim && (start > 0 || end < 1) ? path.makeTrimmed(start, end, false) : null;
          try {
            canvas.drawPath(trimmed ?? path, paint);
          } finally {
            trimmed?.delete();
          }
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
  letterSpacing?: number;
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
  // No typeface could be loaded at all (e.g. a browser provider offline):
  // degrade to drawing nothing instead of crashing the whole frame.
  if (stack.length === 0) {
    return [];
  }
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

// Total width of a string across the font stack (fallbacks included), with
// optional per-character tracking (letterSpacing).
function measureStack(stack: Font[], text: string, letterSpacing = 0): number {
  let sum = 0;
  for (const run of splitRuns(stack, text)) {
    sum += measureTextWidth(stack[run.fontIndex]!, run.text);
  }
  if (letterSpacing !== 0) {
    sum += letterSpacing * Math.max(0, [...text].length - 1);
  }
  return sum;
}

// Draw each run with its resolved font, advancing x by the run's width. With
// letterSpacing the run is drawn per character so tracking applies inside
// runs too, not just between them.
function drawRuns(canvas: Canvas, runs: FontRun[], stack: Font[], x: number, baselineY: number, paint: Paint, letterSpacing = 0): void {
  let cursor = x;
  for (const run of runs) {
    const font = stack[run.fontIndex]!;
    if (letterSpacing === 0) {
      canvas.drawText(run.text, cursor, baselineY, paint, font);
      cursor += measureTextWidth(font, run.text);
      continue;
    }
    for (const ch of run.text) {
      canvas.drawText(ch, cursor, baselineY, paint, font);
      cursor += measureTextWidth(font, ch) + letterSpacing;
    }
  }
}

// Draws a styled line as: soft shadow → outline stroke → fill, so titles and
// captions read clearly against busy video. Per-character font fallback is
// applied via the font stack.
function drawStyledText(CanvasKit: CanvasKit, canvas: Canvas, text: string, x: number, baselineY: number, color: Fill, opacity: number, stack: Font[], style: TextStyle): void {
  const runs = splitRuns(stack, text);
  const letterSpacing = style.letterSpacing ?? 0;

  if (style.shadowColor) {
    const shadowPaint = makePaint(CanvasKit, style.shadowColor, opacity);
    const blur = CanvasKit.MaskFilter.MakeBlur(CanvasKit.BlurStyle.Normal, Math.max(0.1, style.shadowBlur ?? 6), false);
    shadowPaint.setMaskFilter(blur);
    try {
      drawRuns(canvas, runs, stack, x + (style.shadowDx ?? 0), baselineY + (style.shadowDy ?? 4), shadowPaint, letterSpacing);
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
      drawRuns(canvas, runs, stack, x, baselineY, strokePaint, letterSpacing);
    } finally {
      strokePaint.delete();
    }
  }

  const { paint: fillPaint, shader: fillShader } = makeFillPaint(CanvasKit, color, opacity);
  try {
    drawRuns(canvas, runs, stack, x, baselineY, fillPaint, letterSpacing);
  } finally {
    fillPaint.delete();
    fillShader?.delete();
  }
}

// Build the per-character fallback stack for a layer's font at a given size:
// [primary, emoji, default], de-duplicated by typeface identity.
async function loadFontStack(CanvasKit: CanvasKit, size: number, font: string | undefined, provider: AssetProvider): Promise<Font[]> {
  const typefaces = [
    await provider.loadTypeface(CanvasKit, font),
    await provider.loadEmojiTypeface(CanvasKit),
    await provider.loadDefaultTypeface(CanvasKit)
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

async function drawText(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "text" }>, provider: AssetProvider): Promise<void> {
  const size = layer.size ?? 16;
  const stack = await loadFontStack(CanvasKit, size, layer.font, provider);

  try {
    const lineHeight = layer.lineHeight ?? size * 1.2;
    const spacing = layer.letterSpacing ?? 0;
    const lines = layer.maxWidth ? wrapText((t) => measureStack(stack, t, spacing), layer.text, layer.maxWidth) : layer.text.split("\n");
    lines.forEach((line, index) => {
      const x = lineX(layer.align, measureStack(stack, line, spacing));
      drawStyledText(CanvasKit, canvas, line, x, index * lineHeight, layer.color ?? "#000", layer.transform.opacity, stack, layer);
    });
  } finally {
    deleteFontStack(stack);
  }
}

async function drawCaption(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "caption" }>, provider: AssetProvider): Promise<void> {
  const size = layer.size ?? 32;
  const lineHeight = layer.lineHeight ?? size * 1.2;
  const padding = layer.padding ?? 8;

  const stack = await loadFontStack(CanvasKit, size, layer.font, provider);
  try {
    const measure = (t: string) => measureStack(stack, t, layer.letterSpacing ?? 0);
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
// Sphere-mapped image (rotating globe). A triangle fan-grid covers the visible
// disc; each vertex inverse-rotates its screen normal into model space to
// sample the equirectangular texture (the same math as the offline baker in
// examples/assets/build-globe.ts), and a per-vertex grayscale bakes
// Lambert + limb lighting, multiplied against the texture via Modulate.
// The identical vertex data is generated by the native renderer, so both
// backends shade the same globe.
type GlobeParams = {
  radius: number;
  yaw: number;
  pitch: number;
  segments: number;
  imgW: number;
  imgH: number;
  light: [number, number, number];
  ambient: number;
  diffuse: number;
};

export function buildGlobeMesh(p: GlobeParams): { positions: Float32Array; texCoords: Float32Array; colors: Float32Array } {
  const seg = Math.max(8, Math.floor(p.segments));
  const cosS = Math.cos(p.yaw);
  const sinS = Math.sin(p.yaw);
  const cosT = Math.cos(p.pitch);
  const sinT = Math.sin(p.pitch);
  const llen = Math.hypot(p.light[0], p.light[1], p.light[2]) || 1;
  const lx = p.light[0] / llen;
  const ly = p.light[1] / llen;
  const lz = p.light[2] / llen;

  type V = { sx: number; sy: number; u: number; v: number; shade: number };
  const vert = (k: number, j: number): V => {
    const rr = (k / seg) * p.radius;
    const a = (j / seg) * 2 * Math.PI;
    const sx = Math.cos(a) * rr;
    const sy = Math.sin(a) * rr; // screen y (down)
    const nx = sx / p.radius;
    const ny = -sy / p.radius; // view y (up)
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    // Inverse view rotation (pitch then yaw) into model space.
    const az = ny * sinT + nz * cosT;
    const mx = nx * cosS + az * sinS;
    const my = ny * cosT - nz * sinT;
    const mz = -nx * sinS + az * cosS;
    const lon = Math.atan2(mx, mz);
    const lat = Math.asin(Math.max(-1, Math.min(1, my)));
    const u = 0.5 + lon / (2 * Math.PI);
    const v = 0.5 - lat / Math.PI;
    const lambert = Math.max(0, nx * lx + ny * ly + nz * lz);
    const limb = Math.min(1, nz * 4.5);
    const shade = Math.min(1, (p.ambient + p.diffuse * lambert) * (0.45 + 0.55 * limb));
    return { sx, sy, u, v, shade };
  };

  const positions: number[] = [];
  const texCoords: number[] = [];
  const colors: number[] = [];
  const pushTri = (vs: [V, V, V]): void => {
    // Antimeridian seam: when a triangle straddles the u wrap, lift the low-u
    // corners by +1 so interpolation runs through the (Repeat-tiled) seam.
    const wrap = Math.max(vs[0].u, vs[1].u, vs[2].u) - Math.min(vs[0].u, vs[1].u, vs[2].u) > 0.5;
    for (const x of vs) {
      const u = wrap && x.u < 0.5 ? x.u + 1 : x.u;
      positions.push(x.sx, x.sy);
      texCoords.push(u * p.imgW, x.v * p.imgH);
      colors.push(x.shade, x.shade, x.shade, 1);
    }
  };
  for (let k = 1; k <= seg; k += 1) {
    for (let j = 0; j < seg; j += 1) {
      const a = vert(k - 1, j);
      const b = vert(k - 1, j + 1);
      const c = vert(k, j);
      const d = vert(k, j + 1);
      pushTri([a, c, d]);
      pushTri([a, d, b]);
    }
  }
  return { positions: new Float32Array(positions), texCoords: new Float32Array(texCoords), colors: new Float32Array(colors) };
}

export const GLOBE_DEFAULT_LIGHT: [number, number, number] = [-0.42, 0.55, 0.72];

async function drawGlobe(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "globe" }>, provider: AssetProvider): Promise<void> {
  const image = await provider.loadImage(CanvasKit, layer.src);
  if (!image) {
    throw new Error(`CanvasKit failed to decode globe texture: ${layer.src}`);
  }
  const mesh = buildGlobeMesh({
    radius: layer.radius,
    yaw: layer.yaw,
    pitch: layer.pitch,
    segments: layer.segments ?? 64,
    imgW: image.width(),
    imgH: image.height(),
    light: layer.light ?? GLOBE_DEFAULT_LIGHT,
    ambient: layer.ambient ?? 0.32,
    diffuse: layer.diffuse ?? 0.78
  });
  const verts = CanvasKit.MakeVertices(CanvasKit.VertexMode.Triangles, mesh.positions, mesh.texCoords, mesh.colors, null, false);
  const paint = new CanvasKit.Paint();
  const shader = image.makeShaderOptions(CanvasKit.TileMode.Repeat, CanvasKit.TileMode.Clamp, CanvasKit.FilterMode.Linear, CanvasKit.MipmapMode.None);
  paint.setShader(shader);
  paint.setAlphaf(layer.transform.opacity);
  try {
    canvas.drawVertices(verts, CanvasKit.BlendMode.Modulate, paint);
  } finally {
    verts.delete();
    shader.delete();
    paint.delete();
  }
  for (const route of layer.routes ?? []) {
    drawGlobeRoute(CanvasKit, canvas, layer, route);
  }
}

// A great-circle route on the sphere: slerp between the endpoints' unit
// vectors, rotate model→view (the TRANSPOSE of the mesh's view→model
// rotation), orthographically project, and hide samples behind the horizon.
// `progress` cuts by slerp parameter, which IS arc length on a great circle.
type GlobeRoutePoint = { sx: number; sy: number; visible: boolean };

export function globeRoutePoints(layer: { radius: number; yaw: number; pitch: number }, route: { from: [number, number]; to: [number, number]; altitude?: number }, samples: number): GlobeRoutePoint[] {
  const cosS = Math.cos(layer.yaw);
  const sinS = Math.sin(layer.yaw);
  const cosT = Math.cos(layer.pitch);
  const sinT = Math.sin(layer.pitch);
  const altitude = route.altitude ?? 0.12;
  const toVec = ([lat, lng]: [number, number]): [number, number, number] => {
    const la = (lat * Math.PI) / 180;
    const lo = (lng * Math.PI) / 180;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  };
  const a = toVec(route.from);
  const b = toVec(route.to);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  const points: GlobeRoutePoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    let mx: number;
    let my: number;
    let mz: number;
    if (omega < 1e-6) {
      [mx, my, mz] = a;
    } else {
      const w0 = Math.sin((1 - t) * omega) / Math.sin(omega);
      const w1 = Math.sin(t * omega) / Math.sin(omega);
      mx = a[0] * w0 + b[0] * w1;
      my = a[1] * w0 + b[1] * w1;
      mz = a[2] * w0 + b[2] * w1;
    }
    // Model → view (transpose of the mesh rotation in buildGlobeMesh).
    const nx = cosS * mx - sinS * mz;
    const ny = sinT * sinS * mx + cosT * my + sinT * cosS * mz;
    const nz = cosT * sinS * mx - sinT * my + cosT * cosS * mz;
    const lift = 1 + altitude * Math.sin(Math.PI * t);
    points.push({ sx: nx * layer.radius * lift, sy: -ny * layer.radius * lift, visible: nz > 0 });
  }
  return points;
}

const ROUTE_SAMPLES = 128;

function drawGlobeRoute(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "globe" }>, route: NonNullable<Extract<ResolvedLayer, { type: "globe" }>["routes"]>[number]): void {
  const progress = Math.max(0, Math.min(1, route.progress));
  if (progress <= 0) {
    return;
  }
  const points = globeRoutePoints(layer, route, ROUTE_SAMPLES);
  const drawnCount = Math.round(progress * ROUTE_SAMPLES);
  const color = route.color ?? "#ffd166";
  const width = route.width ?? Math.max(2, layer.radius * 0.02);
  const opacity = layer.transform.opacity;

  const builder = new CanvasKit.PathBuilder();
  let pen = false;
  for (let i = 0; i <= drawnCount; i += 1) {
    const p = points[i]!;
    if (!p.visible) {
      pen = false;
      continue;
    }
    if (pen) {
      builder.lineTo(p.sx, p.sy);
    } else {
      builder.moveTo(p.sx, p.sy);
      pen = true;
    }
  }
  const path = builder.detachAndDelete();
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(CanvasKit.PaintStyle.Stroke);
  paint.setStrokeWidth(width);
  paint.setStrokeCap(CanvasKit.StrokeCap.Round);
  paint.setStrokeJoin(CanvasKit.StrokeJoin.Round);
  paint.setColor(parseColor(CanvasKit, color, opacity));
  try {
    canvas.drawPath(path, paint);
    if (route.dots !== false) {
      paint.setStyle(CanvasKit.PaintStyle.Fill);
      const dot = (p: GlobeRoutePoint, r: number, dotColor: string): void => {
        if (!p.visible) return;
        paint.setColor(parseColor(CanvasKit, dotColor, opacity));
        canvas.drawCircle(p.sx, p.sy, r, paint);
      };
      dot(points[0]!, width * 1.5, color);
      if (progress >= 0.999) {
        dot(points[ROUTE_SAMPLES]!, width * 1.5, color);
      } else {
        dot(points[drawnCount]!, width * 1.3, "#ffffff"); // tip riding the draw
      }
    }
  } finally {
    path.delete();
    paint.delete();
  }
}

async function drawImage(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "image" }>, provider: AssetProvider): Promise<void> {
  const image = await provider.loadImage(CanvasKit, layer.src);
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

async function groupContentBounds(CanvasKit: CanvasKit, layers: ResolvedLayer[], provider: AssetProvider): Promise<Rect | undefined> {
  let union: Rect | undefined;
  for (const layer of layers) {
    const local = await layerLocalBounds(CanvasKit, layer, provider);
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

async function layerLocalBounds(CanvasKit: CanvasKit, layer: ResolvedLayer, provider: AssetProvider): Promise<Rect | undefined> {
  switch (layer.type) {
    case "shape":
      return shapeBounds(CanvasKit, layer);
    case "text":
      return await textLayerBounds(CanvasKit, layer, provider);
    case "caption":
      return await captionLayerBounds(CanvasKit, layer, provider);
    case "image":
      return await imageLayerBounds(CanvasKit, layer, provider);
    case "group":
      return await groupContentBounds(CanvasKit, layer.layers, provider);
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
async function textBlockBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "text" | "caption" }>, size: number, lineHeight: number, provider: AssetProvider): Promise<{ rect: Rect; lines: number; blockWidth: number }> {
  const stack = await loadFontStack(CanvasKit, size, layer.font, provider);
  try {
    const measure = (t: string) => measureStack(stack, t, layer.letterSpacing ?? 0);
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

async function textLayerBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "text" }>, provider: AssetProvider): Promise<Rect> {
  const size = layer.size ?? 16;
  const lineHeight = layer.lineHeight ?? size * 1.2;
  const { rect } = await textBlockBounds(CanvasKit, layer, size, lineHeight, provider);
  return expandRect(rect, textStylePad(layer, size));
}

async function captionLayerBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "caption" }>, provider: AssetProvider): Promise<Rect> {
  const size = layer.size ?? 32;
  const lineHeight = layer.lineHeight ?? size * 1.2;
  const padding = layer.padding ?? 8;
  const { rect, lines, blockWidth } = await textBlockBounds(CanvasKit, layer, size, lineHeight, provider);
  const bgWidth = layer.maxWidth ?? blockWidth;
  const background: Rect = {
    x: lineX(layer.align, bgWidth) - padding,
    y: -lineHeight - padding,
    w: bgWidth + padding * 2,
    h: lineHeight * lines + padding * 2
  };
  return expandRect(unionRect(rect, background), textStylePad(layer, size));
}

async function imageLayerBounds(CanvasKit: CanvasKit, layer: Extract<ResolvedLayer, { type: "image" }>, provider: AssetProvider): Promise<Rect | undefined> {
  if (layer.width !== undefined && layer.height !== undefined) {
    return { x: 0, y: 0, w: layer.width, h: layer.height };
  }
  const image = await provider.loadImage(CanvasKit, layer.src);
  if (!image) {
    return undefined;
  }
  return { x: 0, y: 0, w: layer.width ?? image.width(), h: layer.height ?? image.height() };
}

async function drawVideo(CanvasKit: CanvasKit, canvas: Canvas, layer: Extract<ResolvedLayer, { type: "video" }>, frameTimeMs: number, options: DrawContext): Promise<void> {
  const image = await options.assetProvider!.loadVideoImage(CanvasKit, layer, frameTimeMs);
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
    if (!options.assetProvider!.retainsVideoFrames) {
      image.delete();
    }
  }
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
