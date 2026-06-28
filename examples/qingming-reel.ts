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
// Spine gutter shadow printed INTO the painting so it reads as bound to the
// page (the book seam had a gradient, the landscape did not).
const gutterGradient: Gradient = {
  type: "linear",
  from: [0, 0],
  to: [180, 0],
  stops: [
    { offset: 0, color: "rgba(34,28,18,0.62)" },
    { offset: 0.4, color: "rgba(34,28,18,0.2)" },
    { offset: 1, color: "rgba(34,28,18,0)" }
  ]
};
// Outro: deep dusk backdrop + dark mountain silhouettes for a calm, natural
// "wind over the ranges" closing card.
const outroSky: Gradient = {
  type: "linear",
  from: [0, 0],
  to: [0, height],
  stops: [
    { offset: 0, color: "#0a0d12" },
    { offset: 0.5, color: "#12171d" },
    { offset: 1, color: "#070a0e" }
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

// Deterministic PRNG so ridges/figures stay identical across renders.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Natural mountain ridge: irregular peak heights AND spacing within a band
// (hiY = tallest crest, loY = valleys), so the skyline reads organically rather
// than as evenly-spaced bumps.
function naturalRidge(seed: number, hiY: number, loY: number, baseY = 720, spanX = 3400): string {
  const rng = mulberry32(seed);
  const peaks: Array<[number, number]> = [[0, Math.round(loY - (loY - hiY) * rng() * 0.5)]];
  let x = 70 + rng() * 90;
  while (x < spanX) {
    // ~25% of crests rise tall; the rest stay low/moderate — varied skyline.
    const peakedness = rng() < 0.26 ? 0.78 + rng() * 0.22 : rng() * 0.62;
    peaks.push([Math.round(x), Math.round(loY - (loY - hiY) * peakedness)]);
    x += 80 + rng() * 210;
  }
  peaks.push([spanX, Math.round(loY - (loY - hiY) * rng() * 0.5)]);
  return ridgePath(peaks, baseY);
}

// Stadium (capsule) outline between two joints — the building block for a
// fleshed-out ink figure instead of hairline strokes.
function capsule(ax: number, ay: number, bx: number, by: number, r: number): string {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * r;
  const py = (dx / len) * r;
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(ax + px)} ${f(ay + py)} L${f(bx + px)} ${f(by + py)} A${r} ${r} 0 0 1 ${f(bx - px)} ${f(by - py)} L${f(ax - px)} ${f(ay - py)} A${r} ${r} 0 0 1 ${f(ax + px)} ${f(ay + py)} Z`;
}

type Joint = [number, number];
type Joints = {
  head: Joint; neck: Joint; hipC: Joint;
  sL: Joint; sR: Joint; eL: Joint; eR: Joint; hL: Joint; hR: Joint;
  pL: Joint; pR: Joint; kL: Joint; kR: Joint; fL: Joint; fR: Joint;
};

// One filled ink silhouette (torso + limbs as overlapping capsules, unioned by
// nonzero fill) — gives the martial figure real body mass.
function silhouette(j: Joints): string {
  const seg = (a: Joint, b: Joint, r: number) => capsule(a[0], a[1], b[0], b[1], r);
  return [
    seg(j.neck, j.hipC, 11),
    seg(j.sL, j.sR, 8),
    seg(j.hipC, j.sL, 7), seg(j.hipC, j.sR, 7),
    seg(j.sL, j.eL, 6), seg(j.eL, j.hL, 5),
    seg(j.sR, j.eR, 6), seg(j.eR, j.hR, 5),
    seg(j.hipC, j.pL, 8), seg(j.hipC, j.pR, 8),
    seg(j.pL, j.kL, 8), seg(j.kL, j.fL, 6),
    seg(j.pR, j.kR, 8), seg(j.kR, j.fR, 6)
  ].join(" ");
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

const farRidge = naturalRidge(0x51a3, 250, 410);
const midRidge = naturalRidge(0x8c27, 338, 500);
const nearRidge = naturalRidge(0x2f19, 430, 588);

const sceneStart = 3000;
const sceneEnd = 10380;

// 练武小人：四式循环（马步展臂 / 弓步冲拳 / 提膝亮掌 / 仆步下势）。
// 用填充剪影（带身躯/四肢的水墨人形）替代发丝细线，更有体量与真实感。
const poses: Joints[] = [
  // 马步展臂
  { head: [0, -44], neck: [0, -30], hipC: [0, 6], sL: [-12, -27], sR: [12, -27], eL: [-30, -28], eR: [30, -28], hL: [-46, -24], hR: [46, -24], pL: [-10, 6], pR: [10, 6], kL: [-22, 24], kR: [22, 24], fL: [-26, 46], fR: [26, 46] },
  // 弓步冲拳（右拳前冲，左拳收）
  { head: [4, -42], neck: [3, -28], hipC: [0, 6], sL: [-10, -26], sR: [13, -26], eL: [-20, -16], eR: [30, -28], hL: [-30, -6], hR: [50, -30], pL: [-12, 6], pR: [10, 6], kL: [-30, 26], kR: [26, 18], fL: [-46, 44], fR: [38, 46] },
  // 提膝亮掌（右掌上举，右膝提起）
  { head: [0, -46], neck: [0, -32], hipC: [0, 4], sL: [-11, -30], sR: [11, -30], eL: [-22, -20], eR: [18, -44], hL: [-28, -4], hR: [26, -60], pL: [-9, 4], pR: [9, 4], kL: [-6, 24], kR: [22, 6], fL: [-6, 46], fR: [34, 22] },
  // 仆步下势（重心左沉，右腿展开）
  { head: [-10, -28], neck: [-8, -16], hipC: [-4, 8], sL: [-18, -14], sR: [3, -14], eL: [-34, -6], eR: [16, -8], hL: [-48, 0], hR: [32, -16], pL: [-12, 8], pR: [6, 10], kL: [-22, 28], kR: [22, 40], fL: [-30, 44], fR: [50, 46] }
];

function figureLayers(): Layer[] {
  const out: Layer[] = [];
  const start = 3450;
  const stepMs = 520;
  let index = 0;
  for (let t = start; t < sceneEnd; t += stepMs, index += 1) {
    const pose = poses[index % 4]!;
    const endMs = Math.min(t + stepMs, sceneEnd);
    out.push(fillPath(`figure-body-${index}`, t, endMs, silhouette(pose), inkDark, 1));
    // 头 + 发髻
    out.push(circle(`figure-head-${index}`, t, endMs, pose.head[0], pose.head[1], 10, inkDark));
    out.push(circle(`figure-bun-${index}`, t, endMs, pose.head[0], pose.head[1] - 12, 5, inkDark));
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
    // 书缝装订阴影：印在山水之上，使画面"长"在书页里而非贴上去。
    { type: "shape", id: "scene-gutter", shape: "rect", width: 180, height, fill: gutterGradient, startMs: sceneStart, endMs: sceneEnd, transform: { x: 0, y: 0 } },
    rect("scene-spine-crease", sceneStart, sceneEnd, 0, 0, 3, height, "rgba(28,22,14,0.55)"),
    // 右侧（书口）轻微暗边
    rect("scene-foredge", sceneStart, sceneEnd, width - 60, 0, 60, height, "rgba(34,28,18,0.16)", 1, 0, 14),
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
    // Frame-precise cubic-bezier (emphasized) push from the right page to
    // full-frame, then a handscroll-style roll-off to the LEFT while fading —
    // a natural exit instead of squeezing into a sliver.
    x: [
      { timeMs: 9450, value: 640 },
      { timeMs: 10320, value: -700, easing: emphasized }
    ],
    y: [{ timeMs: 5600, value: pageTop + 170 }, { timeMs: 6500, value: height / 2, easing: emphasized }],
    scale: [
      { timeMs: 5600, value: 0.245 },
      { timeMs: 6500, value: 1, easing: emphasized },
      { timeMs: 9450, value: 1 },
      { timeMs: 10300, value: 0.84, easing: "easeOutCubic" }
    ],
    opacity: [
      { timeMs: sceneStart, value: 0 },
      { timeMs: sceneStart + 320, value: 1 },
      { timeMs: 9550, value: 1 },
      { timeMs: 10300, value: 0 }
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
    { timeMs: 9450, value: 1 },
    // 与卷轴左移同步淡出 → 露出底层墨色，画卷向暗处卷离（而非空白纸面）。
    { timeMs: 10200, value: 0 }
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

// 片尾远山（缓慢风移 + 视差），自然风版尾。
const outroFar = naturalRidge(0x7b41, 470, 604, height, 1500);
const outroNear = naturalRidge(0x19d7, 532, 670, height, 1500);

// 随风缓移的雾霭一缕。
function outroMist(id: string, y: number, w: number, fromX: number, toX: number, peak: number, startMs: number): Layer {
  return {
    type: "shape",
    id,
    shape: "rect",
    width: w,
    height: 64,
    fill: "rgba(150,168,178,1)",
    blur: 30,
    startMs,
    endMs: durationMs,
    transform: {
      x: [{ timeMs: startMs, value: fromX }, { timeMs: durationMs, value: toX }],
      y,
      opacity: scaleOpacity(hold(startMs, durationMs, 820, 460), peak)
    }
  };
}

// 飘动的金尘（screen 发光小点，随风上飘）。
const outroMotes: Layer[] = [0, 1, 2, 3, 4].map((i) => {
  const start = outroStart + 320 + i * 160;
  const cx = 380 + i * 150;
  const cy = 286 + (i % 2) * 150;
  const r = 3 + (i % 2);
  return {
    type: "shape",
    id: `outro-mote-${i}`,
    shape: "circle",
    radius: r,
    fill: "rgba(255,224,150,1)",
    blendMode: "screen",
    blur: 3,
    startMs: start,
    endMs: durationMs,
    transform: {
      x: [{ timeMs: start, value: cx - r }, { timeMs: durationMs, value: cx - r - 40 - i * 8 }],
      y: [{ timeMs: start, value: cy - r }, { timeMs: durationMs, value: cy - r - 70 - i * 10 }],
      opacity: scaleOpacity(hold(start, durationMs, 520, 620), 0.55)
    }
  };
});

const outroLayers: Layer[] = [
  // 暮色天幕
  { type: "shape", id: "outro-bg", shape: "rect", width, height, fill: outroSky, startMs: outroStart - 220, endMs: durationMs, transform: { x: 0, y: 0, opacity: hold(outroStart - 220, durationMs, 240, 0, 1) } },
  // 远山剪影（缓慢风移视差）
  { type: "shape", id: "outro-mtn-far", shape: "path", path: outroFar, fill: "rgba(28,38,46,0.92)", blur: 2, startMs: outroStart - 120, endMs: durationMs, transform: { x: [{ timeMs: outroStart - 120, value: 8 }, { timeMs: durationMs, value: -14 }], y: 0, opacity: hold(outroStart - 120, durationMs, 520, 0, 0.85) } },
  { type: "shape", id: "outro-mtn-near", shape: "path", path: outroNear, fill: "#0b1117", startMs: outroStart - 80, endMs: durationMs, transform: { x: [{ timeMs: outroStart - 80, value: 0 }, { timeMs: durationMs, value: -32 }], y: 0, opacity: hold(outroStart - 80, durationMs, 520, 0, 0.96) } },
  // 风中雾霭
  outroMist("outro-mist-a", 432, 780, -140, 120, 0.2, outroStart),
  outroMist("outro-mist-b", 548, 900, 380, 80, 0.15, outroStart + 220),
  // 边缘压暗
  { type: "shape", id: "outro-vignette", shape: "rect", width, height, fill: vignetteGradient, startMs: outroStart, endMs: durationMs, transform: { x: 0, y: 0, opacity: hold(outroStart, durationMs, 520, 0, 0.85) } },
  // 标题金色光晕（spring 弹入）
  {
    type: "group",
    id: "outro-title-glow",
    blendMode: "screen",
    transform: {
      x: 592,
      y: 206,
      scale: springKeyframes({ from: 0.6, to: 1, startMs: outroStart + 200, fps, stiffness: 90, damping: 12 }),
      opacity: hold(outroStart + 200, durationMs, 360, 420, 0.85)
    },
    layers: [
      { type: "shape", id: "outro-title-glow-core", shape: "circle", radius: 250, fill: outroGlow, startMs: outroStart + 200, endMs: durationMs, transform: { x: -250, y: -250 } }
    ]
  },
  text("outro-title", "青冥录", outroStart + 200, durationMs, 424, 238, 112, gold, hold(outroStart + 200, durationMs, 320, 360, 1), {
    stroke: "rgba(0,0,0,0.82)",
    strokeWidth: 6,
    shadowColor: "rgba(231,195,106,0.3)",
    shadowBlur: 24,
    shadowDy: 7
  }),
  // 金色细线 + 中心菱形，自中心展开（替代红圈）
  {
    type: "group",
    id: "outro-rule",
    transform: {
      x: 640,
      y: 332,
      scaleX: track(outroStart + 560, 760, 0, 1, easeOutCubic, 6),
      opacity: hold(outroStart + 560, durationMs, 240, 360, 0.9)
    },
    layers: [
      rect("outro-rule-bar", outroStart + 560, durationMs, -190, 0, 380, 2, "rgba(231,195,106,0.9)"),
      { type: "shape", id: "outro-rule-gem", shape: "rect", width: 11, height: 11, fill: gold, startMs: outroStart + 560, endMs: durationMs, transform: { x: -5.5, y: -5, rotate: 45 } }
    ]
  },
  text("outro-copy", "十年旧案，一剑照青冥", outroStart + 760, durationMs, 410, 392, 38, "#f4e6c2", hold(outroStart + 760, durationMs, 300, 480, 0.92), {
    stroke: "rgba(0,0,0,0.6)",
    strokeWidth: 3
  }),
  ...outroMotes
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
