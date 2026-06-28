# OpenHyperCore

OpenHyperCore 是一个面向低成本 CPU 服务器的视频剪辑渲染引擎原型。它用 TypeScript 描述 Scene Graph，使用 CanvasKit/Skia 做帧渲染，并通过 FFmpeg 输出 H.264/AAC MP4，目标是在不依赖 Chromium、无 GPU 的环境中提供比浏览器渲染链路更轻量、更可控的视频生成能力。

当前项目处于 alpha 阶段，核心 CLI 与渲染管线已经可用，但还不是完整的 HyperFrames 替代品。已实现的能力覆盖图文合成、字幕层、可复用电影感特效 helper、场景时间线编排、PNG still、无音频 MP4、音频合流、多音频混音、VideoLayer、本地素材 probe/cache、raw RGBA 视频帧批量解码、增量帧复用、worker_threads 帧级并行和 AWS 2CPU/2G benchmark 验证；服务化接口和发布打包流程仍在 Roadmap 中。

## 开源

OpenHyperCore 为开源 TypeScript 视频渲染内核，适合被集成到模板视频生成、批量剪辑、服务端渲染和自动化内容生产链路中。项目采用 MIT License，详见仓库根目录 `LICENSE` 文件。

## 功能特点

- Scene Graph IR：用纯数据描述 Composition、Layer、Transform、Keyframe，便于缓存、测试和后续服务化。
- TypeScript API 与轻量 JSX runtime：不引入 React，JSX/命令式写法最终都落到 Composition IR。
- CanvasKit/Skia 渲染后端：支持文本、矩形/圆形/path、图片和第一版本地 VideoLayer。
- SVG debug still 与 PNG still：可快速检查单帧布局，也可生成真实 CanvasKit PNG。
- CaptionLayer：支持时间段字幕、字体大小、颜色、背景色、padding、对齐和 transform 位置。
- 全属性 transform：每个图层都可用关键帧驱动 `x/y/scale/scaleX/scaleY/rotate/opacity`。关键帧可附带 easing（预设名、自定义函数，或 CSS 风格 `cubicBezier(x1,y1,x2,y2)` / `[x1,y1,x2,y2]` 元组），作用于“终止于该关键帧”的区间——任意轨道无需烘焙即可获得逐帧精确曲线，见 `examples/full-transform-easing.ts`。
- 转场 helper：提供 fade、slide、scale preset，并输出可复用 Scene Graph transform keyframes；支持 easing preset（`easeIn/easeOut/easeInOut/sine/quart/expo/back/elastic/bounce/...`、自定义缓动函数或贝塞尔元组），通过采样烘焙为关键帧。
- 时间线 DSL：`composeTimeline` 可将同一属性的多段动画按时间串联（如同一图层的入场淡入 + 出场淡出），`delayTransition` 可整体平移 transform 时间用于错峰编排。
- GroupLayer 预合成：`group` 图层在共享 transform 与组透明度下嵌套子图层（经 saveLayer 作为整体合成，无重叠双重混合）。子图层与 group 自身的关键帧都使用 group 本地时间轴，只改 `startMs` 即可整体搬移一段带动画的内容（对标 Remotion `<Sequence>` 语义），见 `examples/group-spring.ts`。
- Remotion 风格动画 API：`interpolate(t, inputRange, outputRange, { easing, extrapolateLeft/Right })` 支持多段映射；闭式解阻尼弹簧 `spring()` 与 `springKeyframes()` 可把物理弹簧运动烘焙为关键帧轨道。
- 场景级转场：`createTransitionSeries(...).scene(...).transition({ type, durationMs, direction, easing })` 串联整屏场景并产生真正重叠的转场——`wipe`、`clockWipe`（遮罩揭示）、`slide`（整屏推移）、`flip`（绕中心轴翻面）；相邻场景按转场时长重叠（对标 Remotion TransitionSeries 语义），见 `examples/scene-transitions.ts`。
- IR 新增逐轴缩放与揭示遮罩：`transform.scaleX/scaleY`（与统一 `scale` 相乘）；`GroupLayer.reveal`（`wipe`/`clock`，动画化 0→1 `progress`）把 group 裁剪到扫掠矩形或时钟楔形区域。
- 静态图层栅格缓存：内容跨帧不变（只有 transform/透明度/reveal 在动）的 group 只栅格化一次、之后直接贴图。缓存由成本模型驱动且自调优——实测每次直绘耗时，只缓存“直绘比预估贴图更慢”的子树，平价场景零回归，辉光/密集文字卡片自动加速。可用 `cache: false`（单个 group）或 `--no-layer-cache`（全局）关闭；图片图层另有跨帧解码缓存。
- 电影感特效 helper：`cinematicBars`、`flashTransitionLayer`、`speedLineBurst`、`glitchTitle` 可生成片头/转场常用 layer stack，减少手写大量图层。
- 场景时间线 builder：`createTimeline(...).scene(...).transition(...).build()` 可顺序编排命名场景和转场，并返回 Composition 与 timing markers。
- 图层 fit 模式：`ImageLayer.fit` 与 `VideoLayer.fit` 支持 `fill`（拉伸）、`cover`（居中裁切）、`contain`（letterbox 留边）；圆形裁切默认 `cover`。
- 视觉效果：渐变填充（`fill`/`color`/`backgroundColor` 接受 `{ type: "linear"|"radial", stops }`）、逐图层 `blendMode`（multiply/screen/overlay/add/...）、整层 `blur`（高斯模糊）与方向性 `motionBlur`（{ angle, distance, samples }），见 `examples/effects-showcase.ts`。
- 任意形状裁剪：任意图层（或整个 group）可设置 `clip` 为本地坐标系下的 `rect`（可带圆角 `radius`）、`circle` 或 SVG `path` 区域。
- 文本排版：text/caption 支持显式 `\n` 与按 `maxWidth` 自动换行（Latin 按词、CJK 按字），并支持逐行 `align`（left/center/right）。
- 字体：提供命名字体注册表（`registerFont(name, path)`）与逐字符 fallback 字体栈，支持彩色 emoji fallback（`registerEmojiFont`）。
- 字幕：`parseSubtitles` 解析 SRT/WebVTT 为带时间的 cue，`subtitlesToCaptions` 生成带样式、按时间显示的 CaptionLayer。
- FFmpeg 编码后端：通过 raw RGBA stdin pipe 输出 H.264/yuv420p MP4；有音频时输出 AAC。
- AudioLayer：支持单音频、多音频 amix、start/end、fadeIn/fadeOut；`volume` 既可为常量也可为关键帧包络（压低/渐强），编译为 FFmpeg 逐帧 volume 表达式。
- VideoLayer：支持从本地视频按时间点抽帧并贴入 Skia 画布，支持 `playbackRate`（变速）与 `loop`（在 trim 窗口内循环）；有 `width/height` 的视频层会按源视频尺寸批量解码 raw RGBA，绕过 PNG 中间格式与 CanvasKit 每帧图片解码。
- 资产 probe/cache：提供图片、视频、音频 metadata probe，以及任务级缓存 API。
- 帧级优化：连续视觉内容相同则复用 RGBA buffer，保持编码帧序和 PTS 不变。
- worker_threads 并行渲染池：支持 `--workers N`、`--workers auto`、`--worker-window N` 控制并行度与内存窗口。
- 持久帧缓存：`--cache-dir <dir>` 将解码后的 RGBA 帧按 源路径 + mtime/size + 时间 + 尺寸 落盘缓存，可跨渲染任务复用，并在指向同一目录的 worker 进程间共享。
- Benchmark：输出帧数、复用帧、worker 配置、音频 timeline、渲染耗时、编码耗时、峰值 RSS 等指标。

## 当前限制

- 仍是 alpha 工程原型，API 可能继续调整。
- VideoLayer 已具备源尺寸探测、任务级 raw RGBA 帧缓存、窗口化批量预取，并通过 `--cache-dir` 支持跨任务持久磁盘缓存（同时在 worker 间共享）。解码已按连续顺序批量 pass 进行（无逐帧 seek）；显式的 GOP/关键帧对齐调度仍是后续优化。
- 文本排版已支持多行换行、对齐、字体注册和 emoji fallback，但尚未支持行内富文本（单行内混合样式）或双向/复杂文种 shaping。
- 彩色 emoji fallback 依赖宿主机存在 emoji 字体（自动探测，或通过 `registerEmojiFont` 指定）；若没有，则 emoji 回退到默认字体。
- 转场 helper 已支持 easing preset、组合属性时间线 DSL（`composeTimeline`/`delayTransition`）与轻量场景时间线 builder；更完整的 track-based 编辑时间线仍是后续工作。
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
pnpm cli render examples/effects-opener.ts --out /tmp/openhyper-effects.mp4
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

`--cache-dir <dir>` 开启持久磁盘 RGBA 帧缓存：解码帧按 源路径 + mtime/size + 时间 + 尺寸 作为 key，可跨渲染复用，并在指向同一目录的 worker 进程间共享：

```bash
pnpm cli render examples/simple-video.ts --out /tmp/openhyper.mp4 --workers auto --cache-dir /tmp/openhyper-cache
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

### 真实视频 demo 对照

以下数据来自同一台 AWS 2CPU/2G 服务器。测试素材为服务器本地 ignored fixture `examples/demo.mp4`，用于模拟“快速下扶梯进入地铁”的真实视频剪辑；素材文件和生成视频不提交到 GitHub。

| renderer | scenario | total | render wall | encode | peak RSS | note |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| OpenHyperCore | PNG batch VideoLayer | 64.07s | 62.86s | 1.21s | 249MB | 已批量抽帧，但仍有 PNG 编码/解码 |
| OpenHyperCore | raw RGBA source-sized VideoLayer | 52.63s | 51.60s | 1.03s | 235MB | 绕过 PNG，中间帧按源视频 480x272 缓存 |
| OpenHyperCore | raw RGBA + 2 workers | 63.12s | 62.10s | 1.02s | 487MB | 2CPU 上 worker 路径仍慢于单线程 |
| HyperFrames | Chromium screenshot fallback | 162.63s | n/a | n/a | 212MB | 当前服务器 Chromium 缺少 beginFrame，走 screenshot fallback |

结论：真实视频剪辑下，raw RGBA VideoLayer 相比 PNG batch 路径约快 18%，相比该服务器上的 HyperFrames fallback 约快 3.1 倍。下一步性能瓶颈主要在 CanvasKit 逐帧合成和 worker 间视频帧缓存无法共享，2CPU 机器默认仍建议 single-thread。

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

特效 / 时间线片头示例：

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
  core/             Scene Graph IR、Composition 校验、调度器、关键帧、特效/时间线 helper
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
- M3.6：已完成任务级视频帧缓存、窗口化批量预取和 raw RGBA VideoLayer 解码，避免同一视频/同一时间点重复 FFmpeg 抽帧，并绕过 PNG 中间格式。
- M3.7：已完成基础 CaptionLayer，支持时间段文本、样式和位置。
- M3.8：已完成转场 preset、easing、组合 transform 时间线、电影感特效 helper 与轻量场景时间线 builder。
- M4.1：已完成 benchmark fixtures 与 `bench-suite`，对比 single-thread、worker、worker+window、静态复用路径。
- M4.2：已在 AWS 2CPU/2G 服务器上运行 benchmark，验证 1080p30/5s 与 <800MB 内存目标。
- M4.3：输出 benchmark 对比摘要 JSON，便于 CI 和服务器验收。
- M4.4：完成持久磁盘视频帧缓存加固，并修复部分缓存命中时 batch miss 顺序保持问题。
- M5：补齐项目模板、用户文档、错误提示、更完整 track-based 时间线和发布打包流程。

## 目标

OpenHyperCore 的长期目标是成为一个轻量、可编程、易部署的视频剪辑渲染内核：在低规格服务器上完成图文、图片、视频片段和音频的批量合成，并为后续 HTTP 服务、模板系统和可视化编辑器提供稳定的底层渲染能力。
