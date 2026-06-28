// Benchmark workload for the static-layer raster cache: a heavy "glow card"
// (blurred neon shapes + stroked/shadowed CJK text) whose CONTENT never
// changes while its transform floats continuously — every frame is unique at
// the frame level (no CLI frame reuse), but the card subtree repeats, so the
// raster cache turns the expensive redraw into one blit.
//
//   pnpm cli bench examples/bench/glow-card-slide.ts --out /tmp/glow.json --video-out /tmp/glow.mp4
//   pnpm cli bench examples/bench/glow-card-slide.ts --out /tmp/glow.json --video-out /tmp/glow.mp4 --no-layer-cache
import { defineComposition } from "../../packages/core/src/index.ts";
import type { Layer } from "../../packages/core/src/index.ts";

const W = 1920;
const H = 1080;
const DURATION_MS = 8000;

// Expensive static content: mask-filter blurs and 3-pass styled text dominate
// the per-frame raster cost.
function glowCard(): Layer[] {
  const layers: Layer[] = [
    { type: "shape", shape: "rect", width: 1200, height: 700, fill: "#141a2e" }
  ];
  const glowColors = ["#2ec4b6", "#b388ff", "#ff8552", "#4dd0e1", "#7bd88f", "#ffd166"];
  glowColors.forEach((color, index) => {
    layers.push({
      type: "shape",
      shape: "circle",
      radius: 110 + (index % 3) * 30,
      fill: color,
      blur: 22 + (index % 4) * 6,
      transform: { x: 60 + index * 180, y: index % 2 === 0 ? 30 : 380, opacity: 0.5 }
    });
  });
  layers.push({
    type: "shape",
    shape: "rect",
    width: 1140,
    height: 640,
    stroke: "#8ea4c8",
    strokeWidth: 3,
    dash: [18, 12],
    transform: { x: 30, y: 30 }
  });
  layers.push({
    type: "text",
    text: "城市夜行影像志",
    size: 96,
    color: "#f6f7f9",
    stroke: "#101522",
    strokeWidth: 6,
    shadowColor: "#000000",
    shadowBlur: 14,
    transform: { x: 90, y: 170 }
  });
  layers.push({
    type: "text",
    text: "VOL.42 · NIGHT RIDE SPECIAL",
    size: 40,
    color: "#9fb4d0",
    shadowColor: "#05070d",
    shadowBlur: 8,
    transform: { x: 92, y: 240 }
  });
  const paragraphs = [
    "霓虹在湿漉漉的柏油路面上铺开一层流动的光，车流像粒子一样穿过立交桥的弧线。",
    "我们在凌晨两点的环路上记录这座城市的呼吸：便利店的白光、隧道里的钠灯、桥洞下的涂鸦。",
    "镜头不需要说话，快门落下的瞬间，城市自己讲完了整个故事。"
  ];
  paragraphs.forEach((text, index) => {
    layers.push({
      type: "text",
      text,
      size: 34,
      color: "#d7e1ee",
      maxWidth: 1020,
      lineHeight: 50,
      shadowColor: "#05070d",
      shadowBlur: 6,
      transform: { x: 92, y: 330 + index * 120 }
    });
  });
  return layers;
}

export default defineComposition({
  fps: 30,
  width: W,
  height: H,
  durationMs: DURATION_MS,
  layers: [
    { type: "shape", shape: "rect", width: W, height: H, fill: "#070a12" },
    {
      type: "group",
      layers: glowCard(),
      transform: {
        // Continuous drift: every frame differs at the frame level, while the
        // card content stays byte-identical for the raster cache.
        x: [
          { timeMs: 0, value: 300 },
          { timeMs: DURATION_MS, value: 420 }
        ],
        y: [
          { timeMs: 0, value: 120 },
          { timeMs: DURATION_MS / 2, value: 200 },
          { timeMs: DURATION_MS, value: 140 }
        ]
      }
    }
  ]
});
