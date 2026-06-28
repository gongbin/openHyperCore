import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import type { Layer } from "../../core/src/index.ts";
import { renderRgbaFrame } from "../../renderer-skia/src/index.ts";
import { isNativeAddonAvailable, renderFrame } from "../src/index.ts";

const skip = isNativeAddonAvailable() ? false : "native addon not built (run pnpm build:native)";

function meanAbsDiff(a: Buffer, b: Buffer): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i]! - b[i]!);
  }
  return sum / a.length;
}

async function assertParity(layers: Layer[], tolerance: number, width = 64, height = 48): Promise<void> {
  const composition = defineComposition({ fps: 30, width, height, durationMs: 100, layers });
  const frame = resolveFrame(composition, 0);
  const native = renderFrame(frame);
  const wasm = await renderRgbaFrame(frame);
  assert.equal(native.length, wasm.length);
  const diff = meanAbsDiff(native, wasm);
  assert.ok(diff < tolerance, `mean abs channel diff ${diff.toFixed(2)} exceeds ${tolerance}`);
}

test("native gradients (linear + radial) match the wasm backend", { skip }, async () => {
  await assertParity([
    { type: "shape", shape: "rect", width: 64, height: 24, fill: { type: "linear", from: [0, 0], to: [64, 0], stops: [{ offset: 0, color: "#102030" }, { offset: 1, color: "#e0a040" }] } },
    { type: "shape", shape: "circle", radius: 12, fill: { type: "radial", center: [12, 12], radius: 12, stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#2050a0" }] }, transform: { x: 8, y: 24 } }
  ], 4);
});

test("native blend modes match the wasm backend", { skip }, async () => {
  await assertParity([
    { type: "shape", shape: "rect", width: 64, height: 48, fill: "#101010" },
    { type: "shape", shape: "rect", width: 40, height: 40, fill: "#ff3020", transform: { x: 6, y: 4 } },
    { type: "shape", shape: "rect", width: 40, height: 40, fill: "#20a0ff", blendMode: "screen", transform: { x: 18, y: 4 } }
  ], 4);
});

test("native clip (rounded rect + path) matches the wasm backend", { skip }, async () => {
  await assertParity([
    { type: "shape", shape: "rect", width: 64, height: 48, fill: "#222831" },
    { type: "shape", shape: "rect", width: 60, height: 40, fill: "#ffcc00", clip: { type: "rect", width: 40, height: 30, radius: 8 }, transform: { x: 4, y: 4 } },
    { type: "shape", shape: "rect", width: 30, height: 30, fill: "#2ec4b6", clip: { type: "path", path: "M0 0 L30 0 L0 30 Z" }, transform: { x: 30, y: 14 } }
  ], 4);
});

test("native full-layer blur matches the wasm backend", { skip }, async () => {
  await assertParity([
    { type: "shape", shape: "rect", width: 64, height: 48, fill: "#000000" },
    { type: "group", blur: 3, transform: { x: 22, y: 14 }, layers: [{ type: "shape", shape: "rect", width: 20, height: 20, fill: "#ffffff" }] }
  ], 6);
});

test("native group opacity + reveal wipe matches the wasm backend", { skip }, async () => {
  await assertParity([
    { type: "shape", shape: "rect", width: 64, height: 48, fill: "#101820" },
    {
      type: "group",
      transform: { x: 8, y: 8, opacity: 0.5 },
      reveal: { type: "wipe", width: 48, height: 32, direction: "from-left", progress: 0.6 },
      layers: [
        { type: "shape", shape: "rect", width: 48, height: 32, fill: "#ff5d73" },
        { type: "shape", shape: "rect", width: 48, height: 32, fill: "#ff5d73" }
      ]
    }
  ], 4);
});

test("native motion blur matches the wasm backend", { skip }, async () => {
  await assertParity([
    { type: "shape", shape: "rect", width: 64, height: 48, fill: "#000000" },
    { type: "shape", shape: "rect", width: 8, height: 8, fill: "#ffffff", transform: { x: 28, y: 20 }, motionBlur: { angle: 0, distance: 24, samples: 10 } }
  ], 6);
});

test("native image draw (cover) matches the wasm backend", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-native-img-"));
  const png = join(dir, "red.png");
  await writeFile(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lRY6mAAAAABJRU5ErkJggg==", "base64"));
  await assertParity([
    { type: "shape", shape: "rect", width: 64, height: 48, fill: "#000000" },
    { type: "image", src: png, width: 40, height: 30, fit: "cover", transform: { x: 8, y: 8 } }
  ], 4);
});
