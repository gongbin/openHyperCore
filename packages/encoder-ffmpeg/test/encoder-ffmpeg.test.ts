import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImagePipeArgs, buildRawVideoPipeArgs, encodePngFrames, encodeRawVideoFrames, resolveDefaultFfmpegPath } from "../src/index.ts";

test("buildImagePipeArgs creates no-audio H.264 MP4 args from piped PNG frames", () => {
  const args = buildImagePipeArgs({
    fps: 24,
    width: 640,
    height: 360,
    outFile: "/tmp/out.mp4"
  });

  assert.deepEqual(args, [
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    "24",
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "/tmp/out.mp4"
  ]);
});

test("buildRawVideoPipeArgs creates no-audio H.264 MP4 args from piped RGBA frames", () => {
  const args = buildRawVideoPipeArgs({
    fps: 24,
    width: 640,
    height: 360,
    outFile: "/tmp/out.mp4"
  });

  assert.deepEqual(args, [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    "640x360",
    "-framerate",
    "24",
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "/tmp/out.mp4"
  ]);
});

test("buildRawVideoPipeArgs adds a single audio input and AAC output when audioFile is set", () => {
  const args = buildRawVideoPipeArgs({
    fps: 24,
    width: 640,
    height: 360,
    outFile: "/tmp/out.mp4",
    audioFile: "/tmp/music.wav"
  });

  assert.deepEqual(args, [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    "640x360",
    "-framerate",
    "24",
    "-i",
    "pipe:0",
    "-i",
    "/tmp/music.wav",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    "/tmp/out.mp4"
  ]);
});

test("buildRawVideoPipeArgs maps multiple audio inputs through timing, volume, and amix filters", () => {
  const args = buildRawVideoPipeArgs({
    fps: 24,
    width: 640,
    height: 360,
    outFile: "/tmp/out.mp4",
    audioInputs: [
      { src: "/tmp/a.wav", startMs: 500, endMs: 2500, volume: 0.25 },
      { src: "/tmp/b.wav", startMs: 0, volume: 1.5 }
    ]
  });

  assert.deepEqual(args, [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    "640x360",
    "-framerate",
    "24",
    "-i",
    "pipe:0",
    "-i",
    "/tmp/a.wav",
    "-i",
    "/tmp/b.wav",
    "-filter_complex",
    "[1:a]atrim=duration=2,asetpts=PTS-STARTPTS,volume=0.25,adelay=500|500[a0];[2:a]asetpts=PTS-STARTPTS,volume=1.5[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0,apad[aout]",
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    "/tmp/out.mp4"
  ]);
});

test("buildRawVideoPipeArgs maps audio fadeInMs and fadeOutMs to afade filters", () => {
  const args = buildRawVideoPipeArgs({
    fps: 24,
    width: 640,
    height: 360,
    outFile: "/tmp/out.mp4",
    audioInputs: [
      { src: "/tmp/a.wav", startMs: 500, endMs: 2500, volume: 0.25, fadeInMs: 300, fadeOutMs: 400 }
    ]
  });

  assert.deepEqual(args, [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    "640x360",
    "-framerate",
    "24",
    "-i",
    "pipe:0",
    "-i",
    "/tmp/a.wav",
    "-filter_complex",
    "[1:a]atrim=duration=2,asetpts=PTS-STARTPTS,volume=0.25,afade=t=in:st=0:d=0.3,afade=t=out:st=1.6:d=0.4,adelay=500|500[a0];[a0]apad[aout]",
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    "/tmp/out.mp4"
  ]);
});

test("buildRawVideoPipeArgs builds a piecewise-linear volume envelope from keyframes", () => {
  const args = buildRawVideoPipeArgs({
    fps: 24,
    width: 640,
    height: 360,
    outFile: "/tmp/out.mp4",
    audioInputs: [
      { src: "/tmp/a.wav", volume: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }, { timeMs: 2000, value: 0.2 }] }
    ]
  });

  const graph = args[args.indexOf("-filter_complex") + 1]!;
  assert.equal(
    graph,
    "[1:a]asetpts=PTS-STARTPTS,volume='if(lt(t,0),0,if(lt(t,1),(0+(1)*(t-0)/(1)),if(lt(t,2),(1+(-0.8)*(t-1)/(1)),0.2)))':eval=frame[a0];[a0]apad[aout]"
  );
});

test("buildRawVideoPipeArgs rejects negative volume", () => {
  assert.throws(
    () => buildRawVideoPipeArgs({
      fps: 24,
      width: 640,
      height: 360,
      outFile: "/tmp/out.mp4",
      audioInputs: [{ src: "/tmp/a.wav", volume: -1 }]
    }),
    /audio volume must be non-negative/
  );
});

test("buildRawVideoPipeArgs requires endMs when fadeOutMs is set", () => {
  assert.throws(
    () => buildRawVideoPipeArgs({
      fps: 24,
      width: 640,
      height: 360,
      outFile: "/tmp/out.mp4",
      audioInputs: [
        { src: "/tmp/a.wav", fadeOutMs: 400 }
      ]
    }),
    /audio fadeOutMs requires endMs/
  );
});

test("encodePngFrames pipes each PNG frame to the configured ffmpeg process", async () => {
  const { fakeFfmpeg, argsFile, stdinFile, outFile } = await createFakeFfmpeg();

  await encodePngFrames([Buffer.from("one"), Buffer.from("two")], {
    ffmpegPath: process.execPath,
    ffmpegArgsPrefix: [fakeFfmpeg],
    fps: 30,
    width: 320,
    height: 180,
    outFile
  });

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  const stdin = await readFile(stdinFile);
  const out = await stat(outFile);
  assert.deepEqual(args.slice(0, 3), ["-y", "-f", "image2pipe"]);
  assert.equal(stdin.toString(), "onetwo");
  assert.ok(out.size > 0);
});

test("encodeRawVideoFrames pipes raw RGBA bytes to the configured ffmpeg process", async () => {
  const { fakeFfmpeg, argsFile, stdinFile, outFile } = await createFakeFfmpeg();

  await encodeRawVideoFrames([Buffer.from([1, 2, 3, 4]), Buffer.from([5, 6, 7, 8])], {
    ffmpegPath: process.execPath,
    ffmpegArgsPrefix: [fakeFfmpeg],
    fps: 30,
    width: 1,
    height: 1,
    outFile
  });

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  const stdin = await readFile(stdinFile);
  const out = await stat(outFile);
  assert.deepEqual(args.slice(0, 5), ["-y", "-f", "rawvideo", "-pix_fmt", "rgba"]);
  assert.deepEqual([...stdin], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(out.size > 0);
});

test("encodeRawVideoFrames passes audio input args when audioFile is set", async () => {
  const { fakeFfmpeg, argsFile, outFile } = await createFakeFfmpeg();

  await encodeRawVideoFrames([Buffer.from([1, 2, 3, 4])], {
    ffmpegPath: process.execPath,
    ffmpegArgsPrefix: [fakeFfmpeg],
    fps: 30,
    width: 1,
    height: 1,
    outFile,
    audioFile: "/tmp/music.wav"
  });

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  assert.ok(args.includes("/tmp/music.wav"));
  assert.ok(args.includes("-c:a"));
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("-shortest"));
});

test("encodeRawVideoFrames passes mixed audio input args when audioInputs are set", async () => {
  const { fakeFfmpeg, argsFile, outFile } = await createFakeFfmpeg();

  await encodeRawVideoFrames([Buffer.from([1, 2, 3, 4])], {
    ffmpegPath: process.execPath,
    ffmpegArgsPrefix: [fakeFfmpeg],
    fps: 30,
    width: 1,
    height: 1,
    outFile,
    audioInputs: [
      { src: "/tmp/a.wav", startMs: 500, endMs: 2500, volume: 0.25 },
      { src: "/tmp/b.wav", volume: 1.5 }
    ]
  });

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  assert.ok(args.includes("/tmp/a.wav"));
  assert.ok(args.includes("/tmp/b.wav"));
  assert.ok(args.includes("-filter_complex"));
  assert.ok(args.some((arg: string) => arg.includes("[a0][a1]amix=inputs=2:duration=longest:normalize=0,apad[aout]")));
});

test("resolveDefaultFfmpegPath returns the installer binary when available", async () => {
  const ffmpegPath = await resolveDefaultFfmpegPath();

  assert.match(ffmpegPath, /ffmpeg/);
});

async function createFakeFfmpeg(): Promise<{ fakeFfmpeg: string; argsFile: string; stdinFile: string; outFile: string }> {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-ffmpeg-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const outFile = join(dir, "out.mp4");
  const argsFile = join(dir, "args.json");
  const stdinFile = join(dir, "stdin.bin");
  await writeFile(
    fakeFfmpeg,
    `import { createWriteStream, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
const stream = createWriteStream(${JSON.stringify(stdinFile)});
process.stdin.pipe(stream);
process.stdin.on("end", () => {
  writeFileSync(process.argv[process.argv.length - 1], "fake mp4");
});
`,
    "utf8"
  );

  return { fakeFfmpeg, argsFile, stdinFile, outFile };
}

test("buildRawVideoPipeArgs maps video-sourced audio through source trim + atempo", () => {
  const args = buildRawVideoPipeArgs({
    fps: 30,
    width: 640,
    height: 360,
    outFile: "/tmp/out.mp4",
    audioInputs: [
      { src: "/tmp/clip.mp4", startMs: 1000, endMs: 3000, sourceStartMs: 500, playbackRate: 2, volume: 0.8 }
    ]
  });

  const filter = args[args.indexOf("-filter_complex") + 1]!;
  // Source window = sourceStart .. sourceStart + duration·rate, compressed by atempo.
  assert.equal(
    filter,
    "[1:a]atrim=start=0.5:end=4.5,asetpts=PTS-STARTPTS,atempo=2,volume=0.8,adelay=1000|1000[a0];[a0]apad[aout]"
  );
});

test("buildRawVideoPipeArgs chains atempo for rates outside 0.5–2", () => {
  const args = buildRawVideoPipeArgs({
    fps: 30,
    width: 640,
    height: 360,
    outFile: "/tmp/out.mp4",
    audioInputs: [
      { src: "/tmp/clip.mp4", startMs: 0, endMs: 1000, playbackRate: 0.25 }
    ]
  });

  const filter = args[args.indexOf("-filter_complex") + 1]!;
  assert.ok(filter.includes("atempo=0.5,atempo=0.5"), filter);
});
