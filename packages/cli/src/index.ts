#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { encodeRawVideoFrames } from "../../encoder-ffmpeg/src/index.ts";
import type { AudioInput, EncodePngFramesOptions } from "../../encoder-ffmpeg/src/index.ts";
import { defineComposition, frameCount, resolveFrame, timeForFrame } from "../../core/src/index.ts";
import type { AudioLayer, Composition, ResolvedFrame } from "../../core/src/index.ts";
import { createRgbaFrameRenderer, createVideoFrameCache, prefetchVideoFrameBatch, renderPngFrame } from "../../renderer-skia/src/index.ts";
import { renderSvgFrame } from "../../renderer-svg/src/index.ts";

type CliIO = {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

type StillOptions = {
  t: number;
  out: string;
  format: "svg" | "png";
};

type RenderOptions = {
  out: string;
  fps?: number;
  width?: number;
  height?: number;
  ffmpegPath?: string;
  ffmpegArgsPrefix: string[];
  workers?: WorkerSelection;
  workerWindow?: number;
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
};

type CompositionAudio = {
  audioFile?: string;
  audioInputs?: AudioInput[];
};

type WorkerSelection = number | "auto";

type RenderJob = {
  sourceIndex: number;
  frame: ResolvedFrame;
  ffmpegPath?: string;
};

type FramePlan = {
  sourceIndex: number;
  reused: boolean;
};

type RenderWorkerResponse = {
  sourceIndex: number;
  frame?: Uint8Array;
  renderMs?: number;
  error?: string;
};

const VIDEO_PREFETCH_WINDOW_FRAMES = 32;

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
    workerWindow
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
    videoOut: requiredArg(videoOut, "--video-out"),
    fps,
    width,
    height,
    ffmpegPath,
    ffmpegArgsPrefix,
    workers,
    workerWindow
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

async function renderVideo(composition: Composition, options: RenderOptions, audio: CompositionAudio = {}): Promise<Record<string, unknown>> {
  const workerSelection = options.workers === "auto" ? "auto" : "manual";
  const workerCount = resolveWorkerCount(options.workers);
  const workerWindow = workerCount > 1 ? options.workerWindow ?? workerCount * 2 : 0;
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

  await encodeRawVideoFrames(renderCompositionRgbaFrames(composition, stats, workerCount, workerWindow, options.ffmpegPath), encodeOptions);
  stats.peakRssBytes = Math.max(stats.peakRssBytes, process.memoryUsage().rss);
  const totalMs = performance.now() - startedAt;

  return {
    pipeline: "rawvideo-rgba",
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
    renderMs: roundMs(stats.renderWallMs),
    renderWallMs: roundMs(stats.renderWallMs),
    renderCpuMs: roundMs(stats.renderCpuMs),
    encodeMs: roundMs(Math.max(0, totalMs - stats.renderWallMs)),
    totalMs: roundMs(totalMs),
    peakRssBytes: stats.peakRssBytes
  };
}

function extractAudioInputs(composition: Composition): CompositionAudio {
  const audioLayers = composition.layers.filter((layer): layer is AudioLayer => layer.type === "audio");
  if (audioLayers.length === 0) {
    return {};
  }

  const audioInputs = audioLayers.map((layer) => omitUndefined({
    src: layer.src,
    startMs: layer.startMs,
    endMs: layer.endMs,
    volume: layer.volume,
    fadeInMs: layer.fadeInMs,
    fadeOutMs: layer.fadeOutMs
  }) as AudioInput);

  return { audioInputs };
}

async function* renderCompositionRgbaFrames(composition: Composition, stats?: RenderStats, workerCount = 1, workerWindow = workerCount * 2, ffmpegPath?: string): AsyncIterable<Buffer> {
  if (workerCount > 1) {
    yield* renderCompositionRgbaFramesWithWorkers(composition, workerCount, workerWindow, stats, ffmpegPath);
    return;
  }

  let previousKey: string | undefined;
  let previousFrame: Buffer | undefined;
  let prefetchedUntilFrameIndex = 0;
  const totalFrames = frameCount(composition);
  const videoFrameCache = createVideoFrameCache(ffmpegPath ? { ffmpegPath } : {});
  const rgbaRenderer = createRgbaFrameRenderer();

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
    rgbaRenderer.dispose();
  }
}

async function* renderCompositionRgbaFramesWithWorkers(composition: Composition, workerCount: number, workerWindow: number, stats?: RenderStats, ffmpegPath?: string): AsyncIterable<Buffer> {
  const totalFrames = frameCount(composition);
  let frameIndex = 0;
  let sourceIndex = 0;
  let previousKey: string | undefined;
  let previousSourceIndex: number | undefined;
  const carriedFrames = new Map<number, Buffer>();
  const pool = new RenderWorkerPool(Math.min(workerCount, totalFrames), stats);

  try {
    while (frameIndex < totalFrames) {
      const jobs: RenderJob[] = [];
      const plans: FramePlan[] = [];

      while (frameIndex < totalFrames && jobs.length < workerWindow) {
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
        jobs.push(omitUndefined({ sourceIndex: currentSourceIndex, frame: resolvedFrame, ffmpegPath }) as RenderJob);
        plans.push({ sourceIndex: currentSourceIndex, reused: false });
        previousKey = frameKey;
        previousSourceIndex = currentSourceIndex;
        frameIndex += 1;
      }

      if (stats) {
        stats.maxBufferedFrames = Math.max(stats.maxBufferedFrames, jobs.length);
      }
      const startedAt = performance.now();
      const renderedFrames = await pool.render(jobs, stats);
      if (stats) {
        stats.renderWallMs += performance.now() - startedAt;
      }
      for (const [renderedSourceIndex, frame] of renderedFrames) {
        carriedFrames.set(renderedSourceIndex, frame);
      }

      let lastSourceIndex: number | undefined;
      for (const plan of plans) {
        const frame = carriedFrames.get(plan.sourceIndex);
        if (!frame) {
          throw new Error(`Missing rendered frame for source index ${plan.sourceIndex}`);
        }
        if (stats) {
          stats.frames += 1;
          if (plan.reused) {
            stats.reusedFrames += 1;
          }
          stats.peakRssBytes = Math.max(stats.peakRssBytes, process.memoryUsage().rss);
        }
        lastSourceIndex = plan.sourceIndex;
        yield frame;
      }

      for (const renderedSourceIndex of carriedFrames.keys()) {
        if (renderedSourceIndex !== lastSourceIndex) {
          carriedFrames.delete(renderedSourceIndex);
        }
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

  async render(jobs: RenderJob[], stats?: RenderStats): Promise<Map<number, Buffer>> {
    if (jobs.length === 0) {
      return new Map();
    }
    if (this.workers.length === 0) {
      throw new Error("Render worker pool has no workers");
    }

    const results = new Map<number, Buffer>();
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
          if (!message.frame) {
            fail(new Error(`Worker returned no frame for source index ${message.sourceIndex}`));
            return;
          }

          results.set(message.sourceIndex, Buffer.from(message.frame));
          completedJobs += 1;
          if (stats) {
            stats.renderedFrames += 1;
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
  const hasVideoLayer = frame.layers.some((layer) => layer.type === "video");
  return JSON.stringify({
    timeMs: hasVideoLayer ? frame.timeMs : null,
    composition: frame.composition,
    layers: frame.layers.filter((layer) => layer.type !== "audio")
  });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
