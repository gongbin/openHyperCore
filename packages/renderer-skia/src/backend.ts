import type { ResolvedFrame } from "../../core/src/index.ts";
import type { LayerRasterCacheStats } from "./layer-cache.ts";
import { createRgbaFrameRenderer } from "./render-png.ts";
import type { RenderFrameOptions, RgbaFrameRendererOptions } from "./render-png.ts";

// Backend-neutral renderer seam: anything that turns a ResolvedFrame into an
// RGBA frame buffer. The canvaskit-wasm renderer (RgbaFrameRenderer) is the
// reference/fallback implementation; a future native (Rust + skia-safe) backend
// will implement the same shape so the CLI/worker can switch via configuration
// without touching their render loops.
export interface FrameRenderer {
  render(frame: ResolvedFrame, options?: RenderFrameOptions): Promise<Buffer>;
  // Static-layer raster cache stats for benchmarking; backends without one
  // return undefined.
  layerCacheStats(): LayerRasterCacheStats | undefined;
  dispose(): void;
}

export type RenderBackend = "wasm" | "native";

export type CreateFrameRendererOptions = RgbaFrameRendererOptions & {
  // Which backend to instantiate. Defaults to `defaultBackend()` (wasm unless
  // OPENHYPERCORE_RENDERER=native is set).
  backend?: RenderBackend;
};

// The default backend, overridable with OPENHYPERCORE_RENDERER=native once the
// native package is built. Kept as a single chokepoint so flipping the default
// later is a one-line change.
export function defaultBackend(): RenderBackend {
  return process.env.OPENHYPERCORE_RENDERER === "native" ? "native" : "wasm";
}

// Construct a renderer for the selected backend. The native backend is loaded
// lazily so the optional native addon is never required unless requested.
export function createFrameRenderer(options: CreateFrameRendererOptions = {}): FrameRenderer {
  const { backend = defaultBackend(), ...rendererOptions } = options;
  if (backend === "native") {
    throw new Error(
      "native renderer backend is not available yet — planned in packages/renderer-native (Rust + skia-safe). Use the default wasm backend for now."
    );
  }
  return createRgbaFrameRenderer(rendererOptions);
}
