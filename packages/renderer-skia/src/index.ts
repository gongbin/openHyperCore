export {
  LayerRasterCache,
  createLayerRasterCache
} from "./layer-cache.ts";
export type {
  LayerRasterCacheOptions,
  LayerRasterCacheStats,
  LayerRasterEntry
} from "./layer-cache.ts";
export {
  RgbaFrameRenderer,
  createRgbaFrameRenderer,
  VideoFrameCache,
  createVideoFrameCache,
  prefetchVideoFrameBatch,
  prefetchVideoFrames,
  registerFont,
  unregisterFont,
  clearFontRegistry,
  registerEmojiFont,
  renderPngFrame,
  renderRgbaFrame,
  videoTimeForLayer,
  createNodeAssetProvider
} from "./render-png.ts";
export type {
  RgbaVideoFrame,
  RenderFrameOptions,
  RgbaFrameRendererOptions,
  VideoFrameCacheOptions
} from "./render-png.ts";
// Browser-safe draw tree (no node imports): a host can pair drawFrameToCanvas
// with a fetch/<video>-based AssetProvider to render the exact same output as
// the server in a browser preview.
export { drawFrameToCanvas } from "./draw.ts";
export type { AssetProvider, DrawContext, ResolvedVideoLayer } from "./draw.ts";
export { createFrameRenderer, defaultBackend } from "./backend.ts";
export type { CreateFrameRendererOptions, FrameRenderer, RenderBackend } from "./backend.ts";
