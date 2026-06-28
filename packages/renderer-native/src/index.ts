import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedFrame, ResolvedLayer } from "../../core/src/index.ts";
import { videoTimeForLayer } from "../../renderer-skia/src/index.ts";
import type { FrameRenderer, RenderFrameOptions } from "../../renderer-skia/src/index.ts";

// The compiled napi-rs addon (gitignored build artifact at the package root).
// Multi-platform naming + a resolver will arrive with @napi-rs/cli adoption in
// the CI/prebuild phase; for now this is the single dev-machine artifact.
const addonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer-native.node");

export type NativeAddon = {
  renderSmoke(width: number, height: number, r: number, g: number, b: number, a: number): Buffer;
  // The frame is plain numeric data, so JSON is a safe transport across napi;
  // decoded video-layer pixels ride alongside as raw RGBA buffers, referenced by
  // each video layer's injected `frameIndex`.
  renderFrame(frameJson: string, videoFrames: Buffer[]): Buffer;
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

// Render a video-free resolved frame on the native side (sync convenience).
export function renderFrame(frame: ResolvedFrame): Buffer {
  return loadNativeAddon().renderFrame(JSON.stringify(frame), []);
}

// The subset of VideoFrameCache the native renderer needs to pull decoded
// frames; VideoFrameCache satisfies it structurally.
type VideoFrameSource = {
  getSourceSize(src: string): Promise<{ width: number; height: number }>;
  getRgbaFrame(src: string, timeMs: number, width: number, height: number): Promise<{ width: number; height: number; pixels: Buffer }>;
};

// Walk the resolved layers, replacing each video layer with one annotated with
// the index/size of its decoded RGBA frame (collected into `buffers`). Group
// children live on the group's local timeline, so the lookup time is shifted by
// the accumulated group start — mirroring the wasm renderer.
async function annotateVideoLayers(
  layers: ResolvedLayer[],
  localTimeMs: number,
  cache: VideoFrameSource | undefined,
  buffers: Buffer[]
): Promise<ResolvedLayer[]> {
  const out: ResolvedLayer[] = [];
  for (const layer of layers) {
    if (layer.type === "group") {
      const startMs = layer.startMs ?? 0;
      out.push({ ...layer, layers: await annotateVideoLayers(layer.layers, localTimeMs - startMs, cache, buffers) });
      continue;
    }
    if (layer.type === "video") {
      if (!cache) {
        throw new Error("native renderer requires a videoFrameCache to draw video layers");
      }
      const sourceTimeMs = videoTimeForLayer(layer, localTimeMs);
      const size = await cache.getSourceSize(layer.src);
      const frame = await cache.getRgbaFrame(layer.src, sourceTimeMs, size.width, size.height);
      const frameIndex = buffers.length;
      buffers.push(frame.pixels);
      out.push({ ...layer, frameIndex, frameWidth: frame.width, frameHeight: frame.height } as ResolvedLayer);
      continue;
    }
    out.push(layer);
  }
  return out;
}

// Native implementation of the renderer-skia FrameRenderer seam. Video frames
// are still decoded by the TS VideoFrameCache (ffmpeg) and passed in as raw
// RGBA; everything else is drawn natively.
export class NativeFrameRenderer implements FrameRenderer {
  async render(frame: ResolvedFrame, options: RenderFrameOptions = {}): Promise<Buffer> {
    const buffers: Buffer[] = [];
    const layers = await annotateVideoLayers(frame.layers, frame.timeMs, options.videoFrameCache, buffers);
    const annotated = { ...frame, layers };
    return loadNativeAddon().renderFrame(JSON.stringify(annotated), buffers);
  }

  // No cross-frame raster cache yet (Phase 5).
  layerCacheStats(): undefined {
    return undefined;
  }

  dispose(): void {
    // No persistent native resources to release yet.
  }
}

export function createNativeFrameRenderer(): NativeFrameRenderer {
  return new NativeFrameRenderer();
}
