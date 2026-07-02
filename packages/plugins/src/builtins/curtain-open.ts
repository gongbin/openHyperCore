import type { GradientStop, Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { shade } from "./color.ts";

// Theatre-curtain opener: two fold-textured panels cover the frame, hold, then
// sweep apart to reveal whatever is layered beneath the plugin node.
const OPEN_EASE: [number, number, number, number] = [0.7, 0, 0.3, 1];

export const curtainOpen = definePlugin({
  name: "curtain-open",
  displayName: "Curtain Open",
  description: "Stage curtains hold closed, then sweep apart to reveal the scene beneath.",
  category: "opener",
  defaultDurationMs: 3000,
  params: {
    color: { type: "color", default: "#8a1a2b", label: "Curtain color" },
    holdMs: { type: "number", default: 600, min: 0, label: "Hold before opening (ms)" },
    openMs: { type: "number", default: 1800, min: 200, label: "Opening duration (ms)" },
    foldCount: { type: "number", default: 10, min: 2, max: 40, step: 1, label: "Cloth folds per panel" },
    shadow: { type: "boolean", default: true, label: "Stage shadow while closed" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const panelW = Math.ceil(w / 2);
    const openStart = Math.min(params.holdMs, durationMs);
    const openEnd = Math.min(openStart + params.openMs, durationMs);
    const layers: Layer[] = [
      curtainPanel("left", params.color, params.foldCount, panelW, h, [
        { timeMs: 0, value: 0 },
        { timeMs: openStart, value: 0 },
        { timeMs: openEnd, value: -panelW - 12, easing: OPEN_EASE }
      ]),
      curtainPanel("right", params.color, params.foldCount, panelW, h, [
        { timeMs: 0, value: w - panelW },
        { timeMs: openStart, value: w - panelW },
        { timeMs: openEnd, value: w + 12, easing: OPEN_EASE }
      ])
    ];
    if (params.shadow) {
      // Vignette over the closed stage that lifts as the curtains part.
      layers.push({
        type: "shape",
        id: "curtain-shadow",
        shape: "rect",
        width: w,
        height: h,
        fill: {
          type: "radial",
          center: [w / 2, h / 2],
          radius: Math.max(w, h) * 0.72,
          stops: [
            { offset: 0, color: "rgba(0,0,0,0)" },
            { offset: 0.62, color: "rgba(0,0,0,0.18)" },
            { offset: 1, color: "rgba(0,0,0,0.6)" }
          ]
        },
        transform: {
          opacity: [
            { timeMs: 0, value: 1 },
            { timeMs: openStart, value: 1 },
            { timeMs: openEnd, value: 0, easing: OPEN_EASE }
          ]
        }
      });
    }
    return layers;
  }
});

function curtainPanel(side: "left" | "right", color: string, foldCount: number, panelW: number, h: number, x: ScalarKeyframe[]): Layer {
  const innerEdge = side === "left" ? panelW - 10 : 0;
  return {
    type: "group",
    id: `curtain-${side}`,
    transform: { x },
    layers: [
      {
        type: "shape",
        shape: "rect",
        width: panelW,
        height: h,
        fill: {
          type: "linear",
          from: [0, 0],
          to: [panelW, 0],
          stops: foldStops(color, foldCount)
        }
      },
      // Lit leading edge where the two panels meet — sells the cloth depth.
      {
        type: "shape",
        shape: "rect",
        width: 10,
        height: h,
        fill: shade(color, 0.28),
        transform: { x: innerEdge, opacity: 0.85 }
      }
    ]
  };
}

// Alternating light/dark stops fake vertical cloth folds in a single gradient.
function foldStops(color: string, foldCount: number): GradientStop[] {
  const light = shade(color, 0.16);
  const dark = shade(color, -0.38);
  const stops: GradientStop[] = [];
  const folds = Math.max(2, Math.round(foldCount));
  for (let i = 0; i < folds; i += 1) {
    stops.push({ offset: i / folds, color: light });
    stops.push({ offset: (i + 0.55) / folds, color: dark });
  }
  stops.push({ offset: 1, color: light });
  return stops;
}
