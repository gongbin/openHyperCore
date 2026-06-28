// Demo: full transform stack (x/y/scale/scaleX/scaleY/rotate/opacity) driven by
// per-keyframe easing — including frame-precise cubic-bezier curves — alongside
// a physical spring entrance.
//
//   pnpm cli render examples/full-transform-easing.ts --out /tmp/full-transform.mp4
//
// Every track here is a plain ScalarKeyframe[]: the easing on a keyframe shapes
// the segment that ENDS at it ("ease into this value"). A cubic-bezier tuple
// [x1,y1,x2,y2] is serializable and matches CSS `cubic-bezier()`, so curves can
// be hand-tuned to taste; named presets and the spring sampler cover the rest.
import { defineComposition, springKeyframes } from "../packages/core/src/index.ts";
import type { Layer } from "../packages/core/src/index.ts";

const FPS = 30;
const W = 1280;
const H = 720;

// A snappy anticipation-then-overshoot bezier (like material "emphasized").
const EMPHASIZED: [number, number, number, number] = [0.2, 0, 0, 1];

// Spring-driven scale pop for the badge.
const popScale = springKeyframes({ fps: FPS, from: 0.2, to: 1, damping: 8, stiffness: 170 });

function hero(): Layer {
  return {
    type: "group",
    id: "hero",
    startMs: 300,
    endMs: 5000,
    // Position + rotation + opacity all animate on one group, each with its own
    // curve. Cubic-bezier on the landing keyframe gives a precise ease-out.
    transform: {
      x: [
        { timeMs: 0, value: -420 },
        { timeMs: 900, value: 0, easing: EMPHASIZED }
      ],
      rotate: [
        { timeMs: 0, value: -12 },
        { timeMs: 900, value: 0, easing: "easeOutBack" }
      ],
      opacity: [
        { timeMs: 0, value: 0 },
        { timeMs: 500, value: 1, easing: [0.25, 0.1, 0.25, 1] }
      ],
      // Gentle continuous drift using easeInOutSine across a long segment.
      y: [
        { timeMs: 0, value: 300 },
        { timeMs: 2500, value: 280, easing: "easeInOutSine" },
        { timeMs: 5000, value: 300, easing: "easeInOutSine" }
      ]
    },
    layers: [
      { type: "shape", shape: "rect", width: 640, height: 220, radius: 24, fill: "#16202e", transform: { x: 320, y: 110 } },
      { type: "text", text: "全属性 + 贝塞尔曲线", size: 64, color: "#f6f7f9", align: "center", transform: { x: 320, y: 130 } }
    ]
  };
}

function badge(): Layer {
  return {
    type: "group",
    id: "badge",
    startMs: 1200,
    endMs: 5000,
    // Per-axis scale (scaleX/scaleY) plus a spring on uniform scale: the badge
    // pops in physically, then a subtle squash via scaleY easing.
    transform: {
      x: 980,
      y: 200,
      scale: popScale,
      scaleY: [
        { timeMs: 600, value: 1 },
        { timeMs: 760, value: 0.86, easing: "easeOutCubic" },
        { timeMs: 940, value: 1, easing: "easeOutBack" }
      ]
    },
    layers: [
      { type: "shape", shape: "circle", radius: 70, fill: "#2ec4b6" },
      { type: "text", text: "NEW", size: 40, color: "#08231f", align: "center", transform: { y: 14 } }
    ]
  };
}

export default defineComposition({
  fps: FPS,
  width: W,
  height: H,
  durationMs: 5000,
  layers: [
    { type: "shape", shape: "rect", width: W, height: H, fill: "#0c1118" },
    hero(),
    badge()
  ]
});
