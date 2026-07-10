import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { extractAudioInputs, planRenderResources, runCli } from "../src/index.ts";
import { defineComposition } from "../../core/src/index.ts";

test("runCli probe returns composition metadata JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const compositionFile = join(dir, "video.ts");
  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({ fps: 25, width: 320, height: 180, durationMs: 2000, layers: [] });
`,
    "utf8"
  );

  const output: string[] = [];
  await runCli(["probe", compositionFile], { stdout: (line) => output.push(line) });

  const json = JSON.parse(output.join("\n"));
  assert.equal(json.fps, 25);
  assert.equal(json.frames, 50);
});

test("runCli still writes an SVG frame", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const compositionFile = join(dir, "video.ts");
  const outFile = join(dir, "frame.svg");
  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 30,
  width: 320,
  height: 180,
  durationMs: 1000,
  layers: [{ type: "text", text: "CLI", size: 32, color: "#111" }]
});
`,
    "utf8"
  );

  await runCli(["still", compositionFile, "--t", "0.5", "--out", outFile], { stdout: () => undefined });

  const info = await stat(outFile);
  const svg = await readFile(outFile, "utf8");
  assert.ok(info.size > 0);
  assert.match(svg, /CLI/);
});

test("runCli still writes a PNG frame when --format png is used", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const compositionFile = join(dir, "video.ts");
  const outFile = join(dir, "frame.png");
  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 30,
  width: 320,
  height: 180,
  durationMs: 1000,
  layers: [
    { type: "shape", shape: "rect", width: 320, height: 180, fill: "#101820" },
    { type: "text", text: "PNG", size: 32, color: "#fff", transform: { x: 20, y: 64 } }
  ]
});
`,
    "utf8"
  );

  await runCli(["still", compositionFile, "--t", "0.5", "--out", outFile, "--format", "png"], { stdout: () => undefined });

  const png = await readFile(outFile);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 100);
});

test("runCli render writes an MP4 through the configured ffmpeg path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const argsFile = join(dir, "args.json");
  const compositionFile = join(dir, "video.ts");
  const outFile = join(dir, "video.mp4");

  await writeFile(
    fakeFfmpeg,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 160,
  height: 90,
  durationMs: 1000,
  layers: [{ type: "shape", shape: "rect", width: 160, height: 90, fill: "#101820" }]
});
`,
    "utf8"
  );

  await runCli(
    ["render", compositionFile, "--out", outFile, "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  const out = await stat(outFile);
  assert.ok(args.includes("-framerate"));
  assert.ok(args.includes("2"));
  assert.ok(args.includes("rawvideo"));
  assert.ok(args.includes("rgba"));
  assert.ok(out.size > 0);
});

test("runCli render applies --fps and --size overrides to ffmpeg rawvideo args", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const argsFile = join(dir, "args.json");
  const stdinFile = join(dir, "stdin.bin");
  const compositionFile = join(dir, "video.ts");
  const outFile = join(dir, "video.mp4");

  await writeFile(
    fakeFfmpeg,
    `import { createWriteStream, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
const stream = createWriteStream(${JSON.stringify(stdinFile)});
process.stdin.pipe(stream);
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 160,
  height: 90,
  durationMs: 1000,
  layers: [{ type: "shape", shape: "rect", width: 4, height: 4, fill: "#101820" }]
});
`,
    "utf8"
  );

  await runCli(
    ["render", compositionFile, "--out", outFile, "--fps", "4", "--size", "8x6", "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  const stdin = await readFile(stdinFile);
  assert.ok(args.includes("4"));
  assert.ok(args.includes("8x6"));
  assert.equal(stdin.length, 4 * 8 * 6 * 4);
});

test("runCli bench writes render and encode timing metrics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const compositionFile = join(dir, "video.ts");
  const reportFile = join(dir, "bench.json");
  const videoFile = join(dir, "bench.mp4");

  await writeFile(
    fakeFfmpeg,
    `import { writeFileSync } from "node:fs";
process.stdin.resume();
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 8,
  height: 6,
  durationMs: 1000,
  layers: [{ type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" }]
});
`,
    "utf8"
  );

  await runCli(
    ["bench", compositionFile, "--out", reportFile, "--video-out", videoFile, "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const report = JSON.parse(await readFile(reportFile, "utf8"));
  assert.equal(report.frames, 2);
  assert.equal(report.width, 8);
  assert.equal(report.height, 6);
  assert.equal(report.pipeline, "rawvideo-rgba");
  assert.equal(report.durationMs, 1000);
  assert.equal(report.frameDurationMs, 500);
  assert.equal(report.firstFrameTimeMs, 0);
  assert.equal(report.lastFrameTimeMs, 500);
  assert.equal(report.encodedVideoDurationMs, 1000);
  assert.equal(typeof report.renderMs, "number");
  assert.equal(typeof report.renderWallMs, "number");
  assert.equal(typeof report.renderCpuMs, "number");
  assert.equal(report.renderMs, report.renderWallMs);
  assert.ok(report.renderCpuMs >= report.renderWallMs);
  assert.equal(typeof report.encodeMs, "number");
  assert.equal(typeof report.totalMs, "number");
  assert.equal(typeof report.peakRssBytes, "number");
  assert.equal(report.renderedFrames, 1);
  assert.equal(report.reusedFrames, 1);
  assert.equal(report.audioInputs, 0);
});

test("runCli bench writes audio timeline metrics for AudioLayers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const compositionFile = join(dir, "video.ts");
  const reportFile = join(dir, "bench.json");
  const videoFile = join(dir, "bench.mp4");
  const audioA = join(dir, "a.wav");
  const audioB = join(dir, "b.wav");

  await writeFile(audioA, "fake wav a", "utf8");
  await writeFile(audioB, "fake wav b", "utf8");
  await writeFile(
    fakeFfmpeg,
    `import { writeFileSync } from "node:fs";
process.stdin.resume();
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 4,
  width: 8,
  height: 6,
  durationMs: 1250,
  layers: [
    { type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" },
    { type: "audio", src: ${JSON.stringify(audioA)}, startMs: 250, endMs: 1000, volume: 0.5 },
    { type: "audio", src: ${JSON.stringify(audioB)}, startMs: 500, endMs: 1250, volume: 0.75 }
  ]
});
`,
    "utf8"
  );

  await runCli(
    ["bench", compositionFile, "--out", reportFile, "--video-out", videoFile, "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const report = JSON.parse(await readFile(reportFile, "utf8"));
  assert.equal(report.frames, 5);
  assert.equal(report.durationMs, 1250);
  assert.equal(report.frameDurationMs, 250);
  assert.equal(report.firstFrameTimeMs, 0);
  assert.equal(report.lastFrameTimeMs, 1000);
  assert.equal(report.encodedVideoDurationMs, 1250);
  assert.equal(report.audio, true);
  assert.equal(report.audioInputs, 2);
  assert.equal(report.audioTimelineStartMs, 250);
  assert.equal(report.audioTimelineEndMs, 1250);
  assert.equal(report.audioTimelineDurationMs, 1000);
});

test("runCli bench does not reuse active VideoLayer frames across time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-video-"));
  const videoSource = join(dir, "source.mp4");
  const compositionFile = join(dir, "video.ts");
  const reportFile = join(dir, "bench.json");
  const videoFile = join(dir, "bench.mp4");
  const generated = spawnSync(ffmpeg.path, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=4x4:rate=2:duration=1",
    "-pix_fmt",
    "yuv420p",
    videoSource
  ], { encoding: "utf8" });

  assert.equal(generated.status, 0, generated.stderr);
  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 4,
  height: 4,
  durationMs: 1000,
  layers: [{ type: "video", src: ${JSON.stringify(videoSource)}, width: 4, height: 4 }]
});
`,
    "utf8"
  );

  await runCli(
    ["bench", compositionFile, "--out", reportFile, "--video-out", videoFile, "--ffmpeg-path", ffmpeg.path],
    { stdout: () => undefined }
  );

  const report = JSON.parse(await readFile(reportFile, "utf8"));
  assert.equal(report.frames, 2);
  assert.equal(report.renderedFrames, 2);
  assert.equal(report.reusedFrames, 0);
});

test("runCli bench renders non-reused frames through a worker pool when --workers is set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const compositionFile = join(dir, "video.ts");
  const reportFile = join(dir, "bench.json");
  const videoFile = join(dir, "bench.mp4");

  await writeFile(
    fakeFfmpeg,
    `import { createWriteStream, writeFileSync } from "node:fs";
const stream = createWriteStream(${JSON.stringify(join(dir, "stdin.bin"))});
process.stdin.pipe(stream);
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 8,
  height: 6,
  durationMs: 1000,
  layers: [
    { type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" },
    { type: "shape", shape: "circle", radius: 2, fill: "#f2aa4c", transform: { x: [{ timeMs: 0, value: 1 }, { timeMs: 500, value: 3 }], y: 1 } }
  ]
});
`,
    "utf8"
  );

  await runCli(
    ["bench", compositionFile, "--out", reportFile, "--video-out", videoFile, "--workers", "2", "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const report = JSON.parse(await readFile(reportFile, "utf8"));
  assert.equal(report.workerCount, 2);
  assert.equal(report.renderMode, "worker_threads");
  assert.equal(report.frames, 2);
  assert.equal(report.renderedFrames, 2);
  assert.equal(report.reusedFrames, 0);
  assert.equal(typeof report.renderWallMs, "number");
  assert.equal(typeof report.renderCpuMs, "number");
  assert.equal(report.renderMs, report.renderWallMs);
  assert.ok(report.renderCpuMs >= 0);
});

test("runCli bench limits worker buffered frames when --worker-window is set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const compositionFile = join(dir, "video.ts");
  const reportFile = join(dir, "bench.json");
  const videoFile = join(dir, "bench.mp4");

  await writeFile(
    fakeFfmpeg,
    `import { writeFileSync } from "node:fs";
process.stdin.resume();
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 10,
  width: 8,
  height: 6,
  durationMs: 1000,
  layers: [
    { type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" },
    { type: "shape", shape: "circle", radius: 2, fill: "#f2aa4c", transform: { x: [{ timeMs: 0, value: 1 }, { timeMs: 1000, value: 6 }], y: 1 } }
  ]
});
`,
    "utf8"
  );

  await runCli(
    ["bench", compositionFile, "--out", reportFile, "--video-out", videoFile, "--workers", "2", "--worker-window", "3", "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const report = JSON.parse(await readFile(reportFile, "utf8"));
  assert.equal(report.workerCount, 2);
  assert.equal(report.workerWindow, 3);
  assert.equal(report.frames, 10);
  assert.equal(report.renderedFrames, 10);
  assert.equal(report.workerPoolStarts, 1);
  assert.ok(report.maxBufferedFrames <= 3);
});

test("runCli bench resolves --workers auto to a positive worker count", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const compositionFile = join(dir, "video.ts");
  const reportFile = join(dir, "bench.json");
  const videoFile = join(dir, "bench.mp4");

  await writeFile(
    fakeFfmpeg,
    `import { writeFileSync } from "node:fs";
process.stdin.resume();
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 8,
  height: 6,
  durationMs: 500,
  layers: [{ type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" }]
});
`,
    "utf8"
  );

  await runCli(
    ["bench", compositionFile, "--out", reportFile, "--video-out", videoFile, "--workers", "auto", "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const report = JSON.parse(await readFile(reportFile, "utf8"));
  assert.equal(report.workerSelection, "auto");
  assert.equal(Number.isInteger(report.workerCount), true);
  assert.ok(report.workerCount >= 1);
});

test("runCli bench-suite writes comparison metrics for benchmark variants", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-suite-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const dynamicComposition = join(dir, "dynamic.ts");
  const staticComposition = join(dir, "static.ts");
  const reportFile = join(dir, "suite.json");
  const videoDir = join(dir, "videos");

  await writeFile(
    fakeFfmpeg,
    `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
process.stdin.resume();
process.stdin.on("end", () => {
  const out = process.argv[process.argv.length - 1];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, "fake mp4");
});
`,
    "utf8"
  );

  await writeFile(
    dynamicComposition,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 4,
  width: 8,
  height: 6,
  durationMs: 1000,
  layers: [
    { type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" },
    { type: "shape", shape: "circle", radius: 2, fill: "#f2aa4c", transform: { x: [{ timeMs: 0, value: 1 }, { timeMs: 1000, value: 6 }], y: 1 } }
  ]
});
`,
    "utf8"
  );

  await writeFile(
    staticComposition,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 4,
  width: 8,
  height: 6,
  durationMs: 1000,
  layers: [
    { type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" },
    { type: "text", text: "Static", size: 8, color: "#ffffff", transform: { x: 1, y: 5 } }
  ]
});
`,
    "utf8"
  );

  await runCli(
    [
      "bench-suite",
      dynamicComposition,
      "--static",
      staticComposition,
      "--out",
      reportFile,
      "--video-dir",
      videoDir,
      "--workers",
      "2",
      "--worker-window",
      "2",
      "--ffmpeg-path",
      process.execPath,
      "--ffmpeg-arg-prefix",
      fakeFfmpeg
    ],
    { stdout: () => undefined }
  );

  const report = JSON.parse(await readFile(reportFile, "utf8"));
  assert.equal(report.version, 1);
  assert.deepEqual(report.cases.map((entry: { name: string }) => entry.name), [
    "single-thread",
    "worker",
    "worker-window",
    "static-reuse"
  ]);
  assert.equal(report.cases[0].metrics.renderMode, "single_thread");
  assert.equal(report.cases[1].metrics.renderMode, "worker_threads");
  assert.equal(report.cases[2].metrics.workerWindow, 2);
  assert.ok(report.cases[3].metrics.reusedFrames > 0);
  assert.equal(report.summary.totalCases, 4);
  assert.equal(typeof report.summary.bestTotalMsCase, "string");
  assert.ok((await stat(join(videoDir, "single-thread.mp4"))).size > 0);
});

test("runCli render passes the first AudioLayer source to ffmpeg as AAC audio", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const argsFile = join(dir, "args.json");
  const compositionFile = join(dir, "video.ts");
  const audioFile = join(dir, "tone.wav");
  const outFile = join(dir, "video.mp4");

  await writeFile(audioFile, "fake wav", "utf8");
  await writeFile(
    fakeFfmpeg,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 8,
  height: 6,
  durationMs: 1000,
  layers: [
    { type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" },
    { type: "audio", src: ${JSON.stringify(audioFile)} }
  ]
});
`,
    "utf8"
  );

  await runCli(
    ["render", compositionFile, "--out", outFile, "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  assert.ok(args.includes(audioFile));
  assert.ok(args.includes("-c:a"));
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("-shortest"));
});

test("runCli render maps multiple AudioLayers with start, end, and volume into ffmpeg filters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const argsFile = join(dir, "args.json");
  const compositionFile = join(dir, "video.ts");
  const audioA = join(dir, "a.wav");
  const audioB = join(dir, "b.wav");
  const outFile = join(dir, "video.mp4");

  await writeFile(audioA, "fake wav a", "utf8");
  await writeFile(audioB, "fake wav b", "utf8");
  await writeFile(
    fakeFfmpeg,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 8,
  height: 6,
  durationMs: 1000,
  layers: [
    { type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" },
    { type: "audio", src: ${JSON.stringify(audioA)}, startMs: 500, endMs: 2500, volume: 0.25 },
    { type: "audio", src: ${JSON.stringify(audioB)}, volume: 1.5 }
  ]
});
`,
    "utf8"
  );

  await runCli(
    ["render", compositionFile, "--out", outFile, "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  assert.ok(args.includes(audioA));
  assert.ok(args.includes(audioB));
  assert.ok(args.includes("-filter_complex"));
  assert.ok(args.some((arg: string) => arg.includes("[a0][a1]amix=inputs=2:duration=longest:normalize=0,apad[aout]")));
});

test("runCli render maps AudioLayer fadeInMs and fadeOutMs into ffmpeg filters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-cli-"));
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const argsFile = join(dir, "args.json");
  const compositionFile = join(dir, "video.ts");
  const audioFile = join(dir, "tone.wav");
  const outFile = join(dir, "video.mp4");

  await writeFile(audioFile, "fake wav", "utf8");
  await writeFile(
    fakeFfmpeg,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on("end", () => writeFileSync(process.argv[process.argv.length - 1], "fake mp4"));
`,
    "utf8"
  );

  await writeFile(
    compositionFile,
    `import { defineComposition } from "${pathToFileURL(process.cwd() + "/packages/core/src/index.ts").href}";
export default defineComposition({
  fps: 2,
  width: 8,
  height: 6,
  durationMs: 1000,
  layers: [
    { type: "shape", shape: "rect", width: 8, height: 6, fill: "#101820" },
    { type: "audio", src: ${JSON.stringify(audioFile)}, startMs: 500, endMs: 2500, volume: 0.25, fadeInMs: 300, fadeOutMs: 400 }
  ]
});
`,
    "utf8"
  );

  await runCli(
    ["render", compositionFile, "--out", outFile, "--ffmpeg-path", process.execPath, "--ffmpeg-arg-prefix", fakeFfmpeg],
    { stdout: () => undefined }
  );

  const args = JSON.parse(await readFile(argsFile, "utf8"));
  assert.ok(args.includes("-filter_complex"));
  assert.ok(args.some((arg: string) => arg.includes("afade=t=in:st=0:d=0.3")));
  assert.ok(args.some((arg: string) => arg.includes("afade=t=out:st=1.6:d=0.4")));
});

test("planRenderResources adapts worker count and buffer window to the host", () => {
  const GB = 1024 ** 3;
  const frameBytes = 1920 * 1080 * 4 * 3.5;

  // small 2-core / 2 GB server: few workers, buffer must stay well within RAM
  const small = planRenderResources({ width: 1920, height: 1080 }, "auto", undefined, { cores: 2, totalBytes: 2 * GB, freeBytes: 1 * GB });
  assert.ok(small.workerCount <= 2);
  assert.ok(small.workerWindow * frameBytes < 1 * GB);

  // roomy 10-core / 32 GB laptop: scales up for speed
  const big = planRenderResources({ width: 1920, height: 1080 }, "auto", undefined, { cores: 10, totalBytes: 32 * GB, freeBytes: 8 * GB });
  assert.ok(big.workerCount >= 4);
  assert.ok(big.workerCount > small.workerCount);
  assert.ok(big.workerWindow >= small.workerWindow);

  // explicit --workers / --worker-window are honoured
  const fixed = planRenderResources({ width: 1280, height: 720 }, 4, 12, { cores: 8, totalBytes: 16 * GB, freeBytes: 8 * GB });
  assert.equal(fixed.workerCount, 4);
  assert.equal(fixed.workerWindow, 12);

  // no --workers selection stays single-threaded
  const none = planRenderResources({ width: 1280, height: 720 }, undefined, undefined, { cores: 8, totalBytes: 16 * GB, freeBytes: 8 * GB });
  assert.equal(none.workerCount, 1);
  assert.equal(none.workerWindow, 0);
});

test("extractAudioInputs muxes a video layer's embedded audio track", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-vidaudio-"));
  const withAudio = join(dir, "with-audio.mp4");
  const silent = join(dir, "silent.mp4");
  // 1s test clip with a sine audio track, and one without any audio stream.
  const gen1 = spawnSync(ffmpeg.path, [
    "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", withAudio
  ]);
  const gen2 = spawnSync(ffmpeg.path, [
    "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", silent
  ]);
  assert.equal(gen1.status, 0, String(gen1.stderr));
  assert.equal(gen2.status, 0, String(gen2.stderr));

  const composition = defineComposition({
    fps: 10,
    width: 64,
    height: 64,
    durationMs: 1000,
    layers: [
      { type: "video", src: withAudio, startMs: 200, trimStartMs: 100, playbackRate: 2, volume: 0.5 },
      { type: "video", src: silent },
      { type: "video", src: withAudio, volume: 0 }
    ]
  });

  const audio = await extractAudioInputs(composition);
  assert.equal(audio.audioInputs?.length, 1);
  const input = audio.audioInputs![0]!;
  assert.equal(input.src, withAudio);
  assert.equal(input.startMs, 200);
  assert.equal(input.endMs, 1000);
  assert.equal(input.sourceStartMs, 100);
  assert.equal(input.playbackRate, 2);
  assert.equal(input.volume, 0.5);
});
