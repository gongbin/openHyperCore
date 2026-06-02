import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "霓虹混剪" — a beat-cut showcase for the OpenHyperCore render kernel.
// Chinese captions + outlined/shadowed typography.
//
// Structure:
//   intro  (0 .. 2400ms)      启动序列 + 3-2-1 倒计时
//   body   (2400 .. 11400ms)  五段跳切，每段配不同转场：缩放冲击 / 百叶窗 / RGB 故障 / 中分开合
//   outro  (11200 .. 14200ms) 片尾卡：品牌锁定 + 关注按钮
//
// Notes on the engine: keyframes interpolate linearly, so smooth motion is
// faked by sampling an easing curve (see `track`). scale/rotate pivot around
// each layer origin, so video zoom-punches compensate x/y to stay centered.
// Chinese text needs a CJK font — the renderer now defaults to one, or set
// OPENHYPERCORE_FONT to override.
// ---------------------------------------------------------------------------

const width = 1280;
const height = 720;
const fps = 25;

const introMs = 2400;
const cuts = [4280, 6000, 7720, 9440];
const bodyEndMs = 11400;
const outroMs = 11200;
const durationMs = 14200;

const SRC = "examples/demo.mp4";

// Neon duotone palette.
const ink = "#070711";
const magenta = "#ff2d75";
const cyan = "#21f0e0";
const yellow = "#ffd23f";
const violet = "#7b2ff7";
const white = "#ffffff";

// --- easing ---------------------------------------------------------------
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// Sample an easing curve into keyframes so linear interpolation looks smooth.
function track(startMs: number, durMs: number, from: number, to: number, ease: (t: number) => number, steps = 6): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    kf.push({ timeMs: Math.round(startMs + durMs * p), value: from + (to - from) * ease(p) });
  }
  return kf;
}

// Fade in, hold, fade out.
function hold(startMs: number, endMs: number, fadeIn = 200, fadeOut = 220): ScalarKeyframe[] {
  return [
    { timeMs: startMs, value: 0 },
    { timeMs: startMs + fadeIn, value: 1 },
    { timeMs: endMs - fadeOut, value: 1 },
    { timeMs: endMs, value: 0 }
  ];
}

// Glitchy flicker-in, hold, fade out — used for kinetic typography.
function flick(startMs: number, endMs: number): ScalarKeyframe[] {
  return [
    { timeMs: startMs, value: 0 },
    { timeMs: startMs + 55, value: 1 },
    { timeMs: startMs + 90, value: 0.18 },
    { timeMs: startMs + 130, value: 1 },
    { timeMs: startMs + 175, value: 0.35 },
    { timeMs: startMs + 210, value: 1 },
    { timeMs: endMs - 180, value: 1 },
    { timeMs: endMs, value: 0 }
  ];
}

// Repeating blink for the REC dot.
function blink(startMs: number, endMs: number, period = 760): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let t = startMs; t <= endMs; t += period) {
    kf.push({ timeMs: t, value: 1 });
    kf.push({ timeMs: Math.min(endMs, t + Math.round(period * 0.42)), value: 0.12 });
  }
  return kf;
}

// CJK-aware width estimate: full-width glyphs ≈ 1em, Latin ≈ 0.55em.
function textWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const cjk = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef) || (code >= 0x3000 && code <= 0x303f);
    units += cjk ? 1 : 0.55;
  }
  return units * size;
}
const centerX = (text: string, size: number) => Math.round((width - textWidth(text, size)) / 2);

// --- text style presets ----------------------------------------------------
// Typography: small text = heiti, plain (colour only, no decoration); big
// titles = display font with a soft glow only (no light-on-light stroke).
const HEITI = "/System/Library/Fonts/STHeiti Medium.ttc";
const DISPLAY = "examples/assets/ZCOOLQingKeHuangYou-Regular.ttf";
const softShadow: TextStyle = {};
const captionStyle: TextStyle = {};
const titleStyle = (_color: string) => ({ shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 12, shadowDy: 4, font: DISPLAY });

// --- primitive layer builders --------------------------------------------
function rect(id: string, startMs: number, endMs: number, x: number, y: number, w: number, h: number, fill: string, opacity: number | ScalarKeyframe[] = 1, rotate = 0): Layer {
  return {
    type: "shape",
    id,
    shape: "rect",
    width: w,
    height: h,
    fill,
    startMs,
    endMs,
    transform: { x, y, opacity, rotate }
  };
}

function label(id: string, text: string, x: number, y: number, size: number, color: string, startMs: number, endMs: number, opacity: ScalarKeyframe[] = hold(startMs, endMs), style: TextStyle = {}): Layer {
  return { type: "text", id, text, size, color, startMs, endMs, ...style, transform: { x, y, opacity } };
}

// A full-frame color hit that spikes then decays — the glue of beat editing.
function flash(id: string, t: number, color: string, max = 0.92, dur = 260): Layer {
  return {
    type: "shape",
    id,
    shape: "rect",
    width,
    height,
    fill: color,
    startMs: t - 30,
    endMs: t + dur,
    transform: {
      opacity: [
        { timeMs: t - 30, value: 0 },
        { timeMs: t + Math.round(dur * 0.12), value: max },
        { timeMs: t + Math.round(dur * 0.42), value: max * 0.25 },
        { timeMs: t + dur, value: 0 }
      ]
    }
  };
}

// --- intro: boot sequence + countdown -------------------------------------
function gridLine(id: string, axis: "h" | "v", pos: number, delay: number, color: string): Layer {
  const long = axis === "h" ? width + 200 : 6;
  const thick = axis === "h" ? 3 : height + 200;
  const fromX = axis === "h" ? -width : pos;
  const fromY = axis === "h" ? pos : -height;
  const toX = axis === "h" ? 0 : pos;
  const toY = axis === "h" ? pos : 0;
  return {
    type: "shape",
    id,
    shape: "rect",
    width: axis === "h" ? long : thick,
    height: axis === "h" ? thick : long,
    fill: color,
    startMs: delay,
    endMs: introMs + 200,
    transform: {
      x: axis === "h" ? track(delay, 520, fromX, toX, easeOutCubic) : toX,
      y: axis === "h" ? toY : track(delay, 520, fromY, toY, easeOutCubic),
      opacity: [
        { timeMs: delay, value: 0 },
        { timeMs: delay + 160, value: 0.55 },
        { timeMs: introMs, value: 0.2 },
        { timeMs: introMs + 200, value: 0 }
      ]
    }
  };
}

function countdownDigit(text: string, t: number): Layer[] {
  const size = 210;
  const x = centerX(text, size);
  const y = 470;
  const dur = 300;
  return [
    // expanding tick ring (a thin stroked square pulsing out)
    {
      type: "shape",
      id: `cd-ring-${text}`,
      shape: "rect",
      width: 150,
      height: 150,
      fill: ink,
      stroke: cyan,
      strokeWidth: 4,
      startMs: t,
      endMs: t + dur,
      transform: {
        x: track(t, dur, width / 2 - 75, width / 2 - 230, easeOutCubic),
        y: track(t, dur, 360 - 75, 360 - 230, easeOutCubic),
        scale: track(t, dur, 1, 3.05, easeOutCubic),
        opacity: [
          { timeMs: t, value: 0.9 },
          { timeMs: t + dur, value: 0 }
        ]
      }
    },
    {
      type: "text",
      id: `cd-${text}`,
      text,
      size,
      color: white,
      ...titleStyle(magenta),
      startMs: t,
      endMs: t + dur,
      transform: {
        x,
        y,
        scale: track(t, dur, 1.55, 1, easeOutBack, 7),
        opacity: [
          { timeMs: t, value: 0 },
          { timeMs: t + 50, value: 1 },
          { timeMs: t + dur - 70, value: 1 },
          { timeMs: t + dur, value: 0 }
        ]
      }
    }
  ];
}

const introSub = "「 系统已就绪 」  纯 CPU 视频渲染内核";
const introLayers: Layer[] = [
  rect("intro-bg", 0, introMs + 240, 0, 0, width, height, ink),
  rect("intro-band-top", 0, introMs + 240, 0, 0, width, 96, "#0d0d1f"),
  rect("intro-band-bot", 0, introMs + 240, 0, height - 96, width, 96, "#0d0d1f"),
  gridLine("grid-h1", "h", 250, 120, "rgba(33,240,224,0.7)"),
  gridLine("grid-h2", "h", 470, 240, "rgba(255,45,117,0.6)"),
  gridLine("grid-v1", "v", 360, 200, "rgba(123,47,247,0.5)"),
  gridLine("grid-v2", "v", 920, 320, "rgba(33,240,224,0.4)"),
  label("intro-title", "OPENHYPERCORE", centerX("OPENHYPERCORE", 62), 112, 62, white, 220, introMs, flick(220, introMs), titleStyle(cyan)),
  label("intro-sub", introSub, centerX(introSub, 24), 152, 24, cyan, 420, introMs, flick(420, introMs), softShadow),
  // loading bar
  label("load-text", "正在初始化渲染内核…", 340, 580, 20, "rgba(255,255,255,0.78)", 520, introMs, hold(520, introMs, 200, 160), softShadow),
  {
    type: "shape",
    id: "load-track",
    shape: "rect",
    width: 600,
    height: 12,
    fill: ink,
    stroke: "rgba(255,255,255,0.35)",
    strokeWidth: 2,
    startMs: 520,
    endMs: introMs,
    transform: { x: 340, y: 596, opacity: hold(520, introMs, 200, 120) }
  },
  // Full fill bar; a same-colour mask slides off to the right to reveal it
  // left-to-right (only uniform scale exists, so width can't be animated).
  rect("load-fill", 560, introMs, 340, 596, 600, 12, magenta, hold(560, introMs, 60, 120)),
  {
    type: "shape",
    id: "load-mask",
    shape: "rect",
    width: 640,
    height: 18,
    fill: ink,
    startMs: 560,
    endMs: introMs,
    transform: {
      x: track(560, 1560, 340, 952, easeInOutCubic, 8),
      y: 593,
      opacity: hold(560, introMs, 40, 100)
    }
  },
  ...countdownDigit("3", 1500),
  ...countdownDigit("2", 1800),
  ...countdownDigit("1", 2100),
  flash("intro-drop", introMs, white, 0.98, 300)
];

// --- body: video segments + per-cut transitions ---------------------------
function videoSeg(id: string, startMs: number, endMs: number, trimStartMs: number, punch = 0.12): Layer {
  return {
    type: "video",
    id,
    src: SRC,
    startMs,
    endMs,
    trimStartMs,
    width,
    height,
    transform: {
      scale: track(startMs, 360, 1 + punch, 1, easeOutCubic, 5),
      x: track(startMs, 360, -(width / 2) * punch, 0, easeOutCubic, 5),
      y: track(startMs, 360, -(height / 2) * punch, 0, easeOutCubic, 5)
    }
  };
}

function kineticWord(id: string, text: string, startMs: number, endMs: number, color: string): Layer[] {
  const x = 74;
  const size = 82;
  const y = 172;
  const barW = Math.min(textWidth(text, size), 560);
  return [
    rect(`${id}-bar`, startMs, endMs, x - 2, y - 78, barW, 10, color, [
      { timeMs: startMs, value: 0 },
      { timeMs: startMs + 90, value: 1 },
      { timeMs: endMs - 160, value: 1 },
      { timeMs: endMs, value: 0 }
    ]),
    {
      type: "text",
      id,
      text,
      size,
      color: white,
      ...titleStyle(color),
      startMs,
      endMs,
      transform: {
        x: track(startMs, 320, x - 46, x, easeOutCubic),
        y,
        opacity: flick(startMs, endMs)
      }
    }
  ];
}

function clipTag(id: string, tag: string, startMs: number, endMs: number): Layer {
  return label(id, tag, width - 190, 56, 22, yellow, startMs, endMs, hold(startMs, endMs, 140, 140), softShadow);
}

function caption(id: string, text: string, startMs: number, endMs: number): Layer {
  const size = 30;
  return {
    type: "caption",
    id,
    text,
    startMs,
    endMs,
    size,
    color: white,
    backgroundColor: "rgba(7,7,17,0.72)",
    padding: 16,
    align: "center",
    maxWidth: Math.round(textWidth(text, size)),
    lineHeight: size * 1.25,
    ...captionStyle,
    transform: { x: width / 2, y: 656, opacity: hold(startMs, endMs, 160, 180) }
  };
}

// Transition 2 — venetian blind wipe that fully covers the cut, then opens.
function blinds(prefix: string, t: number, color: string): Layer[] {
  const bars = 9;
  const barH = Math.ceil(height / bars);
  const stagger = 16;
  return Array.from({ length: bars }, (_, i): Layer => {
    const inT = t - 220 + i * stagger;
    const mid = t + i * stagger;
    const outT = t + 230 + i * stagger;
    return {
      type: "shape",
      id: `${prefix}-${i}`,
      shape: "rect",
      width,
      height: barH + 1,
      fill: color,
      startMs: inT,
      endMs: outT,
      transform: {
        x: [
          { timeMs: inT, value: -width },
          { timeMs: mid, value: 0 },
          { timeMs: outT, value: width }
        ],
        y: i * barH
      }
    };
  });
}

// Transition 3 — RGB-split glitch burst.
function glitch(prefix: string, t: number): Layer[] {
  const dur = 260;
  const splitOpacity: ScalarKeyframe[] = [
    { timeMs: t - 20, value: 0 },
    { timeMs: t + 30, value: 0.32 },
    { timeMs: t + 70, value: 0.06 },
    { timeMs: t + 110, value: 0.3 },
    { timeMs: t + 170, value: 0.08 },
    { timeMs: t + dur, value: 0 }
  ];
  const bands = Array.from({ length: 5 }, (_, i) => {
    const y = 90 + i * 130 + (i % 2) * 40;
    const bandH = 8 + (i % 3) * 10;
    const startT = t - 10 + i * 18;
    return rect(`${prefix}-band-${i}`, startT, t + dur, i % 2 === 0 ? -26 : 22, y, width + 40, bandH, i % 2 === 0 ? white : cyan, [
      { timeMs: startT, value: 0 },
      { timeMs: startT + 24, value: 0.85 },
      { timeMs: startT + 70, value: 0.1 },
      { timeMs: startT + 120, value: 0.6 },
      { timeMs: t + dur, value: 0 }
    ]);
  });
  return [
    rect(`${prefix}-rgb-m`, t - 20, t + dur, -9, 0, width, height, magenta, splitOpacity),
    rect(`${prefix}-rgb-c`, t - 20, t + dur, 9, 0, width, height, cyan, splitOpacity),
    ...bands,
    flash(`${prefix}-hit`, t, white, 0.5, 130)
  ];
}

// Transition 4 — center split: two slabs converge over the cut, then part.
function centerSplit(prefix: string, t: number, color: string): Layer[] {
  const halfH = height / 2;
  return [
    {
      type: "shape",
      id: `${prefix}-top`,
      shape: "rect",
      width,
      height: halfH,
      fill: color,
      startMs: t - 200,
      endMs: t + 240,
      transform: {
        x: 0,
        y: [
          { timeMs: t - 200, value: -halfH },
          { timeMs: t, value: 0 },
          { timeMs: t + 240, value: -halfH }
        ]
      }
    },
    {
      type: "shape",
      id: `${prefix}-bot`,
      shape: "rect",
      width,
      height: halfH,
      fill: color,
      startMs: t - 200,
      endMs: t + 240,
      transform: {
        x: 0,
        y: [
          { timeMs: t - 200, value: height },
          { timeMs: t, value: halfH },
          { timeMs: t + 240, value: height }
        ]
      }
    },
    rect(`${prefix}-seam`, t - 60, t + 180, 0, halfH - 3, width, 6, white, [
      { timeMs: t - 60, value: 0 },
      { timeMs: t, value: 1 },
      { timeMs: t + 180, value: 0 }
    ]),
    flash(`${prefix}-hit`, t, color, 0.55, 160)
  ];
}

// Fast diagonal streaks for the first whip cut.
function whip(prefix: string, t: number, color: string): Layer {
  return {
    type: "shape",
    id: prefix,
    shape: "rect",
    width: 60,
    height: height * 1.5,
    fill: color,
    startMs: t - 120,
    endMs: t + 220,
    transform: {
      x: track(t - 120, 340, -300, width + 300, easeInOutCubic, 5),
      y: -120,
      rotate: 14,
      opacity: [
        { timeMs: t - 120, value: 0 },
        { timeMs: t - 40, value: 0.85 },
        { timeMs: t + 120, value: 0.5 },
        { timeMs: t + 220, value: 0 }
      ]
    }
  };
}

const segments: Array<{ trim: number; word: string; color: string; tag: string; cap: string }> = [
  { trim: 4000, word: "渲染", color: cyan, tag: "片段 01", cap: "Skia / CanvasKit 逐帧绘制，全程跑在 CPU 上" },
  { trim: 22000, word: "管线", color: magenta, tag: "片段 02", cap: "原始 RGBA 像素直接喂给 FFmpeg 编码" },
  { trim: 47000, word: "并行", color: yellow, tag: "片段 03", cap: "worker_threads 多线程并行渲染每一帧" },
  { trim: 88000, word: "复用", color: violet, tag: "片段 04", cap: "画面相同的帧直接复用 RGBA 缓冲" },
  { trim: 110000, word: "出片", color: cyan, tag: "片段 05", cap: "输出 H.264 + AAC，无需 GPU、无需 Chromium" }
];

const segStarts = [introMs, ...cuts];
const segEnds = [...cuts, bodyEndMs];

const videoLayers: Layer[] = segments.map((seg, i) =>
  videoSeg(`clip-${i + 1}`, segStarts[i]!, segEnds[i]!, seg.trim, i === 0 ? 0.14 : 0.1)
);

const hudLayers: Layer[] = [
  // top/bottom darkening for legibility
  rect("hud-top-grad", introMs, bodyEndMs, 0, 0, width, 92, "rgba(7,7,17,0.55)"),
  rect("hud-bot-grad", introMs, bodyEndMs, 0, height - 150, width, 150, "rgba(7,7,17,0.62)"),
  // REC dot + brand
  {
    type: "shape",
    id: "rec-dot",
    shape: "circle",
    radius: 8,
    fill: magenta,
    startMs: introMs,
    endMs: bodyEndMs,
    transform: { x: 46, y: 44, opacity: blink(introMs, bodyEndMs) }
  },
  label("hud-brand", "OPENHYPERCORE  //  实时渲染", 72, 52, 22, cyan, introMs, bodyEndMs, hold(introMs, bodyEndMs, 200, 200), softShadow),
  // playback scrubber: dim track + a bright playhead that travels across
  rect("prog-track", introMs, bodyEndMs, 0, height - 6, width, 6, "rgba(255,255,255,0.16)"),
  {
    type: "shape",
    id: "prog-head",
    shape: "rect",
    width: 90,
    height: 6,
    fill: magenta,
    startMs: introMs,
    endMs: bodyEndMs,
    transform: {
      x: [
        { timeMs: introMs, value: -90 },
        { timeMs: bodyEndMs, value: width }
      ],
      y: height - 6,
      opacity: 0.95
    }
  }
];

// Per-segment kinetic words, clip tags, captions.
const segmentDecor: Layer[] = segments.flatMap((seg, i) => {
  const start = segStarts[i]! + 120;
  const end = segEnds[i]! - 60;
  return [
    ...kineticWord(`word-${i + 1}`, seg.word, start, end, seg.color),
    clipTag(`tag-${i + 1}`, seg.tag, start, end),
    caption(`cap-${i + 1}`, seg.cap, segStarts[i]! + 200, segEnds[i]! - 120)
  ];
});

const transitionLayers: Layer[] = [
  // cut 1 — whip + white flash
  whip("whip-a", cuts[0]!, cyan),
  whip("whip-b", cuts[0]! + 40, magenta),
  flash("flash-1", cuts[0]!, white, 0.9, 240),
  // cut 2 — blinds
  ...blinds("blinds", cuts[1]!, magenta),
  // cut 3 — glitch
  ...glitch("glitch", cuts[2]!),
  // cut 4 — center split
  ...centerSplit("split", cuts[3]!, yellow)
];

// --- outro: end card -------------------------------------------------------
const followText = "关注项目进展  >";
const tagline = "纯 CPU 渲染  ·  无需 GPU  ·  无需 Chromium";
const pillW = 420;
const pillX = (width - pillW) / 2;
const pillY = 452;

const outroLayers: Layer[] = [
  rect("outro-darken", outroMs, durationMs, 0, 0, width, height, ink, [
    { timeMs: outroMs, value: 0 },
    { timeMs: outroMs + 360, value: 0.86 },
    { timeMs: durationMs, value: 0.86 }
  ]),
  // brand lockup
  label("outro-title", "OPENHYPERCORE", centerX("OPENHYPERCORE", 88), 340, 88, white, outroMs + 280, durationMs, flick(outroMs + 280, durationMs), titleStyle(cyan)),
  // animated underline sweep
  {
    type: "shape",
    id: "outro-underline",
    shape: "rect",
    width: 560,
    height: 6,
    fill: cyan,
    startMs: outroMs + 520,
    endMs: durationMs,
    transform: {
      x: 360,
      y: 366,
      scale: track(outroMs + 520, 460, 0.001, 1, easeOutCubic, 6),
      opacity: 1
    }
  },
  label("outro-tag", tagline, centerX(tagline, 26), 410, 26, yellow, outroMs + 640, durationMs, hold(outroMs + 640, durationMs, 240, 260), softShadow),
  // follow pill
  {
    type: "shape",
    id: "outro-pill",
    shape: "rect",
    width: pillW,
    height: 66,
    fill: magenta,
    startMs: outroMs + 900,
    endMs: durationMs,
    transform: {
      x: pillX,
      y: [
        { timeMs: outroMs + 900, value: pillY + 26 },
        ...track(outroMs + 920, 360, pillY + 26, pillY, easeOutBack, 6)
      ],
      opacity: hold(outroMs + 900, durationMs, 180, 240)
    }
  },
  label(
    "outro-follow",
    followText,
    centerX(followText, 28),
    pillY + 44,
    28,
    white,
    outroMs + 980,
    durationMs,
    hold(outroMs + 980, durationMs, 180, 240),
    softShadow
  ),
  label("outro-handle", "@openhypercore", centerX("@openhypercore", 24), 600, 24, cyan, outroMs + 1100, durationMs, hold(outroMs + 1100, durationMs, 220, 280), softShadow),
  // final fade to black
  rect("final-fade", durationMs - 420, durationMs, 0, 0, width, height, "#000000", [
    { timeMs: durationMs - 420, value: 0 },
    { timeMs: durationMs, value: 1 }
  ])
];

export default defineComposition({
  defaultFont: HEITI,
  fps,
  width,
  height,
  durationMs,
  layers: [
    rect("base", 0, durationMs, 0, 0, width, height, ink),
    ...videoLayers,
    { type: "audio", id: "bgm", src: "examples/assets/bgm-uplift.m4a", startMs: 0, endMs: durationMs, volume: 0.5, fadeInMs: 600, fadeOutMs: 1300 },
    {
      type: "audio",
      id: "reel-audio",
      src: SRC,
      startMs: introMs,
      endMs: bodyEndMs + 200,
      volume: 0.6,
      fadeInMs: 220,
      fadeOutMs: 700
    },
    ...hudLayers,
    ...segmentDecor,
    ...transitionLayers,
    ...introLayers,
    ...outroLayers
  ]
});
