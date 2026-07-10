import { motionPathKeyframes, resolveFrame } from "openhypercore";
import type { Composition, Layer, ResolvedLayer } from "openhypercore";
import type { PluginDefinition } from "openhypercore/plugins";

export type Bezier = [number, number, number, number];
export type Kf = { timeMs: number; value: number; easing?: unknown };
export type AnyLayer = Layer & Record<string, unknown>;
export type SelPath = number[];

export const TRANSFORM_KEYS = ["x", "y", "scale", "rotate", "opacity"] as const;
export type TKey = (typeof TRANSFORM_KEYS)[number];

export const EMPH: Bezier = [0.2, 0, 0, 1];
export const BACK: Bezier = [0.34, 1.56, 0.64, 1];
export const KEY_EPS = 16; // ms tolerance (~1 frame) for "is there a key at the playhead"

export const dfltVal = (k: string): number => (k === "scale" || k === "opacity" ? 1 : 0);
export const r2 = (n: number): number => Math.round(n * 100) / 100;
export const clamp = (lo: number, hi: number, v: number): number => Math.max(lo, Math.min(hi, v));

// Editor-only easing presets, each a serializable cubic-bezier [x1,y1,x2,y2]
// tuple (the engine accepts these directly; named easing functions aren't JSON).
export const EASINGS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  emphasized: [0.2, 0, 0, 1],
  overshoot: [0.34, 1.56, 0.64, 1]
};
export function easingTuple(e: unknown): Bezier {
  if (Array.isArray(e) && e.length === 4 && e.every((n) => typeof n === "number")) return e as Bezier;
  if (typeof e === "string" && EASINGS[e]) return EASINGS[e]!;
  return [0, 0, 1, 1];
}
export function presetName(t: Bezier): string {
  for (const [n, v] of Object.entries(EASINGS)) if (v.every((x, i) => x === t[i])) return n;
  return "custom";
}

// ---------------------------------------------------------------------------
// Layer tree addressing. Selection is a path of child indices from the root
// (e.g. [2] = third top-level layer, [2,0] = its first child).
export function layerAtPath(comp: Composition, path: SelPath): AnyLayer | undefined {
  let list: Layer[] = comp.layers;
  let cur: AnyLayer | undefined;
  for (const i of path) {
    cur = list[i] as AnyLayer | undefined;
    if (!cur) return undefined;
    list = Array.isArray(cur.layers) ? (cur.layers as Layer[]) : [];
  }
  return cur;
}

export function updateLayers(layers: Layer[], path: SelPath, fn: (l: Layer) => Layer | null): Layer[] {
  const [i, ...rest] = path;
  if (i === undefined) return layers;
  return layers.flatMap((l, idx) => {
    if (idx !== i) return [l];
    if (rest.length === 0) {
      const r = fn(l);
      return r === null ? [] : [r];
    }
    const children = Array.isArray((l as AnyLayer).layers) ? ((l as AnyLayer).layers as Layer[]) : [];
    return [{ ...l, layers: updateLayers(children, rest, fn) } as Layer];
  });
}

export function updateLayerAtPath(comp: Composition, path: SelPath, fn: (l: Layer) => Layer | null): Composition {
  return { ...comp, layers: updateLayers(comp.layers, path, fn) };
}

// ---------------------------------------------------------------------------
// Per-layer resolve that keeps the composition index ↔ layer mapping intact.
// (resolveFrame filters inactive layers, so its indices shift — never index it
// by composition position.) Walks the group chain converting to local time,
// then resolves the layer alone; returns null when inactive at that time.
export function resolveLayerAt(expanded: Composition, path: SelPath, timeMs: number): ResolvedLayer | null {
  let layers: Layer[] = expanded.layers;
  let t = timeMs;
  let layer: AnyLayer | undefined;
  for (let step = 0; step < path.length; step += 1) {
    layer = layers[path[step]!] as AnyLayer | undefined;
    if (!layer) return null;
    if (step < path.length - 1) {
      t -= (layer.startMs as number | undefined) ?? 0;
      layers = Array.isArray(layer.layers) ? (layer.layers as Layer[]) : [];
    }
  }
  if (!layer) return null;
  try {
    const frame = resolveFrame({ ...expanded, layers: [layer as Layer] }, t);
    return frame.layers[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transform math. Engine order per layer: translate(x,y) → scale(s·sx, s·sy)
// → rotate(deg, pivot 0,0). Local point p maps to parent space as
// p' = T + S·(R·p).
export type Xf = { x: number; y: number; sx: number; sy: number; rot: number };

export function xfOf(l: ResolvedLayer): Xf {
  const t = l.transform as unknown as Record<string, number>;
  const s = t.scale ?? 1;
  return {
    x: t.x ?? 0,
    y: t.y ?? 0,
    sx: s * (t.scaleX ?? 1),
    sy: s * (t.scaleY ?? 1),
    rot: ((t.rotate ?? 0) * Math.PI) / 180
  };
}

export function localToParent(xf: Xf, px: number, py: number): [number, number] {
  const c = Math.cos(xf.rot);
  const s = Math.sin(xf.rot);
  const rx = px * c - py * s;
  const ry = px * s + py * c;
  return [xf.x + xf.sx * rx, xf.y + xf.sy * ry];
}

export function parentToLocal(xf: Xf, px: number, py: number): [number, number] {
  const dx = (px - xf.x) / (xf.sx || 1e-9);
  const dy = (py - xf.y) / (xf.sy || 1e-9);
  const c = Math.cos(-xf.rot);
  const s = Math.sin(-xf.rot);
  return [dx * c - dy * s, dx * s + dy * c];
}

// ---------------------------------------------------------------------------
// Approximate local (pre-transform) bounds per layer type, used for canvas
// hit-testing and the selection box. Mirrors how each renderer places content.
export type Box = { x: number; y: number; w: number; h: number };

// Same estimate the built-in plugins use: CJK ≈ 1em, latin/digit ≈ 0.55em.
export function estimateTextWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
  return units * size;
}

export function localBox(
  l: ResolvedLayer,
  mediaSize?: (src: string) => { w: number; h: number } | undefined
): Box | null {
  const a = l as unknown as AnyLayer;
  switch (l.type) {
    case "shape": {
      if (a.shape === "circle") {
        const r = (a.radius as number) ?? 0;
        return { x: 0, y: 0, w: r * 2, h: r * 2 };
      }
      const w = (a.width as number) ?? 0;
      const h = (a.height as number) ?? 0;
      if (a.shape === "path" && (!w || !h)) return null;
      return { x: 0, y: 0, w, h };
    }
    case "text":
    case "caption": {
      const size = (a.size as number) ?? 16;
      const lineHeight = ((a.lineHeight as number) ?? 1.2) * size;
      const lines = String(a.text ?? "").split("\n");
      const w = Math.max(1, ...lines.map((ln) => estimateTextWidth(ln, size)));
      const h = Math.max(lineHeight, lines.length * lineHeight);
      const align = (a.align as string) ?? "left";
      const x0 = align === "center" ? -w / 2 : align === "right" ? -w : 0;
      // y is the first-line baseline; the box extends up by ~the ascent.
      return { x: x0, y: -size * 0.82, w, h };
    }
    case "image":
    case "video": {
      let w = a.width as number | undefined;
      let h = a.height as number | undefined;
      const nat = mediaSize?.(String(a.src ?? ""));
      if (nat && (!w || !h)) {
        if (w && !h) h = (w * nat.h) / nat.w;
        else if (h && !w) w = (h * nat.w) / nat.h;
        else { w = nat.w; h = nat.h; }
      }
      return { x: 0, y: 0, w: w ?? 320, h: h ?? 180 };
    }
    case "globe": {
      const r = (a.radius as number) ?? 0;
      return { x: -r, y: -r, w: r * 2, h: r * 2 };
    }
    case "group": {
      const children = (a.layers as ResolvedLayer[] | undefined) ?? [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const child of children) {
        const cb = localBox(child, mediaSize);
        if (!cb) continue;
        const cxf = xfOf(child);
        for (const [px, py] of boxCorners(cb)) {
          const [gx, gy] = localToParent(cxf, px, py);
          minX = Math.min(minX, gx); minY = Math.min(minY, gy);
          maxX = Math.max(maxX, gx); maxY = Math.max(maxY, gy);
        }
      }
      if (!Number.isFinite(minX)) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    default:
      return null;
  }
}

export function boxCorners(b: Box): [number, number][] {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h]
  ];
}

export function pointInBox(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

// ---------------------------------------------------------------------------
export const TYPE_COLORS: Record<string, string> = {
  shape: "#c9a13d",
  text: "#4d8dff",
  caption: "#4d8dff",
  image: "#3fb96f",
  video: "#2fa88a",
  audio: "#18a5b8",
  group: "#9a6ee8",
  globe: "#3f7fc4",
  plugin: "#e08745"
};
export const typeColor = (t: string): string => TYPE_COLORS[t] ?? "#5b6275";

export function layerLabel(l: AnyLayer): string {
  const id = typeof l.id === "string" && l.id ? l.id : "";
  if (id) return id;
  switch (l.type) {
    case "shape": return String(l.shape ?? "shape");
    case "text": case "caption": return String(l.text ?? "text").split("\n")[0]!.slice(0, 14) || "text";
    case "plugin": return String(l.plugin);
    case "image": return "图片";
    case "video": return "视频";
    case "audio": return "音频";
    case "group": return "组";
    case "globe": return "地球仪";
    default: return String((l as { type?: string }).type ?? "layer");
  }
}

export function pluginDefaults(def: PluginDefinition): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(def.params)) {
    if (spec.default !== undefined) params[key] = spec.default;
    else if (spec.required) {
      if (spec.type === "asset") params[key] = spec.placeholder ?? (spec.kind === "image" || spec.kind === undefined ? "https://picsum.photos/seed/openhyper/1280/720" : "");
      else if (spec.type === "string") params[key] = "你的标题";
      else if (spec.type === "number") params[key] = 0;
      else if (spec.type === "latlng") params[key] = [39.9, 116.4];
    }
  }
  return params;
}

// Map a frame time on a video layer's timeline to a source time — mirror of
// the engine's videoTimeForLayer (render-png.ts), reimplemented here because
// that module is node-only.
export function videoSourceTimeMs(layer: AnyLayer, frameTimeMs: number): number {
  const elapsed = Math.max(0, frameTimeMs - ((layer.startMs as number) ?? 0));
  const rateRaw = layer.playbackRate as number | undefined;
  const rate = rateRaw && rateRaw > 0 ? rateRaw : 1;
  const trimStart = (layer.trimStartMs as number) ?? 0;
  let source = trimStart + elapsed * rate;
  const trimEnd = layer.trimEndMs as number | undefined;
  if (layer.loop && trimEnd !== undefined) {
    const span = trimEnd - trimStart;
    if (span > 0) source = trimStart + (((source - trimStart) % span) + span) % span;
  }
  return Math.max(0, source);
}

// ---------------------------------------------------------------------------
// CSS color parsing for the editor's color fields (`<input type="color">` only
// accepts #rrggbb, but IR colors are often rgba(...) / #rgb / #rrggbbaa).
export function parseCssColor(input: string): { r: number; g: number; b: number; a: number } | null {
  const s = input.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split("").map((c) => parseInt(c + c, 16));
      return { r: r!, g: g!, b: b!, a: hex.length === 4 ? a! / 255 : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
  return null;
}

export function toHexColor(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(clamp(0, 255, v)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function composeCssColor(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const c = parseCssColor(hex);
  if (!c) return hex;
  return `rgba(${c.r},${c.g},${c.b},${Math.round(alpha * 100) / 100})`;
}

// ---------------------------------------------------------------------------
// Arc motion baking — thin wrapper over the engine's motionPathKeyframes
// (openhypercore ≥0.5.0), keeping the editor's positional signature.
export function bakeMotionPath(points: [number, number][], durationMs: number, startMs = 0, curviness = 1, keyframes = 18): { x: Kf[]; y: Kf[] } {
  const tracks = motionPathKeyframes({ points, durationMs, startMs, curviness, keyframes });
  return { x: tracks.x as Kf[], y: tracks.y as Kf[] };
}

// Ramer-Douglas-Peucker over a recorded drag, keeping timestamps — turns
// ~hundreds of pointer samples into a handful of clean keyframes.
export type PathSample = { t: number; x: number; y: number };
export function simplifyPath(samples: PathSample[], epsilon: number): PathSample[] {
  if (samples.length <= 2) return samples;
  const keep = new Set<number>([0, samples.length - 1]);
  const stack: [number, number][] = [[0, samples.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = samples[a]!;
    const pb = samples[b]!;
    let maxD = 0;
    let maxI = -1;
    for (let i = a + 1; i < b; i += 1) {
      const p = samples[i]!;
      const d = pointToSegment(p.x, p.y, pa.x, pa.y, pb.x, pb.y);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxI > 0 && maxD > epsilon) {
      keep.add(maxI);
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => samples[i]!);
}

function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(0, 1, ((px - ax) * dx + (py - ay) * dy) / len2) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
}
