import type { Layer, ScalarKeyframe, TextLayer } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";

// Centered RGB-split glitch title (a beginner-friendly, auto-centering take on
// core's glitchTitle factory): flickering main title, cyan/magenta echoes and
// two sliding glitch bars. All timings are local to the plugin window.
export const glitchTitle = definePlugin({
  name: "glitch-title",
  displayName: "Glitch Title",
  description: "A centered title with RGB-split echoes, flicker and glitch bars.",
  category: "title",
  defaultDurationMs: 2400,
  params: {
    text: { type: "string", required: true, label: "Title text" },
    size: { type: "number", default: 0, min: 0, label: "Font size (0 = auto)" },
    y: { type: "number", default: 0.42, min: 0, max: 1, step: 0.01, label: "Vertical position (fraction)" },
    color: { type: "color", default: "#ffffff" },
    accentA: { type: "color", default: "#8ecae6" },
    accentB: { type: "color", default: "#ff006e" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const size = params.size > 0 ? params.size : Math.round(h * 0.12);
    const cx = w / 2;
    const cy = Math.round(h * params.y);
    const estWidth = estimateTextWidth(params.text, size);
    const flicker: ScalarKeyframe[] = [
      { timeMs: 0, value: 0 },
      { timeMs: Math.min(120, durationMs * 0.1), value: 1 },
      { timeMs: Math.min(360, durationMs * 0.3), value: 0.32 },
      { timeMs: Math.min(430, durationMs * 0.36), value: 1 },
      { timeMs: Math.max(Math.min(500, durationMs * 0.42), durationMs - 180), value: 1 },
      { timeMs: durationMs, value: 0 }
    ];
    const main: TextLayer = {
      type: "text",
      id: "glitch-title",
      text: params.text,
      size,
      color: params.color,
      align: "center",
      stroke: "rgba(0,0,0,0.62)",
      strokeWidth: Math.max(3, Math.round(size * 0.05)),
      shadowColor: "rgba(0,0,0,0.72)",
      shadowBlur: Math.max(6, Math.round(size * 0.12)),
      shadowDy: Math.round(size * 0.08),
      transform: { x: cx, y: cy, opacity: flicker }
    };
    return [
      main,
      echo("cyan", params.text, size, cx, cy, params.accentA, -8, -3, durationMs),
      echo("magenta", params.text, size, cx, cy, params.accentB, 9, 4, durationMs),
      bar(0, estWidth, size, cx, cy, params.accentA, -0.52, durationMs),
      bar(1, estWidth, size, cx, cy, params.accentB, 0.18, durationMs)
    ];
  }
});

function echo(suffix: string, text: string, size: number, cx: number, cy: number, color: string, dx: number, dy: number, durationMs: number): TextLayer {
  const startMs = Math.min(70, durationMs * 0.05);
  const endMs = Math.min(durationMs, 720);
  return {
    type: "text",
    id: `glitch-title-${suffix}`,
    text,
    size,
    color,
    align: "center",
    startMs,
    endMs,
    transform: {
      x: [
        { timeMs: startMs, value: cx + dx },
        { timeMs: Math.min(210, endMs), value: cx - dx },
        { timeMs: Math.min(360, endMs), value: cx + dx / 2 }
      ],
      y: cy + dy,
      opacity: [
        { timeMs: startMs, value: 0 },
        { timeMs: Math.min(140, endMs), value: 0.72 },
        { timeMs: Math.min(430, endMs), value: 0.16 },
        { timeMs: endMs, value: 0 }
      ]
    }
  };
}

function bar(index: number, estWidth: number, size: number, cx: number, cy: number, fill: string, yFactor: number, durationMs: number): Layer {
  const startMs = Math.min(180 + index * 90, durationMs * 0.5);
  const endMs = Math.min(durationMs, startMs + 360);
  const barW = Math.round(estWidth * 0.94);
  const left = cx - barW / 2;
  return {
    type: "shape",
    id: `glitch-title-slice-${index}`,
    shape: "rect",
    width: barW,
    height: Math.max(4, Math.round(size * 0.08)),
    fill,
    startMs,
    endMs,
    transform: {
      x: [
        { timeMs: startMs, value: left - 24 },
        { timeMs: Math.min(startMs + 120, endMs), value: left + 34 },
        { timeMs: endMs, value: left - 12 }
      ],
      y: cy + Math.round(size * yFactor),
      opacity: [
        { timeMs: startMs, value: 0 },
        { timeMs: Math.min(startMs + 70, endMs), value: 0.86 },
        { timeMs: Math.min(startMs + 230, endMs), value: 0.18 },
        { timeMs: endMs, value: 0 }
      ]
    }
  };
}

// Rough centering width: CJK glyphs ≈ 1em, everything else ≈ 0.55em. Used by
// title plugins to size bars/sweeps (text itself centres via align).
export function estimateTextWidth(text: string, size: number): number {
  let width = 0;
  for (const ch of text) {
    width += ch.codePointAt(0)! >= 0x2e80 ? size : size * 0.55;
  }
  return width;
}
