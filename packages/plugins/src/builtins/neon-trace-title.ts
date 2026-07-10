import type { Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { estimateTextWidth } from "./glitch-title.ts";
import { withAlpha } from "./globe-common.ts";
import { shade } from "./color.ts";

// Neon sign ignition: the title's letters ignite one by one along a glowing
// trace — each glyph starts as a dim accent outline, flares with an additive
// neon glow, then floods to a bright white fill. Beneath the word an underline
// draws itself left→right with a travelling light node riding its tip, and a
// soft additive haze washes over the finished word. Ends fully lit and holds.
export const neonTraceTitle = definePlugin({
  name: "neon-trace-title",
  displayName: "Neon Trace Title",
  description: "Letters ignite one by one along a glowing trace, an underline draws with a travelling light node, then the word floods to full neon fill.",
  category: "opener",
  defaultDurationMs: 3400,
  params: {
    text: { type: "string", default: "HYPERCORE", label: "Title text" },
    size: { type: "number", default: 0, min: 0, label: "Font size (0 = auto)" },
    color: { type: "color", default: "#4f8cff", label: "Neon color" },
    glow: { type: "number", default: 18, min: 0, max: 60, step: 1, label: "Glow radius (px)" },
    traceMs: { type: "number", default: 2400, min: 200, step: 50, label: "Trace duration (ms)" },
    background: { type: "color", default: "#0d1526", label: "Background" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const size = params.size > 0 ? params.size : Math.round(h * 0.19);
    const glow = params.glow;
    const traceMs = Math.min(params.traceMs, durationMs);
    const chars = [...params.text];
    const gap = Math.round(h * 0.012);
    // estimateTextWidth's 0.55em Latin advance is tuned for mixed text; bold
    // display caps run ~0.7em, so widen the per-glyph advance to match.
    const widths = chars.map((c) => estimateTextWidth(c, size) * 1.28);
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, chars.length - 1);
    // The demo centres glyphs vertically at h * 0.47; text y is the baseline.
    const baselineY = Math.round(h * 0.47 + size * 0.35);

    const layers: Layer[] = [
      {
        type: "shape",
        id: "neon-bg",
        shape: "rect",
        width: w,
        height: h,
        fill: {
          type: "radial",
          center: [w / 2, h / 2],
          radius: w * 0.7,
          stops: [
            { offset: 0, color: params.background },
            { offset: 1, color: shade(params.background, -0.62) }
          ]
        }
      }
    ];

    // Per-character ignition: char i ignites over its own slice of the trace.
    let x = w / 2 - totalW / 2;
    chars.forEach((ch, i) => {
      const cx = x + widths[i]! / 2;
      const igniteStart = Math.round((traceMs * i) / chars.length);
      const igniteEnd = Math.round((traceMs * (i + 1)) / chars.length);
      const fillStart = Math.round(igniteStart + (igniteEnd - igniteStart) * 0.6);

      // Dim accent outline, brightening as the trace reaches the glyph.
      layers.push({
        type: "text",
        id: `neon-trace-${i}`,
        text: ch,
        size,
        color: "rgba(0,0,0,0)",
        stroke: params.color,
        strokeWidth: Math.max(2, Math.round(size * 0.015)),
        align: "center",
        transform: {
          x: cx,
          y: baselineY,
          opacity: [
            { timeMs: 0, value: 0.28 },
            { timeMs: igniteStart, value: 0.28 },
            { timeMs: igniteEnd, value: 1 }
          ]
        }
      });
      // Additive neon halo flaring around the glyph as it ignites, then
      // swelling to full strength once the whole word is lit (the "flood").
      if (glow > 0) {
        const glowOpacity: ScalarKeyframe[] = [
          { timeMs: igniteStart, value: 0 },
          { timeMs: igniteEnd, value: 0.75, easing: "easeOutCubic" }
        ];
        if (traceMs < durationMs) {
          glowOpacity.push(
            { timeMs: traceMs, value: 0.75 },
            { timeMs: Math.min(traceMs + (durationMs - traceMs) * 0.6, durationMs), value: 1, easing: "easeOut" }
          );
        }
        layers.push({
          type: "text",
          id: `neon-glow-${i}`,
          text: ch,
          size,
          color: params.color,
          align: "center",
          blendMode: "add",
          blur: Math.max(2, glow * 0.4),
          transform: { x: cx, y: baselineY, opacity: glowOpacity }
        });
      }
      // Bright white core flooding in over the last 40% of the ignition.
      layers.push({
        type: "text",
        id: `neon-fill-${i}`,
        text: ch,
        size,
        color: "#eaf1ff",
        align: "center",
        shadowColor: params.color,
        shadowBlur: Math.max(4, Math.round(glow * 1.3)),
        shadowDy: 0,
        transform: {
          x: cx,
          y: baselineY,
          opacity: [
            { timeMs: fillStart, value: 0 },
            { timeMs: igniteEnd, value: 1 }
          ]
        }
      });
      x += widths[i]! + gap;
    });

    // Underline growing from the left edge in step with the trace…
    const uy = Math.round(baselineY + size * 0.27);
    const ux0 = w / 2 - totalW / 2;
    const uh = Math.max(2, Math.round(size * 0.02));
    layers.push({
      type: "shape",
      id: "neon-underline",
      shape: "rect",
      width: totalW,
      height: uh,
      fill: withAlpha(params.color, 0.45),
      transform: {
        x: ux0,
        y: uy - uh / 2,
        scaleX: [
          { timeMs: 0, value: 0 },
          { timeMs: traceMs, value: 1 }
        ]
      }
    });
    // …with a glowing light node travelling along its tip.
    const nodeR = Math.max(3, Math.round(size * 0.035));
    const node: ScalarKeyframe[] = [
      { timeMs: 0, value: ux0 - nodeR },
      { timeMs: traceMs, value: ux0 + totalW - nodeR }
    ];
    layers.push({
      type: "shape",
      id: "neon-underline-node",
      shape: "circle",
      radius: nodeR,
      fill: params.color,
      blur: Math.max(2, glow * 0.45),
      transform: { x: node, y: uy - nodeR }
    });
    return layers;
  }
});
