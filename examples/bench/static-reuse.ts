import { defineComposition } from "../../packages/core/src/index.ts";

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
      transform: { x: 160, y: 150 }
    },
    {
      type: "text",
      id: "title",
      text: "Static Frame Reuse",
      size: 72,
      color: "#f6f7f9",
      transform: { x: 220, y: 310 }
    },
    {
      type: "caption",
      id: "caption",
      text: "This fixture should render once and reuse remaining frames",
      size: 34,
      color: "#ffffff",
      backgroundColor: "#000000",
      padding: 12,
      align: "center",
      transform: { x: 640, y: 650 }
    }
  ]
});
