import test from "node:test";
import assert from "node:assert/strict";
import {
  cinematicBars,
  composeTimeline,
  createTimeline,
  createTransitionSeries,
  cubicBezier,
  defineComposition,
  delayTransition,
  fadeTransition,
  flashTransitionLayer,
  glitchTitle,
  frameCount,
  interpolate,
  mergeTransforms,
  parseSubtitles,
  resolveEasing,
  resolveFrame,
  spring,
  springKeyframes,
  scaleTransition,
  slideTransition,
  speedLineBurst,
  subtitlesToCaptions,
  timeForFrame
} from "../src/index.ts";

test("defineComposition rejects invalid dimensions and timing", () => {
  assert.throws(
    () => defineComposition({ fps: 0, width: 1920, height: 1080, durationMs: 1000, layers: [] }),
    /fps must be positive/
  );
  assert.throws(
    () => defineComposition({ fps: 30, width: -1, height: 1080, durationMs: 1000, layers: [] }),
    /width must be positive/
  );
  assert.throws(
    () => defineComposition({ fps: 30, width: 1920, height: 1080, durationMs: 0, layers: [] }),
    /durationMs must be positive/
  );
});

test("frameCount rounds up partial frames", () => {
  const composition = defineComposition({ fps: 30, width: 1920, height: 1080, durationMs: 1001, layers: [] });
  assert.equal(frameCount(composition), 31);
  assert.equal(timeForFrame(composition, 30), 1000);
});

test("resolveFrame filters active layers and interpolates keyframes", () => {
  const composition = defineComposition({
    fps: 30,
    width: 1920,
    height: 1080,
    durationMs: 2000,
    layers: [
      {
        type: "text",
        id: "headline",
        text: "Hello",
        size: 80,
        color: "#fff",
        startMs: 0,
        endMs: 1000,
        transform: {
          x: [
            { timeMs: 0, value: 0 },
            { timeMs: 1000, value: 100 }
          ],
          opacity: [
            { timeMs: 0, value: 0 },
            { timeMs: 1000, value: 1 }
          ]
        }
      },
      {
        type: "shape",
        id: "late",
        shape: "rect",
        width: 100,
        height: 50,
        fill: "#f00",
        startMs: 1200,
        endMs: 2000
      }
    ]
  });

  const frame = resolveFrame(composition, 500);

  assert.equal(frame.timeMs, 500);
  assert.equal(frame.layers.length, 1);
  const headline = frame.layers[0]!;
  assert.equal(headline.id, "headline");
  assert.equal(headline.transform.x, 50);
  assert.equal(headline.transform.opacity, 0.5);
});

test("resolveFrame supports timed CaptionLayers", () => {
  const composition = defineComposition({
    fps: 30,
    width: 1920,
    height: 1080,
    durationMs: 3000,
    layers: [
      {
        type: "caption",
        id: "caption-1",
        text: "Welcome",
        size: 48,
        color: "#ffffff",
        backgroundColor: "#000000",
        padding: 12,
        align: "center",
        startMs: 500,
        endMs: 1500,
        transform: { x: 960, y: 920 }
      }
    ]
  });

  assert.equal(resolveFrame(composition, 400).layers.length, 0);
  const frame = resolveFrame(composition, 1000);
  assert.equal(frame.layers.length, 1);
  assert.equal(frame.layers[0]!.type, "caption");
  assert.equal(frame.layers[0]!.text, "Welcome");
  assert.equal(resolveFrame(composition, 1500).layers.length, 0);
});

test("transition helpers create reusable transform keyframes", () => {
  const transform = mergeTransforms(
    fadeTransition({ startMs: 0, durationMs: 1000, from: 0, to: 1 }),
    slideTransition({ startMs: 0, durationMs: 1000, from: { x: -100, y: 20 }, to: { x: 0, y: 20 } }),
    scaleTransition({ startMs: 500, durationMs: 500, from: 0.8, to: 1 })
  );
  const composition = defineComposition({
    fps: 30,
    width: 1920,
    height: 1080,
    durationMs: 1500,
    layers: [
      {
        type: "text",
        text: "Animated",
        transform
      }
    ]
  });

  const start = resolveFrame(composition, 0).layers[0]!;
  assert.equal(start.transform.opacity, 0);
  assert.equal(start.transform.x, -100);
  assert.equal(start.transform.y, 20);
  assert.equal(start.transform.scale, 0.8);

  const middle = resolveFrame(composition, 750).layers[0]!;
  assert.equal(middle.transform.opacity, 0.75);
  assert.equal(middle.transform.x, -25);
  assert.equal(middle.transform.y, 20);
  assert.equal(middle.transform.scale, 0.9);
});

test("eased transitions bake a non-linear curve into sampled keyframes", () => {
  const linear = fadeTransition({ startMs: 0, durationMs: 1000, from: 0, to: 1 });
  assert.ok(Array.isArray(linear.opacity));
  assert.equal((linear.opacity as unknown[]).length, 2);

  const eased = fadeTransition({ startMs: 0, durationMs: 1000, from: 0, to: 1, easing: "easeOutCubic" });
  const frames = eased.opacity as { timeMs: number; value: number }[];
  assert.ok(Array.isArray(frames));
  assert.ok(frames.length > 2);
  assert.equal(frames[0]!.value, 0);
  assert.equal(frames.at(-1)!.value, 1);
  assert.equal(frames[0]!.timeMs, 0);
  assert.equal(frames.at(-1)!.timeMs, 1000);

  const composition = defineComposition({
    fps: 30,
    width: 100,
    height: 100,
    durationMs: 1000,
    layers: [{ type: "text", text: "Eased", transform: eased }]
  });
  // easeOut front-loads progress: at the midpoint opacity is well past 0.5.
  const mid = resolveFrame(composition, 500).layers[0]!;
  assert.ok((mid.transform.opacity as number) > 0.6, `expected eased midpoint > 0.6, got ${mid.transform.opacity}`);
});

test("custom easing function is sampled into the transition curve", () => {
  const eased = scaleTransition({ startMs: 0, durationMs: 400, from: 0, to: 1, easing: (t) => t * t });
  const frames = eased.scale as { timeMs: number; value: number }[];
  assert.ok(frames.length > 2);
  // t*t at the midpoint is 0.25.
  const midpoint = frames.find((f) => f.timeMs === 200);
  assert.ok(midpoint);
  assert.ok(Math.abs(midpoint!.value - 0.25) < 1e-9);
});

test("cubicBezier matches CSS endpoints and eases between them", () => {
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  // Standard CSS "ease" front-loads progress: midpoint is well past 0.5.
  assert.ok(ease(0.5) > 0.5);
  // A linear control polygon reduces to the identity curve.
  const linear = cubicBezier(0, 0, 1, 1);
  assert.ok(Math.abs(linear(0.5) - 0.5) < 1e-6);
  // overshoot curves can exceed 1 mid-flight (y unclamped).
  const overshoot = cubicBezier(0.34, 1.56, 0.64, 1);
  assert.ok(Math.max(overshoot(0.6), overshoot(0.7), overshoot(0.8)) > 1);
  assert.throws(() => cubicBezier(Number.NaN, 0, 1, 1), /finite/);
});

test("resolveEasing accepts presets, functions and cubic-bezier tuples", () => {
  assert.equal(resolveEasing(undefined), undefined);
  assert.equal(resolveEasing("linear"), undefined);
  const fn = (t: number) => t * t;
  assert.equal(resolveEasing(fn), fn);
  const preset = resolveEasing("easeOutCubic")!;
  assert.ok(Math.abs(preset(1) - 1) < 1e-9);
  const tuple = resolveEasing([0.25, 0.1, 0.25, 1])!;
  assert.equal(tuple(0), 0);
  assert.equal(tuple(1), 1);
});

test("per-keyframe easing curves a single keyframe track", () => {
  const composition = defineComposition({
    fps: 30,
    width: 100,
    height: 100,
    durationMs: 1000,
    layers: [
      {
        type: "text",
        text: "Eased",
        transform: {
          // The easing on the END keyframe governs the segment into it.
          x: [
            { timeMs: 0, value: 0 },
            { timeMs: 1000, value: 100, easing: "easeInCubic" }
          ],
          // Cubic-bezier tuple form is serializable and frame-precise.
          opacity: [
            { timeMs: 0, value: 0 },
            { timeMs: 1000, value: 1, easing: [0.25, 0.1, 0.25, 1] }
          ]
        }
      }
    ]
  });
  const mid = resolveFrame(composition, 500).layers[0]!;
  // easeInCubic at t=0.5 → 0.125 → x = 12.5 (well below the linear 50).
  assert.ok(Math.abs((mid.transform.x as number) - 12.5) < 1e-6);
  // The bezier "ease" front-loads opacity past the linear midpoint.
  assert.ok((mid.transform.opacity as number) > 0.5);
});

test("mergeTransforms and delayTransition cover scaleX/scaleY and keep easing", () => {
  const merged = mergeTransforms({ scaleX: 0.5 }, { scaleY: 2 }, { rotate: 10 });
  assert.equal(merged.scaleX, 0.5);
  assert.equal(merged.scaleY, 2);
  assert.equal(merged.rotate, 10);

  const delayed = delayTransition(
    { x: [{ timeMs: 0, value: 0 }, { timeMs: 200, value: 50, easing: "easeOutBack" }] },
    100
  );
  assert.deepEqual(delayed.x, [
    { timeMs: 100, value: 0 },
    { timeMs: 300, value: 50, easing: "easeOutBack" }
  ]);
});

test("parseSubtitles reads SRT cues into milliseconds", () => {
  const srt = "1\n00:00:01,000 --> 00:00:04,500\nHello world\n\n2\n00:00:05,000 --> 00:00:08,000\nSecond line\nwrapped\n";
  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { startMs: 1000, endMs: 4500, text: "Hello world" });
  assert.equal(cues[1]!.text, "Second line\nwrapped");
});

test("parseSubtitles reads WebVTT cues, skipping header and settings", () => {
  const vtt = "WEBVTT\n\nNOTE intro credit\n\nintro\n00:01.000 --> 00:03.000 align:center\nHi there\n\n00:00:04.000 --> 00:00:06.000\nFull clock\n";
  const cues = parseSubtitles(vtt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { startMs: 1000, endMs: 3000, text: "Hi there" });
  assert.deepEqual(cues[1], { startMs: 4000, endMs: 6000, text: "Full clock" });
});

test("subtitlesToCaptions builds timed caption layers with shared styling", () => {
  const cues = parseSubtitles("1\n00:00:00,000 --> 00:00:02,000\nA\n");
  const captions = subtitlesToCaptions(cues, { size: 40, color: "#fff", align: "center", maxWidth: 800 });
  assert.equal(captions.length, 1);
  assert.deepEqual(captions[0], {
    type: "caption",
    text: "A",
    startMs: 0,
    endMs: 2000,
    size: 40,
    color: "#fff",
    align: "center",
    maxWidth: 800
  });

  // The cue window drives layer visibility through the scheduler.
  const composition = defineComposition({ fps: 30, width: 100, height: 100, durationMs: 3000, layers: captions });
  assert.equal(resolveFrame(composition, 1000).layers.length, 1);
  assert.equal(resolveFrame(composition, 2500).layers.length, 0);
});

test("composeTimeline chains entrance and exit animations on one property", () => {
  const transform = composeTimeline(
    fadeTransition({ startMs: 0, durationMs: 300, from: 0, to: 1 }),
    fadeTransition({ startMs: 2000, durationMs: 300, from: 1, to: 0 })
  );
  const frames = transform.opacity as { timeMs: number; value: number }[];
  assert.deepEqual(frames.map((f) => f.timeMs), [0, 300, 2000, 2300]);

  const composition = defineComposition({
    fps: 30,
    width: 100,
    height: 100,
    durationMs: 2300,
    layers: [{ type: "text", text: "Hi", transform }]
  });
  // Holds fully visible between the entrance and exit segments.
  assert.equal(resolveFrame(composition, 1000).layers[0]!.transform.opacity, 1);
  assert.equal(resolveFrame(composition, 0).layers[0]!.transform.opacity, 0);
  // Fades back out during the exit segment.
  assert.equal(resolveFrame(composition, 2150).layers[0]!.transform.opacity, 0.5);
});

test("delayTransition shifts every keyframe in time", () => {
  const base = fadeTransition({ startMs: 0, durationMs: 200, from: 0, to: 1 });
  const delayed = delayTransition(base, 500);
  const frames = delayed.opacity as { timeMs: number; value: number }[];
  assert.deepEqual(frames, [
    { timeMs: 500, value: 0 },
    { timeMs: 700, value: 1 }
  ]);
});

test("effect helpers build cinematic intro and transition layers", () => {
  const bars = cinematicBars({ width: 1280, height: 720, startMs: 0, endMs: 1200, barHeight: 84 });
  assert.equal(bars.length, 2);
  assert.deepEqual(bars.map((layer) => layer.id), ["cinematic-bars-top", "cinematic-bars-bottom"]);
  assert.equal(bars[1]!.transform?.y, 720 - 84);

  const flash = flashTransitionLayer({ id: "hit", width: 1280, height: 720, startMs: 1000, durationMs: 260, color: "#ffffff", peakOpacity: 0.9 });
  assert.equal(flash.id, "hit");
  assert.equal(flash.endMs, 1260);
  assert.deepEqual((flash.transform?.opacity as { timeMs: number; value: number }[]).map((frame) => frame.timeMs), [1000, 1052, 1130, 1260]);

  const lines = speedLineBurst({ width: 1280, height: 720, startMs: 1200, endMs: 2600, count: 6, seed: 7 });
  assert.equal(lines.length, 6);
  assert.ok(lines.every((layer) => layer.type === "shape" && layer.shape === "rect"));
  assert.equal(lines[0]!.startMs, 1200);
  assert.equal(lines.at(-1)!.endMs, 2600);

  const title = glitchTitle({ text: "METRO RUN", startMs: 0, endMs: 1500, x: 120, y: 300, size: 96 });
  assert.ok(title.length >= 4);
  assert.equal(title[0]!.type, "text");
  assert.equal(title[0]!.text, "METRO RUN");
});

test("createTimeline composes scenes and transitions in sequence", () => {
  const timeline = createTimeline({ width: 1280, height: 720, fps: 30 })
    .scene("intro", 1200, ({ startMs, endMs, width, height }) => [
      ...cinematicBars({ width, height, startMs, endMs }),
      ...glitchTitle({ text: "OPEN", startMs, endMs, x: 120, y: 320, size: 88 })
    ])
    .transition("flash", 240, ({ startMs, width, height }) => [
      flashTransitionLayer({ width, height, startMs, durationMs: 240 })
    ])
    .scene("main", 1000, ({ startMs, endMs, width, height }) => [
      ...speedLineBurst({ width, height, startMs, endMs, count: 4, seed: 3 })
    ])
    .build();

  assert.equal(timeline.durationMs, 2440);
  assert.ok(timeline.layers.length > 6);
  assert.equal(timeline.markers.intro!.startMs, 0);
  assert.equal(timeline.markers.intro!.endMs, 1200);
  assert.equal(timeline.markers.flash!.startMs, 1200);
  assert.equal(timeline.markers.main!.startMs, 1440);
  assert.equal(timeline.composition.type, "composition");
  assert.equal(timeline.composition.durationMs, 2440);
});

test("interpolate maps multi-segment ranges with extrapolation options", () => {
  assert.equal(interpolate(0.5, [0, 1], [0, 100]), 50);
  // Multi-segment.
  assert.equal(interpolate(1.5, [0, 1, 2], [0, 10, 110]), 60);
  // Default extrapolation extends the edge segments.
  assert.equal(interpolate(2, [0, 1], [0, 100]), 200);
  assert.equal(interpolate(-1, [0, 1], [0, 100]), -100);
  // Clamp pins to the range edges; identity returns the input.
  assert.equal(interpolate(2, [0, 1], [0, 100], { extrapolateRight: "clamp" }), 100);
  assert.equal(interpolate(-5, [0, 1], [0, 100], { extrapolateLeft: "identity" }), -5);
  // Easing applies within a segment.
  assert.equal(interpolate(0.5, [0, 1], [0, 100], { easing: (t) => t * t }), 25);

  assert.throws(() => interpolate(0, [1], [1]), /at least 2/);
  assert.throws(() => interpolate(0, [0, 0], [0, 1]), /monotonically increasing/);
  assert.throws(() => interpolate(0, [0, 1, 2], [0, 1]), /same length/);
});

test("spring settles at the target and supports overshoot clamping", () => {
  assert.equal(spring(0, { from: 10, to: 20 }), 10);
  // Default config is underdamped: it overshoots the target on the way in.
  const values = Array.from({ length: 60 }, (_, i) => spring(i * (1000 / 30), { from: 0, to: 1 }));
  assert.ok(Math.max(...values) > 1.001, "expected overshoot past the target");
  // Far in the future the spring has settled.
  assert.ok(Math.abs(spring(5000, { from: 0, to: 1 }) - 1) < 1e-3);
  // Clamping never passes the target.
  const clamped = Array.from({ length: 60 }, (_, i) => spring(i * (1000 / 30), { from: 0, to: 1, overshootClamping: true }));
  assert.ok(Math.max(...clamped) <= 1 + 1e-9);
  // Critically/over-damped configs approach monotonically.
  assert.ok(spring(200, { damping: 30, stiffness: 100, mass: 1 }) < 1);
});

test("springKeyframes samples a keyframe track that ends pinned to the target", () => {
  const frames = springKeyframes({ startMs: 500, fps: 30, from: 0, to: 100 });
  assert.equal(frames[0]!.timeMs, 500);
  assert.equal(frames[0]!.value, 0);
  assert.equal(frames.at(-1)!.value, 100);
  assert.ok(frames.length > 5);

  // Plugs straight into the keyframe IR.
  const composition = defineComposition({
    fps: 30,
    width: 100,
    height: 100,
    durationMs: 3000,
    layers: [{ type: "text", text: "Spring", transform: { y: frames } }]
  });
  const settled = resolveFrame(composition, 2900).layers[0]!;
  assert.equal(settled.transform.y, 100);
});

test("group layers resolve children on the group's local timeline", () => {
  const composition = defineComposition({
    fps: 30,
    width: 1920,
    height: 1080,
    durationMs: 4000,
    layers: [
      {
        type: "group",
        id: "scene-2",
        startMs: 1000,
        endMs: 3000,
        transform: {
          x: 100,
          // The group's own keyframes are local too: this fade runs over the
          // group's first second (parent 1000..2000ms).
          opacity: [
            { timeMs: 0, value: 0 },
            { timeMs: 1000, value: 1 }
          ]
        },
        layers: [
          {
            type: "text",
            id: "title",
            text: "Scene 2",
            // Local timeline: visible for the group's first second.
            startMs: 0,
            endMs: 1000,
            transform: {
              x: [
                { timeMs: 0, value: 0 },
                { timeMs: 1000, value: 50 }
              ]
            }
          },
          { type: "shape", id: "late", shape: "rect", width: 10, height: 10, startMs: 1500 }
        ]
      }
    ]
  });

  // Before the group starts, nothing is active.
  assert.equal(resolveFrame(composition, 500).layers.length, 0);

  // At t=1500 (local 500): group opacity is mid-fade, title is halfway
  // through its local slide, the late shape is not active yet.
  const frame = resolveFrame(composition, 1500);
  assert.equal(frame.layers.length, 1);
  const group = frame.layers[0]!;
  assert.equal(group.type, "group");
  if (group.type !== "group") {
    return;
  }
  assert.equal(group.transform.opacity, 0.5);
  assert.equal(group.layers.length, 1);
  assert.equal(group.layers[0]!.id, "title");
  assert.equal(group.layers[0]!.transform.x, 25);

  // At t=2700 (local 1700): title is gone, the late shape is active.
  const later = resolveFrame(composition, 2700);
  const laterGroup = later.layers[0]!;
  if (laterGroup.type !== "group") {
    return;
  }
  assert.deepEqual(laterGroup.layers.map((layer) => layer.id), ["late"]);

  // After the group's endMs the whole subtree deactivates.
  assert.equal(resolveFrame(composition, 3200).layers.length, 0);
});

test("createTransitionSeries overlaps adjacent scenes by the transition duration", () => {
  const series = createTransitionSeries({ width: 1280, height: 720, fps: 30 })
    .scene("a", 2000, ({ width, height }) => [
      { type: "shape", shape: "rect", width, height, fill: "#111111" }
    ])
    .transition({ type: "wipe", durationMs: 500, direction: "from-left" })
    .scene("b", 2000, ({ width, height }) => [
      { type: "shape", shape: "rect", width, height, fill: "#222222" }
    ])
    .transition({ type: "slide", durationMs: 400, direction: "from-right" })
    .scene("c", 1500, ({ width, height }) => [
      { type: "shape", shape: "rect", width, height, fill: "#333333" }
    ])
    .build();

  // total = 2000 + 2000 + 1500 - 500 - 400
  assert.equal(series.durationMs, 4600);
  assert.deepEqual(series.markers.a, { startMs: 0, endMs: 2000, durationMs: 2000 });
  assert.deepEqual(series.markers.b, { startMs: 1500, endMs: 3500, durationMs: 2000 });
  assert.deepEqual(series.markers.c, { startMs: 3100, endMs: 4600, durationMs: 1500 });
  assert.equal(series.transitions.length, 2);
  assert.deepEqual(series.transitions[0], { type: "wipe", from: "a", to: "b", startMs: 1500, endMs: 2000, durationMs: 500 });

  // During the wipe overlap both scene groups are active; the incoming one
  // carries a reveal whose progress runs on its local timeline.
  const mid = resolveFrame(series.composition, 1750);
  assert.deepEqual(mid.layers.map((layer) => layer.id), ["scene-a", "scene-b"]);
  const incoming = mid.layers[1]!;
  if (incoming.type !== "group") {
    return;
  }
  assert.equal(incoming.reveal?.type, "wipe");
  assert.equal(incoming.reveal?.direction, "from-left");
  assert.equal(incoming.reveal?.progress, 0.5);

  // After the transition the reveal holds at 1 (fully shown).
  const after = resolveFrame(series.composition, 2500);
  const shown = after.layers[0]!;
  if (shown.type !== "group") {
    return;
  }
  assert.equal(shown.reveal?.progress, 1);

  // Slide push: outgoing b exits to -width while incoming c enters from +width.
  const slideMid = resolveFrame(series.composition, 3300);
  assert.deepEqual(slideMid.layers.map((layer) => layer.id), ["scene-b", "scene-c"]);
  assert.equal(slideMid.layers[0]!.transform.x, -640);
  assert.equal(slideMid.layers[1]!.transform.x, 640);
});

test("createTransitionSeries flip wraps scenes in a centre pivot with per-axis scale", () => {
  const series = createTransitionSeries({ width: 800, height: 600, fps: 30 })
    .scene("out", 1000, () => [{ type: "text", text: "out" }])
    .transition({ type: "flip", durationMs: 400 })
    .scene("in", 1000, () => [{ type: "text", text: "in" }])
    .build();

  // First half of the overlap (t=700): outgoing folds, incoming still hidden.
  const early = resolveFrame(series.composition, 700);
  const outScene = early.layers[0]!;
  const inScene = early.layers[1]!;
  if (outScene.type !== "group" || inScene.type !== "group") {
    return;
  }
  const outPivot = outScene.layers[0]!;
  const inPivot = inScene.layers[0]!;
  if (outPivot.type !== "group" || inPivot.type !== "group") {
    return;
  }
  assert.equal(outPivot.id, "out-flip-pivot");
  assert.equal(outPivot.transform.x, 400);
  assert.equal(outPivot.transform.y, 300);
  assert.equal(outPivot.transform.scaleX, 0.5);
  assert.equal(inPivot.transform.scaleX, 0);

  // Second half (t=900): outgoing fully folded, incoming unfolding.
  const late = resolveFrame(series.composition, 900);
  const lateOut = late.layers[0]!;
  const lateIn = late.layers[1]!;
  if (lateOut.type !== "group" || lateIn.type !== "group") {
    return;
  }
  const lateOutPivot = lateOut.layers[0]!;
  const lateInPivot = lateIn.layers[0]!;
  if (lateOutPivot.type !== "group" || lateInPivot.type !== "group") {
    return;
  }
  assert.equal(lateOutPivot.transform.scaleX, 0);
  assert.equal(lateInPivot.transform.scaleX, 0.5);
});

test("createTransitionSeries validates ordering and durations", () => {
  assert.throws(
    () => createTransitionSeries({ width: 100, height: 100, fps: 30 }).transition({ type: "wipe", durationMs: 100 }),
    /requires a preceding scene/
  );
  assert.throws(
    () => createTransitionSeries({ width: 100, height: 100, fps: 30 })
      .scene("a", 500, () => [])
      .transition({ type: "wipe", durationMs: 100 })
      .transition({ type: "slide", durationMs: 100 }),
    /two consecutive transitions/
  );
  assert.throws(
    () => createTransitionSeries({ width: 100, height: 100, fps: 30 })
      .scene("a", 500, () => [])
      .transition({ type: "wipe", durationMs: 100 })
      .build(),
    /trailing transition/
  );
  assert.throws(
    () => createTransitionSeries({ width: 100, height: 100, fps: 30 })
      .scene("a", 300, () => [])
      .transition({ type: "wipe", durationMs: 400 })
      .scene("b", 1000, () => [])
      .build(),
    /must be shorter than both scenes/
  );
});

test("mergeTransforms rejects duplicate animated properties", () => {
  assert.throws(
    () => mergeTransforms(
      fadeTransition({ startMs: 0, durationMs: 300 }),
      { opacity: 0.5 }
    ),
    /Duplicate transform property: opacity/
  );
});
