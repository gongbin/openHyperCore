import type { Layer } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { seeded, withAlpha } from "./globe-common.ts";

// Particle logo assembly: `count` accent particles start scattered at seeded
// random positions (±0.75 × frame around the mark's centre) and ease along a
// cubic curve onto their targets — a ring mark (every 6th particle spirals to
// an inner ring at 0.3 R, like the demo) or a two-radius starburst — while
// brightening from 0.2 to full opacity. The ring outline fades in halfway
// through, and the wordmark fades up beneath the mark near the end. Holds.
export const particleAssemble = definePlugin({
  name: "particle-assemble",
  displayName: "Particle Assemble",
  description: "Scattered particles ease from random space toward target points, converging into a ring-mark logo before the wordmark fades up beneath it.",
  category: "opener",
  defaultDurationMs: 4000,
  params: {
    count: { type: "number", default: 90, min: 8, max: 240, step: 1, label: "Particles" },
    color: { type: "color", default: "#4f8cff", label: "Particle color" },
    assembleMs: { type: "number", default: 2800, min: 300, step: 50, label: "Assemble duration (ms)" },
    shape: { type: "select", options: ["ring", "burst"], default: "ring", label: "Target shape" },
    title: { type: "string", default: "ASSEMBLE", label: "Title text" },
    background: { type: "color", default: "#070a12", label: "Background" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const cx = w / 2;
    const cy = h * 0.44;
    const R = h * 0.24;
    const count = Math.max(1, Math.round(params.count));
    const assembleMs = Math.min(params.assembleMs, durationMs);
    const pr = Math.max(2, h * 0.004);
    const rand = seeded(5);

    const particles: Layer[] = [];
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      let tx: number;
      let ty: number;
      if (params.shape === "burst") {
        // Starburst: alternate between the outer ring and an inner radius.
        const rr = i % 2 === 0 ? R : R * 0.55;
        tx = cx + Math.cos(a) * rr;
        ty = cy + Math.sin(a) * rr;
      } else if (i % 6 === 0) {
        // Ring mark: every 6th particle winds onto an inner ring at 3× angle.
        const rr = R * 0.3;
        tx = cx + Math.cos(a * 3) * rr;
        ty = cy + Math.sin(a * 3) * rr;
      } else {
        tx = cx + Math.cos(a) * R;
        ty = cy + Math.sin(a) * R;
      }
      const sx = cx + (rand() * 2 - 1) * w * 0.75;
      const sy = cy + (rand() * 2 - 1) * h * 0.75;

      particles.push({
        type: "shape",
        shape: "circle",
        radius: pr,
        fill: params.color,
        transform: {
          x: [
            { timeMs: 0, value: sx - pr },
            { timeMs: assembleMs, value: tx - pr, easing: "easeOutCubic" }
          ],
          y: [
            { timeMs: 0, value: sy - pr },
            { timeMs: assembleMs, value: ty - pr, easing: "easeOutCubic" }
          ],
          opacity: [
            { timeMs: 0, value: 0.2 },
            { timeMs: assembleMs, value: 1, easing: "easeOutCubic" }
          ]
        }
      });
    }

    const layers: Layer[] = [
      { type: "shape", id: "assemble-bg", shape: "rect", width: w, height: h, fill: params.background },
      { type: "group", id: "assemble-particles", cache: false, layers: particles },
      // The ring outline settles in once the swarm is halfway home.
      {
        type: "shape",
        id: "assemble-ring",
        shape: "circle",
        radius: R,
        stroke: withAlpha(params.color, 0.6),
        strokeWidth: 2,
        transform: {
          x: cx - R,
          y: cy - R,
          opacity: [
            { timeMs: Math.round(durationMs * 0.5), value: 0 },
            { timeMs: Math.round(durationMs * 0.8), value: 1 }
          ]
        }
      }
    ];

    if (params.title) {
      const titleSize = Math.round(h * 0.085);
      layers.push({
        type: "text",
        id: "assemble-title",
        text: params.title,
        size: titleSize,
        color: "#eaf1ff",
        align: "center",
        transform: {
          x: cx,
          y: Math.round(h * 0.83 + titleSize * 0.35),
          opacity: [
            { timeMs: Math.round(durationMs * 0.72), value: 0 },
            { timeMs: Math.round(durationMs * 0.92), value: 1 }
          ]
        }
      });
    }
    return layers;
  }
});
