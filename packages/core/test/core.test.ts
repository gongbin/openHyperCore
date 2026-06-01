import test from "node:test";
import assert from "node:assert/strict";
import {
  defineComposition,
  fadeTransition,
  frameCount,
  mergeTransforms,
  resolveFrame,
  scaleTransition,
  slideTransition,
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

test("mergeTransforms rejects duplicate animated properties", () => {
  assert.throws(
    () => mergeTransforms(
      fadeTransition({ startMs: 0, durationMs: 300 }),
      { opacity: 0.5 }
    ),
    /Duplicate transform property: opacity/
  );
});
