import type { Layer } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { estimateTextWidth } from "./glitch-title.ts";
import { withAlpha } from "./globe-common.ts";

// Polished title reveal: the text rises and fades in, an underline grows out
// from the centre, and a bright diagonal light bar sweeps across the title
// (additive blend, clipped to the title's box) — the classic trailer shine.
export const lightSweepTitle = definePlugin({
  name: "light-sweep-title",
  displayName: "Light Sweep Title",
  description: "A title fades up, an underline grows, and a light bar sweeps across.",
  category: "title",
  defaultDurationMs: 3000,
  params: {
    text: { type: "string", required: true, label: "Title text" },
    size: { type: "number", default: 0, min: 0, label: "Font size (0 = auto)" },
    y: { type: "number", default: 0.45, min: 0, max: 1, step: 0.01, label: "Vertical position (fraction)" },
    color: { type: "color", default: "#ffffff" },
    sweepColor: { type: "color", default: "#fff6d8" },
    underline: { type: "boolean", default: true }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const size = params.size > 0 ? params.size : Math.round(h * 0.11);
    const cx = w / 2;
    const cy = Math.round(h * params.y);
    const estW = estimateTextWidth(params.text, size);
    const boxW = estW + size * 0.6;
    const boxH = size * 1.5;
    const enter = Math.min(600, Math.round(durationMs * 0.25));
    const sweepStart = Math.round(enter * 0.9);
    const sweepMs = Math.min(750, Math.round(durationMs * 0.3));

    const layers: Layer[] = [
      {
        type: "text",
        id: "sweep-title",
        text: params.text,
        size,
        color: params.color,
        align: "center",
        shadowColor: "rgba(0,0,0,0.65)",
        shadowBlur: Math.max(6, Math.round(size * 0.1)),
        shadowDy: Math.round(size * 0.06),
        transform: {
          x: cx,
          y: [
            { timeMs: 0, value: cy + size * 0.35 },
            { timeMs: enter, value: cy, easing: [0.2, 0, 0, 1] }
          ],
          opacity: [
            { timeMs: 0, value: 0 },
            { timeMs: enter, value: 1 }
          ]
        }
      },
      // The light bar, additive-blended and clipped to the title box so the
      // shine never spills into the rest of the frame.
      {
        type: "group",
        id: "sweep-clip",
        cache: false,
        clip: { type: "rect", width: boxW, height: boxH, x: cx - boxW / 2, y: cy - size * 1.05 },
        blendMode: "add",
        layers: [{
          type: "shape",
          shape: "rect",
          width: size * 0.85,
          height: boxH * 2,
          fill: {
            type: "linear",
            from: [0, 0],
            to: [size * 0.85, 0],
            stops: [
              { offset: 0, color: "rgba(255,255,255,0)" },
              { offset: 0.5, color: withAlpha(params.sweepColor, 0.85) },
              { offset: 1, color: "rgba(255,255,255,0)" }
            ]
          },
          startMs: sweepStart,
          endMs: Math.min(sweepStart + sweepMs + 80, durationMs),
          transform: {
            rotate: -16,
            y: cy - size * 1.5,
            x: [
              { timeMs: sweepStart, value: cx - boxW / 2 - size },
              { timeMs: sweepStart + sweepMs, value: cx + boxW / 2 + size * 0.4, easing: "easeInOut" }
            ]
          }
        }]
      }
    ];

    if (params.underline) {
      const uw = estW * 1.06;
      layers.push({
        type: "shape",
        id: "sweep-underline",
        shape: "rect",
        width: uw,
        height: Math.max(3, Math.round(size * 0.045)),
        fill: params.color,
        transform: {
          y: cy + size * 0.32,
          // Grow from the centre: scaleX and the left-edge x share the easing.
          scaleX: [
            { timeMs: Math.round(enter * 0.6), value: 0 },
            { timeMs: enter + 350, value: 1, easing: [0.2, 0, 0, 1] }
          ],
          x: [
            { timeMs: Math.round(enter * 0.6), value: cx },
            { timeMs: enter + 350, value: cx - uw / 2, easing: [0.2, 0, 0, 1] }
          ],
          opacity: [
            { timeMs: Math.round(enter * 0.6), value: 0 },
            { timeMs: enter, value: 1 }
          ]
        }
      });
    }
    return layers;
  }
});
