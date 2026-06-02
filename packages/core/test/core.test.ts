import test from "node:test";
import assert from "node:assert/strict";
import {
  composeTimeline,
  defineComposition,
  delayTransition,
  fadeTransition,
  frameCount,
  mergeTransforms,
  parseSubtitles,
  resolveFrame,
  scaleTransition,
  slideTransition,
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

test("mergeTransforms rejects duplicate animated properties", () => {
  assert.throws(
    () => mergeTransforms(
      fadeTransition({ startMs: 0, durationMs: 300 }),
      { opacity: 0.5 }
    ),
    /Duplicate transform property: opacity/
  );
});
