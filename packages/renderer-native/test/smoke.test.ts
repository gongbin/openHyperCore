import test from "node:test";
import assert from "node:assert/strict";
import { isNativeAddonAvailable, renderSmoke } from "../src/index.ts";

// Self-skips when the native addon isn't built, so the default `pnpm test` stays
// green on machines without the Rust toolchain; runs after `pnpm build:native`.
test("native skia smoke: clears a raster surface and reads back exact RGBA", {
  skip: isNativeAddonAvailable() ? false : "native addon not built (run pnpm build:native)"
}, () => {
  const buf = renderSmoke(4, 4, 255, 128, 0, 255);
  assert.equal(buf.length, 4 * 4 * 4);
  assert.deepEqual([...buf.subarray(0, 4)], [255, 128, 0, 255]);
  assert.deepEqual([...buf.subarray(60, 64)], [255, 128, 0, 255]);
});
