import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { createVideoFrameCache, renderRgbaFrame } from "../../renderer-skia/src/index.ts";
import type { ResolvedFrame } from "../../core/src/index.ts";

type RenderWorkerRequest = {
  sourceIndex: number;
  frame: ResolvedFrame;
  ffmpegPath?: string;
};

const videoFrameCaches = new Map<string, ReturnType<typeof createVideoFrameCache>>();

if (!parentPort) {
  throw new Error("render-worker must run inside a worker thread");
}

parentPort.on("message", async (message: RenderWorkerRequest) => {
  try {
    const startedAt = performance.now();
    const frame = await renderRgbaFrame(message.frame, {
      videoFrameCache: videoFrameCacheFor(message.ffmpegPath)
    });
    parentPort?.postMessage({
      sourceIndex: message.sourceIndex,
      frame,
      renderMs: performance.now() - startedAt
    });
  } catch (error) {
    parentPort?.postMessage({
      sourceIndex: message.sourceIndex,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

function videoFrameCacheFor(ffmpegPath: string | undefined): ReturnType<typeof createVideoFrameCache> {
  const key = ffmpegPath ?? "default";
  const cached = videoFrameCaches.get(key);
  if (cached) {
    return cached;
  }

  const cache = createVideoFrameCache(ffmpegPath ? { ffmpegPath } : {});
  videoFrameCaches.set(key, cache);
  return cache;
}
