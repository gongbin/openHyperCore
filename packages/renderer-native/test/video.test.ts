import test from "node:test";
import assert from "node:assert/strict";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import type { RenderFrameOptions } from "../../renderer-skia/src/index.ts";
import { createNativeFrameRenderer, isNativeAddonAvailable } from "../src/index.ts";

const skip = isNativeAddonAvailable() ? false : "native addon not built (run pnpm build:native)";

// A 2x2 RGBA frame: red, green / blue, white.
const FRAME_2X2 = Buffer.from([
  255, 0, 0, 255, 0, 255, 0, 255,
  0, 0, 255, 255, 255, 255, 255, 255
]);

const stubCache = {
  async getSourceSize() {
    return { width: 2, height: 2 };
  },
  async getRgbaFrame() {
    return { width: 2, height: 2, pixels: FRAME_2X2 };
  }
};

test("native video layer draws the supplied RGBA frame (fill, scaled)", { skip }, async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 8,
    durationMs: 100,
    layers: [
      { type: "video", src: "stub.mp4", width: 8, height: 8, fit: "fill", transform: { x: 0, y: 0 } }
    ]
  });

  const renderer = createNativeFrameRenderer();
  const rgba = await renderer.render(resolveFrame(composition, 0), { videoFrameCache: stubCache } as unknown as RenderFrameOptions);
  const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];

  // Source quadrants map to the corners after scaling 2x2 -> 8x8.
  const [tlR, tlG, tlB] = px(0, 0);
  assert.ok(tlR! > 150 && tlG! < 100 && tlB! < 100, `top-left should be red, got ${px(0, 0)}`);
  const [trR, trG, trB] = px(7, 0);
  assert.ok(trG! > 150 && trR! < 100 && trB! < 100, `top-right should be green, got ${px(7, 0)}`);
  const [blR, blG, blB] = px(0, 7);
  assert.ok(blB! > 150 && blR! < 100 && blG! < 100, `bottom-left should be blue, got ${px(0, 7)}`);
  const [brR, brG, brB] = px(7, 7);
  assert.ok(brR! > 150 && brG! > 150 && brB! > 150, `bottom-right should be white, got ${px(7, 7)}`);
});

test("native circular video clip fills inside, leaves corners transparent", { skip }, async () => {
  const composition = defineComposition({
    fps: 30,
    width: 16,
    height: 16,
    durationMs: 100,
    layers: [
      { type: "video", src: "stub.mp4", width: 16, height: 16, clip: { type: "circle", radius: 8, cx: 8, cy: 8 }, transform: { x: 0, y: 0 } }
    ]
  });

  const renderer = createNativeFrameRenderer();
  const rgba = await renderer.render(resolveFrame(composition, 0), { videoFrameCache: stubCache } as unknown as RenderFrameOptions);
  const alpha = (x: number, y: number) => rgba[(y * 16 + x) * 4 + 3]!;
  assert.ok(alpha(8, 8) > 0, "centre inside circle: opaque");
  assert.equal(alpha(0, 0), 0, "corner outside circle: transparent");
  assert.equal(alpha(15, 15), 0, "corner outside circle: transparent");
});

test("native renderer rejects video layers without a frame cache", { skip }, async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 8,
    durationMs: 100,
    layers: [{ type: "video", src: "stub.mp4", width: 8, height: 8, transform: {} }]
  });
  const renderer = createNativeFrameRenderer();
  await assert.rejects(() => renderer.render(resolveFrame(composition, 0)), /requires a videoFrameCache/);
});
