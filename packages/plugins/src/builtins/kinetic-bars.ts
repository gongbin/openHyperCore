import type { Layer } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { withAlpha } from "./globe-common.ts";

// Kinetic typography bars: solid colour bars punch in from alternating sides
// with a staggered cubic ease, each acting as a moving mask over a line of
// screen-fixed type — the words snap into place as their bar slides home.
// Odd lines use the demo's "outline" style: translucent accent fill, accent
// stroke fading in, and white text; even lines are solid bars with dark text.
// Lines are given as one `/`-separated string (e.g. "MOTION / IN / FRAMES").
export const kineticBars = definePlugin({
  name: "kinetic-bars",
  displayName: "Kinetic Bars",
  description: "Solid colour bars punch in from alternating sides, each masking a line of type so the words snap into place with a staggered cubic ease.",
  category: "opener",
  defaultDurationMs: 3600,
  params: {
    lines: { type: "string", default: "MOTION / IN / FRAMES", label: "Lines (separated by /)" },
    barColor: { type: "color", default: "#4f8cff", label: "Bar color" },
    staggerMs: { type: "number", default: 120, min: 0, max: 600, step: 10, label: "Stagger (ms)" },
    slideMs: { type: "number", default: 400, min: 100, max: 2000, step: 10, label: "Slide duration (ms)" },
    background: { type: "color", default: "#0b0f16", label: "Background" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const rows = params.lines.split("/").map((s) => s.trim()).filter((s) => s.length > 0);
    const barH = h * 0.2;
    const gap = h * 0.035;
    const barW = w * 0.62;
    const barX = (w - barW) / 2;
    const totalH = rows.length * barH + Math.max(0, rows.length - 1) * gap;
    const textSize = Math.round(barH * 0.6);

    const layers: Layer[] = [
      { type: "shape", id: "kinetic-bg", shape: "rect", width: w, height: h, fill: params.background }
    ];

    let y = (h - totalH) / 2;
    rows.forEach((line, i) => {
      const outlineStyle = i % 2 === 1;
      const dir = i % 2 === 1 ? -1 : 1;
      const delay = Math.min(i * params.staggerMs, Math.max(0, durationMs - params.slideMs));
      const slideEnd = Math.min(delay + params.slideMs, durationMs);
      const startOffset = dir * w * 1.1;

      // The moving group carries the bar AND the clip; the text counter-moves
      // with the same ease so it stays screen-fixed while the mask slides in.
      layers.push({
        type: "group",
        id: `kinetic-row-${i}`,
        cache: false,
        clip: { type: "rect", x: barX, y, width: barW, height: barH },
        layers: [
          {
            type: "shape",
            id: `kinetic-bar-${i}`,
            shape: "rect",
            width: barW,
            height: barH,
            fill: outlineStyle ? withAlpha(params.barColor, 0.13) : params.barColor,
            transform: { x: barX, y }
          },
          {
            type: "text",
            id: `kinetic-text-${i}`,
            text: line,
            size: textSize,
            color: outlineStyle ? "#ffffff" : params.background,
            align: "center",
            transform: {
              x: [
                { timeMs: delay, value: w / 2 - startOffset },
                { timeMs: slideEnd, value: w / 2, easing: "easeOutCubic" }
              ],
              y: y + barH / 2 + textSize * 0.35
            }
          }
        ],
        transform: {
          x: [
            { timeMs: delay, value: startOffset },
            { timeMs: slideEnd, value: 0, easing: "easeOutCubic" }
          ]
        }
      });

      // Accent outline of the demo's "bar" row: strokes the MOVING bar rect
      // (unclipped, like the demo), fading in as the bar slides home.
      if (outlineStyle) {
        layers.push({
          type: "shape",
          id: `kinetic-outline-${i}`,
          shape: "rect",
          width: barW,
          height: barH,
          stroke: params.barColor,
          strokeWidth: 1.5,
          transform: {
            x: [
              { timeMs: delay, value: barX + startOffset },
              { timeMs: slideEnd, value: barX, easing: "easeOutCubic" }
            ],
            y,
            opacity: [
              { timeMs: delay, value: 0 },
              { timeMs: slideEnd, value: 1, easing: "easeOutCubic" }
            ]
          }
        });
      }
      y += barH + gap;
    });
    return layers;
  }
});
