import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "城市漫游 · demo2" — a 20s, native 1920×1080 highlight montage built from the
// best moments of examples/demo2.mov (old-town walk). Beat cuts with varied
// transitions, kinetic words, Chinese captions, HUD, intro + outro, music.
// Demonstrates the 1080p render path. Small text = heiti; titles = display.
// ---------------------------------------------------------------------------

const width = 1920;
const height = 1080;
const fps = 25;
const cx = 960, cy = 540;

const SRC = "examples/demo2.mov";
const BGM = "examples/assets/bgm-epic.m4a";

const ink = "#070711";
const magenta = "#ff2d75";
const cyan = "#21f0e0";
const amber = "#ffd23f";
const violet = "#8a5cff";
const white = "#ffffff";

const HEITI = "/System/Library/Fonts/STHeiti Medium.ttc";
const DISPLAY = "examples/assets/ZCOOLQingKeHuangYou-Regular.ttf";

const introMs = 2400;
const cuts = [5400, 8400, 11400, 14400];
const segStarts = [introMs, ...cuts];
const segEnds = [...cuts, 17400];
const bodyEndMs = 17400;
const outroMs = 17400;
const durationMs = 20000;

// picked highlight trims (within demo2's 43s span)
const trims = [3000, 9000, 15000, 28000, 35000];
const words = ["出发", "老街", "巷弄", "烟火", "归途"];
const wordColors = [cyan, amber, magenta, violet, cyan];
const caps = [
  "漫步老城 · 慢下来",
  "青石巷弄 · 旧时光",
  "市井里的烟火气",
  "转角遇见生活",
  "一镜到底 · 纯 CPU 渲染"
];
const tags = ["镜头 01", "镜头 02", "镜头 03", "镜头 04", "镜头 05"];

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function track(s: number, d: number, a: number, b: number, e: (t: number) => number, n = 6): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let i = 0; i <= n; i += 1) { const p = i / n; kf.push({ timeMs: Math.round(s + d * p), value: a + (b - a) * e(p) }); }
  return kf;
}
function hold(s: number, e: number, fi = 220, fo = 240): ScalarKeyframe[] {
  return [{ timeMs: s, value: 0 }, { timeMs: s + fi, value: 1 }, { timeMs: e - fo, value: 1 }, { timeMs: e, value: 0 }];
}
function flick(s: number, e: number): ScalarKeyframe[] {
  return [{ timeMs: s, value: 0 }, { timeMs: s + 60, value: 1 }, { timeMs: s + 95, value: 0.2 }, { timeMs: s + 140, value: 1 }, { timeMs: s + 190, value: 0.4 }, { timeMs: s + 235, value: 1 }, { timeMs: e - 200, value: 1 }, { timeMs: e, value: 0 }];
}
function blink(s: number, e: number, period = 760): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let t = s; t <= e; t += period) { kf.push({ timeMs: t, value: 1 }); kf.push({ timeMs: Math.min(e, t + 320), value: 0.12 }); }
  return kf;
}
const scaleKf = (kf: ScalarKeyframe[], f: number): ScalarKeyframe[] => kf.map((k) => ({ timeMs: k.timeMs, value: k.value * f }));
function textWidth(t: string, size: number): number {
  let u = 0;
  for (const ch of t) { const c = ch.codePointAt(0) ?? 0; u += (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x3000 && c <= 0x303f) ? 1 : 0.55; }
  return u * size;
}
const centerX = (t: string, size: number) => Math.round((width - textWidth(t, size)) / 2);

const softShadow: TextStyle = {};
const titleStyle: TextStyle = { shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 16, shadowDy: 5, font: DISPLAY } as TextStyle;

function rect(id: string, s: number, e: number, x: number, y: number, w: number, h: number, fill: string, op: number | ScalarKeyframe[] = 1, rot = 0): Layer {
  return { type: "shape", id, shape: "rect", width: w, height: h, fill, startMs: s, endMs: e, transform: { x, y, opacity: op, rotate: rot } };
}
function label(id: string, t: string, x: number | ScalarKeyframe[], y: number, size: number, color: string, s: number, e: number, op: ScalarKeyframe[] = hold(s, e), style: TextStyle = {}): Layer {
  return { type: "text", id, text: t, size, color, startMs: s, endMs: e, ...style, transform: { x, y, opacity: op } };
}
function flash(id: string, t: number, color: string, max = 0.92, dur = 280): Layer {
  return { type: "shape", id, shape: "rect", width, height, fill: color, startMs: t - 30, endMs: t + dur, transform: { opacity: [{ timeMs: t - 30, value: 0 }, { timeMs: t + Math.round(dur * 0.12), value: max }, { timeMs: t + Math.round(dur * 0.42), value: max * 0.25 }, { timeMs: t + dur, value: 0 }] } };
}
function ringPulse(id: string, gx: number, gy: number, baseR: number, s: number, dur: number, fromS: number, toS: number, color: string, sw: number, maxOp = 0.85, glow = 22): Layer[] {
  const steps = 7; const xkf: ScalarKeyframe[] = []; const ykf: ScalarKeyframe[] = []; const skf: ScalarKeyframe[] = [];
  for (let i = 0; i <= steps; i += 1) { const p = i / steps; const sc = fromS + (toS - fromS) * easeOutCubic(p); const t = Math.round(s + dur * p); skf.push({ timeMs: t, value: sc }); xkf.push({ timeMs: t, value: gx - baseR * sc }); ykf.push({ timeMs: t, value: gy - baseR * sc }); }
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + Math.round(dur * 0.14), value: maxOp }, { timeMs: s + dur, value: 0 }];
  return [
    { type: "shape", id: `${id}-h`, shape: "circle", radius: baseR, stroke: color, strokeWidth: sw * 2, fill: ink, blur: glow, startMs: s, endMs: s + dur, transform: { x: xkf, y: ykf, scale: skf, opacity: scaleKf(op, 0.7) } },
    { type: "shape", id: `${id}-c`, shape: "circle", radius: baseR, stroke: color, strokeWidth: sw, fill: ink, startMs: s, endMs: s + dur, transform: { x: xkf, y: ykf, scale: skf, opacity: op } }
  ];
}
// full-frame clip with centre-compensated zoom punch
function videoSeg(id: string, s: number, e: number, trim: number, fromScale = 1.08, zoomDur = 520): Layer {
  return { type: "video", id, src: SRC, startMs: s, endMs: e, trimStartMs: trim, width, height, transform: { scale: track(s, zoomDur, fromScale, 1, easeOutCubic, 6), x: track(s, zoomDur, (width / 2) * (1 - fromScale), 0, easeOutCubic, 6), y: track(s, zoomDur, (height / 2) * (1 - fromScale), 0, easeOutCubic, 6) } };
}
function kineticWord(id: string, t: string, s: number, e: number, color: string): Layer[] {
  const x = 110, size = 120, y = 250;
  const barW = Math.min(textWidth(t, size), 760);
  return [
    rect(`${id}-bar`, s, e, x - 4, y - 116, barW, 14, color, [{ timeMs: s, value: 0 }, { timeMs: s + 90, value: 1 }, { timeMs: e - 160, value: 1 }, { timeMs: e, value: 0 }]),
    label(id, t, track(s, 320, x - 60, x, easeOutCubic), y, size, white, s, e, flick(s, e), titleStyle)
  ];
}
function caption(id: string, t: string, s: number, e: number): Layer {
  const size = 46;
  return { type: "caption", id, text: t, startMs: s, endMs: e, size, color: white, backgroundColor: "rgba(7,7,17,0.72)", padding: 22, align: "center", maxWidth: Math.round(textWidth(t, size)), lineHeight: size * 1.25, font: HEITI, transform: { x: cx, y: 980, opacity: hold(s, e, 180, 200) } };
}
function blinds(prefix: string, t: number, color: string): Layer[] {
  const bars = 10; const barH = Math.ceil(height / bars); const stagger = 18;
  return Array.from({ length: bars }, (_, i): Layer => {
    const inT = t - 240 + i * stagger; const mid = t + i * stagger; const outT = t + 250 + i * stagger;
    return { type: "shape", id: `${prefix}-${i}`, shape: "rect", width, height: barH + 1, fill: color, startMs: inT, endMs: outT, transform: { x: [{ timeMs: inT, value: -width }, { timeMs: mid, value: 0 }, { timeMs: outT, value: width }], y: i * barH } };
  });
}
function glitch(prefix: string, t: number): Layer[] {
  const dur = 280;
  const split: ScalarKeyframe[] = [{ timeMs: t - 20, value: 0 }, { timeMs: t + 30, value: 0.32 }, { timeMs: t + 70, value: 0.06 }, { timeMs: t + 110, value: 0.3 }, { timeMs: t + 170, value: 0.08 }, { timeMs: t + dur, value: 0 }];
  const bands = Array.from({ length: 6 }, (_, i) => {
    const y = 120 + i * 170 + (i % 2) * 50; const bandH = 12 + (i % 3) * 14; const st = t - 10 + i * 18;
    return rect(`${prefix}-b${i}`, st, t + dur, i % 2 === 0 ? -40 : 32, y, width + 60, bandH, i % 2 === 0 ? white : cyan, [{ timeMs: st, value: 0 }, { timeMs: st + 24, value: 0.85 }, { timeMs: st + 70, value: 0.1 }, { timeMs: st + 120, value: 0.6 }, { timeMs: t + dur, value: 0 }]);
  });
  return [rect(`${prefix}-m`, t - 20, t + dur, -14, 0, width, height, magenta, split), rect(`${prefix}-c`, t - 20, t + dur, 14, 0, width, height, cyan, split), ...bands, flash(`${prefix}-hit`, t, white, 0.5, 150)];
}
function whip(id: string, t: number, color: string): Layer {
  return { type: "shape", id, shape: "rect", width: 90, height: height * 1.5, fill: color, blur: 8, startMs: t - 120, endMs: t + 240, transform: { x: track(t - 120, 360, -440, width + 440, easeInOutCubic, 5), y: -180, rotate: 14, opacity: [{ timeMs: t - 120, value: 0 }, { timeMs: t - 40, value: 0.85 }, { timeMs: t + 120, value: 0.5 }, { timeMs: t + 240, value: 0 }] } };
}
function centerSplit(prefix: string, t: number, color: string): Layer[] {
  const hH = height / 2;
  return [
    { type: "shape", id: `${prefix}-top`, shape: "rect", width, height: hH, fill: color, startMs: t - 220, endMs: t + 260, transform: { x: 0, y: [{ timeMs: t - 220, value: -hH }, { timeMs: t, value: 0 }, { timeMs: t + 260, value: -hH }] } },
    { type: "shape", id: `${prefix}-bot`, shape: "rect", width, height: hH, fill: color, startMs: t - 220, endMs: t + 260, transform: { x: 0, y: [{ timeMs: t - 220, value: height }, { timeMs: t, value: hH }, { timeMs: t + 260, value: height }] } },
    flash(`${prefix}-hit`, t, color, 0.5, 180)
  ];
}

const videoLayers: Layer[] = trims.map((tr, i) => videoSeg(`clip${i + 1}`, segStarts[i]!, segEnds[i]!, tr, i === 0 ? 1.12 : 1.08, 520));

const hud: Layer[] = [
  rect("hud-top", introMs, bodyEndMs, 0, 0, width, 140, "rgba(7,7,17,0.5)"),
  rect("hud-bot", introMs, bodyEndMs, 0, height - 220, width, 220, "rgba(7,7,17,0.55)"),
  { type: "shape", id: "rec", shape: "circle", radius: 11, fill: magenta, blur: 6, startMs: introMs, endMs: bodyEndMs, transform: { x: 66, y: 64, opacity: blink(introMs, bodyEndMs) } },
  label("brand", "OPENHYPERCORE  //  城市漫游", 106, 78, 32, cyan, introMs, bodyEndMs, hold(introMs, bodyEndMs, 220, 220), softShadow),
  rect("prog-track", introMs, bodyEndMs, 0, height - 8, width, 8, "rgba(255,255,255,0.16)"),
  { type: "shape", id: "prog", shape: "rect", width: 140, height: 8, fill: magenta, blur: 6, startMs: introMs, endMs: bodyEndMs, transform: { x: [{ timeMs: introMs, value: -140 }, { timeMs: bodyEndMs, value: width }], y: height - 8, opacity: 0.95 } }
];

const decor: Layer[] = trims.flatMap((_, i) => {
  const s = segStarts[i]! + 160, e = segEnds[i]! - 80;
  return [...kineticWord(`w${i + 1}`, words[i]!, s, e, wordColors[i]!), label(`tag${i + 1}`, tags[i]!, width - 300, 84, 32, amber, s, e, hold(s, e, 160, 160), softShadow), caption(`cap${i + 1}`, caps[i]!, segStarts[i]! + 260, segEnds[i]! - 160)];
});

const intro: Layer[] = [
  rect("intro-bg", 0, introMs + 240, 0, 0, width, height, ink),
  ...ringPulse("ir1", cx, cy, 460, 200, 1500, 0.05, 1.1, cyan, 6, 0.9),
  ...ringPulse("ir2", cx, cy, 460, 460, 1500, 0.05, 1.0, magenta, 5, 0.8),
  label("intro-title", "城市漫游", centerX("城市漫游", 150), 560, 150, white, 500, introMs, flick(500, introMs), titleStyle),
  label("intro-sub", "OLD TOWN WALK · demo2", centerX("OLD TOWN WALK · demo2", 38), 650, 38, cyan, 900, introMs, flick(900, introMs), softShadow),
  ...ringPulse("intro-collapse", cx, cy, 520, introMs - 360, 420, 1.05, 0.04, white, 6, 0.95, 26),
  flash("intro-drop", introMs, white, 0.96, 320)
];

const transitions: Layer[] = [
  whip("t1a", cuts[0]!, cyan), whip("t1b", cuts[0]! + 40, magenta), flash("t1f", cuts[0]!, white, 0.9, 260),
  ...blinds("t2", cuts[1]!, magenta),
  ...glitch("t3", cuts[2]!),
  ...centerSplit("t4", cuts[3]!, amber), ...ringPulse("t4r", cx, cy, 520, cuts[3]! - 100, 400, 0.05, 1.0, white, 5, 0.8)
];

const outro: Layer[] = [
  rect("o-bg", outroMs, durationMs, 0, 0, width, height, ink, [{ timeMs: outroMs, value: 0 }, { timeMs: outroMs + 360, value: 0.9 }, { timeMs: durationMs, value: 0.9 }]),
  ...ringPulse("o-r", cx, 470, 360, outroMs + 260, 800, 0.05, 1.0, cyan, 5, 0.7),
  label("o-title", "OPENHYPERCORE", centerX("OPENHYPERCORE", 120), 520, 120, white, outroMs + 320, durationMs, flick(outroMs + 320, durationMs), titleStyle),
  label("o-tag", "城市漫游 · 1080p 纯 CPU 渲染", centerX("城市漫游 · 1080p 纯 CPU 渲染", 38), 620, 38, amber, outroMs + 700, durationMs, hold(outroMs + 700, durationMs, 240, 260), softShadow),
  label("o-handle", "@openhypercore", centerX("@openhypercore", 34), 700, 34, cyan, outroMs + 900, durationMs, hold(outroMs + 900, durationMs, 220, 280), softShadow),
  rect("final-fade", durationMs - 500, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 500, value: 0 }, { timeMs: durationMs, value: 1 }])
];

export default defineComposition({
  fps, width, height, durationMs, defaultFont: HEITI,
  layers: [
    rect("base", 0, durationMs, 0, 0, width, height, ink),
    ...videoLayers,
    { type: "audio", id: "bgm", src: BGM, startMs: 0, endMs: durationMs, volume: 0.55, fadeInMs: 500, fadeOutMs: 1500 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: introMs, endMs: bodyEndMs + 200, volume: 0.5, fadeInMs: 300, fadeOutMs: 700 },
    ...hud,
    ...decor,
    ...transitions,
    ...intro,
    ...outro
  ]
});
