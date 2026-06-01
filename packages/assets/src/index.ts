import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

export type AssetKind = "image" | "video" | "audio";

export type AssetVideoMetadata = {
  codec?: string;
  width?: number;
  height?: number;
};

export type AssetAudioMetadata = {
  codec?: string;
  sampleRate?: number;
  channels?: number;
};

export type AssetProbeMetadata = {
  src: string;
  kind: AssetKind;
  durationMs?: number;
  width?: number;
  height?: number;
  format?: string;
  video?: AssetVideoMetadata;
  audio?: AssetAudioMetadata;
};

export type ProbeAssetOptions = {
  kind?: AssetKind;
  ffprobePath?: string;
  ffprobeArgsPrefix?: string[];
};

type FfprobeJson = {
  format?: {
    format_name?: unknown;
    duration?: unknown;
  };
  streams?: FfprobeStream[];
};

type FfprobeStream = {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  duration?: unknown;
  sample_rate?: unknown;
  channels?: unknown;
};

const imageExtensions = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp"
]);

export class AssetProbeCache {
  readonly #entries = new Map<string, Promise<AssetProbeMetadata>>();

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  async probe(src: string, options: ProbeAssetOptions = {}): Promise<AssetProbeMetadata> {
    const key = await buildCacheKey(src, options.kind);
    const cached = this.#entries.get(key);
    if (cached) {
      return cached;
    }

    const pending = probeAsset(src, options).catch((error: unknown) => {
      this.#entries.delete(key);
      throw error;
    });
    this.#entries.set(key, pending);
    return pending;
  }
}

export function createAssetProbeCache(): AssetProbeCache {
  return new AssetProbeCache();
}

export async function probeAsset(src: string, options: ProbeAssetOptions = {}): Promise<AssetProbeMetadata> {
  const resolvedSrc = resolve(src);
  const ffprobePath = options.ffprobePath ?? await resolveDefaultFfprobePath();
  const args = [
    ...(options.ffprobeArgsPrefix ?? []),
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    resolvedSrc
  ];
  const output = await runFfprobe(ffprobePath, args);
  const data = parseFfprobeJson(output);
  return normalizeProbeMetadata(resolvedSrc, data, options.kind);
}

async function buildCacheKey(src: string, kind: AssetKind | undefined): Promise<string> {
  const resolvedSrc = resolve(src);
  const info = await stat(resolvedSrc);
  return [
    kind ?? "auto",
    resolvedSrc,
    info.size,
    info.mtimeMs
  ].join("|");
}

async function runFfprobe(ffprobePath: string, args: string[]): Promise<string> {
  const child = spawn(ffprobePath, args, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const [exitCode, signal] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    const suffix = stderr ? `: ${stderr}` : signal ? `: signal ${signal}` : "";
    throw new Error(`ffprobe exited with code ${exitCode}${suffix}`);
  }

  return Buffer.concat(stdoutChunks).toString("utf8");
}

function parseFfprobeJson(output: string): FfprobeJson {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("not an object");
    }
    return parsed as FfprobeJson;
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeProbeMetadata(src: string, data: FfprobeJson, requestedKind: AssetKind | undefined): AssetProbeMetadata {
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const videoStream = streams.find((stream) => stringValue(stream.codec_type) === "video");
  const audioStream = streams.find((stream) => stringValue(stream.codec_type) === "audio");
  const format = stringValue(data.format?.format_name);
  const durationMs = durationFrom(data.format?.duration, videoStream?.duration, audioStream?.duration);
  const width = intValue(videoStream?.width);
  const height = intValue(videoStream?.height);
  const kind = requestedKind ?? inferKind(src, durationMs, videoStream, audioStream);
  const metadata: AssetProbeMetadata = { src, kind };

  if (durationMs !== undefined) {
    metadata.durationMs = durationMs;
  }
  if (width !== undefined) {
    metadata.width = width;
  }
  if (height !== undefined) {
    metadata.height = height;
  }
  if (format !== undefined) {
    metadata.format = format;
  }
  if (videoStream) {
    metadata.video = buildVideoMetadata(videoStream, width, height);
  }
  if (audioStream) {
    metadata.audio = buildAudioMetadata(audioStream);
  }

  return metadata;
}

function buildVideoMetadata(stream: FfprobeStream, width: number | undefined, height: number | undefined): AssetVideoMetadata {
  const metadata: AssetVideoMetadata = {};
  const codec = stringValue(stream.codec_name);
  if (codec !== undefined) {
    metadata.codec = codec;
  }
  if (width !== undefined) {
    metadata.width = width;
  }
  if (height !== undefined) {
    metadata.height = height;
  }
  return metadata;
}

function buildAudioMetadata(stream: FfprobeStream): AssetAudioMetadata {
  const metadata: AssetAudioMetadata = {};
  const codec = stringValue(stream.codec_name);
  const sampleRate = intValue(stream.sample_rate);
  const channels = intValue(stream.channels);
  if (codec !== undefined) {
    metadata.codec = codec;
  }
  if (sampleRate !== undefined) {
    metadata.sampleRate = sampleRate;
  }
  if (channels !== undefined) {
    metadata.channels = channels;
  }
  return metadata;
}

function inferKind(src: string, durationMs: number | undefined, videoStream: FfprobeStream | undefined, audioStream: FfprobeStream | undefined): AssetKind {
  if (videoStream) {
    if (imageExtensions.has(extname(src).toLowerCase()) || (durationMs === undefined && !audioStream)) {
      return "image";
    }
    return "video";
  }

  if (audioStream) {
    return "audio";
  }

  throw new Error(`ffprobe did not report image, video, or audio streams: ${src}`);
}

function durationFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed !== undefined && parsed >= 0) {
      return Math.round(parsed * 1000);
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function intValue(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed === undefined ? undefined : Math.round(parsed);
}

async function resolveDefaultFfprobePath(): Promise<string> {
  try {
    const ffmpegInstaller = await import("@ffmpeg-installer/ffmpeg");
    const ffmpegPath = (ffmpegInstaller.default as { path?: unknown } | undefined)?.path ?? (ffmpegInstaller as { path?: unknown }).path;
    if (typeof ffmpegPath === "string" && ffmpegPath.length > 0) {
      const extension = process.platform === "win32" ? ".exe" : "";
      const candidate = join(dirname(ffmpegPath), `ffprobe${extension}`);
      await access(candidate);
      return candidate;
    }
  } catch {
    // Fall back to PATH when the installer does not ship ffprobe for this platform.
  }

  return "ffprobe";
}
