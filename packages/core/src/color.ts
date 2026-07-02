import { resolveEasing } from "./easing.ts";
import type { AnimatedColor } from "./types.ts";

// CSS color parsing + interpolation for color keyframes and the
// Remotion-compatible interpolateColors(). Supports #rgb/#rgba/#rrggbb/
// #rrggbbaa and rgb()/rgba(); anything else is passed through untouched
// (renderers know more names than we interpolate between).

export type Rgba = [number, number, number, number];

export function parseCssColor(color: string): Rgba | undefined {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (hex && hex[1]) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0]! + h[0]!, 16);
      const g = parseInt(h[1]! + h[1]!, 16);
      const b = parseInt(h[2]! + h[2]!, 16);
      const a = h.length === 4 ? parseInt(h[3]! + h[3]!, 16) / 255 : 1;
      return [r, g, b, a];
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [r, g, b, a];
    }
    return undefined;
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (fn) {
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] !== undefined ? Number(fn[4]) : 1];
  }
  return undefined;
}

export function formatRgba([r, g, b, a]: Rgba): string {
  const clamp255 = (v: number): number => Math.round(Math.max(0, Math.min(255, v)));
  const alpha = Math.max(0, Math.min(1, a));
  return `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${Math.round(alpha * 1000) / 1000})`;
}

// Straight RGB-space mix. If either side doesn't parse, snap to the nearer end
// so un-parseable colors degrade to a hard cut instead of breaking the render.
export function mixColors(from: string, to: string, t: number): string {
  const a = parseCssColor(from);
  const b = parseCssColor(to);
  if (!a || !b) {
    return t < 0.5 ? from : to;
  }
  const mix = (i: 0 | 1 | 2 | 3): number => a[i] + (b[i] - a[i]) * t;
  return formatRgba([mix(0), mix(1), mix(2), mix(3)]);
}

// Remotion-compatible: map input through inputRange onto outputColors.
// inputRange must be monotonically increasing and the same length as
// outputColors; input outside the range clamps to the ends.
export function interpolateColors(input: number, inputRange: number[], outputColors: string[]): string {
  if (inputRange.length !== outputColors.length || inputRange.length < 2) {
    throw new Error("interpolateColors: inputRange and outputColors must have the same length (>= 2)");
  }
  if (input <= inputRange[0]!) {
    return outputColors[0]!;
  }
  if (input >= inputRange[inputRange.length - 1]!) {
    return outputColors[outputColors.length - 1]!;
  }
  let i = 1;
  while (i < inputRange.length - 1 && inputRange[i]! < input) {
    i += 1;
  }
  const t = (input - inputRange[i - 1]!) / (inputRange[i]! - inputRange[i - 1]!);
  return mixColors(outputColors[i - 1]!, outputColors[i]!, t);
}

// Keyframe-track resolution, mirroring resolveScalar: per-segment easing is
// carried on the segment's END keyframe.
export function resolveColor(value: AnimatedColor | undefined, timeMs: number, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value.length === 0) {
    return fallback;
  }
  const sorted = [...value].sort((a, b) => a.timeMs - b.timeMs);
  const first = sorted[0]!;
  if (timeMs <= first.timeMs) {
    return first.color;
  }
  const last = sorted[sorted.length - 1]!;
  if (timeMs >= last.timeMs) {
    return last.color;
  }
  const nextIndex = sorted.findIndex((frame) => frame.timeMs >= timeMs);
  const previous = sorted[nextIndex - 1]!;
  const next = sorted[nextIndex]!;
  let progress = (timeMs - previous.timeMs) / (next.timeMs - previous.timeMs);
  const ease = resolveEasing(next.easing);
  if (ease) {
    progress = ease(progress);
  }
  return mixColors(previous.color, next.color, progress);
}
