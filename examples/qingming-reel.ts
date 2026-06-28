// 《青冥录》武侠混剪 — 水墨古籍版头
//
//   pnpm cli render examples/qingming-reel.ts --out /tmp/qingming-reel.mp4
//
// 版头分镜：天空云彩 → 云散现古籍（竖排「青冥录」）→ 翻开书页 →
// 右页水墨山水（叠嶂远近 + 水面 + 简笔小人练武）→ 右页放大全屏 →
// 山水从右向左卷动、小人原地变招 → 收拢书籍 → 切入 f01–f05 视频。
import { cinematicBars, defineComposition, flashTransitionLayer, springKeyframes } from "../packages/core/src/index.ts";
import type { CubicBezierPoints, Gradient, Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

const width = 1280;
const height = 720;
const fps = 24;
const introEnd = 10400;
const clipMs = 4550;
const outroMs = 2300;
const clipStarts = Array.from({ length: 5 }, (_, index) => introEnd + clipMs * index);
const clipEnds = clipStarts.map((start) => start + clipMs);
const outroStart = clipEnds[4]!;
const durationMs = outroStart + outroMs;

const sources = [
  "examples/f01-02178107053491200000000000000000000ffffac153a1e835356.mp4",
  "examples/f02-02178107107440900000000000000000000ffffac15e01611382f.mp4",
  "examples/f03-02178107345206000000000000000000000ffffac182f901ccc70.mp4",
  "examples/f04-02178107431412800000000000000000000ffffac182f901d8285.mp4",
  "examples/f05-02178110280757600000000000000000000ffffac15e01695458d.mp4"
];

const titleAudio = "examples/assets/qingming-title.wav";
const songti = "/System/Library/Fonts/Supplemental/Songti.ttc";
const gold = "#e7c36a";
const paleGold = "#fff0b8";
const red = "#bf2a1d";
const ink = "#050607";
const inkDark = "#262e34";
const paper = "#e9e1cf";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Material "emphasized" cubic-bezier — a snappy cinematic ease-out, applied
// frame-precisely as per-keyframe easing (no sampling).
const emphasized: CubicBezierPoints = [0.2, 0, 0, 1];

// Dawn sky as a vertical gradient (cool zenith → warm horizon) and luminous
// radial glows for the sun and the title bloom.
const skyGradient: Gradient = {
  type: "linear",
  from: [0, 0],
  to: [0, height],
  stops: [
    { offset: 0, color: "#8ca3b6" },
    { offset: 0.55, color: "#aebcc4" },
    { offset: 1, color: "#dcd5c0" }
  ]
};
const sunGlow: Gradient = {
  type: "radial",
  center: [120, 120],
  radius: 120,
  stops: [
    { offset: 0, color: "rgba(255,244,210,0.9)" },
    { offset: 0.5, color: "rgba(238,223,174,0.38)" },
    { offset: 1, color: "rgba(238,223,174,0)" }
  ]
};
const titleGlow: Gradient = {
  type: "radial",
  center: [170, 170],
  radius: 170,
  stops: [
    { offset: 0, color: "rgba(255,236,170,0.85)" },
    { offset: 0.45, color: "rgba(231,195,106,0.42)" },
    { offset: 1, color: "rgba(231,195,106,0)" }
  ]
};
const vignetteGradient: Gradient = {
  type: "radial",
  center: [width / 2, height / 2],
  radius: Math.hypot(width, height) / 2,
  stops: [
    { offset: 0, color: "rgba(0,0,0,0)" },
    { offset: 0.6, color: "rgba(0,0,0,0)" },
    { offset: 1, color: "rgba(6,7,10,0.55)" }
  ]
};
const outroGlow: Gradient = {
  type: "radial",
  center: [240, 240],
  radius: 240,
  stops: [
    { offset: 0, color: "rgba(255,228,150,0.7)" },
    { offset: 0.5, color: "rgba(231,195,106,0.3)" },
    { offset: 1, color: "rgba(231,195,106,0)" }
  ]
};

function track(startMs: number, durMs: number, from: number, to: number, ease = easeOutCubic, steps = 6): ScalarKeyframe[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const p = index / steps;
    return { timeMs: Math.round(startMs + durMs * p), value: from + (to - from) * ease(p) };
  });
}

function hold(startMs: number, endMs: number, fadeIn = 240, fadeOut = 260, peak = 1): ScalarKeyframe[] {
  return [
    { timeMs: startMs, value: 0 },
    { timeMs: startMs + fadeIn, value: peak },
    { timeMs: Math.max(startMs + fadeIn, endMs - fadeOut), value: peak },
    { timeMs: endMs, value: 0 }
  ];
}

function scaleOpacity(kf: ScalarKeyframe[], amount: number): ScalarKeyframe[] {
  return kf.map((item) => ({ timeMs: item.timeMs, value: item.value * amount }));
}

function rect(id: string, startMs: number, endMs: number, x: number, y: number, w: number, h: number, fill: string, opacity: number | ScalarKeyframe[] = 1, rotate = 0, blur = 0): Layer {
  return {
    type: "shape",
    id,
    shape: "rect",
    width: w,
    height: h,
    fill,
    blur,
    startMs,
    endMs,
    transform: { x, y, opacity, rotate }
  };
}

function strokeRect(id: string, startMs: number, endMs: number, x: number, y: number, w: number, h: number, stroke: string, strokeWidth: number, opacity: number | ScalarKeyframe[] = 1): Layer {
  return {
    type: "shape",
    id,
    shape: "rect",
    width: w,
    height: h,
    stroke,
    strokeWidth,
    startMs,
    endMs,
    transform: { x, y, opacity }
  };
}

function pathLayer(id: string, startMs: number, endMs: number, path: string, stroke: string, strokeWidth: number, opacity: number | ScalarKeyframe[], x = 0, y = 0, blur = 0): Layer {
  return {
    type: "shape",
    id,
    shape: "path",
    path,
    stroke,
    strokeWidth,
    fill: "rgba(0,0,0,0)",
    blur,
    startMs,
    endMs,
    transform: { x, y, opacity }
  };
}

function fillPath(id: string, startMs: number, endMs: number, path: string, fill: string, opacity: number | ScalarKeyframe[], blur = 0): Layer {
  return {
    type: "shape",
    id,
    shape: "path",
    path,
    fill,
    blur,
    startMs,
    endMs,
    transform: { opacity }
  };
}

function text(id: string, value: string, startMs: number, endMs: number, x: number | ScalarKeyframe[], y: number | ScalarKeyframe[], size: number, color: string, opacity: number | ScalarKeyframe[], style: TextStyle = {}, lineHeight?: number): Layer {
  return {
    type: "text",
    id,
    text: value,
    font: songti,
    size,
    color,
    startMs,
    endMs,
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...style,
    transform: { x, y, opacity }
  };
}

function circle(id: string, startMs: number, endMs: number, cx: number, cy: number, radius: number, fill: string, opacity: number | ScalarKeyframe[] = 1, blur = 0, scaleY = 1): Layer {
  return {
    type: "shape",
    id,
    shape: "circle",
    radius,
    fill,
    blur,
    startMs,
    endMs,
    transform: { x: cx - radius, y: cy - radius * scaleY, opacity, scaleY }
  };
}

// 平滑山脊剪影：peaks 为山峰锚点，二次曲线串联后落到 baseY 闭合成填充面。
function ridgePath(peaks: Array<[number, number]>, baseY = 720): string {
  const first = peaks[0]!;
  let d = `M${first[0]} ${baseY} L${first[0]} ${first[1]}`;
  for (let index = 1; index < peaks.length; index += 1) {
    const prev = peaks[index - 1]!;
    const cur = peaks[index]!;
    d += ` Q${prev[0]} ${prev[1]} ${(prev[0] + cur[0]) / 2} ${(prev[1] + cur[1]) / 2}`;
  }
  const last = peaks[peaks.length - 1]!;
  d += ` L${last[0]} ${last[1]} L${last[0]} ${baseY} Z`;
  return d;
}

// ---------------------------------------------------------------------------
// 版头第 1 幕：天空与云彩（0–3000ms）
// ---------------------------------------------------------------------------

function cloudCluster(id: string, cx: number, cy: number, scatterX: number, puffs: Array<[number, number, number]>): Layer {
  return {
    type: "group",
    id,
    transform: {
      x: [
        { timeMs: 0, value: cx - 18 },
        { timeMs: 1900, value: cx },
        ...track(1900, 1150, cx, cx + scatterX, easeInOutCubic).slice(1)
      ],
      y: cy,
      opacity: [
        { timeMs: 0, value: 0 },
        { timeMs: 520, value: 1 },
        { timeMs: 2050, value: 1 },
        { timeMs: 2950, value: 0 }
      ]
    },
    layers: puffs.map(([px, py, r], index) =>
      circle(`${id}-puff-${index}`, 0, 3050, px, py, r, "rgba(252,250,243,0.92)", 0.85, 24))
  };
}

const skyLayers: Layer[] = [
  {
    type: "shape",
    id: "sky",
    shape: "rect",
    width,
    height,
    fill: skyGradient,
    startMs: 0,
    endMs: 4300,
    transform: {
      x: 0,
      y: 0,
      opacity: [
        { timeMs: 0, value: 1 },
        { timeMs: 2300, value: 1 },
        { timeMs: 3500, value: 0.3 },
        { timeMs: 4200, value: 0 }
      ]
    }
  },
  // Soft luminous sun halo (screen-blended radial glow over the sky).
  {
    type: "shape",
    id: "sky-sun-glow",
    shape: "circle",
    radius: 120,
    fill: sunGlow,
    blendMode: "screen",
    startMs: 0,
    endMs: 5400,
    transform: {
      x: 950 - 120,
      y: 150 - 120,
      opacity: [
        { timeMs: 350, value: 0 },
        { timeMs: 1500, value: 0.9 },
        { timeMs: 3600, value: 0.7 },
        { timeMs: 5300, value: 0 }
      ]
    }
  },
  rect("sky-horizon", 0, 4200, 0, 430, width, 290, "#cfd6cf", [
    { timeMs: 0, value: 0.8 },
    { timeMs: 3400, value: 0.5 },
    { timeMs: 4100, value: 0 }
  ], 0, 26),
  circle("sky-sun", 0, 5400, 950, 150, 46, "#eedfae", [
    { timeMs: 350, value: 0 },
    { timeMs: 1500, value: 0.62 },
    { timeMs: 3600, value: 0.5 },
    { timeMs: 5300, value: 0 }
  ], 18),
  cloudCluster("cloud-left", 400, 240, -560, [[-110, 18, 78], [0, 0, 95], [120, 26, 70], [30, 52, 84]]),
  cloudCluster("cloud-right", 880, 330, 580, [[-100, 30, 72], [10, 0, 102], [128, 24, 76], [40, 58, 80]]),
  cloudCluster("cloud-high", 660, 110, 220, [[-70, 10, 52], [30, 0, 64], [110, 14, 46]]),
  rect("mist-a", 2600, 6400, -180, 150, 860, 56, "rgba(255,255,255,0.5)", scaleOpacity(hold(2600, 6400, 500, 600), 0.16), -6, 18),
  rect("mist-b", 2900, 6200, 640, 480, 820, 48, "rgba(255,255,255,0.4)", scaleOpacity(hold(2900, 6200, 500, 600), 0.13), 5, 18)
];

// ---------------------------------------------------------------------------
// 版头第 2 幕：古籍（1500ms 现书，2950ms 翻开）
// 书脊在 x=470；封面盖在右页位置（470..810），绕书脊 scaleX 折开，
// 内页（左页）随后从书脊向左展开 —— 即转场库的 flip 机制。
// ---------------------------------------------------------------------------

const spineX = 470;
const pageTop = 160;
const pageW = 340;
const pageH = 460;

function coverFaceLayers(prefix: string, startMs: number, endMs: number): Layer[] {
  return [
    rect(`${prefix}-base`, startMs, endMs, 0, 0, pageW, pageH, "#202a42"),
    strokeRect(`${prefix}-border`, startMs, endMs, 12, 12, pageW - 24, pageH - 24, "rgba(231,195,106,0.66)", 2),
    // 线装：书脊侧缝线
    rect(`${prefix}-thread`, startMs, endMs, 16, 14, 2, pageH - 28, "rgba(222,210,178,0.7)"),
    ...[0, 1, 2, 3, 4].map((index) =>
      rect(`${prefix}-stitch-${index}`, startMs, endMs, 4, 38 + index * 96, 26, 3, "rgba(222,210,178,0.78)")),
    // 题签 + 竖排书名
    rect(`${prefix}-slip`, startMs, endMs, 232, 26, 78, 282, "#efe5c8"),
    strokeRect(`${prefix}-slip-border`, startMs, endMs, 237, 31, 68, 272, "rgba(60,54,40,0.55)", 2),
    text(`${prefix}-title`, "青\n冥\n录", startMs, endMs, 242, 96, 58, "#2a2620", 1, { shadowColor: "rgba(0,0,0,0.22)", shadowBlur: 2, shadowDy: 2 }, 84),
    // 朱印
    rect(`${prefix}-seal`, startMs, endMs, 42, 366, 46, 46, "rgba(191,42,29,0.88)"),
    text(`${prefix}-seal-text`, "青\n冥", startMs, endMs, 56, 384, 18, "#f6e3c2", 0.95, {}, 21)
  ];
}

const bookLayers: Layer[] = [
  rect("book-shadow", 1500, 6300, spineX - 18, pageTop - 8, pageW * 2 + 20, pageH + 22, "rgba(8,10,14,0.4)", scaleOpacity(hold(1500, 6300, 420, 500), 0.4), 0, 14),
  // 左页（封面翻过去后展开）
  {
    type: "group",
    id: "left-page",
    transform: {
      x: spineX,
      y: pageTop,
      scaleX: track(3350, 420, 0.02, 1, easeOutCubic)
    },
    layers: [
      rect("left-page-paper", 3350, 6450, -pageW, 0, pageW, pageH, "#e3dac4", hold(3350, 6450, 100, 420, 1)),
      strokeRect("left-page-border", 3350, 6400, -pageW + 14, 14, pageW - 28, pageH - 28, "rgba(90,80,60,0.4)", 2, hold(3350, 6400, 150, 400, 0.9)),
      ...[0, 1, 2].map((index) =>
        rect(`left-rule-${index}`, 3500, 6350, -86 - index * 64, 40, 2, pageH - 80, "rgba(90,80,60,0.28)", hold(3500, 6350, 200, 380, 0.8))),
      text("left-colophon-a", "青\n冥\n录", 3650, 6300, -118, 96, 40, "#3a3428", hold(3650, 6300, 240, 360, 0.85), {}, 54),
      text("left-colophon-b", "卷\n一\n云\n山\n练\n剑", 3800, 6300, -182, 80, 24, "#4a4434", hold(3800, 6300, 240, 360, 0.7), {}, 33),
      rect("left-seal", 4000, 6300, -150, 370, 32, 32, "rgba(191,42,29,0.72)", hold(4000, 6300, 240, 360, 0.85))
    ]
  },
  // 右页（被封面盖住，翻开后露出，承载山水画）
  rect("right-page-paper", 2400, 6450, spineX, pageTop, pageW, pageH, "#efe6d2", hold(2400, 6450, 100, 420, 1)),
  strokeRect("right-page-border", 2900, 6400, spineX + 14, pageTop + 14, pageW - 28, pageH - 28, "rgba(90,80,60,0.4)", 2, hold(2900, 6400, 200, 400, 0.9)),
  rect("right-page-spine-shade", 2900, 6350, spineX, pageTop, 26, pageH, "rgba(50,44,32,0.3)", hold(2900, 6350, 200, 380, 0.8), 0, 6),
  // 右页题字（画下方），放大前淡出
  text("right-inscription", "云\n山\n练\n剑", 3900, 5900, spineX + 272, pageTop + 304, 24, "#3a3428", hold(3900, 5900, 260, 320, 0.8), {}, 31),
  rect("right-mini-seal", 4150, 5900, spineX + 264, pageTop + 432, 22, 22, "rgba(191,42,29,0.7)", hold(4150, 5900, 240, 300, 0.8))
];

// 封面（翻开动作）：绕书脊折叠
const coverLayer: Layer = {
  type: "group",
  id: "book-cover",
  transform: {
    x: spineX,
    y: track(1500, 850, pageTop + 18, pageTop, easeOutCubic),
    opacity: [
      { timeMs: 1500, value: 0 },
      { timeMs: 2200, value: 1 }
    ],
    scaleX: track(2950, 460, 1, 0.02, easeInOutCubic)
  },
  layers: coverFaceLayers("cover", 1500, 3460)
};

// ---------------------------------------------------------------------------
// 版头第 3 幕：水墨山水画（场景逻辑坐标 1280×720，reveal 裁剪到画框内）
// 页面期：缩到右页（scale 0.245，中心恰好是屏幕中线 x=640）；
// 5600ms 起放大到全屏；6500ms 起山水整体右→左卷动而小人原地变招；
// 9450ms 起绕中轴 scaleX 收拢（合书）。
// ---------------------------------------------------------------------------

const farRidge = ridgePath([[0, 420], [180, 330], [380, 392], [560, 300], [760, 382], [940, 318], [1140, 400], [1320, 308], [1520, 372], [1700, 288], [1900, 380], [2080, 326], [2300, 402], [2480, 308], [2660, 382], [2840, 318], [3060, 392], [3240, 328], [3400, 398]]);
const midRidge = ridgePath([[0, 520], [220, 398], [420, 482], [640, 378], [820, 472], [1040, 388], [1240, 492], [1460, 398], [1660, 482], [1860, 388], [2060, 472], [2260, 378], [2460, 484], [2680, 398], [2880, 472], [3080, 388], [3280, 470], [3400, 440]]);
const nearRidge = ridgePath([[0, 600], [260, 468], [460, 562], [700, 448], [900, 552], [1150, 458], [1380, 562], [1600, 468], [1820, 558], [2050, 458], [2280, 562], [2520, 468], [2720, 558], [2960, 478], [3160, 558], [3400, 500]]);

const sceneStart = 3000;
const sceneEnd = 10380;

// 简笔练武小人：四式循环（马步展臂 / 弓步冲拳 / 提膝亮掌 / 仆步下势）
const poseLimbs = [
  "M0 -34 L0 8 M0 -26 L-34 -30 M0 -26 L34 -30 M0 8 L-26 44 M0 8 L26 44",
  "M-4 -32 L2 8 M-4 -24 L38 -34 M-4 -24 L-24 -10 M2 8 L-30 42 M2 8 L26 26 L32 46",
  "M0 -36 L0 8 M0 -28 L-30 -48 M0 -28 L28 -16 M0 8 L-4 46 M0 8 L24 16 L18 34",
  "M-10 -22 L6 14 M-10 -16 L-46 -10 M-10 -16 L28 -32 M6 14 L-34 28 L-50 26 M6 14 L28 42"
];
const poseHeads: Array<[number, number]> = [[0, -46], [-4, -44], [0, -48], [-12, -34]];

function figureLayers(): Layer[] {
  const out: Layer[] = [];
  const start = 3450;
  const stepMs = 520;
  let index = 0;
  for (let t = start; t < sceneEnd; t += stepMs, index += 1) {
    const pose = index % 4;
    const endMs = Math.min(t + stepMs, sceneEnd);
    const [hx, hy] = poseHeads[pose]!;
    out.push(circle(`figure-head-${index}`, t, endMs, hx, hy, 11, inkDark));
    out.push(pathLayer(`figure-limbs-${index}`, t, endMs, poseLimbs[pose]!, inkDark, 7, 1));
  }
  return out;
}

const sceneryScrollX: ScalarKeyframe[] = [
  ...track(3400, 3100, 0, -150, easeInOutCubic, 4),
  ...track(6500, 2850, -150, -1760, easeInOutCubic, 8).slice(1)
];

const paintingScene: Layer = {
  type: "group",
  id: "scene-clip",
  reveal: { type: "wipe", direction: "from-left", width, height, progress: 0.9995 },
  layers: [
    rect("scene-paper", sceneStart, sceneEnd, 0, 0, width, height, paper),
    rect("scene-sky-wash", sceneStart, sceneEnd, 0, 0, width, 320, "rgba(195,206,205,0.5)", 1, 0, 30),
    // 卷动的山水（宽 3400 的长卷）
    {
      type: "group",
      id: "scenery",
      transform: { x: sceneryScrollX },
      layers: [
        fillPath("ridge-far", sceneStart, sceneEnd, farRidge, "#b9c4c3", 0.5, 4),
        fillPath("ridge-mid", sceneStart, sceneEnd, midRidge, "#8fa0a1", 0.66, 2),
        fillPath("ridge-near", sceneStart, sceneEnd, nearRidge, "#5a6a6e", 0.86),
        pathLayer("ridge-ink-accent", sceneStart, sceneEnd, "M120 540 Q300 470 470 540 M900 530 Q1100 450 1300 535 M1700 545 Q1900 462 2120 540 M2520 540 Q2700 470 2900 545", "rgba(38,46,52,0.4)", 3, 0.7, 0, 0, 1),
        // 水面与波纹（近处是水）
        rect("water", sceneStart, sceneEnd, -200, 596, 3800, 130, "#ccd6d0", 0.85),
        pathLayer("ripple-a", sceneStart, sceneEnd, "M180 632 Q260 624 340 632 M620 654 Q700 646 780 654 M1080 636 Q1170 628 1260 636 M1560 650 Q1650 642 1740 650 M2080 634 Q2170 626 2260 634 M2620 652 Q2700 644 2780 652 M3060 638 Q3140 630 3220 638", "rgba(122,140,138,0.65)", 3, 0.8),
        // 远空飞鸟
        pathLayer("birds", sceneStart, sceneEnd, "M760 200 q10 -10 20 0 q10 -10 20 0 M850 176 q9 -9 18 0 q9 -9 18 0 M1980 190 q10 -10 20 0 q10 -10 20 0", "rgba(50,58,64,0.6)", 3, 0.7)
      ]
    },
    // 小人所立的石矶（固定，不随长卷滚动）
    circle("islet", sceneStart, sceneEnd, 570, 596, 64, "#46555a", 0.92, 0, 0.3),
    circle("islet-shade", sceneStart, sceneEnd, 570, 612, 84, "rgba(58,70,74,0.4)", 0.7, 8, 0.22),
    // 练武小人（原地变招）
    {
      type: "group",
      id: "figure",
      transform: { x: 570, y: 506, scale: 1.6 },
      layers: figureLayers()
    },
    // 全屏卷动期的落款（随合书一起收起）
    text("scroll-inscription", "青\n冥\n录", 6700, 10300, 1156, 110, 46, "#39424a", hold(6700, 10300, 420, 380, 0.85), {}, 62),
    rect("scroll-seal", 6900, 10300, 1136, 292, 34, 34, "rgba(191,42,29,0.78)", hold(6900, 10300, 380, 360, 0.85))
  ]
};

// 画框：页面期缩在右页 → 放大全屏 → 绕中轴收拢
const sceneFrame: Layer = {
  type: "group",
  id: "scene-frame",
  transform: {
    x: 640,
    // Frame-precise cubic-bezier (emphasized) push from the right page to
    // full-frame — per-keyframe easing, no curve sampling.
    y: [{ timeMs: 5600, value: pageTop + 170 }, { timeMs: 6500, value: height / 2, easing: emphasized }],
    scale: [{ timeMs: 5600, value: 0.245 }, { timeMs: 6500, value: 1, easing: emphasized }],
    scaleX: track(9450, 900, 1, 0.015, easeInOutCubic, 8),
    opacity: [
      { timeMs: sceneStart, value: 0 },
      { timeMs: sceneStart + 320, value: 1 },
      { timeMs: 9980, value: 1 },
      // 折到只剩细条时淡出，避免在定格书后留下竖带残影
      { timeMs: 10260, value: 0 }
    ]
  },
  layers: [
    {
      type: "group",
      id: "scene-center",
      transform: { x: -width / 2, y: -height / 2 },
      layers: [paintingScene]
    }
  ]
};

// 合书定格：收拢时书又合上，随后白闪切入正片
const bookFinale: Layer = {
  type: "group",
  id: "book-finale",
  transform: {
    x: 640,
    y: 360,
    scale: track(10020, 430, 0.44, 0.5, easeOutCubic),
    opacity: [
      { timeMs: 10020, value: 0 },
      { timeMs: 10240, value: 0.98 },
      { timeMs: 10460, value: 0.98 }
    ]
  },
  layers: [
    rect("finale-shadow", 10020, 10470, -pageW / 2 - 14, -pageH / 2 - 8, pageW + 28, pageH + 18, "rgba(8,10,14,0.42)", 1, 0, 12),
    {
      type: "group",
      id: "finale-cover",
      transform: { x: -pageW / 2, y: -pageH / 2 },
      layers: coverFaceLayers("finale", 10020, 10470)
    }
  ]
};

// Title bloom: a screen-blended gold radial glow that springs in around the
// book's title slip as the volume settles, then fades before the cover folds.
const titleBloom: Layer = {
  type: "group",
  id: "title-bloom",
  blendMode: "screen",
  transform: {
    x: 741,
    y: 327,
    scale: springKeyframes({ from: 0.5, to: 1, startMs: 1700, fps, stiffness: 120, damping: 11 }),
    opacity: [
      { timeMs: 1500, value: 0 },
      { timeMs: 2050, value: 0.95 },
      { timeMs: 2650, value: 0.95 },
      { timeMs: 2920, value: 0 }
    ]
  },
  layers: [
    {
      type: "shape",
      id: "title-bloom-core",
      shape: "circle",
      radius: 170,
      fill: titleGlow,
      startMs: 1500,
      endMs: 3000,
      transform: { x: -170, y: -170 }
    }
  ]
};

// Cinematic vignette (radial darkening at the edges) over the painting act.
const vignette: Layer = {
  type: "shape",
  id: "intro-vignette",
  shape: "rect",
  width,
  height,
  fill: vignetteGradient,
  startMs: 3000,
  endMs: introEnd + 280,
  transform: { x: 0, y: 0, opacity: hold(3000, introEnd + 280, 600, 300, 1) }
};

const introLayers: Layer[] = [
  rect("intro-ink-bg", 0, introEnd + 320, 0, 0, width, height, ink),
  rect("intro-paper-bg", 0, introEnd + 280, 0, 0, width, height, paper, [
    { timeMs: 0, value: 0 },
    { timeMs: 2600, value: 0.35 },
    { timeMs: 3900, value: 1 },
    { timeMs: introEnd, value: 1 },
    { timeMs: introEnd + 280, value: 0 }
  ]),
  ...skyLayers,
  ...bookLayers,
  sceneFrame,
  coverLayer,
  titleBloom,
  bookFinale,
  vignette,
  flashTransitionLayer({ id: "intro-hit", width, height, startMs: introEnd - 140, durationMs: 380, color: "#fff4d2", peakOpacity: 0.85 })
];

// ---------------------------------------------------------------------------
// 正片：f01–f05 + 墨色转场 + 字幕（沿用原有机制）
// ---------------------------------------------------------------------------

function swordSlash(id: string, timeMs: number, y: number, color = "rgba(255,235,174,0.92)"): Layer[] {
  const opacity = [
    { timeMs, value: 0 },
    { timeMs: timeMs + 80, value: 1 },
    { timeMs: timeMs + 310, value: 0.14 },
    { timeMs: timeMs + 560, value: 0 }
  ];
  return [
    // Luminous streak: screen-blended glow with directional motion blur along
    // the blade's angle, so the light smears into a fast sword arc.
    {
      type: "shape",
      id: `${id}-glow`,
      shape: "rect",
      width: 1630,
      height: 7,
      fill: color,
      blur: 10,
      blendMode: "screen",
      motionBlur: { angle: -13, distance: 80, samples: 8 },
      startMs: timeMs,
      endMs: timeMs + 560,
      transform: { x: -170, y, rotate: -13, opacity: scaleOpacity(opacity, 0.45) }
    },
    rect(`${id}-core`, timeMs + 40, timeMs + 430, -120, y + 8, 1500, 2, "#fffbe6", opacity, -13)
  ];
}

function inkWipe(id: string, timeMs: number, direction: "left" | "right"): Layer[] {
  const from = direction === "left" ? -1320 : 1320;
  const to = direction === "left" ? 1320 : -1320;
  return [
    rect(`${id}-a`, timeMs - 120, timeMs + 520, from, 96, 1480, 180, "rgba(3,4,5,0.88)", hold(timeMs - 120, timeMs + 520, 70, 180), -9, 9),
    rect(`${id}-b`, timeMs - 80, timeMs + 600, to, 354, 1500, 210, "rgba(5,6,7,0.76)", hold(timeMs - 80, timeMs + 600, 70, 190), 11, 12)
  ].map((layer) => ({
    ...layer,
    transform: {
      ...layer.transform,
      // Per-keyframe cubic-bezier sweep — snappier than the sampled curve.
      x: [
        { timeMs: layer.startMs ?? timeMs, value: from },
        { timeMs: layer.endMs ?? timeMs + 600, value: to, easing: emphasized }
      ]
    }
  }));
}

function caption(id: string, value: string, startMs: number, endMs: number, x: number, y: number): Layer[] {
  return [
    rect(`${id}-plate`, startMs, endMs, x - 24, y + 20, 420, 72, "rgba(3,4,5,0.58)", hold(startMs, endMs, 180, 220, 0.9), 0, 4),
    text(id, value, startMs, endMs, x, y, 44, paleGold, hold(startMs + 70, endMs, 160, 250), {
      stroke: "rgba(0,0,0,0.76)",
      strokeWidth: 5,
      shadowColor: "rgba(191,42,29,0.36)",
      shadowBlur: 12,
      shadowDy: 3
    })
  ];
}

function videoLayer(index: number): Layer {
  const startMs = clipStarts[index]!;
  const endMs = clipEnds[index]!;
  const zoomFrom = index % 2 === 0 ? 1.035 : 1.095;
  const zoomTo = index % 2 === 0 ? 1.12 : 1.03;
  return {
    type: "video",
    id: `f0${index + 1}-video`,
    src: sources[index]!,
    width,
    height,
    fit: "cover",
    trimStartMs: 0,
    startMs,
    endMs,
    transform: {
      scale: track(startMs, endMs - startMs, zoomFrom, zoomTo, easeInOutCubic, 8),
      x: track(startMs, endMs - startMs, -26 - index * 7, -72 + index * 12, easeInOutCubic, 8),
      y: track(startMs, endMs - startMs, -18, -42, easeInOutCubic, 8),
      opacity: hold(startMs, endMs, 150, 260)
    }
  };
}

function audioLayer(index: number): Layer {
  const startMs = clipStarts[index]!;
  const endMs = clipEnds[index]!;
  return {
    type: "audio",
    id: `f0${index + 1}-audio`,
    src: sources[index]!,
    startMs,
    endMs,
    volume: 0.76,
    fadeInMs: 200,
    fadeOutMs: 320
  };
}

const transitionTimes = clipStarts.slice(1);
const transitionLayers = transitionTimes.flatMap((timeMs, index) => [
  ...inkWipe(`cut-${index}`, timeMs, index % 2 === 0 ? "left" : "right"),
  ...swordSlash(`cut-slash-${index}`, timeMs - 40, 218 + index * 92, index % 2 === 0 ? "rgba(255,240,184,0.84)" : "rgba(191,42,29,0.82)"),
  flashTransitionLayer({ id: `cut-flash-${index}`, width, height, startMs: timeMs - 40, durationMs: 260, color: index % 2 === 0 ? "#fff4d2" : "#d83a25", peakOpacity: index % 2 === 0 ? 0.62 : 0.44 })
]);

const clipCaptions = [
  caption("caption-1", "雨夜入城", clipStarts[0]! + 560, clipStarts[0]! + 2350, 86, 506),
  caption("caption-2", "旧案重启", clipStarts[1]! + 510, clipStarts[1]! + 2380, 770, 94),
  caption("caption-3", "剑影追魂", clipStarts[2]! + 520, clipStarts[2]! + 2480, 96, 120),
  caption("caption-4", "青冥决", clipStarts[3]! + 620, clipStarts[3]! + 2600, 810, 500),
  caption("caption-5", "十年一剑", clipStarts[4]! + 560, clipStarts[4]! + 2500, 90, 506)
].flat();

const outroLayers: Layer[] = [
  rect("outro-bg", outroStart - 220, durationMs, 0, 0, width, height, "rgba(2,3,5,0.88)", hold(outroStart - 220, durationMs, 180, 0, 0.98)),
  pathLayer("outro-ink-ring", outroStart, durationMs, "M292 365 C408 220 603 190 760 284 C915 377 930 563 760 626 C570 698 340 589 292 365", red, 7, hold(outroStart + 120, durationMs, 280, 400, 0.54), 0, 0, 4),
  // Gold halo that springs in behind the title (screen-blended radial glow).
  {
    type: "group",
    id: "outro-title-glow",
    blendMode: "screen",
    transform: {
      x: 592,
      y: 212,
      scale: springKeyframes({ from: 0.6, to: 1, startMs: outroStart + 180, fps, stiffness: 90, damping: 12 }),
      opacity: hold(outroStart + 180, durationMs, 320, 420, 0.9)
    },
    layers: [
      {
        type: "shape",
        id: "outro-title-glow-core",
        shape: "circle",
        radius: 240,
        fill: outroGlow,
        startMs: outroStart + 180,
        endMs: durationMs,
        transform: { x: -240, y: -240 }
      }
    ]
  },
  text("outro-title", "青冥录", outroStart + 180, durationMs, 424, 244, 112, gold, hold(outroStart + 180, durationMs, 260, 380, 1), {
    stroke: "rgba(0,0,0,0.82)",
    strokeWidth: 6,
    shadowColor: "rgba(231,195,106,0.28)",
    shadowBlur: 22,
    shadowDy: 7
  }),
  text("outro-copy", "十年旧案，一剑照青冥", outroStart + 620, durationMs, 410, 410, 40, "#f9edc8", hold(outroStart + 620, durationMs, 260, 480, 0.92), {
    stroke: "rgba(0,0,0,0.72)",
    strokeWidth: 4
  }),
  ...swordSlash("outro-final-slash", outroStart + 1160, 356, "rgba(255,240,184,0.88)")
];

export default defineComposition({
  fps,
  width,
  height,
  durationMs,
  defaultFont: songti,
  layers: [
    ...introLayers,
    ...sources.map((_, index) => videoLayer(index)),
    ...sources.map((_, index) => audioLayer(index)),
    {
      type: "audio",
      id: "qingming-title-audio",
      src: titleAudio,
      startMs: 0,
      endMs: 4600,
      volume: 0.92,
      fadeInMs: 80,
      fadeOutMs: 900
    },
    ...cinematicBars({ id: "movie-bars", width, height, startMs: 0, endMs: durationMs, barHeight: 64, opacity: 0.92 }),
    ...transitionLayers,
    ...clipCaptions,
    ...outroLayers
  ]
});
