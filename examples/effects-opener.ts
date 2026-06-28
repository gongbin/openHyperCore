import {
  cinematicBars,
  createTimeline,
  flashTransitionLayer,
  glitchTitle,
  speedLineBurst
} from "../packages/core/src/index.ts";

const timeline = createTimeline({ width: 1280, height: 720, fps: 30 })
  .scene("cold-open", 1600, ({ startMs, endMs, width, height }) => [
    {
      type: "shape",
      id: "cold-bg",
      shape: "rect",
      width,
      height,
      fill: "#05060d",
      startMs,
      endMs
    },
    ...speedLineBurst({
      id: "cold-speed",
      width,
      height,
      startMs,
      endMs,
      count: 22,
      seed: 11,
      colors: ["rgba(255,255,255,0.76)", "rgba(39,231,224,0.76)", "rgba(255,46,136,0.70)"]
    }),
    ...cinematicBars({ width, height, startMs, endMs, barHeight: 78 }),
    ...glitchTitle({
      id: "cold-title",
      text: "OPENHYPER",
      startMs,
      endMs,
      x: 132,
      y: 340,
      size: 104,
      color: "#ffffff",
      accentA: "#27e7e0",
      accentB: "#ff2e88"
    })
  ])
  .transition("white-hit", 280, ({ startMs, width, height }) => [
    flashTransitionLayer({ width, height, startMs, durationMs: 280, peakOpacity: 0.96 })
  ])
  .scene("title-card", 1700, ({ startMs, endMs, width, height }) => [
    {
      type: "shape",
      id: "card-bg",
      shape: "rect",
      width,
      height,
      fill: "#101820",
      startMs,
      endMs
    },
    {
      type: "shape",
      id: "card-accent-a",
      shape: "rect",
      width: 880,
      height: 10,
      fill: "#ffb703",
      startMs,
      endMs,
      transform: {
        x: [
          { timeMs: startMs, value: -720 },
          { timeMs: startMs + 620, value: 210 },
          { timeMs: endMs, value: 260 }
        ],
        y: 248,
        rotate: -7,
        opacity: [
          { timeMs: startMs, value: 0 },
          { timeMs: startMs + 180, value: 1 },
          { timeMs: endMs - 260, value: 1 },
          { timeMs: endMs, value: 0 }
        ]
      }
    },
    ...glitchTitle({
      id: "card-title",
      text: "RENDER FAST",
      startMs: startMs + 160,
      endMs,
      x: 180,
      y: 360,
      size: 86,
      color: "#f8f9fa",
      accentA: "#8ecae6",
      accentB: "#ffb703"
    })
  ])
  .build();

export default timeline.composition;
