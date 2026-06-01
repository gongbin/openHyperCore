import { defineComposition } from "../packages/core/src/index.ts";

export default defineComposition({
  fps: 30,
  width: 1280,
  height: 720,
  durationMs: 3000,
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
      type: "text",
      id: "title",
      text: "OpenHyperCore",
      size: 84,
      color: "#f6f7f9",
      startMs: 0,
      endMs: 2500,
      transform: {
        x: 120,
        y: 220,
        opacity: [
          { timeMs: 0, value: 0 },
          { timeMs: 600, value: 1 }
        ]
      }
    },
    {
      type: "shape",
      id: "accent",
      shape: "rect",
      width: 480,
      height: 16,
      fill: "#2ec4b6",
      transform: {
        x: [
          { timeMs: 0, value: 120 },
          { timeMs: 1000, value: 180 }
        ],
        y: 280
      }
    }
  ]
});
