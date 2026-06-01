# OpenHyperCore 引擎技术方案

面向 AWS Lightsail 2vCPU/4GB 等轻量级无 GPU 服务器，构建一个剥离 Chromium、以 Skia + FFmpeg 为渲染/编码核心、支持 JSX 与命令式 Scene Graph 双形态 API 的 TypeScript 视频渲染引擎，MVP 交付为核心引擎 + CLI 本地渲染。

## 1. 关键约束（已确认）

- **部署目标**：AWS Lightsail 2vCPU / 4GB RAM，**无独立 GPU**。方案以 CPU 软件渲染 + 软件编码为主，GPU/NVENC 作为可选后端预留接口。
- **API 形态**：JSX/React 风格组件 + 命令式 Scene Graph API 双形态；JSX 在构建期编译为 Scene Graph IR。
- **MVP 范围**：核心引擎 + CLI，本地导出 MP4/WebM。不含 HTTP 服务、不含可视化时间线编辑器。
- **MVP 素材**：文本、矢量形状、位图、视频片段贴图、音频混音、基础转场（淡入淡出/位移/缩放）。Lottie/SVG 复杂动画延后。

## 2. 核心架构分层

```
┌─────────────────────────────────────────────────────┐
│  作者层  JSX 组件  /  TS Scene Graph API             │
├─────────────────────────────────────────────────────┤
│  编译层  JSX → Scene Graph IR (纯数据，可序列化)      │
├─────────────────────────────────────────────────────┤
│  调度层  Composition / Timeline / FrameScheduler    │
├─────────────────────────────────────────────────────┤
│  渲染层  Renderer 抽象 → SkiaBackend (默认)          │
│                       → WebGPUBackend (可选, 预留)    │
├─────────────────────────────────────────────────────┤
│  资源层  AssetLoader (image/video/audio) + Cache    │
├─────────────────────────────────────────────────────┤
│  编码层  Encoder 抽象 → FFmpegSWBackend (libx264)    │
│                      → HWBackend (NVENC/VT, 预留)    │
└─────────────────────────────────────────────────────┘
```

## 3. 技术选型

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 运行时 | **Bun** (优先) / Node 20+ | 启动快、原生 TS、FFI 性能高，内存占用比 Chromium 小一个数量级 |
| 渲染 | **CanvasKit (Skia WASM)** | 纯 CPU 也能跑、与 Chrome Canvas 同源、矢量+文本+图片栅格化质量高 |
| 文本排版 | Skia Paragraph / HarfBuzz (内置 CanvasKit) | 多语言、emoji、断行 |
| 视频解码贴图 | **FFmpeg (via @ffmpeg/ffmpeg-native 或 fluent-ffmpeg + libav 子进程)** | 抽帧到 RGBA buffer 喂 Skia |
| 编码 | **FFmpeg libx264 / libvpx-vp9** (软件) | 无 GPU 场景可跑；接口预留 NVENC/VideoToolbox |
| 音频 | FFmpeg `amix` + 自研 Timeline 混音器 | 与视频帧同时钟 |
| JSX | **esbuild** 编译 + 自定义 `jsx-runtime` | 不引入 React，运行时只生成 Scene Graph 节点 |
| 任务并发 | `worker_threads` × N (N = vCPU - 1) | 帧级并行，2vCPU 也能 +50% 吞吐 |

## 4. Scene Graph IR

最小节点集（MVP）：

- `Composition` 根节点：`fps`, `width`, `height`, `durationMs`
- `Layer` 公共属性：`startMs`, `endMs`, `transform{x,y,scale,rotate,opacity}`, `easing`
- `TextLayer`：`text`, `font`, `size`, `color`, `align`, `lineHeight`
- `ShapeLayer`：`path` (SVG-like) / `rect` / `circle`, `fill`, `stroke`
- `ImageLayer`：`src`, `fit`
- `VideoLayer`：`src`, `trimStart`, `trimEnd`, `volume`
- `AudioLayer`：`src`, `volume`, `fadeIn/Out`
- 动画：每个属性可绑 `Keyframe[]` 或 `Spring`/`Tween` 描述（不依赖 requestAnimationFrame，时间由调度器驱动）

IR 是纯 JSON，可缓存、可分布式分发，是后续服务化与"AI 改代码即改数据"的基础。

## 5. 渲染管线（每帧）

1. `FrameScheduler` 按 `fps` 推进 `t`，向 Scene Graph 求值（Pure Function：IR + t → ResolvedFrame）。
2. **增量判定**：对比上一帧 ResolvedFrame 哈希，若完全相同 → 通知 Encoder `duplicate_frame`，跳过绘制（README 提到的跳帧优化）。
3. Skia 绘制到 `Surface`（RGBA 像素 buffer）。
4. 像素 buffer 经 **共享内存 / pipe** 直接喂给 FFmpeg `rawvideo` 输入，避免 PNG 编解码往返（软件版"零拷贝近似"）。
5. Worker 池按 GOP 切片并行渲染，主进程负责合流与音频对齐。

## 6. 音视频同步

- 主时钟：`Composition.fps` 推导的 PTS（µs 精度）。
- 音频：所有 `AudioLayer` 在 `AudioMixer` 中按全局时钟重采样到 48kHz/stereo，输出 PCM。
- FFmpeg 合流：`-i video.raw -i audio.pcm -c:v libx264 -c:a aac -shortest`，PTS 由我们生成，杜绝漂移。

## 7. CLI 设计（MVP）

```bash
openhyper render src/MyVideo.tsx --out out.mp4 --fps 30 --size 1920x1080
openhyper render --ir scene.json --out out.mp4
openhyper probe src/MyVideo.tsx          # 打印 IR + 预估耗时
openhyper still src/MyVideo.tsx --t 2.5 --out frame.png
```

入口示例（JSX 形态）：

```tsx
export default function MyVideo() {
  return (
    <Composition fps={30} width={1920} height={1080} duration={5_000}>
      <ImageLayer src="bg.jpg" fit="cover" />
      <TextLayer text="Hello" size={120} from={0} to={2000}
        animate={{ opacity: [0, 1], y: [40, 0] }} />
    </Composition>
  );
}
```

## 8. 性能目标（Lightsail 2vCPU/4GB）

- 1080p30 / 5s 简单图文：**< 实时 1.5×**（≈ 7.5s 渲染完）
- 内存峰值：< 800MB（Skia + FFmpeg + Bun）
- 单机并发：1 个任务跑满 CPU；横向扩展靠多实例 + 队列（非 MVP）。

对比：基于 Puppeteer + Remotion 在同档机器上常需 2GB+ 且接近或低于实时。

## 9. 仓库结构（建议）

```
openHyperCore/
├─ packages/
│  ├─ core/          # Scene Graph IR、调度器、动画求值
│  ├─ jsx-runtime/   # 自定义 jsx → IR
│  ├─ renderer-skia/ # CanvasKit 后端
│  ├─ renderer-gpu/  # WebGPU 后端 (占位)
│  ├─ encoder-ffmpeg/
│  ├─ assets/        # 图/视频/音频加载与缓存
│  └─ cli/           # openhyper 命令
├─ examples/
└─ bench/
```

包管理：pnpm workspace；构建：tsup/esbuild；测试：vitest + 像素对比 (pixelmatch)。

## 10. 里程碑

| # | 内容 | 产出 |
| --- | --- | --- |
| M1 | Scene Graph IR + JSX runtime + 单帧 PNG 导出（仅 Text/Shape/Image） | `openhyper still` 可用 |
| M2 | FrameScheduler + 软件编码 → MP4（无音频） | `openhyper render` 可出无声视频 |
| M3 | VideoLayer 抽帧贴图 + AudioMixer + 合流 | 完整 MVP |
| M4 | Worker 并行 + 增量跳帧 + 基准测试 | 性能达标 |
| M5（非 MVP） | WebGPU 后端、HTTP 服务、Lottie/SVG、Web 预览 UI | 路线图 |

## 11. 风险与缓解

- **CanvasKit WASM 体积/启动**：首启 ~8MB；用常驻进程 + 预热缓解。
- **2vCPU 真实吞吐有限**：明确定位为"低成本 + 高密度多实例"，不在单机追求 10× 实时；大客户场景再切 GPU 后端。
- **FFmpeg 进程通信开销**：用 stdin pipe + rawvideo，避免落盘；后续可换 libav FFI。
- **字体/中文/Emoji**：内置常用字体 fallback 链，提供 `registerFont` API。
- **JSX 与"AI 改代码"友好度**：所有动画属性走声明式 keyframes，避免命令式副作用，便于程序化修改。

## 12. 已确认技术决策

- ✅ 运行时：**Bun** 为主，Node 20+ 作为兼容选项
- ✅ 字体打包：默认内置 Noto Sans CJK + Noto Color Emoji（约 30MB）
- ✅ 输出格式：默认 **MP4 (H.264 + AAC)**，WebM 作为可选扩展

## 13.测试服务器: ssh -i /Users/gongbin/Documents/my/aws/awscn.pem ubuntu@ec2-52-80-19-204.cn-north-1.compute.amazonaws.com.cn  项目建议放在 /var/www 下

## 14. 下一步

方案已确认，可进入实施阶段：
1. 初始化 monorepo 结构（pnpm workspace）
2. 搭建 `@openhyper/core` Scene Graph IR + 类型定义
3. 实现 `@openhyper/jsx-runtime` 自定义 JSX 转换
4. 集成 CanvasKit + 单帧渲染 POC
5. 按 M1→M2→M3→M4 里程碑推进

## 15. 当前实施状态（2026-05-28）

项目名称已统一为 **OpenHyperCore / `openhypercore`**，CLI 命令名统一为 `openhyper`。

已完成 M1 的可测试最小切片，代码按计划拆分为：

- `packages/core`：Scene Graph IR、Composition 校验、帧数/时间换算、关键帧插值、ResolvedFrame 求值。
- `packages/jsx-runtime`：自定义 `jsx/jsxs` runtime 与 `Composition`、`TextLayer`、`ShapeLayer`、`ImageLayer` 工厂，输出纯 JSON IR。
- `packages/renderer-svg`：临时单帧 SVG 后端，用于在 CanvasKit 接入前验证调度与渲染边界。
- `packages/cli`：`openhyper probe` 与 `openhyper still` 的本地 CLI 入口。
- `examples/simple-video.ts`：命令式 Scene Graph 示例。

当前验证命令：

```bash
pnpm check
pnpm build
pnpm test
pnpm cli probe examples/simple-video.ts
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/openhyper-frame.svg
node dist/packages/cli/src/index.js probe examples/simple-video.ts
```

实施计划已补充到 `docs/superpowers/plans/2026-05-28-m1-core-cli.md`。

已完成 M1.1：

1. 引入 TypeScript 构建链路：`pnpm check`、`pnpm build`。
2. 增加 `tsconfig.json` 与 `tsconfig.build.json`，构建产物输出到 `dist/`。
3. 根包暴露 `openhyper` bin 与 `./core`、`./jsx-runtime`、`./renderer-svg`、`./cli` exports。
4. 保留 Node 24 `--experimental-strip-types` 测试路径，构建路径使用 `tsc` 输出 JS/DTS。

已完成 M1.2：

1. 新增 `packages/renderer-skia`，使用 `canvaskit-wasm` 在 Node 下创建 raster surface，并输出 PNG buffer。
2. `renderer-skia` 已支持 MVP still 所需的 `TextLayer`、`ShapeLayer`（rect/circle/path）和基础本地 `ImageLayer` decode。
3. `openhyper still` 新增 `--format svg|png`，默认仍为 SVG debug backend，显式 `--format png` 走 CanvasKit。
4. 构建产物 CLI 已验证可生成 PNG。

当前新增验证命令：

```bash
pnpm cli still examples/simple-video.ts --t 1 --out /tmp/openhyper-frame.png --format png
node dist/packages/cli/src/index.js still examples/simple-video.ts --t 1 --out /tmp/openhyper-dist-frame.png --format png
```

已完成 M2 的第一版无音频 MP4 render 路径：

1. 新增 `packages/encoder-ffmpeg`，通过 `child_process.spawn` 启动 FFmpeg。
2. 当前编码路径使用 CanvasKit 逐帧输出 PNG buffer，经 FFmpeg `image2pipe` 写入 stdin，编码为 H.264 / yuv420p MP4。
3. `openhyper render <composition.ts> --out out.mp4` 已接入，默认自动解析 `@ffmpeg-installer/ffmpeg`，缺失时回退到 PATH 中的 `ffmpeg`。
4. 编码器支持注入 `--ffmpeg-path` 与 `--ffmpeg-arg-prefix`，用于测试和后续部署环境定制。

当前新增验证命令：

```bash
node dist/packages/cli/src/index.js render examples/simple-video.ts --out /tmp/openhyper.mp4
```

已完成 M2.1：

1. `packages/renderer-skia` 新增 `renderRgbaFrame()`，通过 CanvasKit `readPixels` 直接输出 `width * height * 4` RGBA buffer。
2. `packages/encoder-ffmpeg` 新增 `buildRawVideoPipeArgs()` 与 `encodeRawVideoFrames()`。
3. `openhyper render` 默认切换为 FFmpeg `rawvideo` stdin pipe：`-f rawvideo -pix_fmt rgba -s WxH -framerate FPS -i pipe:0`。
4. 保留 PNG still 路径和 PNG pipe 编码器函数，便于 debug 与回退。

当前新增验证命令：

```bash
node dist/packages/cli/src/index.js render examples/simple-video.ts --out /tmp/openhyper-raw.mp4
```

已完成 M2.2：

1. 增加 `openhyper render --fps`、`--size` 覆盖参数。
2. 增加 `openhyper bench <composition.ts> --out report.json --video-out out.mp4`，记录 `frames`、`renderMs`、`encodeMs`、`totalMs`、`peakRssBytes`。
3. Benchmark 与 render 共用单进程 raw RGBA pipe，用作 Worker 池前的性能基线。

当前新增验证命令：

```bash
node dist/packages/cli/src/index.js render examples/simple-video.ts --out /tmp/openhyper-override.mp4 --fps 12 --size 640x360
node dist/packages/cli/src/index.js bench examples/simple-video.ts --out /tmp/openhyper-bench.json --video-out /tmp/openhyper-bench.mp4 --fps 12 --size 640x360
```

已完成 M3 的第一版单音频合流：

1. 实现 `AudioLayer` 的最小音频输入支持。
2. `openhyper render` 会自动读取第一个 `AudioLayer` 的 `src`，作为 FFmpeg 第二输入。
3. FFmpeg 输出参数在存在音频时切换为 H.264 + AAC，并添加 `-shortest` 保持音视频时长对齐。
4. 无音频 composition 仍保留 `-an` 输出路径。

当前新增验证命令：

```bash
node dist/packages/cli/src/index.js render /tmp/openhyper-audio-video.ts --out /tmp/openhyper-audio.mp4
```

真实 smoke 输出已确认包含：

- Video: `h264`, `yuv420p`
- Audio: `aac (LC)`, 48000 Hz mono

已完成 M3.1：

1. 支持 `AudioLayer.startMs/endMs/volume` 映射到 FFmpeg `adelay`、`atrim`、`volume`。
2. 支持多个 `AudioLayer` 的 FFmpeg `amix` 合流。
3. `packages/encoder-ffmpeg` 新增 `audioInputs` 参数，保留旧 `audioFile` 单输入兼容路径。
4. CLI 会把所有 `AudioLayer` 转换为 `audioInputs`，并保留无音频/单音频路径。

当前新增验证命令：

```bash
node dist/packages/cli/src/index.js render /tmp/openhyper-mix-video.ts --out /tmp/openhyper-mix.mp4
```

真实 smoke 输出已确认包含：

- Video: `h264`, `yuv420p`
- Audio: `aac (LC)`, 48000 Hz mono
- FFmpeg filter graph: `atrim` + `asetpts` + `volume` + `adelay` + `amix`

已完成 M3.2：

1. 支持 `AudioLayer.fadeInMs/fadeOutMs` 映射到 FFmpeg `afade`。
2. `fadeInMs` 在裁剪后的音频时间轴从 0 开始淡入；`fadeOutMs` 基于 `endMs - startMs` 计算淡出起点。
3. `fadeOutMs` 需要可计算的音频时长，目前要求同时提供 `endMs`，避免生成位置不确定的淡出滤镜。
4. filter graph 顺序为 `atrim` -> `asetpts` -> `volume` -> `afade` -> `adelay`，确保淡入/淡出发生在 layer 本地时间轴，再延迟到 composition 时间轴。

当前新增验证命令：

```bash
node dist/packages/cli/src/index.js render /tmp/openhyper-fade-video.ts --out /tmp/openhyper-fade.mp4
```

真实 smoke 输出已确认包含：

- Video: `h264`, `yuv420p`
- Audio: `aac (LC)`, 48000 Hz mono
- FFmpeg filter graph: `afade=t=in` + `afade=t=out`

已完成 M3.3：

1. `openhyper bench` 增加视频 duration/PTS 指标：`durationMs`、`frameDurationMs`、`firstFrameTimeMs`、`lastFrameTimeMs`、`encodedVideoDurationMs`。
2. `openhyper bench` 增加音频 timeline 指标：`audioInputs`、`audioTimelineStartMs`、`audioTimelineEndMs`、`audioTimelineDurationMs`。
3. 音频 timeline 目前基于 `AudioLayer.startMs/endMs` 汇总；未显式设置 `endMs` 时按 composition duration 估算。

已完成 M4 的第一版增量跳帧基础：

1. 渲染管线会对连续帧的视觉内容生成稳定 hash。
2. 当视觉内容未变化时，复用上一帧 RGBA buffer，跳过 CanvasKit 绘制，但仍按帧序写入 FFmpeg，保持 PTS 和输出时长稳定。
3. `bench` 新增 `renderedFrames` 与 `reusedFrames`，用于衡量增量复用效果。

已完成 M4 的第一版 worker_threads 帧级渲染池：

1. `openhyper render` 与 `openhyper bench` 新增 `--workers N` 参数；默认 `N=1` 保持单线程路径。
2. 当 `N > 1` 时，主线程仍负责时间轴解析、连续帧复用判定、FFmpeg 写入顺序；worker 只负责非复用帧的 CanvasKit RGBA raster。
3. `bench` 新增 `renderMode` 与 `workerCount`，用于区分 `single_thread` 与 `worker_threads` 路径。
4. worker 路径按原始 frame index 顺序输出，保证编码帧序稳定。

已完成 M4 的 worker 流式预取窗口：

1. `openhyper render` 与 `openhyper bench` 新增 `--worker-window N` 参数；仅在 `--workers N` 大于 1 时生效。
2. worker 路径改为按窗口分批预取非复用帧，每批最多保留 `workerWindow` 个新渲染 RGBA frame，避免长视频一次性缓存全部非复用帧。
3. `bench` 新增 `workerWindow` 与 `maxBufferedFrames`，用于验证 worker 路径的帧缓存上限。
4. 默认窗口为 `workerCount * 2`，可通过 `--worker-window` 针对低内存实例收紧。

已完成 M4 的 worker 自动选择策略：

1. `openhyper render` 与 `openhyper bench` 的 `--workers` 参数支持 `auto`。
2. `auto` 策略基于 Node `availableParallelism()`，选择 `availableParallelism() - 1`，最少 1、最多 4，给主线程和 FFmpeg 保留 CPU 余量。
3. `bench` 新增 `workerSelection`，用于区分 `manual` 与 `auto` worker 策略。
4. 当 `auto` 解析为 1 时仍走单线程路径；大于 1 时走 `worker_threads` 路径。

已完成 M4 的 worker timing 指标拆分：

1. `bench` 新增 `renderWallMs`，表示主流程等待 raster 完成的墙钟时间。
2. `bench` 新增 `renderCpuMs`，表示单线程 raster 时间或各 worker 回传 raster 时间之和。
3. 兼容字段 `renderMs` 现在等于 `renderWallMs`，避免 worker 模式下 `renderMs` 大于 `totalMs`。
4. `encodeMs` 改为基于 `totalMs - renderWallMs` 估算，适合和 worker 并行路径对比。

当前新增验证命令：

```bash
node dist/packages/cli/src/index.js bench /tmp/openhyper-m33m4-video.mjs --out /tmp/openhyper-m33m4-bench.json --video-out /tmp/openhyper-m33m4.mp4
```

真实 smoke 输出已确认：

- `frames`: 24
- `renderedFrames`: 1
- `reusedFrames`: 23
- `audioInputs`: 1
- Video: `h264`, `yuv420p`
- Audio: `aac (LC)`, 48000 Hz mono

Worker smoke 输出已确认：

```bash
node dist/packages/cli/src/index.js bench /tmp/openhyper-worker-video.mjs --out /tmp/openhyper-worker-bench.json --video-out /tmp/openhyper-worker.mp4 --workers 2
```

- `renderMode`: `worker_threads`
- `workerCount`: 2
- `frames`: 9
- `renderedFrames`: 9
- `reusedFrames`: 0
- Video: `h264`, `yuv420p`
- Audio: `aac (LC)`, 48000 Hz mono

Worker window smoke 输出已确认：

```bash
node dist/packages/cli/src/index.js bench /tmp/openhyper-window-video.mjs --out /tmp/openhyper-window-bench.json --video-out /tmp/openhyper-window.mp4 --workers 2 --worker-window 3
```

- `renderMode`: `worker_threads`
- `workerCount`: 2
- `workerWindow`: 3
- `frames`: 20
- `renderedFrames`: 20
- `maxBufferedFrames`: 3
- Video: `h264`, `yuv420p`
- Audio: `aac (LC)`, 48000 Hz mono

Worker auto smoke 输出已确认：

```bash
node dist/packages/cli/src/index.js bench /tmp/openhyper-auto-video.mjs --out /tmp/openhyper-auto-bench.json --video-out /tmp/openhyper-auto.mp4 --workers auto
```

- `workerSelection`: `auto`
- `renderMode`: `worker_threads`
- `workerCount`: 4
- `workerWindow`: 8
- `frames`: 8
- Video: `h264`, `yuv420p`
- Audio: `aac (LC)`, 48000 Hz mono

Worker timing smoke 输出已确认：

```bash
node dist/packages/cli/src/index.js bench /tmp/openhyper-auto-video.mjs --out /tmp/openhyper-timing-bench.json --video-out /tmp/openhyper-timing.mp4 --workers auto
```

- `renderMs`: 68.528
- `renderWallMs`: 68.528
- `renderCpuMs`: 156.171
- Video: `h264`, `yuv420p`
- Audio: `aac (LC)`, 48000 Hz mono

下一阶段建议继续 M4：

1. 增加真实 workload benchmark fixtures，对比单线程、增量复用、Worker 池三种路径。
2. 输出 benchmark 对比摘要，例如 single-thread / worker / worker+window 三组 JSON。
3. 支持音频资源 probe/cache，减少重复输入文件探测。

## 16. 待完成 TODO（按取代 HyperFrames 优先级）

- [x] M3.4：实现 `VideoLayer` 本地视频帧贴图，支持 `src`、`trimStartMs`、`startMs/endMs`、基础 `width/height`。
- [ ] M3.5：新增 `packages/assets`，提供图片/视频/音频 probe、尺寸/时长元信息、按任务缓存。
- [ ] M3.6：实现视频帧缓存与预取，避免同一视频/同一时间点重复 FFmpeg 抽帧。
- [ ] M3.7：实现字幕/CaptionLayer 基础能力，支持时间段文本、样式、位置。
- [ ] M3.8：实现基础转场 preset：fade、slide、scale，并输出可复用 Scene Graph helper。
- [ ] M4.1：增加真实 workload benchmark fixtures，对比 single-thread、worker、worker+window、静态复用路径。
- [ ] M4.2：在 AWS Lightsail 2vCPU/4GB 上运行 benchmark，验证 1080p30/5s 与内存目标。
- [ ] M4.3：输出 benchmark 对比摘要 JSON，便于 CI 和服务器验收。
- [ ] M5：补齐项目模板、用户文档、错误提示、发布打包流程。

已完成 M3.4 的第一版 VideoLayer：

1. `VideoLayer` 类型新增 `width`、`height`、`fit` 字段，为视频贴图尺寸控制预留接口。
2. `renderer-skia` 支持本地视频文件贴图：按 `frame.timeMs - layer.startMs + trimStartMs` 计算视频时间点，调用 FFmpeg 抽取单帧 PNG，再交给 CanvasKit 解码绘制。
3. `openhyper render` 已可输出包含视频贴图的 H.264 MP4。
4. 当前版本为 correctness-first：尚未做视频帧缓存、probe、批量预取；这些继续由 M3.5/M3.6 跟进。

当前新增验证命令：

```bash
node dist/packages/cli/src/index.js render /tmp/openhyper-video-layer-composition.mjs --out /tmp/openhyper-video-layer.mp4 --workers 2 --worker-window 2
```

真实 smoke 输出已确认：

- Video: `h264`, `yuv420p`, 320x180, 6 fps
- VideoLayer 源视频由 FFmpeg `testsrc` 生成，Skia 渲染路径可抽帧并合成输出。
