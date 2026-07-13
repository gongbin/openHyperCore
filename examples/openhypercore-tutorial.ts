// openHyperCore 全景介绍片 — 全程由 openHyperCore 渲染。
// 结构（88s @ 1920×1080）：
//   S1 霓虹片头 → S2 代码即视频（左代码右舞台镜像）→ S3 引擎能力矩阵
//   → S4 插件系统（真实插件并排跑）→ S5-S7 openHyperEditor 实录（三步成片 /
//   画布动画 / 插件库）→ S8 渲染管线与性能 → S9 尾版
// 编辑器录屏素材由 examples/assets/editor-*.mp4 提供（Playwright 实录）；
// 配乐由 examples/assets/build-tutorial-music.ts 离线合成。
import { defineComposition, springKeyframes } from "../packages/core/src/index.ts";
import type { Fill, Layer, ScalarKeyframe } from "../packages/core/src/index.ts";

const W = 1920;
const H = 1080;
const FPS = 30;
const DUR = 88_000;

const FONT = "/System/Library/Fonts/STHeiti Medium.ttc";
const FONT_FUN = "examples/assets/ZCOOLKuaiLe-Regular.ttf";

const MINT = "#7dffcf";
const GOLD = "#ffd166";
const CORAL = "#ff5d73";
const BLUE = "#4f8cff";
const INK = "#060b16";
const TEXT = "#f2f7ff";
const MUTED = "rgba(214,230,248,0.72)";

const EMPH: [number, number, number, number] = [0.2, 0, 0, 1];
const EXIT: [number, number, number, number] = [0.4, 0, 1, 1];

const heroGradient: Fill = {
  type: "linear",
  from: [0, 0],
  to: [900, 0],
  stops: [
    { offset: 0, color: MINT },
    { offset: 0.5, color: "#f8f7ff" },
    { offset: 1, color: GOLD }
  ]
};

function kf(t0: number, t1: number, v0: number, v1: number, easing: ScalarKeyframe["easing"] = EMPH): ScalarKeyframe[] {
  return [
    { timeMs: t0, value: v0 },
    { timeMs: t1, value: v1, easing }
  ];
}

function fade(t0: number, t1: number, inMs = 320, outMs = 320, peak = 1): ScalarKeyframe[] {
  return [
    { timeMs: t0, value: 0 },
    { timeMs: t0 + inMs, value: peak, easing: EMPH },
    { timeMs: Math.max(t0 + inMs, t1 - outMs), value: peak },
    { timeMs: t1, value: 0, easing: EXIT }
  ];
}

// 入场：淡入 + 轻微上移；驻留到 endMs（无出场，交给场景组淡出）。
function rise(t0: number, y: number, dist = 26, inMs = 420): { y: ScalarKeyframe[]; opacity: ScalarKeyframe[] } {
  return {
    y: kf(t0, t0 + inMs, y + dist, y),
    opacity: kf(t0, t0 + inMs, 0, 1)
  };
}

function rect(id: string, t0: number, t1: number, x: number, y: number, width: number, height: number, fill: Fill, opts: {
  opacity?: number | ScalarKeyframe[];
  radius?: number;
  blur?: number | ScalarKeyframe[];
  stroke?: string;
  strokeWidth?: number;
} = {}): Layer {
  const layer: Layer = {
    type: "shape",
    id,
    shape: "rect",
    width,
    height,
    fill,
    startMs: t0,
    endMs: t1,
    transform: { x, y, opacity: opts.opacity ?? 1 }
  };
  if (opts.blur !== undefined) layer.blur = opts.blur;
  // 注意：shape 的 stroke 会替代填充而非叠加，这里刻意不使用（opts.stroke 忽略）。
  if (opts.radius) layer.clip = { type: "rect", width, height, radius: opts.radius };
  return layer;
}

type TextOpts = {
  align?: "left" | "center" | "right";
  maxWidth?: number;
  lineHeight?: number;
  font?: string;
  letterSpacing?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  x?: number | ScalarKeyframe[];
  yTrack?: ScalarKeyframe[];
  scale?: number | ScalarKeyframe[];
};

function text(id: string, t0: number, t1: number, value: string, x: number, y: number, size: number, color: Fill = TEXT, opacity: number | ScalarKeyframe[] = 1, opts: TextOpts = {}): Layer {
  const layer: Layer = {
    type: "text",
    id,
    text: value,
    size,
    color,
    startMs: t0,
    endMs: t1,
    transform: { x: opts.x ?? x, y: opts.yTrack ?? y, opacity }
  };
  if (opts.scale !== undefined) layer.transform!.scale = opts.scale;
  if (opts.align) layer.align = opts.align;
  if (opts.maxWidth) layer.maxWidth = opts.maxWidth;
  if (opts.lineHeight) layer.lineHeight = opts.lineHeight;
  if (opts.font) layer.font = opts.font;
  if (opts.letterSpacing) layer.letterSpacing = opts.letterSpacing;
  if (opts.stroke) { layer.stroke = opts.stroke; layer.strokeWidth = opts.strokeWidth ?? 3; }
  if (opts.shadowColor) { layer.shadowColor = opts.shadowColor; layer.shadowBlur = opts.shadowBlur ?? 12; }
  return layer;
}

function path(id: string, t0: number, t1: number, d: string, stroke: string, strokeWidth: number, opts: {
  opacity?: number | ScalarKeyframes;
  trimEnd?: number | ScalarKeyframe[];
  blur?: number | ScalarKeyframe[];
  dash?: number[];
} = {}): Layer {
  const layer: Layer = {
    type: "shape",
    id,
    shape: "path",
    path: d,
    fill: "rgba(0,0,0,0)",
    stroke,
    strokeWidth,
    startMs: t0,
    endMs: t1,
    transform: { opacity: opts.opacity ?? 1 }
  };
  if (opts.trimEnd !== undefined) { layer.trimStart = 0; layer.trimEnd = opts.trimEnd; }
  if (opts.blur !== undefined) layer.blur = opts.blur;
  if (opts.dash) layer.dash = opts.dash;
  return layer;
}
type ScalarKeyframes = ScalarKeyframe[];

// 底部说明字幕（caption 层自带背景框）。
function note(id: string, t0: number, t1: number, value: string): Layer {
  return {
    type: "caption",
    id,
    text: value,
    size: 29,
    color: "#ecf5ff",
    backgroundColor: "rgba(5,11,20,0.78)",
    padding: 16,
    align: "center",
    maxWidth: 1560,
    startMs: t0,
    endMs: t1,
    transform: { x: W / 2, y: 992, opacity: fade(t0, t1, 260, 260) }
  };
}

// 场景左上角标题 + 副标题（sub 传空串则省略）。
function heading(id: string, t1: number, index: string, title: string, sub: string): Layer[] {
  const a = rise(120, 96);
  const b = rise(260, 168);
  const layers = [
    text(`${id}-index`, 0, t1, index, 120, 96, 24, MINT, a.opacity, { letterSpacing: 6, yTrack: a.y }),
    text(`${id}-title`, 120, t1, title, 120, 134, 46, heroGradient, kf(120, 540, 0, 1), { shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 8 })
  ];
  if (sub) layers.push(text(`${id}-sub`, 260, t1, sub, 120, 206, 25, MUTED, b.opacity, { yTrack: b.y }));
  return layers;
}

// ---------------------------------------------------------------- background
function backgroundLayers(): Layer[] {
  const bg: Fill = {
    type: "linear",
    from: [0, 0],
    to: [W, H],
    stops: [
      { offset: 0, color: "#070d1a" },
      { offset: 0.5, color: "#0a1120" },
      { offset: 1, color: "#071019" }
    ]
  };
  // 半径不超过矩形内切距离，保证 alpha 在矩形边缘前衰减到 0（否则矩形边可见）。
  const glowA: Fill = {
    type: "radial",
    center: [340, 340],
    radius: 336,
    stops: [
      { offset: 0, color: "rgba(125,255,207,0.10)" },
      { offset: 1, color: "rgba(125,255,207,0)" }
    ]
  };
  const glowB: Fill = {
    type: "radial",
    center: [420, 300],
    radius: 296,
    stops: [
      { offset: 0, color: "rgba(79,140,255,0.10)" },
      { offset: 1, color: "rgba(79,140,255,0)" }
    ]
  };
  const vignette: Fill = {
    type: "radial",
    center: [W / 2, H / 2],
    radius: 1220,
    stops: [
      { offset: 0, color: "rgba(0,0,0,0)" },
      { offset: 0.72, color: "rgba(0,0,0,0)" },
      { offset: 1, color: "rgba(0,0,0,0.42)" }
    ]
  };
  return [
    rect("bg", 0, DUR, 0, 0, W, H, bg),
    { // 缓慢漂移的冷暖双辉，给全片一点呼吸感
      type: "shape", id: "bg-glow-a", shape: "rect", width: 680, height: 680, fill: glowA,
      startMs: 0, endMs: DUR,
      transform: { x: [{ timeMs: 0, value: -160 }, { timeMs: DUR, value: 240 }], y: [{ timeMs: 0, value: -120 }, { timeMs: DUR, value: 80 }] }
    },
    {
      type: "shape", id: "bg-glow-b", shape: "rect", width: 840, height: 600, fill: glowB,
      startMs: 0, endMs: DUR,
      transform: { x: [{ timeMs: 0, value: 1400 }, { timeMs: DUR, value: 1080 }], y: [{ timeMs: 0, value: 620 }, { timeMs: DUR, value: 380 }] }
    },
    rect("bg-vignette", 0, DUR, 0, 0, W, H, vignette),
    { // 底部进度线：本片时间轴本身也是一层 shape
      type: "shape", id: "progress", shape: "rect", width: W, height: 4, fill: MINT,
      startMs: 0, endMs: DUR,
      transform: { x: 0, y: H - 4, opacity: 0.32, scaleX: [{ timeMs: 0, value: 0.002 }, { timeMs: DUR, value: 1 }] }
    }
  ];
}

// ---------------------------------------------------------------- S1 hero
function s1Hero(): Layer {
  const T = 5000;
  const sub = rise(2300, 720);
  return {
    type: "group",
    id: "s1",
    startMs: 0,
    endMs: T,
    transform: { opacity: [{ timeMs: 0, value: 1 }, { timeMs: T - 480, value: 1 }, { timeMs: T, value: 0, easing: EXIT }] },
    layers: [
      { type: "plugin", plugin: "neon-trace-title", params: { text: "openHyperCore", size: 148, color: MINT, glow: 26, traceMs: 2100, background: INK }, startMs: 0, endMs: 4600 },
      text("s1-sub", 2300, T, "用 TypeScript 描述视频 · Skia 逐帧渲染 · FFmpeg 输出 MP4", W / 2, 720, 38, TEXT, sub.opacity, {
        align: "center", yTrack: sub.y, shadowColor: "rgba(125,255,207,0.35)", shadowBlur: 18
      }),
      text("s1-chip", 3000, T, "npm install openhypercore", W / 2, 806, 26, MUTED, kf(3000, 3420, 0, 1), { align: "center", letterSpacing: 2 })
    ]
  };
}

// ---------------------------------------------------------------- S2 code = video
function s2CodeIsVideo(): Layer {
  const T = 10_000; // 5000 → 15000
  const codeLines: Array<[string, string]> = [
    ["defineComposition({", MINT],
    ["  fps: 30, width: 1920, height: 1080,", "#d7e7ff"],
    ["  layers: [", "#d7e7ff"],
    ["    { type: \"text\",  text: \"你好，世界\", size: 92 },", GOLD],
    ["    { type: \"shape\", shape: \"circle\",", GOLD],
    ["      transform: { scale: springKeyframes({…}) } },", GOLD],
    ["    { type: \"shape\", shape: \"path\", trimEnd: [0 → 1] },", GOLD],
    ["    { type: \"caption\", text: \"字幕即数据\" },", GOLD],
    ["  ]", "#d7e7ff"],
    ["})", MINT]
  ];
  const codeStart = 700;
  const codeStep = 260;
  const code: Layer[] = codeLines.map(([line, color], i) =>
    text(`s2-code-${i}`, codeStart + i * codeStep, T, line, 164, 328 + i * 46, 25, color, kf(codeStart + i * codeStep, codeStart + i * codeStep + 200, 0, 1), {
      maxWidth: 700, shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 4
    })
  );
  const cursorOn = codeStart + codeLines.length * codeStep;
  const stageFill: Fill = {
    type: "linear",
    from: [0, 0],
    to: [820, 560],
    stops: [
      { offset: 0, color: "#10233a" },
      { offset: 0.55, color: "#1c1530" },
      { offset: 1, color: "#2b1c0e" }
    ]
  };
  // 舞台事件与代码行一一对应：行出现 → 元素上台
  const tText = codeStart + 3 * codeStep + 350;
  const tCircle = codeStart + 5 * codeStep + 350;
  const tPath = codeStart + 6 * codeStep + 350;
  const tCap = codeStart + 7 * codeStep + 350;
  return {
    type: "group",
    id: "s2",
    startMs: 5000,
    endMs: 15_000,
    transform: { opacity: fade(0, T, 420, 380) },
    layers: [
      ...heading("s2-h", T, "01 / CODE", "用 TypeScript 描述视频", "一份 composition 就是一支视频 — 可序列化、可版本控制、可批量生成"),
      // 左：代码面板
      rect("s2-code-panel", 300, T, 120, 268, 800, 560, "rgba(4,10,20,0.88)", { opacity: kf(300, 700, 0, 1), radius: 22, stroke: "rgba(125,255,207,0.18)", strokeWidth: 1.5 }),
      rect("s2-code-bar", 300, T, 120, 268, 800, 44, "rgba(255,255,255,0.05)", { opacity: kf(300, 700, 0, 1), radius: 22 }),
      text("s2-code-name", 420, T, "my-video.ts", 152, 296, 20, MUTED, kf(420, 720, 0, 1)),
      ...code,
      rect("s2-cursor", cursorOn, T, 262, 328 + 9 * 46 - 20, 3, 28, MINT, {
        opacity: [
          { timeMs: cursorOn, value: 1 }, { timeMs: cursorOn + 400, value: 0 }, { timeMs: cursorOn + 800, value: 1 },
          { timeMs: cursorOn + 1200, value: 0 }, { timeMs: cursorOn + 1600, value: 1 }, { timeMs: T, value: 1 }
        ]
      }),
      // 中：映射箭头
      path("s2-arrow", 1500, T, "M948 548 C990 548 990 548 1030 548", MINT, 6, { opacity: kf(1500, 1900, 0, 0.9), trimEnd: kf(1500, 2200, 0, 1), blur: 3 }),
      // 右：实时舞台（这里的一切都由上面那份"代码"驱动）
      {
        type: "group",
        id: "s2-stage",
        startMs: 300,
        endMs: T,
        clip: { type: "rect", width: 820, height: 560, radius: 22 },
        transform: { x: 1000, y: 268, opacity: kf(0, 400, 0, 1), scale: [{ timeMs: 0, value: 1 }, { timeMs: T, value: 1.02 }] },
        layers: [
          rect("s2-stage-bg", 0, T, 0, 0, 820, 560, stageFill),
          text("s2-stage-hello", tText - 300, T, "你好，世界", 410, 208, 92, heroGradient, kf(tText - 300, tText, 0, 1), {
            align: "center", font: FONT_FUN,
            scale: springKeyframes({ from: 0.4, to: 1, startMs: tText - 300, fps: FPS, stiffness: 130, damping: 11 }),
            shadowColor: "rgba(125,255,207,0.4)", shadowBlur: 22
          }),
          {
            type: "shape", id: "s2-stage-orb", shape: "circle", radius: 74,
            fill: { type: "radial", center: [74, 74], radius: 74, stops: [{ offset: 0, color: "rgba(255,93,115,0.95)" }, { offset: 1, color: "rgba(255,93,115,0.25)" }] },
            blendMode: "screen",
            startMs: tCircle - 300, endMs: T,
            transform: {
              x: kf(tCircle - 300, tCircle + 500, -170, 96),
              y: 330,
              opacity: kf(tCircle - 300, tCircle, 0, 1),
              scale: springKeyframes({ from: 0.3, to: 1, startMs: tCircle - 300, fps: FPS, stiffness: 140, damping: 10 })
            }
          },
          path("s2-stage-route", tPath - 200, T, "M120 470 C260 350 380 480 520 372 C620 296 680 330 744 250", GOLD, 6, {
            opacity: kf(tPath - 200, tPath + 100, 0, 1), trimEnd: kf(tPath - 200, tPath + 1500, 0, 1), blur: 4
          }),
          {
            type: "caption", id: "s2-stage-cap", text: "字幕即数据", size: 30, color: "#ffffff",
            backgroundColor: "rgba(4,9,18,0.72)", padding: 14, align: "center",
            startMs: tCap - 200, endMs: T,
            transform: { x: 410, y: kf(tCap - 200, tCap + 260, 540, 492), opacity: kf(tCap - 200, tCap + 200, 0, 1) }
          }
        ]
      },
      note("s2-note", 2600, T - 200, "Layer / Keyframe / Easing / Plugin 全是纯数据 — 引擎逐帧解析，渲染完全确定")
    ]
  };
}

// ---------------------------------------------------------------- S3 capability grid
function s3Capabilities(): Layer {
  const T = 11_000; // 15000 → 26000
  const tileW = 500;
  const tileH = 330;
  const cols = [170, 710, 1250];
  const rows = [268, 640];
  const tiles: Array<{ key: string; title: string; desc: string; accent: string; demo: (t0: number) => Layer[] }> = [
    {
      key: "shape", title: "图形 · 渐变 · 混合", desc: "rect / circle / path · 线性与径向渐变 · 17 种 blend", accent: MINT,
      demo: (t0) => [
        {
          type: "shape", id: "s3-d1-a", shape: "circle", radius: 56,
          fill: { type: "radial", center: [56, 56], radius: 56, stops: [{ offset: 0, color: "rgba(125,255,207,0.9)" }, { offset: 1, color: "rgba(125,255,207,0.1)" }] },
          blendMode: "screen", startMs: t0, endMs: T,
          transform: { x: kf(t0, t0 + 2600, 120, 200), y: 168, opacity: kf(t0, t0 + 300, 0, 1) }
        },
        {
          type: "shape", id: "s3-d1-b", shape: "circle", radius: 56,
          fill: { type: "radial", center: [56, 56], radius: 56, stops: [{ offset: 0, color: "rgba(79,140,255,0.9)" }, { offset: 1, color: "rgba(79,140,255,0.1)" }] },
          blendMode: "screen", startMs: t0 + 120, endMs: T,
          transform: { x: kf(t0 + 120, t0 + 2600, 280, 238), y: 168, opacity: kf(t0 + 120, t0 + 420, 0, 1) }
        },
        rect("s3-d1-c", t0 + 240, T, 330, 196, 110, 64, { type: "linear", from: [0, 0], to: [110, 64], stops: [{ offset: 0, color: CORAL }, { offset: 1, color: GOLD }] }, { opacity: kf(t0 + 240, t0 + 540, 0, 0.92), radius: 14 })
      ]
    },
    {
      key: "text", title: "文本 · 字幕", desc: "逐字 CJK 换行 · 描边阴影 · caption 自带背景框", accent: GOLD,
      demo: (t0) => [
        text("s3-d2-a", t0, T, "你好 Hello 👋", 250, 178, 40, TEXT, kf(t0, t0 + 350, 0, 1), { align: "center", stroke: "rgba(0,0,0,0.55)", strokeWidth: 3 }),
        {
          type: "caption", id: "s3-d2-b", text: "字幕条 caption", size: 24, color: "#fff",
          backgroundColor: "rgba(255,209,102,0.16)", padding: 12, align: "center",
          startMs: t0 + 260, endMs: T,
          transform: { x: 250, y: kf(t0 + 260, t0 + 620, 268, 240), opacity: kf(t0 + 260, t0 + 560, 0, 1) }
        }
      ]
    },
    {
      key: "spring", title: "关键帧 · 弹簧", desc: "cubic-bezier / 预设 / spring 物理缓动", accent: CORAL,
      demo: (t0) => [
        path("s3-d3-track", t0, T, "M70 250 L430 250", "rgba(255,255,255,0.16)", 3, { dash: [10, 12] }),
        {
          type: "shape", id: "s3-d3-ball", shape: "circle", radius: 26, fill: CORAL,
          blur: 8, startMs: t0, endMs: T,
          transform: {
            x: springKeyframes({ from: 70, to: 360, startMs: t0 + 200, fps: FPS, stiffness: 90, damping: 9 }),
            y: 224, opacity: kf(t0, t0 + 250, 0, 1)
          }
        },
        text("s3-d3-t", t0 + 500, T, "springKeyframes()", 250, 158, 24, MUTED, kf(t0 + 500, t0 + 800, 0, 1), { align: "center" })
      ]
    },
    {
      key: "av", title: "视频 · 音频", desc: "多轨叠放 · trim / 倍速 / 音量包络 · AAC 混流", accent: BLUE,
      demo: (t0) => [
        {
          type: "video", id: "s3-d4-v", src: "examples/f01-02178107053491200000000000000000000ffffac153a1e835356.mp4",
          width: 300, height: 172, fit: "cover", volume: 0, trimStartMs: 1500, trimEndMs: 4800, loop: true,
          clip: { type: "rect", width: 300, height: 172, radius: 14 },
          startMs: t0 + 150, endMs: T,
          transform: { x: 44, y: 118, opacity: kf(t0 + 150, t0 + 500, 0, 1) }
        },
        path("s3-d4-wave", t0 + 420, T, "M368 200 C382 168 390 236 404 200 C418 166 428 238 442 200 C454 172 462 230 472 200", MINT, 4, { trimEnd: kf(t0 + 420, t0 + 1600, 0, 1), blur: 2 })
      ]
    },
    {
      key: "mask", title: "遮罩 · 揭示", desc: "rect / circle / path 裁剪 · wipe / clock reveal", accent: MINT,
      demo: (t0) => [
        {
          type: "group", id: "s3-d5-wipe",
          startMs: t0, endMs: T,
          reveal: { type: "wipe", width: 410, height: 90, direction: "from-left", progress: kf(t0 + 200, t0 + 1600, 0, 1) },
          transform: { x: 46, y: 128 },
          layers: [rect("s3-d5-bar", 0, T, 0, 0, 410, 90, { type: "linear", from: [0, 0], to: [410, 0], stops: [{ offset: 0, color: MINT }, { offset: 1, color: BLUE }] }, { radius: 16, opacity: 0.9 })]
        },
        {
          type: "group", id: "s3-d5-clock",
          startMs: t0 + 500, endMs: T,
          reveal: { type: "clock", width: 96, height: 96, progress: kf(t0 + 700, t0 + 2200, 0, 1) },
          transform: { x: 356, y: 206 },
          layers: [{ type: "shape", id: "s3-d5-pie", shape: "circle", radius: 44, fill: GOLD, startMs: 0, endMs: T, transform: { x: 4, y: 4, opacity: 0.92 } }]
        },
        text("s3-d5-t", t0 + 900, T, "reveal: wipe / clock", 46, 258, 22, MUTED, kf(t0 + 900, t0 + 1200, 0, 1))
      ]
    },
    {
      key: "fx", title: "模糊 · 运动模糊", desc: "高斯 / 霓虹辉光 · 方向性 motion blur", accent: GOLD,
      demo: (t0) => [
        {
          type: "shape", id: "s3-d6-glow", shape: "circle", radius: 46, fill: MINT,
          blur: [{ timeMs: t0, value: 4 }, { timeMs: t0 + 1300, value: 22 }, { timeMs: t0 + 2600, value: 4 }],
          startMs: t0, endMs: T,
          transform: { x: 96, y: 152, opacity: kf(t0, t0 + 300, 0, 0.9) }
        },
        {
          type: "shape", id: "s3-d6-swipe", shape: "rect", width: 150, height: 26, fill: GOLD,
          motionBlur: { angle: 0, distance: 60, samples: 12 },
          startMs: t0 + 300, endMs: T,
          clip: { type: "rect", width: 150, height: 26, radius: 13 },
          transform: {
            x: [{ timeMs: t0 + 300, value: 210 }, { timeMs: t0 + 1400, value: 320, easing: EMPH }, { timeMs: t0 + 2500, value: 210, easing: EMPH }],
            y: 185, opacity: kf(t0 + 300, t0 + 600, 0, 0.95)
          }
        }
      ]
    }
  ];
  const tileLayers: Layer[] = tiles.map((tile, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const t0 = 700 + i * 140;
    return {
      type: "group",
      id: `s3-tile-${tile.key}`,
      startMs: 0,
      endMs: T,
      transform: {
        x: cols[col]!,
        y: kf(t0, t0 + 460, rows[row]! + 34, rows[row]!),
        opacity: kf(t0, t0 + 420, 0, 1)
      },
      layers: [
        rect(`s3-tile-${tile.key}-bg`, 0, T, 0, 0, tileW, tileH, {
          type: "linear", from: [0, 0], to: [0, tileH],
          stops: [{ offset: 0, color: "rgba(255,255,255,0.075)" }, { offset: 1, color: "rgba(255,255,255,0.03)" }]
        }, { radius: 20, stroke: "rgba(255,255,255,0.10)", strokeWidth: 1.5 }),
        rect(`s3-tile-${tile.key}-bar`, 160, T, 28, 30, 46, 5, tile.accent, { radius: 3, opacity: kf(160, 420, 0, 1) }),
        text(`s3-tile-${tile.key}-title`, 200, T, tile.title, 28, 56, 29, TEXT, kf(200, 480, 0, 1)),
        text(`s3-tile-${tile.key}-desc`, 320, T, tile.desc, 28, 96, 19, MUTED, kf(320, 600, 0, 1), { maxWidth: 444, lineHeight: 27 }),
        ...tile.demo(600 + i * 120)
      ]
    };
  });
  return {
    type: "group",
    id: "s3",
    startMs: 15_000,
    endMs: 26_000,
    transform: { opacity: fade(0, T, 420, 380) },
    layers: [
      ...heading("s3-h", T, "02 / ENGINE", "引擎能力：一切皆数据", "以下每一格演示，都是这支视频里真实运行的图层"),
      ...tileLayers,
      note("s3-note", 3000, T - 200, "同一份 IR 可以进缓存、跑测试、发远端 — 渲染结果逐帧确定")
    ]
  };
}

// ---------------------------------------------------------------- S4 plugins
function s4Plugins(): Layer {
  const T = 7500; // 26000 → 33500
  const frames: Array<{ key: string; label: string; layer: Layer }> = [
    {
      key: "kinetic", label: "kinetic-bars",
      layer: { type: "plugin", plugin: "kinetic-bars", params: { lines: "开场 / 转场 / 标题", barColor: MINT, background: "#0b0f16" }, startMs: 400, endMs: T }
    },
    {
      key: "glitch", label: "glitch-title",
      layer: { type: "plugin", plugin: "glitch-title", params: { text: "OPENHYPER", color: "#ffffff", accentA: "#8ecae6", accentB: CORAL }, startMs: 700, endMs: T }
    },
    {
      key: "particle", label: "particle-assemble",
      layer: { type: "plugin", plugin: "particle-assemble", params: { title: "PLUGIN", color: GOLD, count: 110, assembleMs: 2400, background: "#070a12" }, startMs: 1000, endMs: T }
    }
  ];
  const frameW = 536;
  const frameH = 301;
  const xs = [136, 692, 1248];
  const frameLayers: Layer[] = frames.flatMap((f, i) => {
    const t0 = 500 + i * 220;
    return [
      {
        type: "group" as const,
        id: `s4-frame-${f.key}`,
        startMs: 0,
        endMs: T,
        clip: { type: "rect" as const, width: frameW, height: frameH, radius: 18 },
        transform: { x: xs[i]!, y: kf(t0, t0 + 480, 330, 296), opacity: kf(t0, t0 + 440, 0, 1) },
        layers: [
          rect(`s4-frame-${f.key}-bg`, 0, T, 0, 0, frameW, frameH, "#0a0e18"),
          { // 插件真实运行，整体缩放进 mini 窗口
            type: "group" as const,
            id: `s4-frame-${f.key}-scale`,
            startMs: 0,
            endMs: T,
            transform: { scale: frameW / W },
            layers: [f.layer]
          }
        ]
      },
      text(`s4-label-${f.key}`, t0 + 260, T, f.label, xs[i]! + frameW / 2, 636, 24, MUTED, kf(t0 + 260, t0 + 560, 0, 1), { align: "center", letterSpacing: 1 })
    ];
  });
  return {
    type: "group",
    id: "s4",
    startMs: 26_000,
    endMs: 33_500,
    transform: { opacity: fade(0, T, 420, 380) },
    layers: [
      ...heading("s4-h", T, "03 / PLUGINS", "插件：可复用的动效组件", "definePlugin 定义 → expandComposition 展开成普通图层，非破坏、参数可编辑"),
      ...frameLayers,
      rect("s4-code-bg", 1500, T, 360, 700, 1200, 66, "rgba(4,10,20,0.86)", { radius: 14, opacity: kf(1500, 1850, 0, 1), stroke: "rgba(255,209,102,0.2)", strokeWidth: 1.5 }),
      text("s4-code", 1650, T, "{ type: \"plugin\", plugin: \"glitch-title\", params: { text: \"OPENHYPER\" } }", W / 2, 742, 26, GOLD, kf(1650, 2000, 0, 1), { align: "center" }),
      note("s4-note", 2800, T - 200, "上面三个窗口就是三个真实插件图层 — 和你在编辑器插件库里看到的完全一致")
    ]
  };
}

// ---------------------------------------------------------------- editor scenes (S5-S7)
// 编辑器实录：左侧步骤栏 + 右侧浏览器窗口（Playwright 录制的真实操作）。
function editorScene(opts: {
  id: string;
  startMs: number;
  endMs: number;
  step: string;
  title: string;
  src: string;
  playbackRate: number;
  bullets: Array<[number, string]>;
  noteText?: string;
}): Layer {
  const T = opts.endMs - opts.startMs;
  const vidW = 1200;
  const vidH = 750;
  const vidX = 620;
  const vidY = 266;
  const barH = 46;
  const frameX = vidX - 16;
  const frameY = vidY - barH - 14;
  const frameW = vidW + 32;
  const frameH = vidH + barH + 28;
  const bullets: Layer[] = opts.bullets.flatMap(([t0, label], i) => {
    const y = 520 + i * 76;
    return [
      {
        type: "shape" as const, id: `${opts.id}-dot-${i}`, shape: "circle" as const, radius: 7, fill: MINT,
        startMs: t0, endMs: T,
        transform: { x: 128, y: y - 16, opacity: kf(t0, t0 + 260, 0, 1), scale: springKeyframes({ from: 0.2, to: 1, startMs: t0, fps: FPS, stiffness: 160, damping: 11 }) }
      },
      text(`${opts.id}-b-${i}`, t0, T, label, 156, y, 27, TEXT, kf(t0, t0 + 300, 0, 1), {
        x: kf(t0, t0 + 380, 176, 156), maxWidth: 380
      })
    ];
  });
  return {
    type: "group",
    id: opts.id,
    startMs: opts.startMs,
    endMs: opts.endMs,
    transform: { opacity: fade(0, T, 420, 380) },
    layers: [
      text(`${opts.id}-step`, 140, T, opts.step, 120, 300, 23, MINT, kf(140, 440, 0, 1), { letterSpacing: 5 }),
      text(`${opts.id}-title`, 220, T, opts.title, 120, 352, 38, TEXT, kf(220, 560, 0, 1), { maxWidth: 400, lineHeight: 52 }),
      ...bullets,
      // 浏览器窗口
      rect(`${opts.id}-shadow`, 200, T, frameX - 10, frameY - 4, frameW + 20, frameH + 20, "rgba(0,0,0,0.55)", { radius: 26, blur: 26, opacity: kf(200, 600, 0, 1) }),
      rect(`${opts.id}-frame`, 200, T, frameX, frameY, frameW, frameH, "#0e1526", { radius: 18, opacity: kf(200, 560, 0, 1), stroke: "rgba(255,255,255,0.10)", strokeWidth: 1.5 }),
      { type: "shape", id: `${opts.id}-dot-r`, shape: "circle", radius: 7, fill: "#ff5f57", startMs: 320, endMs: T, transform: { x: frameX + 22, y: frameY + 16, opacity: kf(320, 560, 0, 1) } },
      { type: "shape", id: `${opts.id}-dot-y`, shape: "circle", radius: 7, fill: "#febc2e", startMs: 360, endMs: T, transform: { x: frameX + 46, y: frameY + 16, opacity: kf(360, 600, 0, 1) } },
      { type: "shape", id: `${opts.id}-dot-g`, shape: "circle", radius: 7, fill: "#28c840", startMs: 400, endMs: T, transform: { x: frameX + 70, y: frameY + 16, opacity: kf(400, 640, 0, 1) } },
      rect(`${opts.id}-url`, 420, T, frameX + frameW / 2 - 210, frameY + 9, 420, 28, "rgba(255,255,255,0.06)", { radius: 14, opacity: kf(420, 700, 0, 1) }),
      text(`${opts.id}-url-t`, 460, T, "localhost:5199 · openHyperEditor", frameX + frameW / 2, frameY + 29, 17, MUTED, kf(460, 740, 0, 1), { align: "center" }),
      {
        type: "video",
        id: `${opts.id}-vid`,
        src: opts.src,
        width: vidW,
        height: vidH,
        fit: "fill",
        playbackRate: opts.playbackRate,
        clip: { type: "rect", width: vidW, height: vidH, radius: 10 },
        startMs: 350,
        endMs: T,
        transform: { x: vidX, y: vidY, opacity: kf(350, 750, 0, 1) }
      },
      ...(opts.noteText ? [note(`${opts.id}-note`, 1200, T - 200, opts.noteText)] : [])
    ]
  };
}

function s5EditorHeader(): Layer {
  // 覆盖 S5–S7 的常驻标题（避免三段重复淡入闪烁）
  const T = 69_200 - 33_500;
  return {
    type: "group",
    id: "s5h",
    startMs: 33_500,
    endMs: 69_200,
    transform: { opacity: fade(0, T, 420, 380) },
    layers: heading("s5-h", T, "04 / EDITOR", "openHyperEditor 可视化编辑器", "")
  };
}

// ---------------------------------------------------------------- S8 pipeline
function s8Pipeline(): Layer {
  const T = 10_300; // 69200 → 79500
  const nodes: Array<[string, string]> = [
    ["TypeScript 合成", MINT],
    ["Scene-Graph IR（纯数据）", "#8ecae6"],
    ["Rust + Skia 原生光栅化", GOLD],
    ["FFmpeg → H.264 + AAC MP4", CORAL]
  ];
  const nodeLayers: Layer[] = nodes.flatMap(([label, accent], i) => {
    const t0 = 600 + i * 320;
    const y = 262 + i * 132;
    return [
      rect(`s8-node-${i}`, t0, T, 1206, y, 590, 84, "rgba(255,255,255,0.07)", { radius: 16, opacity: kf(t0, t0 + 380, 0, 1), stroke: "rgba(255,255,255,0.10)", strokeWidth: 1.5 }),
      rect(`s8-node-${i}-bar`, t0 + 100, T, 1230, y + 24, 6, 36, accent, { radius: 3, opacity: kf(t0 + 100, t0 + 400, 0, 1) }),
      text(`s8-node-${i}-t`, t0 + 140, T, label, 1258, y + 52, 27, TEXT, kf(t0 + 140, t0 + 460, 0, 1)),
      ...(i < nodes.length - 1
        ? [path(`s8-link-${i}`, t0 + 380, T, `M1501 ${y + 88} L1501 ${y + 128}`, accent, 5, { opacity: kf(t0 + 380, t0 + 620, 0, 0.85), trimEnd: kf(t0 + 380, t0 + 700, 0, 1) })]
        : [])
    ];
  });
  return {
    type: "group",
    id: "s8",
    startMs: 69_200,
    endMs: 79_500,
    transform: { opacity: fade(0, T, 420, 380) },
    layers: [
      ...heading("s8-h", T, "05 / RENDER", "无浏览器渲染管线", "不需要 Chromium、不需要 GPU — 轻量 CPU 服务器即可批量出片"),
      // 左：编辑器里点"渲染 MP4"的真实过程（服务端 native 后端）
      rect("s8-vshadow", 300, T, 96, 262, 1048, 700, "rgba(0,0,0,0.5)", { radius: 24, blur: 24, opacity: kf(300, 700, 0, 1) }),
      rect("s8-vframe", 300, T, 106, 272, 1028, 680, "#0e1526", { radius: 16, opacity: kf(300, 660, 0, 1), stroke: "rgba(255,255,255,0.10)", strokeWidth: 1.5 }),
      {
        type: "video",
        id: "s8-vid",
        src: "examples/assets/editor-render.mp4",
        width: 1000,
        height: 625,
        fit: "fill",
        playbackRate: 1.85,
        clip: { type: "rect", width: 1000, height: 625, radius: 10 },
        startMs: 400,
        // 素材 15.9s ÷ 1.85 ≈ 8.6s，结束后冻结在最后一帧由 opacity 淡出前的场景兜住
        endMs: Math.min(T, 400 + 8500),
        transform: { x: 120, y: 300, opacity: kf(400, 800, 0, 1) }
      },
      // 右：管线节点
      ...nodeLayers,
      // 性能徽章（数字来自真实录屏与仓库基准）
      rect("s8-badge-a", 2400, T, 1206, 806, 286, 62, "rgba(125,255,207,0.16)", { radius: 31, opacity: kf(2400, 2800, 0, 1) }),
      text("s8-badge-a-t", 2500, T, "native ≈ 10× wasm", 1349, 846, 25, MINT, kf(2500, 2900, 0, 1), { align: "center" }),
      rect("s8-badge-b", 2700, T, 1510, 806, 286, 62, "rgba(255,209,102,0.16)", { radius: 31, opacity: kf(2700, 3100, 0, 1) }),
      text("s8-badge-b-t", 2800, T, "本片服务端渲染 9.1s", 1653, 846, 25, GOLD, kf(2800, 3200, 0, 1), { align: "center" }),
      note("s8-note", 1600, T - 200, "npx openhyper render my-video.ts --renderer native --workers auto · 或 openhyper serve 做渲染服务")
    ]
  };
}

// ---------------------------------------------------------------- S9 outro
function s9Outro(): Layer {
  const T = 8500; // 79500 → 88000
  return {
    type: "group",
    id: "s9",
    startMs: 79_500,
    endMs: 88_000,
    transform: { opacity: [{ timeMs: 0, value: 0 }, { timeMs: 420, value: 1, easing: EMPH }, { timeMs: T - 900, value: 1 }, { timeMs: T, value: 0, easing: EXIT }] },
    layers: [
      { type: "plugin", plugin: "particle-assemble", params: { title: "", color: MINT, count: 150, assembleMs: 2600, shape: "ring", background: "rgba(0,0,0,0)" }, startMs: 0, endMs: T, transform: { y: -200 } },
      text("s9-title", 1500, T, "openHyperCore", W / 2, 368, 76, heroGradient, kf(1500, 2100, 0, 1), {
        align: "center", shadowColor: "rgba(125,255,207,0.35)", shadowBlur: 22,
        scale: springKeyframes({ from: 0.72, to: 1, startMs: 1500, fps: FPS, stiffness: 110, damping: 12 })
      }),
      text("s9-tag", 2400, T, "用代码生成视频 · 用数据组织模板 · 用插件沉淀动效", W / 2, 700, 31, TEXT, kf(2400, 2900, 0, 1), { align: "center", font: FONT_FUN, shadowColor: "rgba(125,255,207,0.3)", shadowBlur: 14 }),
      rect("s9-term", 3000, T, 480, 760, 960, 128, "rgba(4,10,20,0.88)", { radius: 18, opacity: kf(3000, 3400, 0, 1) }),
      text("s9-cmd-1", 3300, T, "$ npm install openhypercore", 522, 812, 27, MINT, kf(3300, 3650, 0, 1)),
      text("s9-cmd-2", 3700, T, "$ npx openhyper render my-video.ts --out out.mp4", 522, 858, 27, GOLD, kf(3700, 4050, 0, 1))
    ]
  };
}

// ---------------------------------------------------------------- composition
export default defineComposition({
  fps: FPS,
  width: W,
  height: H,
  durationMs: DUR,
  defaultFont: FONT,
  layers: [
    ...backgroundLayers(),
    s1Hero(),
    s2CodeIsVideo(),
    s3Capabilities(),
    s4Plugins(),
    s5EditorHeader(),
    editorScene({
      id: "s5",
      startMs: 33_500,
      endMs: 49_500,
      step: "STEP 1 / 快速开始",
      title: "三步做出\n你的第一支视频",
      src: "examples/assets/editor-quickstart.mp4",
      playbackRate: 1.6,
      bullets: [
        [1200, "选一个片头插件"],
        [4600, "写下标题，实时带入"],
        [7600, "拖入你的视频素材"],
        [10600, "生成合成，空格播放"]
      ],
      noteText: "快速开始向导会生成一份普通 composition — 之后每一层都可继续编辑"
    }),
    editorScene({
      id: "s6",
      startMs: 49_500,
      endMs: 62_500,
      step: "STEP 2 / 画布即时编辑",
      title: "在画布上\n直接做动画",
      src: "examples/assets/editor-animate.mp4",
      playbackRate: 1.65,
      bullets: [
        [700, "点选画布图层"],
        [1700, "入场动画悬停即试播"],
        [4100, "一键应用弹簧弹出"],
        [5400, "拖动时间轴回放"],
        [8700, "拖拽改位置与关键帧"]
      ],
      noteText: "所有操作最终都落回同一份场景数据 — 撤销/重做、分组、关键帧全程可控"
    }),
    editorScene({
      id: "s7",
      startMs: 62_500,
      endMs: 69_200,
      step: "STEP 3 / 插件库",
      title: "插件卡片\n实时预览",
      src: "examples/assets/editor-plugins.mp4",
      playbackRate: 1.45,
      bullets: [
        [500, "内置动效插件库"],
        [1500, "点击卡片即时预览"],
        [3000, "auto-form 参数面板"],
        [5200, "一键添加到时间线"]
      ]
    }),
    s8Pipeline(),
    s9Outro(),
    {
      type: "audio",
      id: "bgm",
      src: "examples/assets/openhypercore-tutorial-bed-long.m4a",
      startMs: 0,
      endMs: DUR,
      volume: [
        { timeMs: 0, value: 0 },
        { timeMs: 800, value: 0.85 },
        { timeMs: 84_000, value: 0.85 },
        { timeMs: 88_000, value: 0 }
      ],
      fadeInMs: 300,
      fadeOutMs: 1500
    }
  ]
});
