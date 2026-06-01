import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import { renderPngFrame, renderRgbaFrame } from "../src/index.ts";

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
