import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import { renderRgbaFrame } from "../../renderer-skia/src/index.ts";
import { isNativeAddonAvailable, renderFrame } from "../src/index.ts";

const skip = isNativeAddonAvailable() ? false : "native addon not built (run pnpm build:native)";
const earth = join(fileURLToPath(new URL(".", import.meta.url)), "../../../examples/assets/earth-equirect.jpg");

// Both backends generate the same globe mesh (see buildGlobeMesh in
// renderer-skia/src/draw.ts and draw_globe in lib.rs) and modulate the same
// decoded texture, so frames should match within AA/quantization tolerance.
test("native globe rendering matches the wasm backend within tolerance", { skip }, async () => {
  const composition = defineComposition({
    fps: 30,
    width: 96,
    height: 96,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 96, height: 96, fill: "#050a18" },
      {
        type: "globe",
        src: earth,
        radius: 36,
        yaw: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: Math.PI }],
        pitch: -0.35,
        transform: { x: 48, y: 48 }
      }
    ]
  });

  for (const timeMs of [0, 500, 1000]) {
    const frame = resolveFrame(composition, timeMs);
    const native = renderFrame(frame);
    const wasm = await renderRgbaFrame(frame);
    assert.equal(native.length, wasm.length);
    let differing = 0;
    for (let i = 0; i < native.length; i += 1) {
      if (Math.abs(native[i]! - wasm[i]!) > 8) {
        differing += 1;
      }
    }
    const fraction = differing / native.length;
    assert.ok(fraction < 0.03, `t=${timeMs}: native vs wasm differ on ${(fraction * 100).toFixed(2)}% of channels (>8/255)`);
  }
});
