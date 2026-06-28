import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { createFrameRenderer, createVideoFrameCache, prefetchVideoFrameBatch } from "../../renderer-skia/src/index.ts";
import type { ResolvedFrame } from "../../core/src/index.ts";

// A run = a contiguous slice of frames. The worker batch-extracts all the video
// frames the slice needs in one ffmpeg pass (sequential decode, no per-frame
// seek), then rasterises each frame.
type RenderWorkerRequest = {
  runIndex: number;
  sourceIndices: number[];
  frames: ResolvedFrame[];
  ffmpegPath?: string;
  diskCacheDir?: string;
  layerCache?: boolean;
};

const videoFrameCaches = new Map<string, ReturnType<typeof createVideoFrameCache>>();
const rgbaRenderer = createFrameRenderer();

if (!parentPort) {
  throw new Error("render-worker must run inside a worker thread");
}

parentPort.on("message", async (message: RenderWorkerRequest) => {
  try {
    const startedAt = performance.now();
    const cache = videoFrameCacheFor(message.ffmpegPath, message.diskCacheDir);
    cache.clear();
    await prefetchVideoFrameBatch(message.frames, cache);
    const frames: Uint8Array[] = [];
    for (const frame of message.frames) {
      frames.push(await rgbaRenderer.render(frame, message.layerCache === false
        ? { videoFrameCache: cache, layerCache: false }
        : { videoFrameCache: cache }));
    }
    parentPort?.postMessage({
      runIndex: message.runIndex,
      frames,
      renderMs: performance.now() - startedAt
    });
  } catch (error) {
    parentPort?.postMessage({
      runIndex: message.runIndex,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

process.once("exit", () => rgbaRenderer.dispose());

function videoFrameCacheFor(ffmpegPath: string | undefined, diskCacheDir: string | undefined): ReturnType<typeof createVideoFrameCache> {
  const key = `${ffmpegPath ?? "default"}|${diskCacheDir ?? ""}`;
  const cached = videoFrameCaches.get(key);
  if (cached) {
    return cached;
  }

  const options: { ffmpegPath?: string; diskCacheDir?: string } = {};
  if (ffmpegPath) {
    options.ffmpegPath = ffmpegPath;
  }
  if (diskCacheDir) {
    options.diskCacheDir = diskCacheDir;
  }
  const cache = createVideoFrameCache(options);
  videoFrameCaches.set(key, cache);
  return cache;
}
