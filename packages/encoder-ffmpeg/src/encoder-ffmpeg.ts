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

export type AudioInput = {
  src: string;
  startMs?: number;
  endMs?: number;
  volume?: number;
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

  const output = audioInputs.length === 1
    ? "[a0]anull[aout]"
    : `${audioInputs.map((_, index) => `[a${index}]`).join("")}amix=inputs=${audioInputs.length}:duration=longest:normalize=0[aout]`;

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
    assertPositive("audio volume", audio.volume);
    filters.push(`volume=${formatNumber(audio.volume)}`);
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

function codecArgs(audioInputs: AudioInput[]): string[] {
  const videoArgs = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
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
