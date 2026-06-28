// Demo: scene-level transitions (wipe / clock-wipe / slide / flip).
//
//   pnpm cli render examples/scene-transitions.ts --out /tmp/scene-transitions.mp4
//
// Five full-frame scenes chained by the four transition types. Each scene is
// built on its own LOCAL timeline by createTransitionSeries; adjacent scenes
// overlap for the transition duration (Remotion TransitionSeries semantics).
import { createTransitionSeries } from "../packages/core/src/index.ts";
import type { Layer } from "../packages/core/src/index.ts";

const W = 1280;
const H = 720;

function scene(bg: string, accent: string, title: string, subtitle: string): Layer[] {
  return [
    { type: "shape", shape: "rect", width: W, height: H, fill: bg },
    { type: "shape", shape: "circle", radius: 140, fill: accent, blur: 24, transform: { x: W - 420, y: 110, opacity: 0.55 } },
    { type: "shape", shape: "rect", width: 88, height: 10, fill: accent, transform: { x: 120, y: 332 } },
    {
      type: "text",
      text: title,
      size: 92,
      color: "#f6f7f9",
      transform: { x: 120, y: 300 }
    },
    {
      type: "text",
      text: subtitle,
      size: 36,
      color: "#9aa7b4",
      transform: {
        x: 120,
        y: 420,
        // Local-timeline entrance: every scene fades its subtitle in after
        // the transition has mostly revealed it.
        opacity: [
          { timeMs: 300, value: 0 },
          { timeMs: 800, value: 1 }
        ]
      }
    }
  ];
}

export default createTransitionSeries({ width: W, height: H, fps: 30 })
  .scene("intro", 2000, () => scene("#10131a", "#2ec4b6", "WIPE", "下一场从左侧擦入"))
  .transition({ type: "wipe", durationMs: 600, direction: "from-left", easing: "easeInOutCubic" })
  .scene("city", 2000, () => scene("#1d1430", "#b388ff", "CLOCK WIPE", "时钟扫掠揭示下一场"))
  .transition({ type: "clockWipe", durationMs: 700 })
  .scene("ocean", 2000, () => scene("#0c2231", "#4dd0e1", "SLIDE", "整屏推移切换"))
  .transition({ type: "slide", durationMs: 600, direction: "from-right", easing: "easeInOutCubic" })
  .scene("sunset", 2000, () => scene("#2a1410", "#ff8552", "FLIP", "绕中心轴翻面"))
  .transition({ type: "flip", durationMs: 700, easing: "easeInOut" })
  .scene("finale", 2200, () => scene("#101d14", "#7bd88f", "OPENHYPER", "四种场景级真转场"))
  .build()
  .composition;
