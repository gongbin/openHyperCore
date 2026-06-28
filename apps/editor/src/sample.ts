import { defineComposition } from "openhypercore";
import type { Composition } from "openhypercore";

// A vector-only starter composition (shapes + gradients + blend + clip + a
// spring/cubic-bezier-animated card) — fully faithful in the canvaskit preview.
export const sampleComposition: Composition = defineComposition({
  fps: 30,
  width: 1280,
  height: 720,
  durationMs: 3000,
  layers: [
    {
      type: "shape",
      shape: "rect",
      width: 1280,
      height: 720,
      fill: { type: "radial", center: [640, 360], radius: 720, stops: [{ offset: 0, color: "#1b2a4a" }, { offset: 1, color: "#070b14" }] }
    },
    {
      type: "shape",
      shape: "circle",
      radius: 150,
      fill: { type: "radial", center: [150, 150], radius: 150, stops: [{ offset: 0, color: "rgba(46,196,182,0.9)" }, { offset: 1, color: "rgba(46,196,182,0)" }] },
      blendMode: "screen",
      transform: { x: 360, y: 180 }
    },
    {
      type: "shape",
      shape: "circle",
      radius: 150,
      fill: { type: "radial", center: [150, 150], radius: 150, stops: [{ offset: 0, color: "rgba(255,93,115,0.9)" }, { offset: 1, color: "rgba(255,93,115,0)" }] },
      blendMode: "screen",
      transform: { x: 620, y: 200 }
    },
    {
      type: "group",
      id: "card",
      clip: { type: "rect", width: 360, height: 200, radius: 28 },
      transform: {
        x: [
          { timeMs: 0, value: 120 },
          { timeMs: 1400, value: 800, easing: [0.2, 0, 0, 1] },
          { timeMs: 2800, value: 120, easing: [0.2, 0, 0, 1] }
        ],
        y: 420
      },
      layers: [
        { type: "shape", shape: "rect", width: 360, height: 200, fill: { type: "linear", from: [0, 0], to: [360, 200], stops: [{ offset: 0, color: "#3a1c71" }, { offset: 1, color: "#d76d77" }] } }
      ]
    }
  ]
});
