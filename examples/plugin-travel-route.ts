// Travel-intro showcase: an animated map route (Sapporo → Tokyo) that hands
// off into footage — here a Ken Burns photo stands in for the user's own
// video clip (swap the ken-burns node for a { type: "video" } layer).
//
//   pnpm cli render examples/plugin-travel-route.ts --out /tmp/travel-route.mp4

import type { Composition } from "../packages/core/src/index.ts";

const composition: Composition = {
  type: "composition",
  fps: 30,
  width: 1280,
  height: 720,
  durationMs: 9000,
  layers: [
    {
      type: "plugin",
      plugin: "map-route",
      params: {
        from: [43.06, 141.35],
        to: [35.68, 139.69],
        fromLabel: "札幌",
        toLabel: "東京",
        routeColor: "#ffb703",
        landColor: "#2b4a68",
        background: "#0b1526"
      },
      endMs: 5600
    },
    // "User footage" fades in over the finished route and takes over.
    {
      type: "plugin",
      plugin: "ken-burns",
      params: {
        src: "https://picsum.photos/seed/tokyo-street/1280/720",
        zoomFrom: 1.05,
        zoomTo: 1.16,
        fadeInMs: 900,
        fadeOutMs: 600
      },
      startMs: 4800,
      endMs: 9000
    },
    {
      type: "plugin",
      plugin: "glitch-title",
      params: { text: "東京 48 小時", size: 110 },
      startMs: 6000,
      endMs: 8600
    }
  ]
};

export default composition;
