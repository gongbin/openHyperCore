import type { Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { withAlpha } from "./globe-common.ts";

// Classic film-leader countdown: concentric rings and a crosshair over a big
// number, with a clock wedge sweeping one revolution per count (the group
// reveal's clock mask). The window is split evenly across the counts, so a
// 3-second window with from=3 ticks once per second.
export const countdown = definePlugin({
  name: "countdown",
  displayName: "Countdown",
  description: "A film-leader countdown: sweeping clock wedge, rings, crosshair, big numbers.",
  category: "opener",
  defaultDurationMs: 3000,
  params: {
    from: { type: "number", default: 3, min: 1, max: 9, step: 1, label: "Count from" },
    numberColor: { type: "color", default: "#f4f1ea" },
    ringColor: { type: "color", default: "#c9c2b4" },
    background: { type: "color", default: "#14161a" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const cx = w / 2;
    const cy = h / 2;
    const from = Math.max(1, Math.round(params.from));
    const stepMs = durationMs / from;

    const ring = (radius: number, strokeWidth: number): Layer => ({
      type: "shape",
      shape: "circle",
      radius,
      stroke: params.ringColor,
      strokeWidth,
      transform: { x: cx - radius, y: cy - radius, opacity: 0.8 }
    });
    const line = (x: number, y: number, lw: number, lh: number): Layer => ({
      type: "shape",
      shape: "rect",
      width: lw,
      height: lh,
      fill: withAlpha(params.ringColor, 0.55),
      transform: { x, y }
    });

    const layers: Layer[] = [
      { type: "shape", id: "cd-bg", shape: "rect", width: w, height: h, fill: params.background },
      // Static furniture rasters once: rings + crosshair in a cached group.
      {
        type: "group",
        id: "cd-furniture",
        cache: true,
        layers: [
          ring(h * 0.34, 3),
          ring(h * 0.285, 2),
          line(0, cy - 1, w, 2),
          line(cx - 1, 0, 2, h),
          // Corner vignette.
          {
            type: "shape",
            shape: "rect",
            width: w,
            height: h,
            fill: {
              type: "radial",
              center: [cx, cy],
              radius: Math.max(w, h) * 0.72,
              stops: [
                { offset: 0, color: "rgba(0,0,0,0)" },
                { offset: 0.7, color: "rgba(0,0,0,0.12)" },
                { offset: 1, color: "rgba(0,0,0,0.5)" }
              ]
            }
          }
        ]
      }
    ];

    for (let i = 0; i < from; i += 1) {
      const startMs = Math.round(i * stepMs);
      const endMs = Math.round((i + 1) * stepMs);
      const local = endMs - startMs;
      const pop: ScalarKeyframe[] = [
        { timeMs: 0, value: 1.08 },
        { timeMs: Math.min(180, local * 0.25), value: 1, easing: "easeOut" }
      ];
      // The sweeping brightening wedge — one clock revolution per count.
      layers.push({
        type: "group",
        id: `cd-wedge-${from - i}`,
        startMs,
        endMs,
        reveal: {
          type: "clock",
          width: w,
          height: h,
          progress: [{ timeMs: 0, value: 0 }, { timeMs: local, value: 1 }]
        },
        layers: [
          { type: "shape", shape: "rect", width: w, height: h, fill: "rgba(255,255,255,0.09)" },
          // The wedge also carries a soft warm tint inside the inner ring.
          {
            type: "shape",
            shape: "circle",
            radius: h * 0.285,
            fill: withAlpha(params.ringColor, 0.16),
            transform: { x: cx - h * 0.285, y: cy - h * 0.285 }
          }
        ]
      });
      layers.push({
        type: "text",
        id: `cd-number-${from - i}`,
        text: String(from - i),
        size: Math.round(h * 0.42),
        color: params.numberColor,
        align: "center",
        shadowColor: "rgba(0,0,0,0.6)",
        shadowBlur: 10,
        shadowDy: 4,
        startMs,
        endMs,
        transform: { x: cx, y: cy + h * 0.15, scale: pop }
      });
    }
    return layers;
  }
});
