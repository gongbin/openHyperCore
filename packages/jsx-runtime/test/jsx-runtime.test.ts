import test from "node:test";
import assert from "node:assert/strict";
import { Composition, Fragment, ImageLayer, ShapeLayer, TextLayer, jsx, jsxs } from "../src/index.ts";

test("jsx runtime converts component calls to serializable composition IR", () => {
  const composition = jsxs(Composition, {
    fps: 24,
    width: 1280,
    height: 720,
    durationMs: 3000,
    children: [
      jsx(TextLayer, { id: "title", text: "OpenHyper", size: 72, color: "#111", from: 0, to: 1500 }),
      jsx(ShapeLayer, { id: "bar", shape: "rect", width: 400, height: 24, fill: "#0af" }),
      jsx(ImageLayer, { id: "logo", src: "logo.png", fit: "contain" })
    ]
  });

  assert.equal(composition.type, "composition");
  assert.equal(composition.layers.length, 3);
  assert.deepEqual(composition.layers.map((layer) => layer.type), ["text", "shape", "image"]);
  assert.equal(composition.layers[0]!.startMs, 0);
  assert.equal(composition.layers[0]!.endMs, 1500);
});

test("Fragment flattens nested children", () => {
  const children = jsxs(Fragment, {
    children: [
      jsx(TextLayer, { text: "A" }),
      [jsx(TextLayer, { text: "B" })]
    ]
  });

  assert.equal(children.length, 2);
  const second = children[1] as { text: string };
  assert.equal(second.text, "B");
});
