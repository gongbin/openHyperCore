import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer } from "../packages/core/src/index.ts";

const width = 1280;
const height = 720;
const introMs = 1900;
const durationMs = 12000;

const cutTimes = [1900, 3480, 5750, 8120, 10100];

function rect(id: string, startMs: number, endMs: number, x: number, y: number, w: number, h: number, fill: string, opacity = 1, rotate = 0): Layer {
  return {
    type: "shape",
    id,
    shape: "rect",
    width: w,
    height: h,
    fill,
    startMs,
    endMs,
    transform: { x, y, opacity, rotate }
  };
}

function flash(id: string, timeMs: number, color: string, maxOpacity = 0.76): Layer {
  return {
    type: "shape",
    id,
    shape: "rect",
    width,
    height,
    fill: color,
    startMs: timeMs,
    endMs: timeMs + 240,
    transform: {
      opacity: [
        { timeMs, value: 0 },
        { timeMs: timeMs + 42, value: maxOpacity },
        { timeMs: timeMs + 120, value: 0.18 },
        { timeMs: timeMs + 240, value: 0 }
      ]
    }
  };
}

function speedLine(id: string, index: number, side: "left" | "right"): Layer {
  const startMs = introMs + 260 + index * 165;
  const baseX = side === "left" ? 80 + index * 34 : 1180 - index * 31;
  const drift = side === "left" ? -180 : 180;
  return {
    type: "shape",
    id,
    shape: "rect",
    width: 5 + (index % 3) * 3,
    height: 260 + (index % 4) * 58,
    fill: index % 2 === 0 ? "rgba(255,183,3,0.82)" : "rgba(33,158,188,0.78)",
    startMs,
    endMs: durationMs - 900,
    transform: {
      x: [
        { timeMs: startMs, value: baseX },
        { timeMs: durationMs - 900, value: baseX + drift }
      ],
      y: [
        { timeMs: startMs, value: -360 - index * 44 },
        { timeMs: durationMs - 900, value: 820 + index * 36 }
      ],
      rotate: side === "left" ? -17 : 17,
      opacity: [
        { timeMs: startMs, value: 0 },
        { timeMs: startMs + 260, value: 0.86 },
        { timeMs: durationMs - 1200, value: 0.68 },
        { timeMs: durationMs - 900, value: 0 }
      ]
    }
  };
}

function trackingLine(id: string, startMs: number, endMs: number, x: number, y0: number, y1: number, color: string): Layer {
  return {
    type: "shape",
    id,
    shape: "rect",
    width: 6,
    height: 190,
    fill: color,
    startMs,
    endMs,
    transform: {
      x,
      y: [
        { timeMs: startMs, value: y0 },
        { timeMs: endMs, value: y1 }
      ],
      opacity: [
        { timeMs: startMs, value: 0 },
        { timeMs: startMs + 180, value: 0.92 },
        { timeMs: endMs - 220, value: 0.82 },
        { timeMs: endMs, value: 0 }
      ]
    }
  };
}

const speedLines = Array.from({ length: 18 }, (_, index) => speedLine(`speed-${index}`, index, index % 2 === 0 ? "left" : "right"));

const beatFlashes = cutTimes.flatMap((timeMs, index) => [
  flash(`beat-flash-${index}`, timeMs, index % 2 === 0 ? "rgba(255,183,3,0.95)" : "rgba(33,158,188,0.90)", index === 0 ? 0.95 : 0.58),
  rect(`beat-bar-${index}`, timeMs, timeMs + 360, -220, 132 + index * 52, 1720, 11, index % 2 === 0 ? "#ffb703" : "#8ecae6", 0.92, -11)
]);

export default defineComposition({
  fps: 25,
  width,
  height,
  durationMs,
  layers: [
    {
      type: "video",
      id: "metro-video",
      src: "examples/demo.mp4",
      startMs: introMs,
      endMs: durationMs,
      width,
      height,
      trimStartMs: 0
    },
    {
      type: "audio",
      id: "metro-audio",
      src: "examples/demo.mp4",
      startMs: introMs,
      endMs: durationMs,
      volume: 0.92,
      fadeInMs: 180,
      fadeOutMs: 700
    },
    rect("intro-bg", 0, introMs + 220, 0, 0, width, height, "#05070a"),
    rect("intro-grid-top", 0, introMs, -120, 132, 1520, 4, "rgba(142,202,230,0.72)", 1, -8),
    rect("intro-grid-bottom", 0, introMs, -80, 500, 1460, 6, "rgba(255,183,3,0.86)", 1, -8),
    rect("intro-swipe-a", 120, 980, -880, 246, 980, 16, "#ffb703", 1, -8),
    rect("intro-swipe-b", 230, 1140, 1180, 420, 920, 10, "#219ebc", 1, -8),
    {
      type: "text",
      id: "intro-kicker",
      text: "RAW RGBA VIDEO PIPELINE",
      size: 30,
      color: "#8ecae6",
      startMs: 180,
      endMs: introMs,
      transform: {
        x: [
          { timeMs: 180, value: 108 },
          { timeMs: 680, value: 154 }
        ],
        y: 206,
        opacity: [
          { timeMs: 180, value: 0 },
          { timeMs: 360, value: 1 },
          { timeMs: 1600, value: 1 },
          { timeMs: introMs, value: 0 }
        ]
      }
    },
    {
      type: "text",
      id: "intro-title",
      text: "METRO RUN",
      size: 108,
      color: "#f8f9fa",
      startMs: 220,
      endMs: introMs,
      transform: {
        x: [
          { timeMs: 220, value: 92 },
          { timeMs: 760, value: 152 },
          { timeMs: 1340, value: 126 }
        ],
        y: 356,
        opacity: [
          { timeMs: 220, value: 0 },
          { timeMs: 420, value: 1 },
          { timeMs: 1180, value: 0.28 },
          { timeMs: 1260, value: 1 },
          { timeMs: 1600, value: 1 },
          { timeMs: introMs, value: 0 }
        ]
      }
    },
    {
      type: "text",
      id: "intro-drop",
      text: "DROP IN 03",
      size: 42,
      color: "#ffb703",
      startMs: 860,
      endMs: introMs,
      transform: {
        x: 162,
        y: 426,
        opacity: [
          { timeMs: 860, value: 0 },
          { timeMs: 960, value: 1 },
          { timeMs: 1110, value: 0.22 },
          { timeMs: 1240, value: 1 },
          { timeMs: 1440, value: 0.16 },
          { timeMs: 1580, value: 1 },
          { timeMs: introMs, value: 0 }
        ]
      }
    },
    flash("intro-white-hit", 1660, "rgba(255,255,255,0.96)", 0.96),
    rect("top-vignette", introMs, durationMs, 0, 0, width, 76, "rgba(0,0,0,0.56)"),
    rect("bottom-vignette", introMs, durationMs, 0, 594, width, 126, "rgba(0,0,0,0.70)"),
    ...speedLines,
    ...beatFlashes,
    trackingLine("rail-lock-left", 2260, 7100, 290, 90, 520, "rgba(255,183,3,0.92)"),
    trackingLine("rail-lock-right", 2260, 7100, 986, 30, 574, "rgba(142,202,230,0.86)"),
    trackingLine("escalator-cursor-a", 5200, 9800, 430, 24, 610, "rgba(255,255,255,0.86)"),
    trackingLine("escalator-cursor-b", 6200, 10800, 830, -20, 590, "rgba(255,183,3,0.76)"),
    rect("scanline-a", introMs, durationMs - 900, 0, 188, width, 3, "rgba(255,255,255,0.28)"),
    rect("scanline-b", introMs + 400, durationMs - 900, 0, 474, width, 3, "rgba(142,202,230,0.22)"),
    {
      type: "text",
      id: "corner-label",
      text: "OPENHYPERCORE // FIELD RENDER",
      size: 23,
      color: "#ffb703",
      startMs: 2100,
      endMs: 10100,
      transform: {
        x: 42,
        y: 52,
        opacity: [
          { timeMs: 2100, value: 0 },
          { timeMs: 2350, value: 1 },
          { timeMs: 9700, value: 1 },
          { timeMs: 10100, value: 0 }
        ]
      }
    },
    {
      type: "text",
      id: "big-drop",
      text: "DESCENT",
      size: 78,
      color: "#ffffff",
      startMs: 2920,
      endMs: 4200,
      transform: {
        x: [
          { timeMs: 2920, value: 88 },
          { timeMs: 3320, value: 148 }
        ],
        y: 176,
        opacity: [
          { timeMs: 2920, value: 0 },
          { timeMs: 3040, value: 1 },
          { timeMs: 3240, value: 0.2 },
          { timeMs: 3380, value: 1 },
          { timeMs: 4040, value: 1 },
          { timeMs: 4200, value: 0 }
        ]
      }
    },
    {
      type: "text",
      id: "big-sprint",
      text: "SPRINT LINE",
      size: 72,
      color: "#ffb703",
      startMs: 5900,
      endMs: 7200,
      transform: {
        x: [
          { timeMs: 5900, value: 600 },
          { timeMs: 6380, value: 532 }
        ],
        y: 170,
        opacity: [
          { timeMs: 5900, value: 0 },
          { timeMs: 6040, value: 1 },
          { timeMs: 6220, value: 0.18 },
          { timeMs: 6360, value: 1 },
          { timeMs: 7000, value: 0.94 },
          { timeMs: 7200, value: 0 }
        ]
      }
    },
    {
      type: "caption",
      id: "caption-1",
      text: "Jump cut into the escalator drop.",
      startMs: 2400,
      endMs: 4300,
      size: 34,
      color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.74)",
      padding: 16,
      align: "center",
      maxWidth: 620,
      transform: { x: 640, y: 650 }
    },
    {
      type: "caption",
      id: "caption-2",
      text: "Speed lines and rail locks ride the motion.",
      startMs: 5050,
      endMs: 7050,
      size: 34,
      color: "#ffffff",
      backgroundColor: "rgba(5,23,30,0.78)",
      padding: 16,
      align: "center",
      maxWidth: 680,
      transform: { x: 640, y: 650 }
    },
    {
      type: "caption",
      id: "caption-3",
      text: "Raw RGBA frames skip PNG encode/decode.",
      startMs: 7600,
      endMs: 9600,
      size: 34,
      color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.74)",
      padding: 16,
      align: "center",
      maxWidth: 680,
      transform: { x: 640, y: 650 }
    },
    rect("outro-bg", 10320, durationMs, 0, 0, width, height, "rgba(0,0,0,0.82)"),
    rect("outro-line-a", 10420, durationMs, 170, 250, 920, 8, "#ffb703", 1, -6),
    rect("outro-line-b", 10520, durationMs, 260, 472, 780, 5, "#8ecae6", 1, -6),
    {
      type: "text",
      id: "outro-title",
      text: "RUN COMPLETE",
      size: 84,
      color: "#f8f9fa",
      startMs: 10420,
      endMs: durationMs,
      transform: {
        x: 252,
        y: 366,
        opacity: [
          { timeMs: 10420, value: 0 },
          { timeMs: 10640, value: 1 },
          { timeMs: 11040, value: 0.24 },
          { timeMs: 11180, value: 1 },
          { timeMs: 11700, value: 1 },
          { timeMs: durationMs, value: 0 }
        ]
      }
    },
    {
      type: "text",
      id: "outro-subtitle",
      text: "H.264 + AAC / SERVER BENCHMARK",
      size: 30,
      color: "#ffb703",
      startMs: 10720,
      endMs: durationMs,
      transform: {
        x: 356,
        y: 420,
        opacity: [
          { timeMs: 10720, value: 0 },
          { timeMs: 10900, value: 1 },
          { timeMs: 11700, value: 1 },
          { timeMs: durationMs, value: 0 }
        ]
      }
    }
  ]
});
