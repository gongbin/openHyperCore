# OpenHyperCore

[中文文档](README.zh-CN.md)

OpenHyperCore is a lightweight video editing and rendering engine prototype for low-cost CPU servers. It describes video compositions as a TypeScript scene graph, renders frames with CanvasKit/Skia, and writes H.264/AAC MP4 output through FFmpeg. The goal is to provide a rendering pipeline that is lighter, more controllable, and easier to deploy than browser-based renderers, without requiring Chromium or a GPU.

The project is currently in alpha. The core CLI and rendering pipeline are usable, but OpenHyperCore is not yet a complete HyperFrames replacement. Implemented capabilities include graphic/text composition, captions, reusable cinematic effect helpers, timeline composition, PNG still export, silent MP4 rendering, audio muxing, multi-audio mixing, VideoLayer, local asset probe/cache, batched raw RGBA video-frame decoding, incremental frame reuse, worker_threads frame rendering, and AWS 2CPU/2G benchmark validation. HTTP service APIs and release packaging remain on the roadmap.

## Open Source

OpenHyperCore is an open-source TypeScript video rendering core for template video generation, batch editing, server-side rendering, and automated content production pipelines. The project is released under the MIT License. See [LICENSE](LICENSE).

## Use As A Package

```bash
npm install openhypercore
```

The composition IR is plain JSON-serializable data, so authoring is decoupled from rendering — author anywhere (incl. the browser), render on a Node server.

```ts
// Authoring (browser-safe, no Node/ffmpeg deps): the main entry re-exports core.
import { defineComposition, interpolate, cubicBezier } from "openhypercore";

const composition = defineComposition({
  fps: 30, width: 1280, height: 720, durationMs: 2000,
  layers: [
    { type: "shape", shape: "rect", width: 1280, height: 720, fill: { type: "linear", from: [0, 0], to: [0, 720], stops: [{ offset: 0, color: "#1b2a4a" }, { offset: 1, color: "#070b14" }] } },
    { type: "text", text: "Hello", size: 96, color: "#fff", align: "center",
      transform: { x: 640, y: 380, opacity: [{ timeMs: 0, value: 0 }, { timeMs: 600, value: 1, easing: [0.2, 0, 0, 1] }] } }
  ]
});
```

```ts
// Rendering (Node): resolve a frame and rasterise it, or encode to MP4.
import { resolveFrame } from "openhypercore";
import { renderPngFrame } from "openhypercore/renderer-skia";

const png = await renderPngFrame(resolveFrame(composition, 600));
```

CLI (handy for scripts and agents — `probe`/`still`/`render`/`bench`):

```bash
npx openhyper render my-composition.ts --out out.mp4
npx openhyper render my-composition.ts --out out.mp4 --renderer native --workers auto
```

### Render service (HTTP)

Run the same render pipeline as an HTTP service — `POST /render` a composition IR (JSON) and get an MP4 back. The same engine serves both agents (scripted) and the editor (browser); IR assets must be reachable from the server's filesystem.

```bash
npx openhyper serve --port 8787
# POST a composition IR -> MP4
curl -X POST -H "content-type: application/json" \
  --data '{"type":"composition","fps":30,"width":1280,"height":720,"durationMs":1000,"layers":[...]}' \
  http://localhost:8787/render --output out.mp4
```

`GET /healthz` for liveness; the response carries `X-OpenHyper-Frames/Render-Ms/Total-Ms/Renderer` headers and CORS is enabled. Programmatic: `import { createRenderServer } from "openhypercore/server"`.

Subpath entries: `openhypercore` (≡ `openhypercore/core`, authoring IR + animation), `openhypercore/plugins` (motion-effect plugins), `openhypercore/renderer-skia` (CanvasKit raster), `openhypercore/renderer-skia/draw` (browser-safe draw tree for live previews), `openhypercore/renderer-svg`, `openhypercore/encoder-ffmpeg`, `openhypercore/assets`, `openhypercore/jsx-runtime`, `openhypercore/server` (HTTP render service), `openhypercore/cli`.

The default renderer is the portable CanvasKit/wasm backend (no native binary required). The native (Rust + skia-safe) backend — ~8–14× faster — is an opt-in: build it from source with `pnpm build:native` and select with `--renderer native` (or `OPENHYPERCORE_RENDERER=native`); prebuilt per-platform binaries are planned.

## Motion-Effect Plugins

Rich, ready-made animations from a handful of parameters — drop a `{ type: "plugin" }` node into the layer list and it expands into plain IR layers before rendering. The CLI, the render service and the editor all expand automatically; the plugin node stays in your JSON, so its params remain editable (non-destructive).

```ts
// A full cold open from three plugin nodes (see examples/plugin-cold-open.ts):
const composition = defineComposition({
  fps: 30, width: 1280, height: 720, durationMs: 13000,
  layers: [
    { type: "plugin", plugin: "countdown", params: { from: 3 }, endMs: 3000 },
    { type: "plugin", plugin: "globe-route",
      params: { src: "assets/earth.jpg", from: [39.9, 116.4], to: [48.85, 2.35], fromLabel: "北京", toLabel: "Paris" },
      startMs: 3000, endMs: 10000 },
    { type: "plugin", plugin: "light-sweep-title", params: { text: "巴黎 72 小時", y: 0.82 }, startMs: 9200 }
  ]
});
```

Built-in plugins (`openhypercore/plugins`):

| Plugin | What it does | Key params |
| --- | --- | --- |
| `globe-intro` | A lit satellite globe spins to a target and zooms in (starfield, atmosphere, radar pings) | `src` (2:1 equirect texture), `target` [lat,lng], `spin`, `zoom`, `background` |
| `globe-route` | A great-circle route draws itself between two places on the rotating globe (hides behind the horizon) | `src`, `from`/`to` [lat,lng], `fromLabel`/`toLabel`, `routeColor`, `zoom` |
| `map-route` | A 2D route arcs across a bundled Natural Earth world map with a moving tip and popping endpoints | `from`/`to` [lat,lng], labels, `landColor`/`routeColor`, `lineStyle`, `zoom` |
| `countdown` | Film-leader countdown: sweeping clock wedge, rings, crosshair, big numbers | `from` (3..1), colors |
| `curtain-open` | Stage curtains hold, then sweep apart to reveal the scene beneath | `color`, `holdMs`, `openMs`, `foldCount` |
| `ken-burns` | Full-frame photo with a slow centred zoom + drift, fading in/out | `src`, `zoomFrom/To`, `driftX/Y` |
| `glitch-title` | Centered RGB-split glitch title with flicker and slice bars | `text`, `size`, accent colors |
| `light-sweep-title` | Title rises in, an underline grows, a light bar sweeps across | `text`, `size`, `sweepColor` |

Plugin content lives on a LOCAL timeline: the node's `startMs/endMs` place the whole effect, and its base props (`transform`, `clip`, `blendMode`, ...) apply to the expanded group — so effects relocate, fade and mask like any other layer. Expanding manually (e.g. for inspection) is one call:

```ts
import { expandComposition, definePlugin, registerPlugin, listPlugins } from "openhypercore/plugins";

const expanded = expandComposition(composition); // plugin nodes -> plain layers

// Custom plugins: params carry a serializable schema (editors auto-generate
// forms from it), expand() is a pure function returning local-time layers.
registerPlugin(definePlugin({
  name: "badge",
  params: { text: { type: "string", required: true }, color: { type: "color", default: "#ffb703" } },
  expand: (p, ctx) => [
    { type: "text", text: p.text, color: p.color, align: "center",
      transform: { x: ctx.width / 2, y: ctx.height / 2 } }
  ]
}));
```

## Features

- Scene Graph IR: describes compositions, layers, transforms, and keyframes as plain data for caching, testing, and future service integration.
- TypeScript API and lightweight JSX runtime: no React dependency; JSX and imperative APIs both compile into the same Composition IR.
- CanvasKit/Skia renderer: supports text, rectangles, circles, paths, images, and the first local VideoLayer implementation.
- Native renderer backend (Rust + skia-safe, optional): renders whole frames natively behind the same `FrameRenderer` seam, reaching full feature parity with the wasm renderer (verified by golden tests) at much higher throughput — measured ~8x faster rendering / ~6x faster end-to-end on an effects-heavy 1080p scene. Build it with `pnpm build:native` (needs the Rust toolchain), then select it via `--renderer native` (or `OPENHYPERCORE_RENDERER=native`); the wasm backend stays the default and portable fallback. The native backend draws every frame directly (no static-layer raster cache needed — direct draw already beats cached wasm blits). Benchmark with `node --experimental-strip-types packages/renderer-native/scripts/bench-vs-wasm.mjs`.
- SVG debug stills and PNG stills: quickly inspect layout as SVG or render a real CanvasKit PNG frame.
- CaptionLayer: supports timed captions, font size, color, background color, padding, alignment, and transform position.
- Full transform stack: every layer animates `x/y/scale/scaleX/scaleY/rotate/opacity` via keyframe tracks. Each keyframe carries optional easing (named preset, custom function, or a CSS-style `cubicBezier(x1,y1,x2,y2)` / `[x1,y1,x2,y2]` tuple) applied to the segment ending at it — so any track gets frame-precise curves without baking. See `examples/full-transform-easing.ts`.
- Transition helpers: fade, slide, and scale presets that return reusable transform keyframes, with named easing presets (`easeIn/easeOut/easeInOut/sine/quart/expo/back/elastic/bounce/...`, custom functions, or cubic-bezier tuples) baked into sampled keyframes.
- Timeline DSL: `composeTimeline` chains multiple animations of the same property over time (e.g. entrance fade-in + exit fade-out on one layer), and `delayTransition` shifts a transform in time for staggering.
- GroupLayer pre-composition: a `group` layer nests children under a shared transform and group opacity (composited as one unit via saveLayer, no double blending). Children and the group's own keyframes live on the group's local timeline, so a whole animated block relocates by changing `startMs` alone (Remotion `<Sequence>` semantics). See `examples/group-spring.ts`.
- Remotion-style animation APIs: `interpolate(t, inputRange, outputRange, { easing, extrapolateLeft/Right })` for multi-segment mappings, a closed-form damped `spring()` plus `springKeyframes()` that bakes physical spring motion into keyframe tracks, `interpolateColors()` (multi-stop RGB color mapping), deterministic `random(seed)`, and `stagger()` for cascade entrances.
- Color keyframes: shape `fill`/`stroke` and text `color` accept keyframed color tracks (RGB-space interpolation with per-segment easing), and shape `strokeWidth` animates — resolved to plain values before drawing, so every renderer gets them for free.
- Path trim animation: shape paths carry animatable `trimStart`/`trimEnd` (fractions of total length) — keyframing `trimEnd` 0→1 draws a route or signature over time, composing with dashed strokes.
- Globe layer: a 2:1 equirectangular texture rendered as an orthographic globe (UV triangle mesh with per-vertex Lambert + limb lighting) with keyframeable `radius`/`yaw`/`pitch`, plus great-circle `routes` that draw on the surface with animatable progress and hide behind the horizon. Identical vertex data in the wasm and native backends (parity-tested).
- Scene transitions: `createTransitionSeries(...).scene(...).transition({ type, durationMs, direction, easing })` chains full-frame scenes with real overlapping transitions — `wipe`, `clockWipe` (mask reveals), `slide` (push), and `flip` (centre-pivot fold) — where adjacent scenes overlap for the transition duration (Remotion TransitionSeries semantics). See `examples/scene-transitions.ts`.
- Per-axis scale and reveal masks in the IR: `transform.scaleX/scaleY` (multiplied with uniform `scale`), and `GroupLayer.reveal` (`wipe`/`clock` with an animated 0→1 `progress`) clip a group to a swept rect or clock wedge.
- Static-layer raster cache: groups whose resolved content repeats across frames (only their transform/opacity/reveal animating) are rastered once and blitted afterwards. Cost-driven and self-tuning — it times every direct draw and caches only subtrees that draw slower than the predicted blit, so cheap flat scenes never regress while glow/text-heavy cards speed up. Opt out per group with `cache: false` or globally with `--no-layer-cache`; image layers are also decode-cached across frames.
- Cinematic effect helpers: `cinematicBars`, `flashTransitionLayer`, `speedLineBurst`, and `glitchTitle` generate reusable intro/transition layer stacks for high-energy reels without hand-writing dozens of layers.
- Motion-effect plugins: `{ type: "plugin" }` IR nodes expand into plain layers via `openhypercore/plugins` (`expandComposition`, auto-run by the CLI/service/editor), with a serializable param schema editors turn into forms — 8 built-ins from stage curtains to a rotating satellite globe (see the section above), plus `definePlugin`/`registerPlugin` for your own.
- Scene timeline builder: `createTimeline(...).scene(...).transition(...).build()` lays out named scenes and transitions sequentially, returning both a ready Composition and timing markers.
- Layer fit modes: `ImageLayer.fit` and `VideoLayer.fit` support `fill` (stretch), `cover` (centre-crop), and `contain` (letterbox); circular clips default to `cover`.
- Visual effects: gradient fills (`fill`/`color`/`backgroundColor` accept `{ type: "linear"|"radial", stops }`), per-layer `blendMode` (multiply/screen/overlay/add/...), full-layer `blur` (Gaussian), and directional `motionBlur` ({ angle, distance, samples }). See `examples/effects-showcase.ts`.
- Arbitrary clipping: any layer (or whole group) sets `clip` to a `rect` (with optional corner `radius`), `circle`, or SVG `path` region in its local space.
- Text layout: multi-line text/captions with explicit `\n` and automatic word/CJK wrapping via `maxWidth`, plus per-line `align` (left/center/right).
- Fonts: a named font registry (`registerFont(name, path)`) and per-character fallback stack with optional colour-emoji fallback (`registerEmojiFont`).
- Subtitles: `parseSubtitles` reads SRT/WebVTT into timed cues and `subtitlesToCaptions` turns them into styled, time-bounded CaptionLayers.
- FFmpeg encoder backend: pipes raw RGBA frames to FFmpeg and outputs H.264/yuv420p MP4; with audio layers it outputs AAC audio.
- AudioLayer: supports single audio, multi-audio `amix`, start/end timing, fade in/out, and `volume` as either a constant or a keyframe envelope (ducking/swells) compiled to an FFmpeg per-frame volume expression.
- VideoLayer: extracts frames from local video by timeline time and draws them into the Skia canvas, with `playbackRate` (speed up/slow down) and `loop` over the trimmed window. Video layers with `width/height` use source-sized batched raw RGBA decoding, bypassing the PNG intermediate format and CanvasKit per-frame image decoding.
- Asset probe/cache: provides metadata probing and task-level cache APIs for images, video, and audio.
- Frame-level reuse: visually identical consecutive frames reuse the same RGBA buffer while preserving encoded frame order and PTS.
- worker_threads render pool: supports `--workers N`, `--workers auto`, and `--worker-window N` to control parallelism and memory buffering.
- Persistent frame cache: `--cache-dir <dir>` stores decoded RGBA frames on disk keyed by source + mtime/size + time + dimensions, so they are reused across renders and shared between worker processes.
- Benchmark output: reports frame count, rendered/reused frames, worker settings, audio timeline, render time, encode time, total time, and peak RSS.

## Current Limits

- This is still an alpha prototype, and APIs may continue to change.
- VideoLayer supports source-size probing, task-level raw RGBA caching, windowed batched prefetch, and (via `--cache-dir`) a cross-task persistent disk cache that is also shared between workers. Decode already runs as contiguous sequential batch passes (no per-frame seeks); explicit GOP/keyframe-aligned scheduling is still a future refinement.
- Text layout supports multi-line wrapping, alignment, font registration, and emoji fallback, but not yet full rich-text runs (mixed styles within a line) or bidirectional/complex-script shaping.
- Colour-emoji fallback depends on an emoji font being available on the host (auto-detected, or set via `registerEmojiFont`); without one, emoji fall back to the default typeface.
- Transition helpers support easing presets, a composed property timeline DSL (`composeTimeline`/`delayTransition`), and a lightweight scene timeline builder. A richer track-based editor timeline is still future work.
- The HTTP render service (`openhyper serve`), the decoupled web editor (`apps/editor`) and npm packaging exist; native per-platform prebuilt binaries are still planned (build from source meanwhile).

## Requirements

- Node.js 24+. The current test commands run TypeScript directly with `node --experimental-strip-types`.
- pnpm.
- FFmpeg. The project depends on `@ffmpeg-installer/ffmpeg`, so most local runs do not need a separate FFmpeg installation. You can also pass a system FFmpeg path with `--ffmpeg-path`.

## Install And Verify

```bash
pnpm install
pnpm check
pnpm build
pnpm test
```

Common development commands:

```bash
pnpm cli probe examples/simple-video.ts
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/openhyper-frame.svg
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/openhyper-frame.png --format png
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4
pnpm cli render examples/effects-opener.ts --out /tmp/openhyper-effects.mp4
pnpm cli bench examples/simple-video.ts --out /tmp/openhyper-bench.json --video-out /tmp/openhyper-bench.mp4
pnpm cli bench-suite examples/bench/animated-workload.ts --static examples/bench/static-reuse.ts --out /tmp/openhyper-bench-suite.json --video-dir /tmp/openhyper-bench-suite
```

After building, you can also run the compiled output directly:

```bash
node dist/packages/cli/src/index.js probe examples/simple-video.ts
node dist/packages/cli/src/index.js render examples/simple-video.ts --out /tmp/openhyper.mp4
```

## CLI Usage

### probe

Prints basic composition metadata, including fps, size, duration, frame count, and layer count.

```bash
pnpm cli probe examples/simple-video.ts
```

### still

Exports a single frame at a given timestamp. The default output is an SVG debug still. Add `--format png` to render a real CanvasKit PNG.

```bash
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/frame.svg
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/frame.png --format png
```

### render

Renders an MP4. The default pipeline sends raw RGBA frames to FFmpeg. Without audio it outputs H.264 MP4; with AudioLayer it outputs H.264 + AAC MP4.

```bash
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4
pnpm cli render examples/simple-video.ts --out /tmp/openhyper-720p.mp4 --fps 24 --size 1280x720
pnpm cli render examples/simple-video.ts --out /tmp/openhyper-worker.mp4 --workers auto --worker-window 4
```

You can specify an FFmpeg binary or extra prefix arguments:

```bash
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4 --ffmpeg-path /usr/local/bin/ffmpeg
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4 --ffmpeg-arg-prefix -hide_banner
```

`--cache-dir <dir>` enables a persistent on-disk RGBA frame cache. Decoded video frames are keyed by source path + mtime/size + time + dimensions, so the cache is reused across renders (cross-task) and shared between worker processes pointing at the same directory:

```bash
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4 --workers auto --cache-dir /tmp/openhyper-cache
```

### bench

Renders a video and writes JSON metrics. This is useful for comparing single-thread, worker, and worker-window configurations.

```bash
pnpm cli bench examples/simple-video.ts \
  --out /tmp/openhyper-bench.json \
  --video-out /tmp/openhyper-bench.mp4 \
  --workers auto
```

Typical metrics include:

- `renderMode`, `workerSelection`, `workerCount`, `workerWindow`
- `frames`, `renderedFrames`, `reusedFrames`, `maxBufferedFrames`
- `durationMs`, `frameDurationMs`, `encodedVideoDurationMs`
- `audioInputs`, `audioTimelineStartMs`, `audioTimelineEndMs`
- `renderWallMs`, `renderCpuMs`, `encodeMs`, `totalMs`, `peakRssBytes`

### bench-suite

Runs the M4.1 benchmark comparison suite and generates four cases:

- `single-thread`: dynamic workload, single-thread rendering
- `worker`: dynamic workload, worker_threads rendering
- `worker-window`: dynamic workload, worker_threads with a bounded buffer window
- `static-reuse`: static fixture, used to verify frame reuse

```bash
pnpm cli bench-suite examples/bench/animated-workload.ts \
  --static examples/bench/static-reuse.ts \
  --out /tmp/openhyper-bench-suite.json \
  --video-dir /tmp/openhyper-bench-suite \
  --workers 2 \
  --worker-window 4
```

You can also run the built-in fixture script:

```bash
pnpm bench:fixtures
```

## Benchmark

M4.2/M4.3 pre-optimization benchmarks were run on an AWS server with 2 vCPU, about 2GiB RAM, 2GiB swap, and no GPU. Output was H.264, 1920x1080, 30fps, 5.000s.

Benchmark command:

```bash
pnpm cli bench-suite examples/bench/animated-workload.ts \
  --static examples/bench/static-reuse.ts \
  --out bench-results/m4.3-pre/suite-1080p30-2cpu2g-final.json \
  --video-dir bench-results/m4.3-pre/videos-final \
  --fps 30 \
  --size 1920x1080 \
  --workers 2 \
  --worker-window 2
```

| case | total | render wall | encode | peak RSS | frame result |
| --- | ---: | ---: | ---: | ---: | --- |
| `single-thread` | 4.99s | 3.30s | 1.69s | 236MB | 150 rendered / 0 reused |
| `worker` | 6.42s | 4.28s | 2.15s | 600MB | 150 rendered / 0 reused |
| `worker-window` | 6.59s | 4.76s | 1.83s | 561MB | 150 rendered / 0 reused |
| `static-reuse` | 2.85s | 0.02s | 2.83s | 291MB | 1 rendered / 149 reused |

Conclusions:

- On a 2CPU/2G machine, `single-thread` is the recommended path for dynamic graphic workloads. A 5-second 1080p30 video completed in about 4.99s, meeting the 5s design target.
- Static frame reuse is effective: only 1 of 150 frames is rendered, and the other 149 frames are reused. Total time was about 2.85s.
- All cases stayed below the 800MB peak RSS target.
- `worker_threads` now reuses a persistent render pool, but on low-core 2CPU/2G machines it is still slower than single-thread rendering due to parallel CanvasKit surfaces, thread communication, and memory pressure. Worker rendering is not recommended as the default for 2CPU deployments.

### Real Video Demo Comparison

The following data was collected on the same AWS 2CPU/2G server. The test asset was a server-local ignored fixture, `examples/demo.mp4`, used to simulate a real "fast escalator descent into a subway" edit. The source asset and generated videos are not committed to GitHub.

| renderer | scenario | total | render wall | encode | peak RSS | note |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| OpenHyperCore | PNG batch VideoLayer | 64.07s | 62.86s | 1.21s | 249MB | Batched extraction, but still uses PNG encode/decode |
| OpenHyperCore | raw RGBA source-sized VideoLayer | 52.63s | 51.60s | 1.03s | 235MB | Bypasses PNG; intermediate frames are cached at the source video size, 480x272 |
| OpenHyperCore | raw RGBA + 2 workers | 63.12s | 62.10s | 1.02s | 487MB | Worker path is still slower than single-thread on 2CPU |
| HyperFrames | Chromium screenshot fallback | 162.63s | n/a | n/a | 212MB | Server Chromium lacked beginFrame support, so HyperFrames used screenshot fallback |

Conclusion: on the real video edit, raw RGBA VideoLayer is about 18% faster than the PNG batch path and about 3.1x faster than the HyperFrames fallback observed on this server. The next major bottlenecks are per-frame CanvasKit composition and the lack of shared video-frame cache across workers. On 2CPU machines, single-thread rendering remains the recommended default.

## Composition Examples

Minimal imperative scene graph:

```ts
import { defineComposition } from "../packages/core/src/index.ts";

export default defineComposition({
  fps: 30,
  width: 1280,
  height: 720,
  durationMs: 3000,
  layers: [
    {
      type: "shape",
      shape: "rect",
      width: 1280,
      height: 720,
      fill: "#101820"
    },
    {
      type: "text",
      text: "OpenHyperCore",
      size: 84,
      color: "#f6f7f9",
      transform: {
        x: 120,
        y: 220,
        opacity: [
          { timeMs: 0, value: 0 },
          { timeMs: 600, value: 1 }
        ]
      }
    }
  ]
});
```

Audio example:

```ts
{
  type: "audio",
  src: "./assets/music.wav",
  startMs: 0,
  endMs: 3000,
  volume: 0.7,
  fadeInMs: 300,
  fadeOutMs: 500
}
```

Video layer example:

```ts
{
  type: "video",
  src: "./assets/clip.mp4",
  startMs: 500,
  endMs: 2500,
  trimStartMs: 1000,
  width: 640,
  height: 360
}
```

Caption example:

```ts
{
  type: "caption",
  text: "This line is shown near the bottom of the frame",
  startMs: 500,
  endMs: 2500,
  size: 42,
  color: "#ffffff",
  backgroundColor: "#000000",
  padding: 12,
  align: "center",
  transform: { x: 640, y: 660 }
}
```

Transition helper example:

```ts
import {
  fadeTransition,
  mergeTransforms,
  scaleTransition,
  slideTransition
} from "openhypercore/core";

{
  type: "text",
  text: "Animated title",
  transform: mergeTransforms(
    fadeTransition({ startMs: 0, durationMs: 600 }),
    slideTransition({
      startMs: 0,
      durationMs: 600,
      from: { y: 40 },
      to: { y: 0 }
    }),
    scaleTransition({ startMs: 0, durationMs: 600, from: 0.92, to: 1 })
  )
}
```

Effect/timeline opener example:

```ts
import {
  cinematicBars,
  createTimeline,
  flashTransitionLayer,
  glitchTitle,
  speedLineBurst
} from "openhypercore/core";

const timeline = createTimeline({ width: 1280, height: 720, fps: 30 })
  .scene("intro", 1600, ({ startMs, endMs, width, height }) => [
    ...speedLineBurst({ width, height, startMs, endMs, count: 18, seed: 9 }),
    ...cinematicBars({ width, height, startMs, endMs }),
    ...glitchTitle({ text: "METRO RUN", startMs, endMs, x: 120, y: 340, size: 96 })
  ])
  .transition("flash", 240, ({ startMs, width, height }) => [
    flashTransitionLayer({ width, height, startMs, durationMs: 240 })
  ])
  .build();

export default timeline.composition;
```

Asset probe/cache example:

```ts
import { createAssetProbeCache } from "openhypercore/assets";

const cache = createAssetProbeCache();
const clip = await cache.probe("./assets/clip.mp4");

console.log(clip.width, clip.height, clip.durationMs);
```

Video frame cache example:

```ts
import { createVideoFrameCache, renderRgbaFrame } from "openhypercore/renderer-skia";

const videoFrameCache = createVideoFrameCache();
const rgba = await renderRgbaFrame(frame, { videoFrameCache });
```

## Repository Layout

```text
packages/
  core/             Scene Graph IR, composition validation, scheduler, keyframes, effects/timeline helpers
  jsx-runtime/      Custom JSX runtime that emits IR
  renderer-svg/     SVG debug still backend
  renderer-skia/    CanvasKit PNG/RGBA renderer backend
  encoder-ffmpeg/   FFmpeg rawvideo/image pipe, H.264/AAC encoding, audio filter graph
  assets/           Image/video/audio probe and task-level cache
  cli/              openhyper CLI, render/bench commands, worker_threads scheduling
examples/           Example compositions
examples/bench/     M4.1 benchmark fixtures
```

## Roadmap

- M3.5: completed `packages/assets`, with image/video/audio probe, size/duration metadata, and task-level cache.
- M3.6: completed task-level video frame cache, windowed batch prefetch, and raw RGBA VideoLayer decoding to avoid repeated FFmpeg extraction and bypass the PNG intermediate format.
- M3.7: completed basic CaptionLayer with timed text, style, and position.
- M3.8: completed transition presets, easing, composed transform timelines, cinematic effect helpers, and the lightweight scene timeline builder.
- M4.1: completed benchmark fixtures and `bench-suite`, comparing single-thread, worker, worker+window, and static-reuse paths.
- M4.2: completed AWS 2CPU/2G benchmark validation for the 1080p30/5s and <800MB memory targets.
- M4.3: completed benchmark summary JSON output for CI and server acceptance checks.
- M4.4: completed persistent disk video-frame cache hardening and batch-order preservation for partial cache hits.
- M5: fill in project templates, user documentation, error messages, richer track-based timelines, and release packaging.

## Goal

OpenHyperCore aims to become a lightweight, programmable, easy-to-deploy video editing and rendering core. It should support batch composition of graphics, images, video clips, and audio on low-spec servers, while providing a stable rendering foundation for future HTTP services, template systems, and visual editors.
