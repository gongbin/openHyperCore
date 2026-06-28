import test from "node:test";
import assert from "node:assert/strict";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import { renderRgbaFrame } from "../../renderer-skia/src/index.ts";
import { isNativeAddonAvailable, renderFrame } from "../src/index.ts";

const skip = isNativeAddonAvailable() ? false : "native addon not built (run pnpm build:native)";

// The native (skia-safe) and wasm (canvaskit) backends are both Skia, so shape
// rendering should match closely — flat interiors near-exactly, AA edges within
// a few LSB across the two Skia builds.
test("native shape rendering matches the wasm backend within tolerance", { skip }, async () => {
  const composition = defineComposition({
    fps: 30,
    width: 64,
    height: 48,
    durationMs: 100,
    layers: [
      { type: "shape", shape: "rect", width: 64, height: 48, fill: "#102030" },
      { type: "shape", shape: "rect", width: 20, height: 20, fill: "#ff4400", transform: { x: 8, y: 8, opacity: 0.7 } },
      { type: "shape", shape: "circle", radius: 12, fill: "#2ec4b6", transform: { x: 40, y: 10 } },
      { type: "shape", shape: "path", path: "M0 0 L24 0 L0 16 Z", stroke: "#ffffff", strokeWidth: 2, transform: { x: 8, y: 26 } },
      { type: "shape", shape: "rect", width: 18, height: 14, stroke: "#ffd166", strokeWidth: 2, dash: [4, 3], transform: { x: 40, y: 30 } }
    ]
  });

  const frame = resolveFrame(composition, 0);
  const native = renderFrame(frame);
  const wasm = await renderRgbaFrame(frame);

  assert.equal(native.length, wasm.length);
  let differing = 0;
  for (let i = 0; i < native.length; i += 1) {
    if (Math.abs(native[i]! - wasm[i]!) > 6) {
      differing += 1;
    }
  }
  const fraction = differing / native.length;
  assert.ok(fraction < 0.02, `native vs wasm differ on ${(fraction * 100).toFixed(2)}% of channels (>6/255)`);

  // A flat interior pixel of the orange rect should match (near-)exactly.
  const px = (x: number, y: number) => [native.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4), wasm.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)] as const;
  const [n, w] = px(16, 16);
  for (let c = 0; c < 4; c += 1) {
    assert.ok(Math.abs(n[c]! - w[c]!) <= 2, `interior pixel channel ${c}: native ${n[c]} vs wasm ${w[c]}`);
  }
});
