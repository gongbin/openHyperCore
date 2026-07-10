import type { Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { seeded } from "./globe-common.ts";

// Hyperspace jump opener: star streaks accelerate radially from the centre
// (length and outward push grow with an accel^n ramp), spike to a full-frame
// white flash at light-speed (~70% of the window), then the title punches in,
// scaling down from oversize as the flash clears. The end state holds.
export const hyperspaceWarp = definePlugin({
  name: "hyperspace-warp",
  displayName: "Hyperspace Warp",
  description: "Star streaks accelerate radially from the centre, spike to a white flash at light-speed, then the title punches in scaling down from oversize.",
  category: "opener",
  defaultDurationMs: 3800,
  params: {
    streaks: { type: "number", default: 120, min: 20, max: 240, step: 10, label: "Streak count" },
    accel: { type: "number", default: 2.0, min: 1, max: 4, step: 0.1, label: "Acceleration exponent" },
    flashMs: { type: "number", default: 300, min: 0, max: 1000, step: 50, label: "Flash duration (ms)" },
    title: { type: "string", default: "HYPERSPACE", label: "Title text" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs: T } = ctx;
    const cx = w / 2;
    const cy = h / 2;
    // The reference design was authored on a 1024x576 canvas; scale absolute px.
    const unit = h / 576;
    const rand = seeded(3);
    const count = Math.max(1, Math.round(params.streaks));

    // speed(p): 0 → 1 over the first 70% with an accelerating (p^accel) ramp,
    // then held at light-speed. Baked at quadratically-informative fractions.
    const rampEnd = 0.7 * T;
    const fractions = [0, 0.25, 0.45, 0.65, 0.85, 1];
    const speedAt = (f: number): number => Math.pow(f, params.accel);

    const streaks: Layer[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = rand() * Math.PI * 2;
      const dist = rand();
      const r0 = dist * Math.max(w, h) * 0.06;
      const lineWidth = (1 + dist * 1.6) * unit;
      const lengthAt = (speed: number): number => (8 + speed * 190) * (0.4 + dist) * unit;
      const maxLen = lengthAt(1);
      const xTrack: ScalarKeyframe[] = fractions.map((f) => ({
        timeMs: Math.round(f * rampEnd),
        value: r0 + speedAt(f) * 40 * unit
      }));
      const lenTrack: ScalarKeyframe[] = fractions.map((f) => ({
        timeMs: Math.round(f * rampEnd),
        value: lengthAt(speedAt(f)) / maxLen
      }));
      // Rotation lives on the wrapper group so the inner scaleX stretches the
      // streak along its OWN direction (per-layer order is scale-then-rotate).
      streaks.push({
        type: "group",
        layers: [{
          type: "shape",
          shape: "rect",
          width: maxLen,
          height: lineWidth,
          fill: "#b4cdff",
          transform: {
            y: -lineWidth / 2,
            x: xTrack,
            scaleX: lenTrack,
            opacity: 0.18 + 0.6 * dist
          }
        }],
        transform: { x: cx, y: cy, rotate: (angle * 180) / Math.PI }
      });
    }

    const layers: Layer[] = [
      { type: "shape", id: "warp-bg", shape: "rect", width: w, height: h, fill: "#03060f" },
      { type: "group", id: "warp-streaks", cache: false, layers: streaks }
    ];

    // Light-speed flash: a full-frame white rect spiking around 70% of the window.
    if (params.flashMs > 0) {
      const centre = Math.round(0.7 * T);
      const half = Math.max(16, Math.round(params.flashMs / 2));
      const from = Math.max(0, centre - half);
      const to = Math.min(T, centre + half);
      layers.push({
        type: "shape",
        id: "warp-flash",
        shape: "rect",
        width: w,
        height: h,
        fill: "#ffffff",
        startMs: from,
        endMs: to,
        transform: {
          opacity: [
            { timeMs: from, value: 0 },
            { timeMs: centre, value: 0.85 },
            { timeMs: to, value: 0 }
          ]
        }
      });
    }

    // Title punches in as the flash clears: scale 2.2 → 1 with an ease-out,
    // opacity fading up over the first half of the settle.
    const title = params.title ?? "";
    if (title.length > 0) {
      const size = Math.round(h * 0.13);
      const inMs = Math.round(0.7 * T);
      layers.push({
        type: "text",
        id: "warp-title",
        text: title,
        size,
        color: "#ffffff",
        align: "center",
        letterSpacing: Math.round(size * 0.04),
        shadowColor: "rgba(120,160,255,0.55)",
        shadowBlur: Math.round(size * 0.35),
        shadowDy: 0,
        startMs: inMs,
        transform: {
          x: cx,
          y: cy + size * 0.35,
          scale: [
            { timeMs: inMs, value: 2.2 },
            { timeMs: Math.round(0.9 * T), value: 1, easing: "easeOut" }
          ],
          opacity: [
            { timeMs: inMs, value: 0 },
            { timeMs: Math.round(0.85 * T), value: 1 }
          ]
        }
      });
    }

    return layers;
  }
});
