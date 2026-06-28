import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import { LayerRasterCache, clearFontRegistry, createFrameRenderer, createRgbaFrameRenderer, createVideoFrameCache, registerFont, renderPngFrame, renderRgbaFrame, videoTimeForLayer } from "../src/index.ts";
import type { ResolvedLayer } from "../../core/src/index.ts";

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

test("registerFont resolves a named font, falling back when unavailable", async (t) => {
  t.after(() => clearFontRegistry());
  // A registered name that points at a missing file must fall back to the
  // default typeface rather than throwing — text still renders.
  registerFont("title", "/openhypercore/does-not-exist.ttf");
  const composition = defineComposition({
    fps: 30,
    width: 96,
    height: 48,
    durationMs: 1000,
    layers: [
      { type: "text", text: "TEXT", size: 28, color: "#ffffff", font: "title", transform: { x: 4, y: 34 } }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  assert.ok(countPixelsWithAlpha(rgba) > 0);
});

test("renderRgbaFrame renders mixed text and emoji without throwing", async () => {
  // Emoji fall through the font stack to the emoji/default fallback; the
  // primary glyphs still draw regardless of whether an emoji font is present.
  const composition = defineComposition({
    fps: 30,
    width: 128,
    height: 48,
    durationMs: 1000,
    layers: [
      { type: "text", text: "Hi 😀", size: 28, color: "#ffffff", transform: { x: 4, y: 34 } }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  assert.equal(rgba.length, 128 * 48 * 4);
  assert.ok(countPixelsWithAlpha(rgba) > 0);
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

test("renderRgbaFrame wraps a CaptionLayer onto multiple lines within maxWidth", async () => {
  const size = 10;
  const padding = 2;
  const lineHeight = 12;
  const composition = defineComposition({
    fps: 30,
    width: 48,
    height: 32,
    durationMs: 1000,
    layers: [
      {
        type: "caption",
        text: "AA BB",
        size,
        lineHeight,
        padding,
        color: "#ffffff",
        backgroundColor: "#ff0000",
        maxWidth: 20,
        transform: { x: 4, y: 14 }
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const pixel = (x: number, y: number) => rgba.subarray((y * 48 + x) * 4, (y * 48 + x) * 4 + 4);
  // With two wrapped lines the red background spans two line-heights, so a
  // background pixel well below the first line (row 26) is still red. A single
  // line's background (height ~16) would leave that row transparent.
  assert.deepEqual([...pixel(10, 26)], [255, 0, 0, 255]);
  // ...and the row beyond both lines is transparent again.
  assert.equal(pixel(10, 30)[3], 0);
});

test("renderRgbaFrame letterboxes an ImageLayer with fit: contain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openhyper-image-fit-"));
  const imageFile = join(dir, "red.png");
  // A wide 4x2 red source drawn into a 4x4 box. With "contain" the source
  // keeps its 2:1 aspect, so it occupies the middle two rows and the top/
  // bottom rows stay transparent (letterbox).
  const generated = spawnSync(ffmpeg.path, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=4x2:d=1",
    "-frames:v",
    "1",
    imageFile
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);

  const composition = defineComposition({
    fps: 1,
    width: 4,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "image", src: imageFile, width: 4, height: 4, fit: "contain" }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  assert.equal(rgba.length, 4 * 4 * 4);
  // Top-left pixel (row 0) is letterbox → transparent.
  assert.equal(rgba[3], 0);
  // A pixel in the centred band (row 2) is opaque red.
  const center = (2 * 4 + 1) * 4;
  assert.ok(rgba[center]! > 180);
  assert.equal(rgba[center + 3], 255);
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

test("VideoFrameCache prefetchRgbaFrames batches raw RGBA video times", async () => {
  const { cache, countFile, videoFile } = await createFakeVideoFrameCache();

  await cache.prefetchRgbaFrames(videoFile, [0, 500, 1000], 2, 2);
  const first = await cache.getRgbaFrame(videoFile, 0, 2, 2);
  const second = await cache.getRgbaFrame(videoFile, 500, 2, 2);
  const third = await cache.getRgbaFrame(videoFile, 1000, 2, 2);
  const count = await readFile(countFile, "utf8");

  assert.equal(first.pixels.length, 2 * 2 * 4);
  assert.equal(second.pixels.length, 2 * 2 * 4);
  assert.equal(third.pixels.length, 2 * 2 * 4);
  assert.deepEqual([...first.pixels.subarray(0, 4)], [255, 0, 0, 255]);
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

test("VideoFrameCache persists RGBA frames to a shared disk cache across instances", async () => {
  const { makeCache, dir, countFile, videoFile } = await createFakeVideoFrameCache();
  const diskCacheDir = join(dir, "frame-cache");

  // First instance decodes and persists the frame to disk.
  const warm = makeCache({ diskCacheDir });
  const first = await warm.getRgbaFrame(videoFile, 0, 2, 2);
  assert.equal(await readFile(countFile, "utf8"), "x");

  // A fresh instance with a cold in-memory map reads the frame from disk
  // instead of invoking ffmpeg again (count stays "x").
  const cold = makeCache({ diskCacheDir });
  const second = await cold.getRgbaFrame(videoFile, 0, 2, 2);
  assert.equal(await readFile(countFile, "utf8"), "x");

  assert.deepEqual([...second.pixels], [...first.pixels]);
  assert.equal(second.width, 2);
  assert.equal(second.height, 2);
});

test("VideoFrameCache batch prefetch reuses disk-cached frames across instances", async () => {
  const { makeCache, dir, countFile, videoFile } = await createFakeVideoFrameCache();
  const diskCacheDir = join(dir, "frame-cache");

  const warm = makeCache({ diskCacheDir });
  await warm.prefetchRgbaFrames(videoFile, [0, 500, 1000], 2, 2);
  assert.equal(await readFile(countFile, "utf8"), "x");

  // A cold instance finds every frame on disk, so no new ffmpeg pass runs.
  const cold = makeCache({ diskCacheDir });
  await cold.prefetchRgbaFrames(videoFile, [0, 500, 1000], 2, 2);
  const frame = await cold.getRgbaFrame(videoFile, 500, 2, 2);
  assert.equal(await readFile(countFile, "utf8"), "x");
  assert.equal(frame.pixels.length, 2 * 2 * 4);
});

test("VideoFrameCache preserves batch order when some disk cached frames are missing", async () => {
  const { makeCache, dir, countFile, videoFile } = await createFakeVideoFrameCache();
  const diskCacheDir = join(dir, "frame-cache");

  const warm = makeCache({ diskCacheDir });
  await warm.getRgbaFrame(videoFile, 500, 2, 2);
  assert.equal(await readFile(countFile, "utf8"), "x");

  const cold = makeCache({ diskCacheDir });
  await cold.prefetchRgbaFrames(videoFile, [0, 500, 1000], 2, 2);
  assert.equal(await readFile(countFile, "utf8"), "xx");
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
if (process.argv.includes("null")) {
  process.stderr.write("Stream #0:0: Video: h264, yuv420p, 2x2, 25 fps\\n");
  process.exit(0);
}
appendFileSync(${JSON.stringify(countFile)}, "x");
const framesIndex = process.argv.indexOf("-frames:v");
const frames = framesIndex >= 0 ? Number(process.argv[framesIndex + 1]) : 1;
if (process.argv.includes("rawvideo")) {
  const scaleArg = process.argv.find((arg) => arg.includes("scale=")) ?? "scale=1:1";
  const match = /scale=(\\d+):(\\d+)/.exec(scaleArg);
  const width = match ? Number(match[1]) : 1;
  const height = match ? Number(match[2]) : 1;
  const frame = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < frame.length; offset += 4) {
    frame[offset] = 255;
    frame[offset + 3] = 255;
  }
  for (let index = 0; index < frames; index += 1) {
    process.stdout.write(frame);
  }
  process.exit(0);
}
const png = Buffer.from(${JSON.stringify(redPngBase64)}, "base64");
for (let index = 0; index < frames; index += 1) {
  process.stdout.write(png);
}
`,
    "utf8"
  );

  const makeCache = (extra: { diskCacheDir?: string } = {}) => createVideoFrameCache({
    ffmpegPath: process.execPath,
    ffmpegArgsPrefix: [fakeFfmpeg],
    ...extra
  });

  return {
    cache: makeCache(),
    makeCache,
    dir,
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

test("group layers composite children with a shared transform and group opacity", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#000000" },
      {
        type: "group",
        startMs: 0,
        transform: { x: 4, opacity: 0.5 },
        layers: [
          // Two fully overlapping red rects: with saveLayer semantics the
          // group still composites at 50%, not 75% (no double blending).
          { type: "shape", shape: "rect", width: 4, height: 4, fill: "#ff0000" },
          { type: "shape", shape: "rect", width: 4, height: 4, fill: "#ff0000" }
        ]
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));

  // Left half: untouched black background.
  assert.deepEqual([...rgba.subarray(0, 3)], [0, 0, 0]);
  // Right half (shifted by the group transform): red at 50% over black.
  const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
  const [r, g, b] = px(6, 2);
  assert.ok(Math.abs(r! - 128) <= 2, `expected ~128 red, got ${r}`);
  assert.equal(g, 0);
  assert.equal(b, 0);
});

test("createFrameRenderer returns the wasm backend by default and rejects native until built", async () => {
  const renderer = createFrameRenderer();
  try {
    const composition = defineComposition({
      fps: 30,
      width: 4,
      height: 4,
      durationMs: 100,
      layers: [{ type: "shape", shape: "rect", width: 4, height: 4, fill: "#ffffff" }]
    });
    const rgba = await renderer.render(resolveFrame(composition, 0));
    assert.equal(rgba.length, 4 * 4 * 4);
    assert.deepEqual([...rgba.subarray(0, 4)], [255, 255, 255, 255]);
  } finally {
    renderer.dispose();
  }
  assert.throws(() => createFrameRenderer({ backend: "native" }), /native renderer backend is not available/);
});

test("a layer clip masks content outside the clip region", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#000000" },
      // Full-width red rect clipped to the left half — only x<4 should be red.
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#ff0000", clip: { type: "rect", width: 4, height: 4 } }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
  assert.deepEqual(px(1, 2), [255, 0, 0], "inside clip: red");
  assert.deepEqual(px(6, 2), [0, 0, 0], "outside clip: untouched black");
});

test("a path clip masks any layer to an arbitrary region", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#000000" },
      // Triangle clip in the top-left corner: (0,0)->(8,0)->(0,4).
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#00ff00", clip: { type: "path", path: "M0 0 L8 0 L0 4 Z" } }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
  // Top-left is inside the triangle, bottom-right is outside it.
  assert.deepEqual(px(1, 0), [0, 255, 0], "inside triangle: green");
  assert.deepEqual(px(7, 3), [0, 0, 0], "outside triangle: untouched black");
});

test("a linear gradient fill ramps across a shape", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 1,
    durationMs: 1000,
    layers: [
      {
        type: "shape",
        shape: "rect",
        width: 8,
        height: 1,
        fill: { type: "linear", from: [0, 0], to: [8, 0], stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] }
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const red = (x: number) => rgba[x * 4]!;
  assert.ok(red(0) < 40, `left edge dark, got ${red(0)}`);
  assert.ok(red(7) > 215, `right edge light, got ${red(7)}`);
  assert.ok(red(4) > 100 && red(4) < 180, `midpoint grey, got ${red(4)}`);
});

test("blend mode 'add' sums overlapping layers", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 4,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 4, height: 4, fill: "#000000" },
      { type: "shape", shape: "rect", width: 4, height: 4, fill: "#ff0000" },
      { type: "shape", shape: "rect", width: 4, height: 4, fill: "#00ff00", blendMode: "add" }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const px = (x: number, y: number) => [...rgba.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 3)];
  assert.deepEqual(px(2, 2), [255, 255, 0], "red + green = yellow");
});

test("a full-layer blur bleeds a group beyond its footprint", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 16,
    height: 4,
    durationMs: 1000,
    layers: [
      {
        type: "group",
        blur: 4,
        layers: [{ type: "shape", shape: "rect", width: 4, height: 4, fill: "#ffffff" }]
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const alpha = (x: number, y: number) => rgba[(y * 16 + x) * 4 + 3]!;
  assert.ok(alpha(2, 2) > 0, "inside the rect: opaque");
  assert.ok(alpha(6, 2) > 0, "2px past the edge: blur bleed");
  assert.ok(alpha(2, 2) > alpha(6, 2), "denser inside than in the bleed");
  assert.equal(alpha(14, 2), 0, "far away: untouched");
});

test("motion blur smears a layer along its direction", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 16,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 2, height: 2, fill: "#ffffff", transform: { x: 7, y: 1 }, motionBlur: { angle: 0, distance: 8, samples: 8 } }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  // Read the alpha channel: pixels are unpremultiplied, so white's RGB stays
  // 255 regardless of coverage — only alpha reflects the accumulated smear.
  // The un-blurred 2px rect sits at x≈7..9; motion blur spreads it across the
  // travel with partial coverage and softens the original footprint.
  const val = (x: number, y: number) => rgba[(y * 16 + x) * 4 + 3]!;
  assert.ok(val(4, 2) > 0 && val(4, 2) < 255, `smeared left of centre, got ${val(4, 2)}`);
  assert.ok(val(11, 2) > 0 && val(11, 2) < 255, `smeared right of centre, got ${val(11, 2)}`);
  assert.ok(val(8, 2) < 255, "centre softened: energy spread across the smear");
  assert.equal(val(0, 2), 0, "before the smear: untouched");
  assert.equal(val(15, 2), 0, "beyond the smear: untouched");
});

test("videoTimeForLayer maps trim, playbackRate and loop", () => {
  const base = { type: "video", src: "x.mp4", startMs: 1000, transform: {} } as unknown as Extract<ResolvedLayer, { type: "video" }>;
  // Plain trim offset: source = elapsed + trimStart.
  assert.equal(videoTimeForLayer({ ...base, trimStartMs: 500 }, 1200), 700);
  // 2x speed consumes source twice as fast.
  assert.equal(videoTimeForLayer({ ...base, trimStartMs: 0, playbackRate: 2 }, 1300), 600);
  // Half speed.
  assert.equal(videoTimeForLayer({ ...base, playbackRate: 0.5 }, 3000), 1000);
  // Loop wraps within [trimStart, trimEnd]: elapsed=800 → raw 900 → wrap into
  // the 500ms window [100,600] → 400.
  assert.equal(videoTimeForLayer({ ...base, trimStartMs: 100, trimEndMs: 600, loop: true }, 1800), 400);
  // Before start clamps to 0 elapsed.
  assert.equal(videoTimeForLayer({ ...base, trimStartMs: 200 }, 500), 200);
});

test("group reveal wipe clips children to the swept region", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#0000ff" },
      {
        type: "group",
        reveal: { type: "wipe", direction: "from-left", width: 8, height: 4, progress: 0.5 },
        layers: [{ type: "shape", shape: "rect", width: 8, height: 4, fill: "#ff0000" }]
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
  // Left half revealed red; right half still the blue backdrop.
  assert.deepEqual(px(1, 2), [255, 0, 0]);
  assert.deepEqual(px(6, 2), [0, 0, 255]);
});

test("group reveal clock wipe sweeps a wedge from 12 o'clock", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 8,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 8, height: 8, fill: "#0000ff" },
      {
        type: "group",
        reveal: { type: "clock", width: 8, height: 8, progress: 0.25 },
        layers: [{ type: "shape", shape: "rect", width: 8, height: 8, fill: "#ff0000" }]
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
  // progress 0.25 = a quarter sweep covering the top-right quadrant.
  assert.deepEqual(px(6, 1), [255, 0, 0]);
  // Other quadrants are untouched.
  assert.deepEqual(px(1, 1), [0, 0, 255]);
  assert.deepEqual(px(1, 6), [0, 0, 255]);
  assert.deepEqual(px(6, 6), [0, 0, 255]);
});

test("scaleX squashes a layer horizontally around its origin", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#0000ff" },
      {
        type: "shape",
        shape: "rect",
        width: 8,
        height: 4,
        fill: "#ff0000",
        transform: { scaleX: 0.5 }
      }
    ]
  });

  const rgba = await renderRgbaFrame(resolveFrame(composition, 0));
  const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
  // The red rect shrinks to the left half (origin pivot); right half stays blue.
  assert.deepEqual(px(1, 2), [255, 0, 0]);
  assert.deepEqual(px(6, 2), [0, 0, 255]);
});

test("layer raster cache blits identical pixels for a static group on repeat frames", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 16,
    height: 8,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 16, height: 8, fill: "#000000" },
      {
        type: "group",
        transform: {
          x: [
            { timeMs: 0, value: 0 },
            { timeMs: 600, value: 6 }
          ]
        },
        layers: [
          { type: "shape", shape: "rect", width: 4, height: 4, fill: "#ff0000", transform: { x: 2, y: 2 } },
          { type: "shape", shape: "rect", width: 2, height: 2, fill: "#00ff00", transform: { x: 4, y: 0 } }
        ]
      }
    ]
  });

  // costRatio 0 bypasses the cost gate so the tiny fixture rasters.
  const cached = createRgbaFrameRenderer({ layerCache: { costRatio: 0 } });
  const uncached = createRgbaFrameRenderer({ layerCache: false });
  try {
    // Frames 1-2: direct draws (timing sightings). Frame 3: rasters.
    await cached.render(resolveFrame(composition, 0));
    await cached.render(resolveFrame(composition, 200));
    await cached.render(resolveFrame(composition, 300));
    // Frame 4: cache hit — the group's transform moved, the content did not.
    const hit = await cached.render(resolveFrame(composition, 400));
    const direct = await uncached.render(resolveFrame(composition, 400));
    assert.ok(hit.equals(direct), "cached blit must match the direct draw byte-for-byte");

    const stats = cached.layerCacheStats();
    assert.ok(stats, "default renderer exposes layer cache stats");
    assert.equal(stats.rasters, 1);
    assert.ok(stats.hits >= 1, `expected at least one hit, got ${stats.hits}`);
  } finally {
    cached.dispose();
    uncached.dispose();
  }
});

test("layer raster cache flattens group opacity like saveLayer", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#000000" },
      {
        type: "group",
        transform: { x: 4, opacity: 0.5 },
        layers: [
          { type: "shape", shape: "rect", width: 4, height: 4, fill: "#ff0000" },
          { type: "shape", shape: "rect", width: 4, height: 4, fill: "#ff0000" }
        ]
      }
    ]
  });

  const renderer = createRgbaFrameRenderer({ layerCache: { costRatio: 0 } });
  try {
    await renderer.render(resolveFrame(composition, 0));
    await renderer.render(resolveFrame(composition, 100));
    await renderer.render(resolveFrame(composition, 200));
    const rgba = await renderer.render(resolveFrame(composition, 300));
    const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
    const [r, g, b] = px(6, 2);
    // Overlapping children still composite at 50%, not 75%.
    assert.ok(Math.abs(r! - 128) <= 2, `expected ~128 red, got ${r}`);
    assert.equal(g, 0);
    assert.equal(b, 0);
    assert.ok((renderer.layerCacheStats()?.hits ?? 0) >= 1);
  } finally {
    renderer.dispose();
  }
});

test("layer raster cache applies an animated reveal wipe to the cached snapshot", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 4,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 8, height: 4, fill: "#0000ff" },
      {
        type: "group",
        reveal: {
          type: "wipe",
          direction: "from-left",
          width: 8,
          height: 4,
          progress: [
            { timeMs: 0, value: 0 },
            { timeMs: 1000, value: 1 }
          ]
        },
        layers: [{ type: "shape", shape: "rect", width: 8, height: 4, fill: "#ff0000" }]
      }
    ]
  });

  const renderer = createRgbaFrameRenderer({ layerCache: { costRatio: 0 } });
  try {
    await renderer.render(resolveFrame(composition, 250));
    await renderer.render(resolveFrame(composition, 500));
    await renderer.render(resolveFrame(composition, 625));
    // Cache hit: reveal progress 0.75 clips the SAME cached snapshot.
    const rgba = await renderer.render(resolveFrame(composition, 750));
    const px = (x: number, y: number) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
    assert.deepEqual(px(5, 2), [255, 0, 0]);
    assert.deepEqual(px(7, 2), [0, 0, 255]);
    assert.ok((renderer.layerCacheStats()?.hits ?? 0) >= 1);
  } finally {
    renderer.dispose();
  }
});

test("layer raster cache renders text inside a cached group within AA tolerance", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 64,
    height: 32,
    durationMs: 1000,
    layers: [
      { type: "shape", shape: "rect", width: 64, height: 32, fill: "#ffffff" },
      {
        type: "group",
        layers: [
          { type: "text", text: "Hi", size: 18, color: "#000000", transform: { x: 8, y: 22 } }
        ]
      }
    ]
  });

  const cached = createRgbaFrameRenderer({ layerCache: { costRatio: 0 } });
  const uncached = createRgbaFrameRenderer({ layerCache: false });
  try {
    await cached.render(resolveFrame(composition, 0));
    await cached.render(resolveFrame(composition, 100));
    await cached.render(resolveFrame(composition, 150));
    const hit = await cached.render(resolveFrame(composition, 200));
    const direct = await uncached.render(resolveFrame(composition, 200));
    let off = 0;
    for (let index = 0; index < hit.length; index += 1) {
      if (Math.abs(hit[index]! - direct[index]!) > 4) {
        off += 1;
      }
    }
    assert.equal(off, 0, `cached text render drifted beyond AA tolerance on ${off} bytes`);
    // The glyphs actually rendered (not an empty/clipped raster).
    let darkPixels = 0;
    for (let index = 0; index < hit.length; index += 4) {
      if (hit[index]! < 100) {
        darkPixels += 1;
      }
    }
    assert.ok(darkPixels > 10, `expected visible glyph pixels, got ${darkPixels}`);
  } finally {
    cached.dispose();
    uncached.dispose();
  }
});

test("group cache: false opts a group out of raster caching", async () => {
  const composition = defineComposition({
    fps: 30,
    width: 8,
    height: 4,
    durationMs: 1000,
    layers: [
      {
        type: "group",
        cache: false,
        layers: [{ type: "shape", shape: "rect", width: 8, height: 4, fill: "#ff0000" }]
      }
    ]
  });

  const renderer = createRgbaFrameRenderer({ layerCache: { costRatio: 0 } });
  try {
    await renderer.render(resolveFrame(composition, 0));
    await renderer.render(resolveFrame(composition, 100));
    await renderer.render(resolveFrame(composition, 200));
    await renderer.render(resolveFrame(composition, 300));
    assert.equal(renderer.layerCacheStats()?.rasters, 0);
    assert.equal(renderer.layerCacheStats()?.hits, 0);
  } finally {
    renderer.dispose();
  }
});

test("LayerRasterCache evicts least-recently-used entries beyond its byte budget", () => {
  const disposed: string[] = [];
  const fakeEntry = (name: string, bytes: number) => ({
    image: { delete: () => disposed.push(name) },
    surface: { dispose: () => undefined },
    x: 0,
    y: 0,
    bytes
  }) as unknown as import("../src/layer-cache.ts").LayerRasterEntry;

  const cache = new LayerRasterCache({ maxBytes: 100 });
  assert.equal(cache.shouldConsider("a"), false, "unseen content is not considered");
  cache.recordDraw("a", 5);
  assert.equal(cache.shouldConsider("a"), false, "one sighting is not enough");
  cache.recordDraw("a", 5);
  assert.equal(cache.shouldConsider("a"), true, "repeated content is considered");
  // 5ms direct draw vs a ~0.002ms predicted blit for 100px → clearly worth it.
  assert.ok(cache.worthRastering("a", 100));
  // …but not when the predicted blit dwarfs the draw (huge area, fast draw).
  cache.recordDraw("b", 0.01);
  cache.recordDraw("b", 0.01);
  assert.ok(!cache.worthRastering("b", 2_000_000));
  cache.reject("b");
  assert.equal(cache.shouldConsider("b"), false, "rejected keys stay rejected");
  assert.ok(!cache.admits(60), "a single entry may not take over half the budget");
  assert.ok(cache.admits(50));

  assert.ok(cache.set("a", fakeEntry("a", 40)));
  assert.ok(cache.set("b", fakeEntry("b", 40)));
  // Touch "a" so "b" is the LRU candidate.
  assert.ok(cache.get("a"));
  assert.ok(cache.set("c", fakeEntry("c", 40)));
  assert.deepEqual(disposed, ["b"]);
  assert.ok(cache.get("a"));
  assert.equal(cache.get("b"), undefined);
  assert.ok(cache.get("c"));
  assert.equal(cache.stats().evictions, 1);

  cache.dispose();
  assert.deepEqual(disposed.sort(), ["a", "b", "c"]);
  assert.equal(cache.stats().entries, 0);
});
