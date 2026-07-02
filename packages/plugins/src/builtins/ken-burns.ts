import type { ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";

// Classic documentary photo opener: a full-frame image slowly zooms and
// drifts. Zoom is compensated so it grows around the frame CENTRE (the engine
// scales from the layer origin), and the drift lands on top of that.
export const kenBurns = definePlugin({
  name: "ken-burns",
  displayName: "Ken Burns Photo",
  description: "Full-frame photo with a slow cinematic zoom + drift, fading in and out.",
  category: "opener",
  defaultDurationMs: 4000,
  params: {
    src: { type: "asset", kind: "image", required: true, label: "Photo" },
    zoomFrom: { type: "number", default: 1, min: 0.2, max: 4, step: 0.01 },
    zoomTo: { type: "number", default: 1.15, min: 0.2, max: 4, step: 0.01 },
    driftX: { type: "number", default: 0, label: "Horizontal drift (px)" },
    driftY: { type: "number", default: 0, label: "Vertical drift (px)" },
    fadeInMs: { type: "number", default: 500, min: 0 },
    fadeOutMs: { type: "number", default: 500, min: 0 }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const track = (from: number, to: number): ScalarKeyframe[] => [
      { timeMs: 0, value: from },
      { timeMs: durationMs, value: to, easing: "easeInOut" }
    ];
    const opacity: ScalarKeyframe[] = [];
    if (params.fadeInMs > 0) {
      opacity.push({ timeMs: 0, value: 0 }, { timeMs: Math.min(params.fadeInMs, durationMs), value: 1 });
    }
    if (params.fadeOutMs > 0) {
      const fadeOutStart = Math.max(params.fadeInMs, durationMs - params.fadeOutMs);
      opacity.push({ timeMs: fadeOutStart, value: 1 }, { timeMs: durationMs, value: 0 });
    }
    return [
      {
        type: "image",
        id: "ken-burns-photo",
        src: params.src,
        fit: "cover",
        width: w,
        height: h,
        transform: {
          scale: track(params.zoomFrom, params.zoomTo),
          // Centre-compensation: origin shift that keeps the zoom centred,
          // with the requested drift layered on the end pose.
          x: track(((1 - params.zoomFrom) * w) / 2, ((1 - params.zoomTo) * w) / 2 + params.driftX),
          y: track(((1 - params.zoomFrom) * h) / 2, ((1 - params.zoomTo) * h) / 2 + params.driftY),
          ...(opacity.length > 0 ? { opacity } : {})
        }
      }
    ];
  }
});
