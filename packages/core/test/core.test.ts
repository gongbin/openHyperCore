import test from "node:test";
import assert from "node:assert/strict";
import {
  defineComposition,
  frameCount,
  resolveFrame,
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
