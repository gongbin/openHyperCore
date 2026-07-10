import type { Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { withAlpha } from "./globe-common.ts";
import { shade } from "./color.ts";

// Phosphor radar: a cached grid of concentric rings and a crosshair, with a
// bright glowing sweep line (and a decaying trail of fainter lines behind it)
// revolving from 12 o'clock — one revolution per `sweepMs`, continuing across
// the whole window. Fixed blips flare and ring outward the instant the beam
// passes over them, computed from the rotation speed, then decay back to dim.
export const radarSweep = definePlugin({
  name: "radar-sweep",
  displayName: "Radar Sweep",
  description: "A phosphor radar grid with a rotating sweep line and a decaying trail; blips flare and ring out the instant the beam passes over them.",
  category: "opener",
  defaultDurationMs: 4000,
  params: {
    color: { type: "color", default: "#7dffcf", label: "Phosphor color" },
    rings: { type: "number", default: 4, min: 1, max: 8, step: 1, label: "Rings" },
    sweepMs: { type: "number", default: 4000, min: 500, step: 100, label: "Sweep period (ms)" },
    blips: { type: "number", default: 4, min: 0, max: 8, step: 1, label: "Blips" },
    background: { type: "color", default: "#060d0a", label: "Background" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42;
    const rings = Math.max(1, Math.round(params.rings));
    const sweepMs = params.sweepMs;
    const bright = shade(params.color, 0.15);

    // Static furniture (rings + crosshair) rasters once via cache.
    const furniture: Layer[] = [];
    for (let i = 1; i <= rings; i += 1) {
      const r = (R * i) / rings;
      furniture.push({
        type: "shape",
        shape: "circle",
        radius: r,
        stroke: withAlpha(params.color, 0.22),
        strokeWidth: 1,
        transform: { x: -r, y: -r }
      });
    }
    furniture.push(
      { type: "shape", shape: "rect", width: R * 2, height: 1.5, fill: withAlpha(params.color, 0.22), transform: { x: -R, y: -0.75 } },
      { type: "shape", shape: "rect", width: 1.5, height: R * 2, fill: withAlpha(params.color, 0.22), transform: { x: -0.75, y: -R } }
    );

    // The rotating beam: bright glowing line at the head plus a decaying trail
    // of fainter lines at small negative angle offsets (the phosphor smear).
    const TRAIL = 16;
    const TRAIL_SPAN_DEG = 74;
    const beam: Layer[] = [];
    for (let i = TRAIL; i >= 1; i -= 1) {
      beam.push({
        type: "shape",
        id: `radar-trail-${i}`,
        shape: "path",
        path: `M 0 0 L ${R} 0`,
        stroke: withAlpha(params.color, 0.34 * (1 - i / (TRAIL + 1))),
        strokeWidth: 2,
        transform: { rotate: -(i / TRAIL) * TRAIL_SPAN_DEG }
      });
    }
    beam.push({
      type: "shape",
      id: "radar-beam",
      shape: "path",
      path: `M 0 0 L ${R} 0`,
      stroke: bright,
      strokeWidth: 2.5,
      blur: 4
    });

    const layers: Layer[] = [
      { type: "shape", id: "radar-bg", shape: "rect", width: w, height: h, fill: params.background },
      { type: "group", id: "radar-furniture", cache: true, layers: furniture, transform: { x: cx, y: cy } },
      {
        type: "group",
        id: "radar-sweep",
        cache: false,
        layers: beam,
        transform: {
          x: cx,
          y: cy,
          // Start at 12 o'clock; k revolutions across the window.
          rotate: [
            { timeMs: 0, value: -90 },
            { timeMs: durationMs, value: -90 + (360 * durationMs) / sweepMs }
          ]
        }
      }
    ];

    // Blips at fixed positions (fractions of R; first four match the demo).
    const BLIP_POS: ReadonlyArray<readonly [number, number]> = [
      [0.5, 0.35], [-0.34, 0.5], [0.24, -0.62], [-0.58, -0.24],
      [0.66, -0.12], [-0.14, -0.42], [0.12, 0.64], [-0.6, 0.14]
    ];
    const blipCount = Math.min(Math.max(0, Math.round(params.blips)), BLIP_POS.length);
    // Beam decay window: the demo's 0.7 rad of trailing flare, in ms.
    const decayMs = Math.round((0.7 / (Math.PI * 2)) * sweepMs);
    const dotR = Math.max(3, R * 0.014);
    const ringR = Math.max(12, R * 0.09);

    for (let b = 0; b < blipCount; b += 1) {
      const [fx, fy] = BLIP_POS[b]!;
      const bx = cx + fx * R;
      const by = cy + fy * R;
      // Times at which the beam angle passes over this blip (per revolution).
      const blipDeg = (Math.atan2(fy, fx) * 180) / Math.PI;
      const firstPass = (((blipDeg + 90) % 360 + 360) % 360 / 360) * sweepMs;
      const passes: number[] = [];
      for (let t = firstPass; t < durationMs; t += sweepMs) {
        passes.push(Math.round(t));
      }

      // Circles scale about their top-left origin, so x/y counter-tracks keep
      // each blip centred: x = bx - r * scale(t), sharing the scale keyframes.
      type CenteredScale = { s: ScalarKeyframe[]; x: ScalarKeyframe[]; y: ScalarKeyframe[]; r: number };
      const push = (kf: CenteredScale, timeMs: number, scale: number, easing?: ScalarKeyframe["easing"]): void => {
        const at = (value: number): ScalarKeyframe => (easing ? { timeMs, value, easing } : { timeMs, value });
        kf.s.push(at(scale));
        kf.x.push(at(bx - kf.r * scale));
        kf.y.push(at(by - kf.r * scale));
      };
      const dot: CenteredScale = { s: [], x: [], y: [], r: dotR };
      const ring: CenteredScale = { s: [], x: [], y: [], r: ringR };
      const dotOpacity: ScalarKeyframe[] = [{ timeMs: 0, value: 0.28 }];
      const ringOpacity: ScalarKeyframe[] = [{ timeMs: 0, value: 0 }];
      push(dot, 0, 1);
      push(ring, 0, 0.25);
      for (const t of passes) {
        const tEnd = Math.min(t + decayMs, durationMs);
        if (t > 0) {
          dotOpacity.push({ timeMs: t - 1, value: 0.28 });
          ringOpacity.push({ timeMs: t - 1, value: 0 });
          push(dot, t - 1, 1);
          push(ring, t - 1, 0.25);
        }
        dotOpacity.push({ timeMs: t, value: 1 }, { timeMs: tEnd, value: 0.28 });
        ringOpacity.push({ timeMs: t, value: 0.6 }, { timeMs: tEnd, value: 0 });
        push(dot, t, 2.3);
        push(dot, tEnd, 1);
        push(ring, t, 0.25);
        push(ring, tEnd, 1, "easeOut");
      }

      layers.push({
        type: "shape",
        id: `radar-blip-${b}`,
        shape: "circle",
        radius: dotR,
        fill: bright,
        transform: { x: dot.x, y: dot.y, opacity: dotOpacity, scale: dot.s }
      });
      if (passes.length > 0) {
        layers.push({
          type: "shape",
          id: `radar-blip-ring-${b}`,
          shape: "circle",
          radius: ringR,
          stroke: withAlpha(params.color, 0.6),
          strokeWidth: 1.5,
          transform: { x: ring.x, y: ring.y, opacity: ringOpacity, scale: ring.s }
        });
      }
    }
    return layers;
  }
});
