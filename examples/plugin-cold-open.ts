// The full cold open, chained from plugins only: film countdown → globe route
// (Beijing → Paris on a rotating satellite globe) → light-sweep title.
//
//   pnpm cli render examples/plugin-cold-open.ts --out /tmp/cold-open.mp4

import type { Composition } from "../packages/core/src/index.ts";

const composition: Composition = {
  type: "composition",
  fps: 30,
  width: 1280,
  height: 720,
  durationMs: 13000,
  layers: [
    { type: "plugin", plugin: "countdown", params: { from: 3 }, endMs: 3000 },
    {
      type: "plugin",
      plugin: "globe-route",
      params: {
        src: "examples/assets/earth-hi.jpg",
        from: [39.9, 116.4],
        to: [48.85, 2.35],
        fromLabel: "北京",
        toLabel: "Paris",
        zoom: 1.8
      },
      startMs: 3000,
      endMs: 10000,
      transform: { opacity: [{ timeMs: 0, value: 0 }, { timeMs: 400, value: 1 }] }
    },
    {
      type: "plugin",
      plugin: "light-sweep-title",
      params: { text: "巴黎 72 小時", y: 0.82 },
      startMs: 9200,
      endMs: 13000
    }
  ]
};

export default composition;
