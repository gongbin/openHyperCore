import test from "node:test";
import assert from "node:assert/strict";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import { renderSvgFrame } from "../src/index.ts";

test("renderSvgFrame emits deterministic SVG for resolved text and shapes", () => {
  const composition = defineComposition({
    fps: 30,
    width: 640,
    height: 360,
    durationMs: 1000,
    layers: [
      {
        type: "shape",
        shape: "rect",
        id: "bg",
        width: 640,
        height: 360,
        fill: "#222"
      },
      {
        type: "text",
        id: "title",
        text: "Hello <Core>",
        size: 48,
        color: "#fff",
        transform: { x: 20, y: 80, opacity: 0.75 }
      }
    ]
  });

  const svg = renderSvgFrame(resolveFrame(composition, 0));

  assert.match(svg, /<svg/);
  assert.match(svg, /width="640"/);
  assert.match(svg, /<rect/);
  assert.match(svg, /Hello &lt;Core&gt;/);
  assert.match(svg, /opacity="0.75"/);
});
