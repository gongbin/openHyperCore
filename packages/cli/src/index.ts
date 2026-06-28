#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { availableParallelism, freemem, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { encodeRawVideoFrames } from "../../encoder-ffmpeg/src/index.ts";
import type { AudioInput, EncodePngFramesOptions } from "../../encoder-ffmpeg/src/index.ts";
import { defineComposition, frameCount, resolveFrame, timeForFrame } from "../../core/src/index.ts";
import type { Composition, Layer, ResolvedFrame, ResolvedLayer } from "../../core/src/index.ts";
import { createVideoFrameCache, prefetchVideoFrameBatch, renderPngFrame } from "../../renderer-skia/src/index.ts";
import type { LayerRasterCacheStats } from "../../renderer-skia/src/index.ts";
import { renderSvgFrame } from "../../renderer-svg/src/index.ts";
import { createBackendRenderer, parseRendererBackend, resolveBackend } from "./renderer-backend.ts";
import type { RendererBackend } from "./renderer-backend.ts";

type CliIO = {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

type StillOptions = {
  t: number;
  out: string;
  format: "svg" | "png";
};

export type RenderOptions = {
  out: string;
  fps?: number;
  width?: number;
  height?: number;
  ffmpegPath?: string;
  ffmpegArgsPrefix: string[];
  workers?: WorkerSelection;
  workerWindow?: number;
  diskCacheDir?: string;
  // `false` disables the in-renderer static-layer raster cache (--no-layer-cache).
  layerCache?: boolean;
  // Render backend: "wasm" (canvaskit, default) or "native" (Rust + skia-safe).
  renderer?: RendererBackend;
};

type BenchOptions = Omit<RenderOptions, "out"> & {
  out: string;
  videoOut: string;
};

type BenchSuiteOptions = Omit<RenderOptions, "out"> & {
  out: string;
  staticFile: string;
  videoDir: string;
};

type RenderStats = {
  frames: number;
  renderedFrames: number;
  reusedFrames: number;
  workerPoolStarts: number;
  maxBufferedFrames: number;
  renderWallMs: number;
  renderCpuMs: number;
  peakRssBytes: number;
  layerCache?: LayerRasterCacheStats;
};

export type CompositionAudio = {
  audioFile?: string;
  audioInputs?: AudioInput[];
};

type WorkerSelection = number | "auto";

// A worker now handles a contiguous RUN of frames so it can batch-extract the
// needed video frames in one ffmpeg pass (sequential decode ≈ 10ms/frame vs a
// per-frame seek ≈ 130ms/frame), then rasterise them in parallel with peers.
type RenderRunJob = {
  runIndex: number;
  sourceIndices: number[];
  frames: ResolvedFrame[];
  ffmpegPath?: string;
  diskCacheDir?: string;
  layerCache?: boolean;
  backend?: RendererBackend;
};

type FramePlan = {
  sourceIndex: number;
  reused: boolean;
};

type RenderWorkerResponse = {
  runIndex: number;
  frames?: Uint8Array[];
  renderMs?: number;
  error?: string;
};

const VIDEO_PREFETCH_WINDOW_FRAMES = 32;
const RENDER_RUN_FRAMES = 30;

export async function runCli(args: string[], io: CliIO = {}): Promise<void> {
  const stdout = io.stdout ?? ((line: string) => console.log(line));
  const command = args[0];

  if (command === "probe") {
    const file = requiredArg(args[1], "composition file");
    const composition = await loadComposition(file);
    stdout(JSON.stringify(probeComposition(composition), null, 2));
    return;
  }

  if (command === "still") {
    const file = requiredArg(args[1], "composition file");
    const options = parseStillOptions(args.slice(2));
    const composition = await loadComposition(file);
    const frame = resolveFrame(composition, Math.round(options.t * 1000));
    if (options.format === "png") {
      await writeFile(options.out, await renderPngFrame(frame));
    } else {
      await writeFile(options.out, renderSvgFrame(frame), "utf8");
    }
    stdout(options.out);
    return;
  }

  if (command === "render") {
    const file = requiredArg(args[1], "composition file");
    const options = parseRenderOptions(args.slice(2));
    const composition = applyRenderOverrides(await loadComposition(file), options);
    await renderVideo(composition, options, extractAudioInputs(composition));
    stdout(options.out);
    return;
  }

  if (command === "bench") {
    const file = requiredArg(args[1], "composition file");
    const options = parseBenchOptions(args.slice(2));
    const composition = applyRenderOverrides(await loadComposition(file), options);
    const metrics = await renderVideo(composition, { ...options, out: options.videoOut }, extractAudioInputs(composition));
    await writeFile(options.out, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
    stdout(options.out);
    return;
  }

  if (command === "bench-suite") {
    const file = requiredArg(args[1], "composition file");
    const options = parseBenchSuiteOptions(args.slice(2));
    const report = await runBenchSuite(file, options);
    await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    stdout(options.out);
    return;
  }

  if (command === "serve") {
    const port = parseServePort(args.slice(1));
    // Dynamic import avoids a static cycle (server reuses renderVideo from here).
    const { startRenderServer } = await import("../../server/src/index.ts");
    await startRenderServer(port);
    stdout(`openhypercore render service on http://localhost:${port}  (POST /render with a composition IR → MP4)`);
    return; // the listening server keeps the process alive
  }

  throw new Error(`Unknown command: ${command ?? "(missing)"}`);
}

function probeComposition(composition: Composition): Record<string, unknown> {
  return {
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
    durationMs: composition.durationMs,
    frames: frameCount(composition),
    layers: composition.layers.length
  };
}

async function loadComposition(file: string): Promise<Composition> {
  const moduleUrl = pathToFileURL(resolve(file)).href;
  const loaded = await import(`${moduleUrl}?t=${Date.now()}`);
  const composition = loaded.default ?? loaded.composition;

  if (!composition || composition.type !== "composition") {
    throw new Error(`Composition module must export a default Composition: ${file}`);
  }

  return composition as Composition;
}

function parseStillOptions(args: string[]): StillOptions {
  let t = 0;
  let out: string | undefined;
  let format: StillOptions["format"] = "svg";

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];

    if (name === "--t") {
      t = Number(requiredArg(value, "--t value"));
      index += 1;
      continue;
    }

    if (name === "--out") {
      out = requiredArg(value, "--out value");
      index += 1;
      continue;
    }

    if (name === "--format") {
      format = parseStillFormat(requiredArg(value, "--format value"));
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${name}`);
  }

  if (!Number.isFinite(t) || t < 0) {
    throw new Error("--t must be a non-negative number of seconds");
  }

  return { t, out: requiredArg(out, "--out"), format };
}

function parseStillFormat(value: string): StillOptions["format"] {
  if (value === "svg" || value === "png") {
    return value;
  }
  throw new Error("--format must be svg or png");
}

function parseRenderOptions(args: string[]): RenderOptions {
  let out: string | undefined;
  let fps: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let ffmpegPath: string | undefined;
  let workers: WorkerSelection | undefined;
  let workerWindow: number | undefined;
  let diskCacheDir: string | undefined;
  let layerCache: boolean | undefined;
  let renderer: RendererBackend | undefined;
  const ffmpegArgsPrefix: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];

    if (name === "--out") {
      out = requiredArg(value, "--out value");
      index += 1;
      continue;
    }

    if (name === "--fps") {
      fps = parsePositiveNumber(requiredArg(value, "--fps value"), "--fps");
      index += 1;
      continue;
    }

    if (name === "--size") {
      const parsed = parseSize(requiredArg(value, "--size value"));
      width = parsed.width;
      height = parsed.height;
      index += 1;
      continue;
    }

    if (name === "--ffmpeg-path") {
      ffmpegPath = requiredArg(value, "--ffmpeg-path value");
      index += 1;
      continue;
    }

    if (name === "--ffmpeg-arg-prefix") {
      ffmpegArgsPrefix.push(requiredArg(value, "--ffmpeg-arg-prefix value"));
      index += 1;
      continue;
    }

    if (name === "--workers") {
      workers = parseWorkerSelection(requiredArg(value, "--workers value"));
      index += 1;
      continue;
    }

    if (name === "--worker-window") {
      workerWindow = parsePositiveInteger(requiredArg(value, "--worker-window value"), "--worker-window");
      index += 1;
      continue;
    }

    if (name === "--cache-dir") {
      diskCacheDir = resolve(requiredArg(value, "--cache-dir value"));
      index += 1;
      continue;
    }

    if (name === "--no-layer-cache") {
      layerCache = false;
      continue;
    }

    if (name === "--renderer") {
      renderer = parseRendererBackend(requiredArg(value, "--renderer value"));
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${name}`);
  }

  return omitUndefined({
    out: requiredArg(out, "--out"),
    fps,
    width,
    height,
    ffmpegPath,
    ffmpegArgsPrefix,
    workers,
    workerWindow,
    diskCacheDir,
    layerCache,
    renderer
  }) as RenderOptions;
}

function parseBenchOptions(args: string[]): BenchOptions {
  let out: string | undefined;
  let videoOut: string | undefined;
  let fps: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let ffmpegPath: string | undefined;
  let workers: WorkerSelection | undefined;
  let workerWindow: number | undefined;
  let diskCacheDir: string | undefined;
  let layerCache: boolean | undefined;
  let renderer: RendererBackend | undefined;
  const ffmpegArgsPrefix: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];

    if (name === "--out") {
      out = requiredArg(value, "--out value");
      index += 1;
      continue;
    }

    if (name === "--video-out") {
      videoOut = requiredArg(value, "--video-out value");
      index += 1;
      continue;
    }

    if (name === "--renderer") {
      renderer = parseRendererBackend(requiredArg(value, "--renderer value"));
      index += 1;
      continue;
    }

    if (name === "--fps") {
      fps = parsePositiveNumber(requiredArg(value, "--fps value"), "--fps");
      index += 1;
      continue;
    }

    if (name === "--size") {
      const parsed = parseSize(requiredArg(value, "--size value"));
      width = parsed.width;
      height = parsed.height;
      index += 1;
      continue;
    }

    if (name === "--ffmpeg-path") {
      ffmpegPath = requiredArg(value, "--ffmpeg-path value");
      index += 1;
      continue;
    }

    if (name === "--ffmpeg-arg-prefix") {
      ffmpegArgsPrefix.push(requiredArg(value, "--ffmpeg-arg-prefix value"));
      index += 1;
      continue;
    }

    if (name === "--workers") {
      workers = parseWorkerSelection(requiredArg(value, "--workers value"));
      index += 1;
      continue;
    }

    if (name === "--worker-window") {
      workerWindow = parsePositiveInteger(requiredArg(value, "--worker-window value"), "--worker-window");
      index += 1;
      continue;
    }

    if (name === "--cache-dir") {
      diskCacheDir = resolve(requiredArg(value, "--cache-dir value"));
      index += 1;
      continue;
    }

    if (name === "--no-layer-cache") {
      layerCache = false;
      continue;
    }

    throw new Error(`Unknown option: ${name}`);
  }

  return omitUndefined({
    out: requiredArg(out, "--out"),
    videoOut: requiredArg(videoOut, "--video-out"),
    fps,
    width,
    height,
    ffmpegPath,
    ffmpegArgsPrefix,
    workers,
    workerWindow,
    diskCacheDir,
    layerCache,
    renderer
  }) as BenchOptions;
}

function parseBenchSuiteOptions(args: string[]): BenchSuiteOptions {
  let out: string | undefined;
  let staticFile: string | undefined;
  let videoDir: string | undefined;
  let fps: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let ffmpegPath: string | undefined;
  let workers: WorkerSelection | undefined;
  let workerWindow: number | undefined;
  const ffmpegArgsPrefix: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];

    if (name === "--out") {
      out = requiredArg(value, "--out value");
      index += 1;
      continue;
    }

    if (name === "--static") {
      staticFile = requiredArg(value, "--static value");
      index += 1;
      continue;
    }

    if (name === "--video-dir") {
      videoDir = requiredArg(value, "--video-dir value");
      index += 1;
      continue;
    }

    if (name === "--fps") {
      fps = parsePositiveNumber(requiredArg(value, "--fps value"), "--fps");
      index += 1;
      continue;
    }

    if (name === "--size") {
      const parsed = parseSize(requiredArg(value, "--size value"));
      width = parsed.width;
      height = parsed.height;
      index += 1;
      continue;
    }

    if (name === "--ffmpeg-path") {
      ffmpegPath = requiredArg(value, "--ffmpeg-path value");
      index += 1;
      continue;
    }

    if (name === "--ffmpeg-arg-prefix") {
      ffmpegArgsPrefix.push(requiredArg(value, "--ffmpeg-arg-prefix value"));
      index += 1;
      continue;
    }

    if (name === "--workers") {
      workers = parseWorkerSelection(requiredArg(value, "--workers value"));
      index += 1;
      continue;
    }

    if (name === "--worker-window") {
      workerWindow = parsePositiveInteger(requiredArg(value, "--worker-window value"), "--worker-window");
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${name}`);
  }

  return omitUndefined({
    out: requiredArg(out, "--out"),
    staticFile: requiredArg(staticFile, "--static"),
    videoDir: requiredArg(videoDir, "--video-dir"),
    fps,
    width,
    height,
    ffmpegPath,
    ffmpegArgsPrefix,
    workers,
    workerWindow
  }) as BenchSuiteOptions;
}

async function runBenchSuite(dynamicFile: string, options: BenchSuiteOptions): Promise<Record<string, unknown>> {
  await mkdir(options.videoDir, { recursive: true });
  const dynamicComposition = applyRenderOverrides(await loadComposition(dynamicFile), options);
  const staticComposition = applyRenderOverrides(await loadComposition(options.staticFile), options);
  const workerSelection = options.workers ?? 2;
  const workerWindow = options.workerWindow ?? 2;
  const baseOptions = omitUndefined({
    fps: options.fps,
    width: options.width,
    height: options.height,
    ffmpegPath: options.ffmpegPath,
    ffmpegArgsPrefix: options.ffmpegArgsPrefix
  }) as Omit<RenderOptions, "out">;
  const cases = [
    {
      name: "single-thread",
      fixture: dynamicFile,
      composition: dynamicComposition,
      options: {}
    },
    {
      name: "worker",
      fixture: dynamicFile,
      composition: dynamicComposition,
      options: { workers: workerSelection }
    },
    {
      name: "worker-window",
      fixture: dynamicFile,
      composition: dynamicComposition,
      options: { workers: workerSelection, workerWindow }
    },
    {
      name: "static-reuse",
      fixture: options.staticFile,
      composition: staticComposition,
      options: {}
    }
  ];
  const results = [];

  for (const benchmarkCase of cases) {
    const videoOut = join(options.videoDir, `${benchmarkCase.name}.mp4`);
    const renderOptions = {
      ...baseOptions,
      ...benchmarkCase.options,
      out: videoOut
    } as RenderOptions;
    const metrics = await renderVideo(benchmarkCase.composition, renderOptions, extractAudioInputs(benchmarkCase.composition));
    results.push({
      name: benchmarkCase.name,
      fixture: benchmarkCase.fixture,
      videoOut,
      metrics
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    cases: results,
    summary: summarizeBenchmarkSuite(results)
  };
}

function summarizeBenchmarkSuite(results: Array<{ name: string; metrics: Record<string, unknown> }>): Record<string, unknown> {
  return {
    totalCases: results.length,
    bestTotalMsCase: bestCaseName(results, "totalMs"),
    bestRenderWallMsCase: bestCaseName(results, "renderWallMs"),
    maxReusedFramesCase: maxCaseName(results, "reusedFrames")
  };
}

function bestCaseName(results: Array<{ name: string; metrics: Record<string, unknown> }>, metric: string): string | null {
  return numericCaseName(results, metric, (current, best) => current < best);
}

function maxCaseName(results: Array<{ name: string; metrics: Record<string, unknown> }>, metric: string): string | null {
  return numericCaseName(results, metric, (current, best) => current > best);
}

function numericCaseName(results: Array<{ name: string; metrics: Record<string, unknown> }>, metric: string, better: (current: number, best: number) => boolean): string | null {
  let bestName: string | null = null;
  let bestValue: number | undefined;
  for (const result of results) {
    const value = result.metrics[metric];
    if (typeof value !== "number") {
      continue;
    }
    if (bestValue === undefined || better(value, bestValue)) {
      bestName = result.name;
      bestValue = value;
    }
  }
  return bestName;
}

export async function renderVideo(composition: Composition, options: RenderOptions, audio: CompositionAudio = {}): Promise<Record<string, unknown>> {
  const workerSelection = options.workers === "auto" ? "auto" : "manual";
  const backend = resolveBackend(options.renderer);
  const plan = planRenderResources(composition, options.workers, options.workerWindow);
  const workerCount = plan.workerCount;
  const workerWindow = plan.workerWindow;
  const stats: RenderStats = {
    frames: 0,
    renderedFrames: 0,
    reusedFrames: 0,
    workerPoolStarts: 0,
    maxBufferedFrames: 0,
    renderWallMs: 0,
    renderCpuMs: 0,
    peakRssBytes: process.memoryUsage().rss
  };
  const startedAt = performance.now();
  const encodeOptions: EncodePngFramesOptions = {
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
    outFile: options.out,
    ffmpegArgsPrefix: options.ffmpegArgsPrefix
  };
  if (options.ffmpegPath) {
    encodeOptions.ffmpegPath = options.ffmpegPath;
  }
  if (audio.audioFile) {
    encodeOptions.audioFile = audio.audioFile;
  }
  if (audio.audioInputs && audio.audioInputs.length > 0) {
    encodeOptions.audioInputs = audio.audioInputs;
  }

  await encodeRawVideoFrames(renderCompositionRgbaFrames(composition, stats, workerCount, workerWindow, options.ffmpegPath, options.diskCacheDir, options.layerCache, backend), encodeOptions);
  stats.peakRssBytes = Math.max(stats.peakRssBytes, process.memoryUsage().rss);
  const totalMs = performance.now() - startedAt;

  return {
    pipeline: "rawvideo-rgba",
    renderer: backend,
    renderMode: workerCount > 1 ? "worker_threads" : "single_thread",
    workerSelection,
    workerCount,
    workerWindow: workerCount > 1 ? workerWindow : null,
    frames: stats.frames,
    renderedFrames: stats.renderedFrames,
    reusedFrames: stats.reusedFrames,
    workerPoolStarts: stats.workerPoolStarts,
    maxBufferedFrames: stats.maxBufferedFrames,
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
    durationMs: composition.durationMs,
    frameDurationMs: roundMs(1000 / composition.fps),
    firstFrameTimeMs: stats.frames > 0 ? 0 : null,
    lastFrameTimeMs: stats.frames > 0 ? timeForFrame(composition, stats.frames - 1) : null,
    encodedVideoDurationMs: roundMs((stats.frames / composition.fps) * 1000),
    audio: Boolean(audio.audioFile) || Boolean(audio.audioInputs?.length),
    ...summarizeAudioTimeline(audio, composition.durationMs),
    layerCache: stats.layerCache ?? null,
    renderMs: roundMs(stats.renderWallMs),
    renderWallMs: roundMs(stats.renderWallMs),
    renderCpuMs: roundMs(stats.renderCpuMs),
    encodeMs: roundMs(Math.max(0, totalMs - stats.renderWallMs)),
    totalMs: roundMs(totalMs),
    peakRssBytes: stats.peakRssBytes
  };
}

export function extractAudioInputs(composition: Composition): CompositionAudio {
  const audioInputs: AudioInput[] = [];
  collectAudioInputs(composition.layers, 0, composition.durationMs, true, audioInputs);
  if (audioInputs.length === 0) {
    return {};
  }

  return { audioInputs };
}

// Audio layers may sit inside groups; group children live on the group's
// LOCAL timeline, so nested audio is shifted by the accumulated group start
// and clamped to the group's window on the composition timeline.
function collectAudioInputs(layers: Layer[], offsetMs: number, windowEndMs: number, topLevel: boolean, out: AudioInput[]): void {
  for (const layer of layers) {
    if (layer.type === "group") {
      const groupStartMs = offsetMs + (layer.startMs ?? 0);
      const groupEndMs = Math.min(layer.endMs !== undefined ? offsetMs + layer.endMs : windowEndMs, windowEndMs);
      collectAudioInputs(layer.layers, groupStartMs, groupEndMs, false, out);
      continue;
    }
    if (layer.type !== "audio") {
      continue;
    }
    if (topLevel) {
      // Preserve the legacy pass-through shape for top-level audio (undefined
      // startMs/endMs keep their encoder defaults).
      out.push(omitUndefined({
        src: layer.src,
        startMs: layer.startMs,
        endMs: layer.endMs,
        volume: layer.volume,
        fadeInMs: layer.fadeInMs,
        fadeOutMs: layer.fadeOutMs
      }) as AudioInput);
      continue;
    }
    out.push(omitUndefined({
      src: layer.src,
      startMs: offsetMs + (layer.startMs ?? 0),
      endMs: Math.min(offsetMs + (layer.endMs ?? (windowEndMs - offsetMs)), windowEndMs),
      volume: layer.volume,
      fadeInMs: layer.fadeInMs,
      fadeOutMs: layer.fadeOutMs
    }) as AudioInput);
  }
}

async function* renderCompositionRgbaFrames(composition: Composition, stats?: RenderStats, workerCount = 1, workerWindow = workerCount * 2, ffmpegPath?: string, diskCacheDir?: string, layerCache?: boolean, backend: RendererBackend = "wasm"): AsyncIterable<Buffer> {
  if (workerCount > 1) {
    yield* renderCompositionRgbaFramesWithWorkers(composition, workerCount, workerWindow, stats, ffmpegPath, diskCacheDir, layerCache, backend);
    return;
  }

  let previousKey: string | undefined;
  let previousFrame: Buffer | undefined;
  let prefetchedUntilFrameIndex = 0;
  const totalFrames = frameCount(composition);
  const videoFrameCache = createVideoFrameCache(videoFrameCacheOptions(ffmpegPath, diskCacheDir));
  const rgbaRenderer = createBackendRenderer(backend, layerCache === false ? { layerCache: false } : {});

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const timeMs = timeForFrame(composition, frameIndex);
      const resolvedFrame = resolveFrame(composition, timeMs);
      const frameKey = visualFrameKey(resolvedFrame);

      if (previousKey === frameKey && previousFrame) {
        if (stats) {
          stats.frames += 1;
          stats.reusedFrames += 1;
          stats.peakRssBytes = Math.max(stats.peakRssBytes, process.memoryUsage().rss);
        }
        yield previousFrame;
        continue;
      }

      const startedAt = performance.now();
      if (frameIndex >= prefetchedUntilFrameIndex && frameHasVideoLayer(resolvedFrame)) {
        const prefetchEndFrameIndex = Math.min(totalFrames, frameIndex + VIDEO_PREFETCH_WINDOW_FRAMES);
        videoFrameCache.clear();
        await prefetchVideoFrameBatch(resolveFrameWindow(composition, frameIndex, prefetchEndFrameIndex, resolvedFrame), videoFrameCache);
        prefetchedUntilFrameIndex = prefetchEndFrameIndex;
      }
      const frame = await rgbaRenderer.render(resolvedFrame, { videoFrameCache });
      if (stats) {
        stats.frames += 1;
        stats.renderedFrames += 1;
        const elapsedMs = performance.now() - startedAt;
        stats.renderWallMs += elapsedMs;
        stats.renderCpuMs += elapsedMs;
        stats.peakRssBytes = Math.max(stats.peakRssBytes, process.memoryUsage().rss);
      }
      previousKey = frameKey;
      previousFrame = frame;
      yield frame;
    }
  } finally {
    if (stats) {
      const cacheStats = rgbaRenderer.layerCacheStats();
      if (cacheStats) {
        stats.layerCache = cacheStats;
      }
    }
    rgbaRenderer.dispose();
  }
}

async function* renderCompositionRgbaFramesWithWorkers(composition: Composition, workerCount: number, workerWindow: number, stats?: RenderStats, ffmpegPath?: string, diskCacheDir?: string, layerCache?: boolean, backend: RendererBackend = "wasm"): AsyncIterable<Buffer> {
  const totalFrames = frameCount(composition);
  // `workerWindow` caps how many fresh frames are buffered (memory window) per
  // dispatch; spread across up to `workerCount` contiguous runs.
  const windowFrames = workerWindow > 0 ? workerWindow : workerCount * RENDER_RUN_FRAMES;
  const runFrames = Math.min(RENDER_RUN_FRAMES, Math.max(1, Math.ceil(windowFrames / workerCount)));
  let frameIndex = 0;
  let sourceIndex = 0;
  let previousKey: string | undefined;
  let previousSourceIndex: number | undefined;
  let lastBuffer: Buffer | undefined;
  const pool = new RenderWorkerPool(Math.min(workerCount, totalFrames), stats);

  try {
    while (frameIndex < totalFrames) {
      // Build up to `workerCount` contiguous runs (one per worker), so each
      // worker batch-extracts its own slice and rasterises it in parallel.
      const runs: RenderRunJob[] = [];
      const plans: FramePlan[] = [];
      let batchFrames = 0;
      while (frameIndex < totalFrames && runs.length < workerCount && batchFrames < windowFrames) {
        const sourceIndices: number[] = [];
        const frames: ResolvedFrame[] = [];
        while (frameIndex < totalFrames && frames.length < runFrames && batchFrames < windowFrames) {
          const timeMs = timeForFrame(composition, frameIndex);
          const resolvedFrame = resolveFrame(composition, timeMs);
          const frameKey = visualFrameKey(resolvedFrame);

          if (previousKey === frameKey && previousSourceIndex !== undefined) {
            plans.push({ sourceIndex: previousSourceIndex, reused: true });
            frameIndex += 1;
            continue;
          }

          const currentSourceIndex = sourceIndex;
          sourceIndex += 1;
          batchFrames += 1;
          frames.push(resolvedFrame);
          sourceIndices.push(currentSourceIndex);
          plans.push({ sourceIndex: currentSourceIndex, reused: false });
          previousKey = frameKey;
          previousSourceIndex = currentSourceIndex;
          frameIndex += 1;
        }
        if (frames.length > 0) {
          runs.push(omitUndefined({ runIndex: runs.length, sourceIndices, frames, ffmpegPath, diskCacheDir, layerCache, backend }) as RenderRunJob);
        }
      }

      if (stats) {
        stats.maxBufferedFrames = Math.max(stats.maxBufferedFrames, runs.reduce((n, r) => n + r.frames.length, 0));
      }
      const startedAt = performance.now();
      const renderedFrames = await pool.render(runs, stats);
      if (stats) {
        stats.renderWallMs += performance.now() - startedAt;
      }

      for (const plan of plans) {
        const frame = plan.reused ? lastBuffer : renderedFrames.get(plan.sourceIndex);
        if (!frame) {
          throw new Error(`Missing rendered frame for source index ${plan.sourceIndex}`);
        }
        if (!plan.reused) {
          lastBuffer = frame;
        }
        if (stats) {
          stats.frames += 1;
          if (plan.reused) {
            stats.reusedFrames += 1;
          }
          stats.peakRssBytes = Math.max(stats.peakRssBytes, process.memoryUsage().rss);
        }
        yield frame;
      }
    }
  } finally {
    pool.terminate();
  }
}

class RenderWorkerPool {
  private readonly workers: Worker[];

  constructor(workerCount: number, stats?: RenderStats) {
    this.workers = Array.from({ length: workerCount }, () => new Worker(renderWorkerUrl()));
    if (stats && this.workers.length > 0) {
      stats.workerPoolStarts += 1;
    }
  }

  async render(jobs: RenderRunJob[], stats?: RenderStats): Promise<Map<number, Buffer>> {
    if (jobs.length === 0) {
      return new Map();
    }
    if (this.workers.length === 0) {
      throw new Error("Render worker pool has no workers");
    }

    const results = new Map<number, Buffer>();
    const byRun = new Map<number, RenderRunJob>(jobs.map((job) => [job.runIndex, job]));
    const activeWorkers = this.workers.slice(0, Math.min(this.workers.length, jobs.length));
    const handlers = new Map<Worker, {
      message: (message: RenderWorkerResponse) => void;
      error: (error: Error) => void;
      exit: (code: number) => void;
    }>();
    let nextJobIndex = 0;
    let completedJobs = 0;
    let settled = false;

    return await new Promise((resolvePool, rejectPool) => {
      const cleanup = (): void => {
        for (const [worker, handler] of handlers) {
          worker.off("message", handler.message);
          worker.off("error", handler.error);
          worker.off("exit", handler.exit);
        }
        handlers.clear();
      };
      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        rejectPool(error);
      };
      const dispatch = (worker: Worker): void => {
        const job = jobs[nextJobIndex];
        nextJobIndex += 1;
        if (!job) {
          return;
        }
        worker.postMessage(job);
      };

      for (const worker of activeWorkers) {
        const onMessage = (message: RenderWorkerResponse): void => {
          if (settled) {
            return;
          }
          if (message.error) {
            fail(new Error(message.error));
            return;
          }
          const job = byRun.get(message.runIndex);
          if (!job || !message.frames || message.frames.length !== job.sourceIndices.length) {
            fail(new Error(`Worker returned an invalid result for run ${message.runIndex}`));
            return;
          }

          for (let i = 0; i < job.sourceIndices.length; i += 1) {
            results.set(job.sourceIndices[i]!, Buffer.from(message.frames[i]!));
          }
          completedJobs += 1;
          if (stats) {
            stats.renderedFrames += job.sourceIndices.length;
            stats.renderCpuMs += message.renderMs ?? 0;
          }

          if (completedJobs === jobs.length) {
            settled = true;
            cleanup();
            resolvePool(results);
            return;
          }

          dispatch(worker);
        };
        const onError = (error: Error): void => fail(error);
        const onExit = (code: number): void => {
          if (!settled && code !== 0) {
            fail(new Error(`Render worker exited with code ${code}`));
          }
        };

        handlers.set(worker, { message: onMessage, error: onError, exit: onExit });
        worker.on("message", onMessage);
        worker.on("error", onError);
        worker.on("exit", onExit);
        dispatch(worker);
      }
    });
  }

  terminate(): void {
    for (const worker of this.workers) {
      void worker.terminate();
    }
  }
}

function summarizeAudioTimeline(audio: CompositionAudio, compositionDurationMs: number): Record<string, number | null> {
  const audioInputs = audio.audioInputs ?? (audio.audioFile ? [{ src: audio.audioFile }] : []);
  if (audioInputs.length === 0) {
    return {
      audioInputs: 0,
      audioTimelineStartMs: null,
      audioTimelineEndMs: null,
      audioTimelineDurationMs: null
    };
  }

  const starts = audioInputs.map((input) => input.startMs ?? 0);
  const ends = audioInputs.map((input) => input.endMs ?? compositionDurationMs);
  const startMs = Math.min(...starts);
  const endMs = Math.max(...ends);

  return {
    audioInputs: audioInputs.length,
    audioTimelineStartMs: startMs,
    audioTimelineEndMs: endMs,
    audioTimelineDurationMs: Math.max(0, endMs - startMs)
  };
}

function frameHasVideoLayer(frame: ResolvedFrame): boolean {
  return frame.layers.some((layer) => layer.type === "video");
}

function resolveFrameWindow(composition: Composition, startFrameIndex: number, endFrameIndex: number, firstFrame: ResolvedFrame): ResolvedFrame[] {
  const frames = [firstFrame];
  for (let frameIndex = startFrameIndex + 1; frameIndex < endFrameIndex; frameIndex += 1) {
    frames.push(resolveFrame(composition, timeForFrame(composition, frameIndex)));
  }
  return frames;
}

function visualFrameKey(frame: ReturnType<typeof resolveFrame>): string {
  return JSON.stringify({
    timeMs: hasVideoLayer(frame.layers) ? frame.timeMs : null,
    composition: frame.composition,
    layers: stripAudioLayers(frame.layers)
  });
}

// Video makes a frame time-dependent even when the resolved layer JSON is
// stable, including video nested inside groups.
function hasVideoLayer(layers: ResolvedLayer[]): boolean {
  return layers.some((layer) => layer.type === "video" || (layer.type === "group" && hasVideoLayer(layer.layers)));
}

// Audio never affects pixels, so it must not break frame reuse — strip it
// recursively before hashing.
function stripAudioLayers(layers: ResolvedLayer[]): ResolvedLayer[] {
  return layers
    .filter((layer) => layer.type !== "audio")
    .map((layer) => (layer.type === "group" ? { ...layer, layers: stripAudioLayers(layer.layers) } : layer));
}

function applyRenderOverrides(composition: Composition, options: Pick<RenderOptions, "fps" | "width" | "height">): Composition {
  return defineComposition({
    ...composition,
    fps: options.fps ?? composition.fps,
    width: options.width ?? composition.width,
    height: options.height ?? composition.height
  });
}

function parseSize(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) {
    throw new Error("--size must use WIDTHxHEIGHT, for example 1920x1080");
  }

  return {
    width: parsePositiveNumber(match[1]!, "--size width"),
    height: parsePositiveNumber(match[2]!, "--size height")
  };
}

function parsePositiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be positive`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = parsePositiveNumber(value, name);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function parseServePort(args: string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--port") {
      return parsePositiveInteger(requiredArg(args[index + 1], "--port value"), "--port");
    }
  }
  return 8787;
}

function parseWorkerSelection(value: string): WorkerSelection {
  if (value === "auto") {
    return "auto";
  }
  return parsePositiveInteger(value, "--workers");
}

function resolveWorkerCount(selection: WorkerSelection | undefined): number {
  if (selection === "auto") {
    return Math.max(1, Math.min(4, availableParallelism() - 1));
  }
  return selection ?? 1;
}

// Pick a worker count + buffer window that fit the host: scale up on a roomy
// laptop, stay within RAM on a small (e.g. 2-core / 2 GB) server so rendering
// completes smoothly instead of OOM-ing. Buffer sizing is based on the RGBA
// frame size, available memory, and core count.
export type HostResources = { cores: number; totalBytes: number; freeBytes: number };

export function planRenderResources(
  composition: Pick<Composition, "width" | "height">,
  selection: WorkerSelection | undefined,
  explicitWindow: number | undefined,
  host: HostResources = { cores: availableParallelism(), totalBytes: totalmem(), freeBytes: freemem() }
): { workerCount: number; workerWindow: number } {
  if (selection === undefined) {
    // No --workers given: keep the simple single-threaded default.
    return { workerCount: 1, workerWindow: 0 };
  }

  const cores = host.cores;
  const frameBytes = Math.max(1, composition.width * composition.height * 4);
  // Each buffered frame costs roughly: a worker extraction-cache frame, the
  // worker's rendered output, and the main-thread copy → ~3.5× the frame.
  const perFrameBytes = frameBytes * 3.5;
  const reserveBytes = 512 * 1024 * 1024; // base runtime (Node + CanvasKit + ffmpeg)
  // Budget from TOTAL ram (the OS reclaims cache; freemem under-reports
  // "available" on macOS/Linux), but never assume more than freemem + a
  // reclaimable allowance so a genuinely tight host stays safe.
  const totalBudget = host.totalBytes * 0.5;
  const freeBudget = host.freeBytes + host.totalBytes * 0.35; // free + reclaimable cache allowance
  const budgetBytes = Math.max(0, Math.min(totalBudget, freeBudget) - reserveBytes);
  const maxBufferedFrames = Math.max(1, Math.floor(budgetBytes / perFrameBytes));

  let workerCount: number;
  if (selection === "auto") {
    const coreWorkers = cores <= 2 ? cores : cores - 1; // leave a core on bigger machines
    workerCount = Math.max(1, Math.min(coreWorkers, maxBufferedFrames, 8));
  } else {
    workerCount = Math.max(1, selection);
  }

  if (workerCount <= 1) {
    return { workerCount: 1, workerWindow: 0 };
  }

  // Full batching = RENDER_RUN_FRAMES per worker; shrink to stay within memory.
  const fullWindow = workerCount * RENDER_RUN_FRAMES;
  const adaptiveWindow = Math.max(workerCount, Math.min(fullWindow, maxBufferedFrames));
  return { workerCount, workerWindow: explicitWindow ?? adaptiveWindow };
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function renderWorkerUrl(): URL {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return new URL(`./render-worker.${extension}`, import.meta.url);
}

function requiredArg(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T;
}

// Build VideoFrameCache options, omitting unset fields (exactOptionalPropertyTypes).
function videoFrameCacheOptions(ffmpegPath?: string, diskCacheDir?: string): { ffmpegPath?: string; diskCacheDir?: string } {
  const options: { ffmpegPath?: string; diskCacheDir?: string } = {};
  if (ffmpegPath) {
    options.ffmpegPath = ffmpegPath;
  }
  if (diskCacheDir) {
    options.diskCacheDir = diskCacheDir;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
