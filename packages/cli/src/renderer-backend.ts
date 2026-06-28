import { createFrameRenderer } from "../../renderer-skia/src/index.ts";
import type { FrameRenderer, RgbaFrameRendererOptions } from "../../renderer-skia/src/index.ts";
import { createNativeFrameRenderer } from "../../renderer-native/src/index.ts";

export type RendererBackend = "wasm" | "native";

// The CLI is the composition root that knows about every backend, so backend
// selection lives here rather than inside renderer-skia (which must not depend
// on renderer-native). Importing renderer-native is cheap — it only loads the
// native .node addon lazily on first render, so the wasm path never needs it.
export function resolveBackend(explicit?: RendererBackend): RendererBackend {
  if (explicit) {
    return explicit;
  }
  return process.env.OPENHYPERCORE_RENDERER === "native" ? "native" : "wasm";
}

export function createBackendRenderer(backend: RendererBackend, options: RgbaFrameRendererOptions = {}): FrameRenderer {
  if (backend === "native") {
    return createNativeFrameRenderer();
  }
  return createFrameRenderer(options);
}

export function parseRendererBackend(value: string): RendererBackend {
  if (value === "wasm" || value === "native") {
    return value;
  }
  throw new Error("--renderer must be wasm or native");
}
