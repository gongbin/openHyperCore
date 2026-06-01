import {
  defineComposition,
  fadeTransition,
  mergeTransforms,
  scaleTransition,
  slideTransition
} from "../../packages/core/src/index.ts";

export default defineComposition({
  fps: 30,
  width: 1280,
  height: 720,
  durationMs: 5000,
  layers: [
    {
      type: "shape",
      id: "background",
      shape: "rect",
      width: 1280,
      height: 720,
      fill: "#101820"
    },
    {
      type: "shape",
      id: "panel",
      shape: "rect",
      width: 960,
      height: 420,
      fill: "#182a3a",
      transform: mergeTransforms(
        fadeTransition({ startMs: 0, durationMs: 500 }),
        slideTransition({ startMs: 0, durationMs: 500, from: { y: 60 }, to: { y: 0 } })
      )
    },
    {
      type: "text",
      id: "title",
      text: "OpenHyperCore Benchmark",
      size: 64,
      color: "#f6f7f9",
      transform: mergeTransforms(
        fadeTransition({ startMs: 100, durationMs: 700 }),
        slideTransition({ startMs: 100, durationMs: 700, from: { x: 80, y: 190 }, to: { x: 120, y: 190 } }),
        scaleTransition({ startMs: 100, durationMs: 700, from: 0.96, to: 1 })
      )
    },
    {
      type: "shape",
      id: "moving-dot",
      shape: "circle",
      radius: 34,
      fill: "#2ec4b6",
      transform: {
        x: [
          { timeMs: 0, value: 160 },
          { timeMs: 2500, value: 1080 },
          { timeMs: 5000, value: 160 }
        ],
        y: [
          { timeMs: 0, value: 500 },
          { timeMs: 2500, value: 430 },
          { timeMs: 5000, value: 500 }
        ],
        scale: [
          { timeMs: 0, value: 0.7 },
          { timeMs: 2500, value: 1.15 },
          { timeMs: 5000, value: 0.7 }
        ]
      }
    },
    {
      type: "caption",
      id: "caption",
      text: "Animated layers + caption + transition helpers",
      startMs: 800,
      endMs: 4400,
      size: 34,
      color: "#ffffff",
      backgroundColor: "#000000",
      padding: 12,
      align: "center",
      transform: { x: 640, y: 650 }
    }
  ]
});
