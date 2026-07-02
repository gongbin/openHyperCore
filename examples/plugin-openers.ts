// Plugin showcase: a title scene revealed by stage curtains, followed by a
// Ken Burns photo. Plugin nodes stay as { type: "plugin" } in the IR — the CLI
// expands them via openhypercore/plugins before rendering, and the editor
// edits their params in an auto-generated form.
//
//   pnpm cli render examples/plugin-openers.ts --out /tmp/plugin-openers.mp4

import type { Composition } from "../packages/core/src/index.ts";

const W = 1280;
const H = 720;

const composition: Composition = {
  type: "composition",
  fps: 30,
  width: W,
  height: H,
  durationMs: 8000,
  layers: [
    {
      type: "shape",
      shape: "rect",
      width: W,
      height: H,
      fill: {
        type: "linear",
        from: [0, 0],
        to: [0, H],
        stops: [
          { offset: 0, color: "#1d3557" },
          { offset: 1, color: "#0b1526" }
        ]
      }
    },
    {
      type: "plugin",
      plugin: "glitch-title",
      params: { text: "北海道之旅", accentA: "#8ecae6", accentB: "#ff5d8f" },
      startMs: 700,
      endMs: 4000
    },
    {
      type: "plugin",
      plugin: "ken-burns",
      params: {
        src: "https://picsum.photos/seed/hokkaido/1280/720",
        zoomFrom: 1,
        zoomTo: 1.18,
        driftX: -30,
        fadeInMs: 600,
        fadeOutMs: 800
      },
      startMs: 4000,
      endMs: 8000
    },
    {
      type: "plugin",
      plugin: "curtain-open",
      params: { color: "#8a1a2b", holdMs: 500, openMs: 1900 },
      endMs: 3200
    }
  ]
};

export default composition;
