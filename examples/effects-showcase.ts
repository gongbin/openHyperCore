// Demo: gradients, blend modes, full-layer blur, motion blur and arbitrary
// shape clipping — all pure-vector, so it renders with no external assets.
//
//   pnpm cli render examples/effects-showcase.ts --out /tmp/effects.mp4
import { defineComposition } from "../packages/core/src/index.ts";
import type { Gradient, Layer } from "../packages/core/src/index.ts";

const FPS = 30;
const W = 1280;
const H = 720;
const DUR = 4000;

const skyGradient: Gradient = {
  type: "radial",
  center: [W / 2, H / 2],
  radius: H,
  stops: [
    { offset: 0, color: "#1b2a4a" },
    { offset: 1, color: "#070b14" }
  ]
};

const titleGradient: Gradient = {
  type: "linear",
  from: [0, 0],
  to: [560, 0],
  stops: [
    { offset: 0, color: "#ff8a5c" },
    { offset: 0.5, color: "#ffd166" },
    { offset: 1, color: "#2ec4b6" }
  ]
};

// Two overlapping blurred discs composited with "screen" → an additive glow.
function glow(id: string, x: number, color: string): Layer {
  return {
    type: "group",
    id,
    blendMode: "screen",
    blur: 40,
    transform: { x, y: 220 },
    layers: [{ type: "shape", shape: "circle", radius: 120, fill: color }]
  };
}

export default defineComposition({
  fps: FPS,
  width: W,
  height: H,
  durationMs: DUR,
  layers: [
    { type: "shape", shape: "rect", width: W, height: H, fill: skyGradient },

    glow("glow-a", 520, "#2ec4b6"),
    glow("glow-b", 760, "#ff5d73"),

    // Gradient title.
    { type: "text", id: "title", text: "渐变 · 混合 · 模糊", size: 92, color: titleGradient, align: "center", transform: { x: W / 2, y: 360 } },

    // A photo-card clipped to a rounded rect, drifting with motion blur.
    {
      type: "group",
      id: "card",
      clip: { type: "rect", width: 360, height: 200, radius: 28 },
      motionBlur: { angle: 0, distance: 90, samples: 12 },
      transform: {
        x: [
          { timeMs: 0, value: 120 },
          { timeMs: 1500, value: 820, easing: [0.2, 0, 0, 1] },
          { timeMs: 3000, value: 120, easing: [0.2, 0, 0, 1] }
        ],
        y: 470
      },
      layers: [
        { type: "shape", shape: "rect", width: 360, height: 200, fill: { type: "linear", from: [0, 0], to: [360, 200], stops: [{ offset: 0, color: "#3a1c71" }, { offset: 1, color: "#d76d77" }] } },
        { type: "text", text: "运动模糊", size: 44, color: "#ffffff", align: "center", transform: { x: 180, y: 116 } }
      ]
    }
  ]
});
