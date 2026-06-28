// Demo: GroupLayer (pre-composition) + spring()/interpolate() animation APIs.
//
//   pnpm cli render examples/group-spring.ts --out /tmp/group-spring.mp4
//
// A reusable "card" subtree is built once on a LOCAL timeline (0 = group
// start) and dropped into the parent timeline twice at different offsets —
// Remotion <Sequence> semantics. The card bounces in with a physical spring
// and the whole group fades as one unit (no double-blended children).
import { defineComposition, interpolate, springKeyframes } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe } from "../packages/core/src/index.ts";

const FPS = 30;

// Spring entrance baked into keyframes on the group's local timeline.
const bounceIn = springKeyframes({ fps: FPS, from: -260, to: 0, damping: 9, stiffness: 120 });

// interpolate() drives a custom opacity curve: quick fade-in, hold, fade-out.
const cardOpacity: ScalarKeyframe[] = Array.from({ length: 2200 / 50 + 1 }, (_, i) => {
  const timeMs = i * 50;
  return {
    timeMs,
    value: interpolate(timeMs, [0, 250, 1800, 2200], [0, 1, 1, 0], { extrapolateRight: "clamp" })
  };
});

// One reusable card; everything inside uses LOCAL time.
function card(title: string, accent: string): Layer[] {
  return [
    { type: "shape", shape: "rect", width: 560, height: 200, fill: "#1c2532", transform: { x: 0, y: 0 } },
    { type: "shape", shape: "rect", width: 12, height: 200, fill: accent },
    {
      type: "text",
      text: title,
      size: 56,
      color: "#f6f7f9",
      transform: { x: 48, y: 120 }
    }
  ];
}

export default defineComposition({
  fps: FPS,
  width: 1280,
  height: 720,
  durationMs: 5000,
  layers: [
    { type: "shape", shape: "rect", width: 1280, height: 720, fill: "#0c1118" },
    {
      type: "group",
      id: "card-1",
      startMs: 400,
      endMs: 2600,
      transform: { x: 360, opacity: cardOpacity, y: [...bounceIn.map((k) => ({ timeMs: k.timeMs, value: 180 + k.value }))] },
      layers: card("Spring 入场", "#2ec4b6")
    },
    {
      type: "group",
      id: "card-2",
      startMs: 2400,
      endMs: 4800,
      transform: { x: 360, opacity: cardOpacity, y: [...bounceIn.map((k) => ({ timeMs: k.timeMs, value: 320 + k.value }))] },
      layers: card("同一子树，第二次复用", "#ff8552")
    }
  ]
});
