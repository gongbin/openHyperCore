# OpenHyperCore

OpenHyperCore 是一个面向低成本 CPU 服务器的视频剪辑渲染引擎原型。它用 TypeScript 描述 Scene Graph，使用 CanvasKit/Skia 做帧渲染，并通过 FFmpeg 输出 H.264/AAC MP4，目标是在不依赖 Chromium、无 GPU 的环境中提供比浏览器渲染链路更轻量、更可控的视频生成能力。

当前项目处于 alpha 阶段，核心 CLI 与渲染管线已经可用，但还不是完整的 HyperFrames 替代品。已实现的能力覆盖图文合成、PNG still、无音频 MP4、音频合流、多音频混音、基础视频贴图、增量帧复用和 worker_threads 帧级并行；素材缓存、字幕层、转场 preset、服务化接口和生产级 benchmark 仍在 Roadmap 中。

## 功能特点

- Scene Graph IR：用纯数据描述 Composition、Layer、Transform、Keyframe，便于缓存、测试和后续服务化。
- TypeScript API 与轻量 JSX runtime：不引入 React，JSX/命令式写法最终都落到 Composition IR。
- CanvasKit/Skia 渲染后端：支持文本、矩形/圆形/path、图片和第一版本地 VideoLayer。
- SVG debug still 与 PNG still：可快速检查单帧布局，也可生成真实 CanvasKit PNG。
- FFmpeg 编码后端：通过 raw RGBA stdin pipe 输出 H.264/yuv420p MP4；有音频时输出 AAC。
- AudioLayer：支持单音频、多音频 amix、start/end、volume、fadeIn/fadeOut。
- VideoLayer：支持从本地视频按时间点抽帧并贴入 Skia 画布。
- 帧级优化：连续视觉帧 hash 相同则复用 RGBA buffer，保持编码帧序和 PTS 不变。
- worker_threads 并行渲染池：支持 `--workers N`、`--workers auto`、`--worker-window N` 控制并行度与内存窗口。
- Benchmark：输出帧数、复用帧、worker 配置、音频 timeline、渲染耗时、编码耗时、峰值 RSS 等指标。

## 当前限制

- 仍是 alpha 工程原型，API 可能继续调整。
- VideoLayer 目前是 correctness-first：每个需要的视频帧会调用 FFmpeg 抽帧，尚未实现视频帧缓存、probe 和批量预取。
- `ImageLayer.fit` 与 `VideoLayer.fit` 已预留类型，但当前 Skia 绘制主要按 `width/height` 拉伸绘制。
- 文本排版仍是基础 Skia font 绘制，尚未补齐复杂断行、字体注册和 emoji fallback。
- 尚未实现 `packages/assets`、CaptionLayer、转场 helper、HTTP 服务、可视化编辑器和发布打包流程。

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

## 仓库结构

```text
packages/
  core/             Scene Graph IR、Composition 校验、调度器、关键帧求值
  jsx-runtime/      自定义 JSX runtime，输出 IR
  renderer-svg/     SVG debug still 后端
  renderer-skia/    CanvasKit PNG/RGBA 渲染后端
  encoder-ffmpeg/   FFmpeg rawvideo/image pipe、H.264/AAC 编码、音频 filter graph
  cli/              openhyper CLI、render/bench、worker_threads 调度
examples/           示例 Composition
docs/               开发计划与实施记录
```

## Roadmap

- M3.5：新增 `packages/assets`，提供图片/视频/音频 probe、尺寸/时长元信息和任务级缓存。
- M3.6：实现视频帧缓存与预取，避免同一视频/同一时间点重复 FFmpeg 抽帧。
- M3.7：实现 CaptionLayer，支持时间段文本、样式和位置。
- M3.8：实现基础转场 preset：fade、slide、scale。
- M4.1：增加真实 workload benchmark fixtures，对比 single-thread、worker、worker+window、静态复用路径。
- M4.2：在 AWS Lightsail 2vCPU/4GB 上运行 benchmark，验证 1080p30/5s 与内存目标。
- M4.3：输出 benchmark 对比摘要 JSON，便于 CI 和服务器验收。
- M5：补齐项目模板、用户文档、错误提示和发布打包流程。

## 目标

OpenHyperCore 的长期目标是成为一个轻量、可编程、易部署的视频剪辑渲染内核：在低规格服务器上完成图文、图片、视频片段和音频的批量合成，并为后续 HTTP 服务、模板系统和可视化编辑器提供稳定的底层渲染能力。
