import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import { renderRgbaFrame } from "../../renderer-skia/src/index.ts";
import { isNativeAddonAvailable, renderFrame } from "../src/index.ts";

// Both backends must use the SAME typeface for a fair comparison, so pin an
// explicit font that ships on macOS dev machines; skip elsewhere.
const FONT = "/System/Library/Fonts/STHeiti Medium.ttc";
const skip = !isNativeAddonAvailable()
  ? "native addon not built (run pnpm build:native)"
  : !existsSync(FONT)
    ? `pinned test font missing: ${FONT}`
    : false;

function meanAbsDiff(a: Buffer, b: Buffer): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i]! - b[i]!);
  }
  return sum / a.length;
}

function solidPixels(rgba: Buffer): number {
  let count = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! > 128) {
      count += 1;
    }
  }
  return count;
}

test("native text (CJK + Latin, per-char font stack) matches the wasm backend", { skip }, async () => {
  const composition = defineComposition({
    fps: 30,
    width: 320,
    height: 96,
    durationMs: 100,
    defaultFont: FONT,
    layers: [
      { type: "text", text: "Hello 世界", size: 48, color: "#ffffff", transform: { x: 12, y: 64 } },
      { type: "text", text: "SPACED", size: 22, letterSpacing: 6, color: "#8ecdf7", transform: { x: 12, y: 88 } }
    ]
  });

  const frame = resolveFrame(composition, 0);
  const native = renderFrame(frame);
  const wasm = await renderRgbaFrame(frame);

  assert.equal(native.length, wasm.length);
  // Text was actually drawn in both backends.
  const nativeSolid = solidPixels(native);
  const wasmSolid = solidPixels(wasm);
  assert.ok(nativeSolid > 50, `native drew too few solid pixels: ${nativeSolid}`);
  assert.ok(wasmSolid > 50, `wasm drew too few solid pixels: ${wasmSolid}`);

  // Same typeface + same layout algorithm => glyphs land in the same place at
  // the same size; allow for AA differences between the two Skia builds.
  const ratio = nativeSolid / wasmSolid;
  assert.ok(ratio > 0.8 && ratio < 1.25, `solid-pixel counts diverge: native ${nativeSolid} vs wasm ${wasmSolid}`);
  const diff = meanAbsDiff(native, wasm);
  assert.ok(diff < 8, `mean abs channel diff too high: ${diff.toFixed(2)}`);
});

test("native caption with background + alignment matches the wasm backend", { skip }, async () => {
  const composition = defineComposition({
    fps: 30,
    width: 320,
    height: 96,
    durationMs: 100,
    defaultFont: FONT,
    layers: [
      { type: "caption", text: "字幕 Caption", size: 36, color: "#ffffff", backgroundColor: "#202830", padding: 10, align: "center", transform: { x: 160, y: 60 } }
    ]
  });

  const frame = resolveFrame(composition, 0);
  const native = renderFrame(frame);
  const wasm = await renderRgbaFrame(frame);

  assert.equal(native.length, wasm.length);
  const diff = meanAbsDiff(native, wasm);
  assert.ok(diff < 10, `mean abs channel diff too high: ${diff.toFixed(2)}`);
});
