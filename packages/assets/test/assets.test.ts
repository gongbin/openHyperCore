import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetProbeCache, createAssetProbeCache, probeAsset } from "../src/index.ts";

test("probeAsset parses ffprobe JSON for video metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-assets-"));
  const src = join(dir, "clip.mp4");
  const fakeFfprobe = join(dir, "fake-ffprobe.mjs");
  const argsFile = join(dir, "args.json");

  await writeFile(src, "fake video", "utf8");
  await writeFile(
    fakeFfprobe,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.5" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, duration: "2.5" },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, duration: "2.5" }
  ]
}));
`,
    "utf8"
  );

  const metadata = await probeAsset(src, { ffprobePath: process.execPath, ffprobeArgsPrefix: [fakeFfprobe] });
  const args = JSON.parse(await readFile(argsFile, "utf8"));

  assert.ok(args.includes("-show_streams"));
  assert.ok(args.includes("-show_format"));
  assert.equal(metadata.kind, "video");
  assert.equal(metadata.src, src);
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
  assert.equal(metadata.durationMs, 2500);
  assert.deepEqual(metadata.video, { codec: "h264", width: 1920, height: 1080 });
  assert.deepEqual(metadata.audio, { codec: "aac", sampleRate: 48000, channels: 2 });
});

test("probeAsset classifies still image streams as images", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-assets-"));
  const src = join(dir, "frame.png");
  const fakeFfprobe = join(dir, "fake-ffprobe.mjs");

  await writeFile(src, "fake png", "utf8");
  await writeFile(
    fakeFfprobe,
    `console.log(JSON.stringify({
  format: { format_name: "png_pipe" },
  streams: [
    { codec_type: "video", codec_name: "png", width: 320, height: 180 }
  ]
}));
`,
    "utf8"
  );

  const metadata = await probeAsset(src, { ffprobePath: process.execPath, ffprobeArgsPrefix: [fakeFfprobe] });

  assert.equal(metadata.kind, "image");
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 180);
  assert.equal(metadata.durationMs, undefined);
  assert.equal(metadata.audio, undefined);
});

test("AssetProbeCache reuses metadata for the same task file key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-assets-"));
  const src = join(dir, "music.wav");
  const fakeFfprobe = join(dir, "fake-ffprobe.mjs");
  const countFile = join(dir, "count.txt");
  const cache = createAssetProbeCache();

  await writeFile(src, "fake audio", "utf8");
  await writeFile(countFile, "", "utf8");
  await writeFile(
    fakeFfprobe,
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(countFile)}, "x");
console.log(JSON.stringify({
  format: { format_name: "wav", duration: "1.25" },
  streams: [
    { codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "44100", channels: 1, duration: "1.25" }
  ]
}));
`,
    "utf8"
  );

  const first = await cache.probe(src, { kind: "audio", ffprobePath: process.execPath, ffprobeArgsPrefix: [fakeFfprobe] });
  const second = await cache.probe(src, { kind: "audio", ffprobePath: process.execPath, ffprobeArgsPrefix: [fakeFfprobe] });
  const count = await readFile(countFile, "utf8");

  assert.equal(first, second);
  assert.equal(first.kind, "audio");
  assert.equal(first.durationMs, 1250);
  assert.deepEqual(first.audio, { codec: "pcm_s16le", sampleRate: 44100, channels: 1 });
  assert.equal(count, "x");
});

test("AssetProbeCache can be constructed directly", () => {
  const cache = new AssetProbeCache();

  assert.equal(cache.size, 0);
  cache.clear();
  assert.equal(cache.size, 0);
});
