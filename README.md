# OpenHyperCore

OpenHyperCore 是一个面向低成本 CPU 服务器的视频剪辑渲染引擎原型。它用 TypeScript 描述 Scene Graph，使用 CanvasKit/Skia 做帧渲染，并通过 FFmpeg 输出 H.264/AAC MP4，目标是在不依赖 Chromium、无 GPU 的环境中提供比浏览器渲染链路更轻量、更可控的视频生成能力。

当前项目处于 alpha 阶段，核心 CLI 与渲染管线已经可用，但还不是完整的 HyperFrames 替代品。已实现的能力覆盖图文合成、字幕层、基础转场 preset、PNG still、无音频 MP4、音频合流、多音频混音、基础视频贴图、资产 probe/cache、任务级视频帧缓存、增量帧复用、worker_threads 帧级并行和 AWS 2CPU/2G benchmark 验证；服务化接口和发布打包流程仍在 Roadmap 中。

## 开源

OpenHyperCore 为开源 TypeScript 视频渲染内核，适合被集成到模板视频生成、批量剪辑、服务端渲染和自动化内容生产链路中。项目采用 MIT License，详见仓库根目录 `LICENSE` 文件。

## 功能特点

- Scene Graph IR：用纯数据描述 Composition、Layer、Transform、Keyframe，便于缓存、测试和后续服务化。
- TypeScript API 与轻量 JSX runtime：不引入 React，JSX/命令式写法最终都落到 Composition IR。
- CanvasKit/Skia 渲染后端：支持文本、矩形/圆形/path、图片和第一版本地 VideoLayer。
- SVG debug still 与 PNG still：可快速检查单帧布局，也可生成真实 CanvasKit PNG。
- CaptionLayer：支持时间段字幕、字体大小、颜色、背景色、padding、对齐和 transform 位置。
- 转场 helper：提供 fade、slide、scale preset，并输出可复用 Scene Graph transform keyframes。
- FFmpeg 编码后端：通过 raw RGBA stdin pipe 输出 H.264/yuv420p MP4；有音频时输出 AAC。
- AudioLayer：支持单音频、多音频 amix、start/end、volume、fadeIn/fadeOut。
- VideoLayer：支持从本地视频按时间点抽帧并贴入 Skia 画布，渲染任务内带视频帧缓存和预取。
- 资产 probe/cache：提供图片、视频、音频 metadata probe，以及任务级缓存 API。
- 帧级优化：连续视觉内容相同则复用 RGBA buffer，保持编码帧序和 PTS 不变。
- worker_threads 并行渲染池：支持 `--workers N`、`--workers auto`、`--worker-window N` 控制并行度与内存窗口。
- Benchmark：输出帧数、复用帧、worker 配置、音频 timeline、渲染耗时、编码耗时、峰值 RSS 等指标。

## 当前限制

- 仍是 alpha 工程原型，API 可能继续调整。
- VideoLayer 目前仍以 correctness-first 为主：已具备任务级视频帧缓存和单帧预取，但尚未做跨任务持久缓存、批量 GOP 级解码或基于 probe 的高级调度。
- `ImageLayer.fit` 与 `VideoLayer.fit` 已预留类型，但当前 Skia 绘制主要按 `width/height` 拉伸绘制。
- 文本排版仍是基础 Skia font 绘制，尚未补齐复杂断行、字体注册和 emoji fallback。
- CaptionLayer 当前为单行基础字幕，尚未实现自动换行、复杂排版和 SRT/VTT 导入。
- 转场 helper 当前输出基础 transform keyframes，尚未实现 easing preset、组合时间线 DSL 或复杂出入场编排。
- 尚未实现 HTTP 服务、可视化编辑器和发布打包流程。

## 环境要求

- Node.js 24+，当前测试命令使用 `node --experimental-strip-types` 直接运行 TypeScript。
- pnpm。
- FFmpeg。项目依赖 `@ffmpeg-installer/ffmpeg`，多数本地场景无需额外安装；也可以通过 CLI 的 `--ffmpeg-path` 指定系统 FFmpeg。

## 安装与验证

```bash
pnpm install
pnpm check
pnpm build
pnpm test
```

常用开发命令：

```bash
pnpm cli probe examples/simple-video.ts
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/openhyper-frame.svg
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/openhyper-frame.png --format png
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4
pnpm cli bench examples/simple-video.ts --out /tmp/openhyper-bench.json --video-out /tmp/openhyper-bench.mp4
pnpm cli bench-suite examples/bench/animated-workload.ts --static examples/bench/static-reuse.ts --out /tmp/openhyper-bench-suite.json --video-dir /tmp/openhyper-bench-suite
```

构建后也可以直接运行编译产物：

```bash
node dist/packages/cli/src/index.js probe examples/simple-video.ts
node dist/packages/cli/src/index.js render examples/simple-video.ts --out /tmp/openhyper.mp4
```

## CLI 使用

### probe

打印 Composition 的基础信息，包括 fps、尺寸、时长、帧数和 layer 数量。

```bash
pnpm cli probe examples/simple-video.ts
```

### still

导出指定时间点的单帧。默认输出 SVG debug still；加 `--format png` 后使用 CanvasKit 输出 PNG。

```bash
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/frame.svg
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/frame.png --format png
```

### render

渲染 MP4。默认走 raw RGBA pipe 到 FFmpeg；无音频时输出 H.264 MP4，有 AudioLayer 时输出 H.264 + AAC MP4。

```bash
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4
pnpm cli render examples/simple-video.ts --out /tmp/openhyper-720p.mp4 --fps 24 --size 1280x720
pnpm cli render examples/simple-video.ts --out /tmp/openhyper-worker.mp4 --workers auto --worker-window 4
```

可指定 FFmpeg 路径或额外前置参数：

```bash
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4 --ffmpeg-path /usr/local/bin/ffmpeg
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4 --ffmpeg-arg-prefix -hide_banner
```

### bench

渲染视频并输出 JSON 指标，适合比较单线程、worker 和窗口大小配置。

```bash
pnpm cli bench examples/simple-video.ts \
  --out /tmp/openhyper-bench.json \
  --video-out /tmp/openhyper-bench.mp4 \
  --workers auto
```

典型指标包括：

- `renderMode`、`workerSelection`、`workerCount`、`workerWindow`
- `frames`、`renderedFrames`、`reusedFrames`、`maxBufferedFrames`
- `durationMs`、`frameDurationMs`、`encodedVideoDurationMs`
- `audioInputs`、`audioTimelineStartMs`、`audioTimelineEndMs`
- `renderWallMs`、`renderCpuMs`、`encodeMs`、`totalMs`、`peakRssBytes`

### bench-suite

运行 M4.1 benchmark 对比套件，自动生成四组 case：

- `single-thread`：动态 workload，单线程渲染
- `worker`：动态 workload，worker_threads 渲染
- `worker-window`：动态 workload，worker_threads + 缓冲窗口
- `static-reuse`：静态 fixture，验证帧复用路径

```bash
pnpm cli bench-suite examples/bench/animated-workload.ts \
  --static examples/bench/static-reuse.ts \
  --out /tmp/openhyper-bench-suite.json \
  --video-dir /tmp/openhyper-bench-suite \
  --workers 2 \
  --worker-window 4
```

也可以直接运行内置 fixture 脚本：

```bash
pnpm bench:fixtures
```

## Benchmark

M4.2/M4.3 前置优化在 AWS 服务器上完成 1080p30 / 5s benchmark。测试机器为 2 vCPU、约 2GiB RAM、2GiB swap，无 GPU；输出均为 H.264、1920x1080、30fps、5.000s。

测试命令：

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

结论：

- 在 2CPU/2G 机器上，`single-thread` 是动态图文 workload 的推荐路径，5 秒 1080p30 视频约 4.99 秒完成，达到 5s 设计目标。
- 静态复用路径有效，150 帧只渲染 1 帧，其余 149 帧复用，总耗时约 2.85 秒。
- 所有 case 峰值 RSS 均低于 800MB 内存目标。
- `worker_threads` 现在复用持久渲染池，但在 2CPU/2G 低核数机器上仍慢于单线程，主要受并行 CanvasKit surface、线程通信和内存压力影响；2CPU 部署默认不建议启用 worker。

## Composition 示例

最小命令式 Scene Graph：

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

音频示例：

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

视频贴图示例：

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

字幕示例：

```ts
{
  type: "caption",
  text: "这一段会显示在画面底部",
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

转场 helper 示例：

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

资产 probe/cache 示例：

```ts
import { createAssetProbeCache } from "openhypercore/assets";

const cache = createAssetProbeCache();
const clip = await cache.probe("./assets/clip.mp4");

console.log(clip.width, clip.height, clip.durationMs);
```

视频帧缓存示例：

```ts
import { createVideoFrameCache, renderRgbaFrame } from "openhypercore/renderer-skia";

const videoFrameCache = createVideoFrameCache();
const rgba = await renderRgbaFrame(frame, { videoFrameCache });
```

## 仓库结构

```text
packages/
  core/             Scene Graph IR、Composition 校验、调度器、关键帧求值
  jsx-runtime/      自定义 JSX runtime，输出 IR
  renderer-svg/     SVG debug still 后端
  renderer-skia/    CanvasKit PNG/RGBA 渲染后端
  encoder-ffmpeg/   FFmpeg rawvideo/image pipe、H.264/AAC 编码、音频 filter graph
  assets/           图片/视频/音频 probe 与任务级缓存
  cli/              openhyper CLI、render/bench、worker_threads 调度
examples/           示例 Composition
examples/bench/     M4.1 benchmark fixtures
```

## Roadmap

- M3.5：已完成 `packages/assets`，提供图片/视频/音频 probe、尺寸/时长元信息和任务级缓存。
- M3.6：已完成任务级视频帧缓存与单帧预取，避免同一视频/同一时间点重复 FFmpeg 抽帧。
- M3.7：已完成基础 CaptionLayer，支持时间段文本、样式和位置。
- M3.8：已完成基础转场 preset：fade、slide、scale，并输出可复用 Scene Graph helper。
- M4.1：已完成 benchmark fixtures 与 `bench-suite`，对比 single-thread、worker、worker+window、静态复用路径。
- M4.2：已在 AWS 2CPU/2G 服务器上运行 benchmark，验证 1080p30/5s 与 <800MB 内存目标。
- M4.3：输出 benchmark 对比摘要 JSON，便于 CI 和服务器验收。
- M5：补齐项目模板、用户文档、错误提示和发布打包流程。

## 目标

OpenHyperCore 的长期目标是成为一个轻量、可编程、易部署的视频剪辑渲染内核：在低规格服务器上完成图文、图片、视频片段和音频的批量合成，并为后续 HTTP 服务、模板系统和可视化编辑器提供稳定的底层渲染能力。
