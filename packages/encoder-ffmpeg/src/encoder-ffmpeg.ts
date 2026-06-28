import { spawn } from "node:child_process";
import { once } from "node:events";

export type ImagePipeArgsOptions = {
  fps: number;
  width: number;
  height: number;
  outFile: string;
  audioFile?: string;
  audioInputs?: AudioInput[];
};

// A volume automation point (time relative to the audio's own start).
export type VolumePoint = { timeMs: number; value: number };

export type AudioInput = {
  src: string;
  startMs?: number;
  endMs?: number;
  // Constant gain, or a piecewise-linear envelope (keyframes) for ducking/swells.
  volume?: number | VolumePoint[];
  fadeInMs?: number;
  fadeOutMs?: number;
};

export type EncodePngFramesOptions = ImagePipeArgsOptions & {
  ffmpegPath?: string;
  ffmpegArgsPrefix?: string[];
};

export type EncodeRawVideoFramesOptions = EncodePngFramesOptions;

export function buildImagePipeArgs(options: ImagePipeArgsOptions): string[] {
  assertPositive("fps", options.fps);
  assertPositive("width", options.width);
  assertPositive("height", options.height);
  const audioInputs = normalizeAudioInputs(options);

  return [
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(options.fps),
    "-i",
    "pipe:0",
    ...audioInputArgs(audioInputs),
    ...audioFilterArgs(audioInputs),
    ...codecArgs(audioInputs),
    "-movflags",
    "+faststart",
    options.outFile
  ];
}

export function buildRawVideoPipeArgs(options: ImagePipeArgsOptions): string[] {
  assertPositive("fps", options.fps);
  assertPositive("width", options.width);
  assertPositive("height", options.height);
  const audioInputs = normalizeAudioInputs(options);

  return [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${options.width}x${options.height}`,
    "-framerate",
    String(options.fps),
    "-i",
    "pipe:0",
    ...audioInputArgs(audioInputs),
    ...audioFilterArgs(audioInputs),
    ...codecArgs(audioInputs),
    "-movflags",
    "+faststart",
    options.outFile
  ];
}

export async function encodePngFrames(frames: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options: EncodePngFramesOptions): Promise<void> {
  await encodeFramesWithArgs(frames, options, buildImagePipeArgs(options));
}

export async function encodeRawVideoFrames(frames: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options: EncodeRawVideoFramesOptions): Promise<void> {
  await encodeFramesWithArgs(frames, options, buildRawVideoPipeArgs(options));
}

async function encodeFramesWithArgs(frames: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options: EncodePngFramesOptions, pipeArgs: string[]): Promise<void> {
  const ffmpegPath = options.ffmpegPath ?? await resolveDefaultFfmpegPath();
  const args = [...(options.ffmpegArgsPrefix ?? []), ...pipeArgs];
  const child = spawn(ffmpegPath, args, {
    stdio: ["pipe", "ignore", "pipe"]
  });

  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  try {
    for await (const frame of frames) {
      await writeChunk(child.stdin, frame);
    }
    child.stdin.end();
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  const [exitCode, signal] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    const suffix = stderr ? `: ${stderr}` : signal ? `: signal ${signal}` : "";
    throw new Error(`ffmpeg exited with code ${exitCode}${suffix}`);
  }
}

export async function resolveDefaultFfmpegPath(): Promise<string> {
  try {
    const ffmpegInstaller = await import("@ffmpeg-installer/ffmpeg");
    const candidate = (ffmpegInstaller.default as { path?: unknown } | undefined)?.path ?? (ffmpegInstaller as { path?: unknown }).path;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  } catch {
    // Fall back to PATH for environments that provide a system ffmpeg.
  }

  return "ffmpeg";
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: Uint8Array): Promise<void> {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function normalizeAudioInputs(options: ImagePipeArgsOptions): AudioInput[] {
  if (options.audioInputs && options.audioInputs.length > 0) {
    return options.audioInputs;
  }

  return options.audioFile ? [{ src: options.audioFile }] : [];
}

function audioInputArgs(audioInputs: AudioInput[]): string[] {
  return audioInputs.flatMap((audio) => ["-i", audio.src]);
}

function audioFilterArgs(audioInputs: AudioInput[]): string[] {
  const needsFilterGraph = audioInputs.some((audio) => (
    audio.startMs !== undefined
    || audio.endMs !== undefined
    || audio.volume !== undefined
    || audio.fadeInMs !== undefined
    || audio.fadeOutMs !== undefined
  )) || audioInputs.length > 1;
  if (!needsFilterGraph) {
    return [];
  }

  const chains = audioInputs.map((audio, index) => {
    const inputIndex = index + 1;
    const filters = audioFilters(audio);
    return `[${inputIndex}:a]${filters.join(",")}[a${index}]`;
  });

  // Pad the mixed audio with trailing silence so a track that ends before the
  // (finite, piped) video never becomes the "-shortest" stream and truncates
  // the rendered video. The video pipe stays authoritative for output length.
  const output = audioInputs.length === 1
    ? "[a0]apad[aout]"
    : `${audioInputs.map((_, index) => `[a${index}]`).join("")}amix=inputs=${audioInputs.length}:duration=longest:normalize=0,apad[aout]`;

  return ["-filter_complex", [...chains, output].join(";"), "-map", "0:v:0", "-map", "[aout]"];
}

function audioFilters(audio: AudioInput): string[] {
  const filters: string[] = [];
  const durationMs = audio.endMs !== undefined ? audio.endMs - (audio.startMs ?? 0) : undefined;
  if (durationMs !== undefined) {
    assertPositive("audio duration", durationMs);
    filters.push(`atrim=duration=${formatSeconds(durationMs / 1000)}`);
  }
  filters.push("asetpts=PTS-STARTPTS");
  if (audio.volume !== undefined) {
    const filter = volumeFilter(audio.volume);
    if (filter) {
      filters.push(filter);
    }
  }
  if (audio.fadeInMs !== undefined) {
    assertPositive("audio fadeInMs", audio.fadeInMs);
    filters.push(`afade=t=in:st=0:d=${formatSeconds(audio.fadeInMs / 1000)}`);
  }
  if (audio.fadeOutMs !== undefined) {
    assertPositive("audio fadeOutMs", audio.fadeOutMs);
    if (durationMs === undefined) {
      throw new Error("audio fadeOutMs requires endMs");
    }
    const fadeOutStartMs = Math.max(0, durationMs - audio.fadeOutMs);
    filters.push(`afade=t=out:st=${formatSeconds(fadeOutStartMs / 1000)}:d=${formatSeconds(audio.fadeOutMs / 1000)}`);
  }
  if (audio.startMs !== undefined && audio.startMs > 0) {
    const delayMs = Math.round(audio.startMs);
    filters.push(`adelay=${delayMs}|${delayMs}`);
  }
  return filters;
}

// Build the `volume` filter for a constant gain or a keyframe envelope. A
// single number is a static gain; an array becomes a per-frame-evaluated
// piecewise-linear envelope expression. `t` is seconds from the audio's start
// (the filter runs after asetpts, before adelay).
function volumeFilter(volume: number | VolumePoint[]): string | undefined {
  if (typeof volume === "number") {
    assertNonNegative("audio volume", volume);
    return `volume=${formatNumber(volume)}`;
  }

  const points = volume
    .filter((point) => Number.isFinite(point.timeMs) && Number.isFinite(point.value))
    .map((point) => ({ t: Math.max(0, point.timeMs) / 1000, v: point.value }))
    .sort((a, b) => a.t - b.t);
  for (const point of points) {
    assertNonNegative("audio volume", point.v);
  }
  if (points.length === 0) {
    return undefined;
  }
  if (points.length === 1) {
    return `volume=${formatNumber(points[0]!.v)}`;
  }
  // Single-quote the expression so its commas/parens aren't parsed as filter
  // separators inside -filter_complex.
  return `volume='${buildVolumeExpr(points)}':eval=frame`;
}

function buildVolumeExpr(points: Array<{ t: number; v: number }>): string {
  let expr = formatNumber(points[points.length - 1]!.v);
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segment = a.v === b.v
      ? formatNumber(a.v)
      : `(${formatNumber(a.v)}+(${formatNumber(b.v - a.v)})*(t-${formatNumber(a.t)})/(${formatNumber(b.t - a.t)}))`;
    expr = `if(lt(t,${formatNumber(b.t)}),${segment},${expr})`;
  }
  const first = points[0]!;
  return `if(lt(t,${formatNumber(first.t)}),${formatNumber(first.v)},${expr})`;
}

function codecArgs(audioInputs: AudioInput[]): string[] {
  const videoArgs = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
  if (audioInputs.length === 0) {
    return ["-an", ...videoArgs];
  }

  return [...videoArgs, "-c:a", "aac", "-shortest"];
}

function formatSeconds(value: number): string {
  return formatNumber(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}
