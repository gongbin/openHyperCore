import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import { createRgbaFrameRenderer, createVideoFrameCache, renderPngFrame, renderRgbaFrame } from "../src/index.ts";

test("renderPngFrame emits a PNG buffer for resolved text and shapes", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 320,
    height: 180,
    durationMs: 1000,
    layers: [
      {
        type: "shape",
        shape: "rect",
        width: 320,
        height: 180,
        fill: "#18202a"
      },
      {
        type: "text",
        text: "PNG",
        size: 42,
        color: "#ffffff",
        transform: { x: 24, y: 72 }
      },
      {
        type: "shape",
        shape: "circle",
        radius: 20,
        fill: "#2ec4b6",
        transform: { x: 220, y: 64 }
      }
    ]
  });

  const png = await renderPngFrame(resolveFrame(composition, 0));

  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 100);
});

test("renderRgbaFrame emits width x height x 4 raw bytes", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 4,
    height: 3,
    durationMs: 1000,
    layers: [
      {
        type: "shape",
        shape: "rect",
        width: 4,
        height: 3,
        fill: "#ff0000"
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));

  assert.ok(Buffer.isBuffer(rgba));
  assert.equal(rgba.length, 4 * 3 * 4);
  assert.deepEqual([...rgba.subarray(0, 4)], [255, 0, 0, 255]);
});

test("renderRgbaFrame draws visible text glyphs", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 96,
    height: 48,
    durationMs: 1000,
    layers: [
      {
        type: "text",
        text: "TEXT",
        size: 28,
        color: "#ffffff",
        transform: { x: 4, y: 34 }
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const paintedPixels = countPixelsWithAlpha(rgba);

  assert.ok(paintedPixels > 0);
});

test("RgbaFrameRenderer reuses a renderer across frames", async () => {
  const composition = defineComposition({
    fps: 2,
    width: 4,
    height: 3,
    durationMs: 1000,
    layers: [
      {
        type: "shape",
        shape: "rect",
        width: 4,
        height: 3,
        fill: "#ff0000"
      },
      {
        type: "shape",
        shape: "rect",
        width: 4,
        height: 3,
        fill: "#0000ff",
        transform: {
          opacity: [
            { timeMs: 0, value: 0 },
            { timeMs: 500, value: 1 }
          ]
        }
      }
    ]
  });
  const renderer = createRgbaFrameRenderer();

  try {
    const first = await renderer.render(resolveFrame(composition, 0));
    const second = await renderer.render(resolveFrame(composition, 500));

    assert.equal(first.length, 4 * 3 * 4);
    assert.equal(second.length, 4 * 3 * 4);
    assert.notDeepEqual([...first.subarray(0, 4)], [...second.subarray(0, 4)]);
  } finally {
    renderer.dispose();
  }
});

test("renderRgbaFrame draws a CaptionLayer background", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 24,
    height: 16,
    durationMs: 1000,
    layers: [
      {
        type: "caption",
        text: "Hi",
        size: 12,
        color: "#ffffff",
        backgroundColor: "#ff0000",
        padding: 0,
        transform: { x: 0, y: 12 }
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));

  assert.equal(rgba.length, 24 * 16 * 4);
  assert.deepEqual([...rgba.subarray(0, 4)], [255, 0, 0, 255]);
});

test("renderRgbaFrame draws a VideoLayer frame extracted with ffmpeg", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-video-layer-"));
  const videoFile = join(dir, "red.mp4");
  const generated = spawnSync(ffmpeg.path, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=4x3:d=1:r=1",
    "-frames:v",
    "1",
    "-pix_fmt",
    "yuv420p",
    videoFile
  ], { encoding: "utf8" });

  assert.equal(generated.status, 0, generated.stderr);

  const composition = defineComposition({
    fps: 1,
    width: 4,
    height: 3,
    durationMs: 1000,
    layers: [
      {
        type: "video",
        src: videoFile,
        width: 4,
        height: 3
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));

  assert.equal(rgba.length, 4 * 3 * 4);
  assert.ok(rgba[0]! > 180);
  assert.ok(rgba[1]! < 80);
  assert.ok(rgba[2]! < 80);
  assert.equal(rgba[3], 255);
});

test("VideoFrameCache reuses extracted frames for the same video time", async () => {
  const { cache, countFile, videoFile } = await createFakeVideoFrameCache();

  const first = await cache.getFrame(videoFile, 250);
  const second = await cache.getFrame(videoFile, 250);
  const count = await readFile(countFile, "utf8");

  assert.equal(first, second);
  assert.equal(count, "x");
});

test("VideoFrameCache prefetch stores frames for later rendering", async () => {
  const { cache, countFile, videoFile } = await createFakeVideoFrameCache();

  await cache.prefetch(videoFile, 500);
  await cache.getFrame(videoFile, 500);
  const count = await readFile(countFile, "utf8");

  assert.equal(count, "x");
});

test("VideoFrameCache prefetchFrames batches sequential video times", async () => {
  const { cache, countFile, videoFile } = await createFakeVideoFrameCache();

  await cache.prefetchFrames(videoFile, [0, 500, 1000]);
  await cache.getFrame(videoFile, 0);
  await cache.getFrame(videoFile, 500);
  await cache.getFrame(videoFile, 1000);
  const count = await readFile(countFile, "utf8");

  assert.equal(count, "x");
});

test("renderRgbaFrame shares cached VideoLayer frames within a render task", async () => {
  const { cache, countFile, videoFile } = await createFakeVideoFrameCache();
  const composition = defineComposition({
    fps: 1,
    width: 4,
    height: 3,
    durationMs: 1000,
    layers: [
      {
        type: "video",
        src: videoFile,
        width: 4,
        height: 3
      },
      {
        type: "video",
        src: videoFile,
        width: 4,
        height: 3
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0), { videoFrameCache: cache });
  const count = await readFile(countFile, "utf8");

  assert.equal(rgba.length, 4 * 3 * 4);
  assert.equal(count, "x");
});

async function createFakeVideoFrameCache() {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-video-cache-"));
  const videoFile = join(dir, "clip.mp4");
  const fakeFfmpeg = join(dir, "fake-ffmpeg.mjs");
  const countFile = join(dir, "count.txt");

  await writeFile(videoFile, "fake video", "utf8");
  await writeFile(countFile, "", "utf8");
  await writeFile(
    fakeFfmpeg,
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(countFile)}, "x");
const framesIndex = process.argv.indexOf("-frames:v");
const frames = framesIndex >= 0 ? Number(process.argv[framesIndex + 1]) : 1;
const png = Buffer.from(${JSON.stringify(redPngBase64)}, "base64");
for (let index = 0; index < frames; index += 1) {
  process.stdout.write(png);
}
`,
    "utf8"
  );

  return {
    cache: createVideoFrameCache({
      ffmpegPath: process.execPath,
      ffmpegArgsPrefix: [fakeFfmpeg]
    }),
    countFile,
    videoFile
  };
}

const redPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lRY6mAAAAABJRU5ErkJggg==";

function countPixelsWithAlpha(rgba: Buffer): number {
  let count = 0;
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] !== 0) {
      count += 1;
    }
  }
  return count;
}
