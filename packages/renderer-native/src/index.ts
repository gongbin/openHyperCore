import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedFrame } from "../../core/src/index.ts";

// The compiled napi-rs addon (gitignored build artifact at the package root).
// Multi-platform naming + a resolver will arrive with @napi-rs/cli adoption in
// the CI/prebuild phase; for now this is the single dev-machine artifact.
const addonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer-native.node");

// The native addon's exported surface. Grows phase by phase; Phase 0b ships only
// the smoke entry point that proves the bridge + skia-safe round-trip.
export type NativeAddon = {
  renderSmoke(width: number, height: number, r: number, g: number, b: number, a: number): Buffer;
  renderFrame(frameJson: string): Buffer;
};

let cached: NativeAddon | undefined;

export function isNativeAddonAvailable(): boolean {
  return existsSync(addonPath);
}

export function loadNativeAddon(): NativeAddon {
  if (cached) {
    return cached;
  }
  if (!existsSync(addonPath)) {
    throw new Error(`native renderer addon not built at ${addonPath} — run \`pnpm build:native\` (requires the Rust toolchain)`);
  }
  cached = createRequire(import.meta.url)(addonPath) as NativeAddon;
  return cached;
}

export function renderSmoke(width: number, height: number, r: number, g: number, b: number, a: number): Buffer {
  return loadNativeAddon().renderSmoke(width, height, r, g, b, a);
}

// Render a resolved frame entirely on the native side. The frame is plain
// numeric data, so JSON is a safe (if not yet optimal) transport across napi;
// a compact binary encoding is a later optimization if this proves hot.
export function renderFrame(frame: ResolvedFrame): Buffer {
  return loadNativeAddon().renderFrame(JSON.stringify(frame));
}
