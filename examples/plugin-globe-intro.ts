// Globe-intro showcase: a rotating satellite globe spins to Tokyo and zooms
// in, handing off to the map-route opener — the full travel-video cold open.
//
//   pnpm cli render examples/plugin-globe-intro.ts --out /tmp/globe-intro.mp4

import type { Composition } from "../packages/core/src/index.ts";

const composition: Composition = {
  type: "composition",
  fps: 30,
  width: 1280,
  height: 720,
  durationMs: 11000,
  layers: [
    {
      type: "plugin",
      plugin: "globe-intro",
      params: {
        src: "examples/assets/earth-hi.jpg",
        target: [35.68, 139.69],
        spin: 200,
        zoom: 3.4
      },
      endMs: 6400
    },
    {
      type: "plugin",
      plugin: "map-route",
      params: {
        from: [43.06, 141.35],
        to: [35.68, 139.69],
        fromLabel: "札幌",
        toLabel: "東京"
      },
      startMs: 6000,
      endMs: 11000,
      transform: {
        opacity: [{ timeMs: 0, value: 0 }, { timeMs: 700, value: 1 }]
      }
    }
  ]
};

export default composition;
