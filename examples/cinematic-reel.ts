import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "影院级混剪" — a flagship showcase for OpenHyperCore.
//
// Goes well beyond straight bars: a glowing portal intro (expanding rings,
// orbiting particles, a radar sweep, letter-by-letter kinetic title), then
// five clips wired with circular / curved / spinning transitions plus
// picture-in-picture, split-screen and a far>near depth push. Chinese
// captions throughout, with outlined + glowing typography.
//
// Engine notes: keyframes interpolate linearly, so smooth motion is sampled
// from easing curves (`track`). scale/rotate pivot around each layer origin —
// circles, rings and zooms compensate x/y to orbit / grow around a point.
// Shapes use the new `blur` for neon glow; text uses stroke + shadow.
// ---------------------------------------------------------------------------

const width = 1280;
const height = 720;
const fps = 25;
const cx = 640;
const cy = 372;

const introMs = 3000;
const cuts = [4900, 6800, 8800, 11000];
const segStarts = [introMs, ...cuts];
const segEnds = [...cuts, 13000];
const bodyEndMs = 13000;
const outroMs = 12800;
const durationMs = 16000;

const SRC = "examples/demo.mp4";

const ink = "#05060d";
const cyan = "#27e7e0";
const magenta = "#ff2e88";
const violet = "#8a5cff";
const amber = "#ffd23f";
const white = "#ffffff";

// --- easing ---------------------------------------------------------------
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const linear = (t: number) => t;

function track(startMs: number, durMs: number, from: number, to: number, ease: (t: number) => number, steps = 6): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    kf.push({ timeMs: Math.round(startMs + durMs * p), value: from + (to - from) * ease(p) });
  }
  return kf;
}

function hold(startMs: number, endMs: number, fadeIn = 200, fadeOut = 220): ScalarKeyframe[] {
  return [
    { timeMs: startMs, value: 0 },
    { timeMs: startMs + fadeIn, value: 1 },
    { timeMs: endMs - fadeOut, value: 1 },
    { timeMs: endMs, value: 0 }
  ];
}

function flick(startMs: number, endMs: number): ScalarKeyframe[] {
  return [
    { timeMs: startMs, value: 0 },
    { timeMs: startMs + 55, value: 1 },
    { timeMs: startMs + 90, value: 0.2 },
    { timeMs: startMs + 130, value: 1 },
    { timeMs: startMs + 175, value: 0.4 },
    { timeMs: startMs + 210, value: 1 },
    { timeMs: endMs - 180, value: 1 },
    { timeMs: endMs, value: 0 }
  ];
}

function blink(startMs: number, endMs: number, period = 760): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let t = startMs; t <= endMs; t += period) {
    kf.push({ timeMs: t, value: 1 });
    kf.push({ timeMs: Math.min(endMs, t + Math.round(period * 0.42)), value: 0.12 });
  }
  return kf;
}

const scaleKf = (kf: ScalarKeyframe[], f: number): ScalarKeyframe[] => kf.map((k) => ({ timeMs: k.timeMs, value: k.value * f }));

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

// --- text styles -----------------------------------------------------------
// Typography: small text = heiti, plain (colour only); big titles = display
// font with a soft glow only (no light-on-light stroke).
const HEITI = "/System/Library/Fonts/STHeiti Medium.ttc";
const DISPLAY = "examples/assets/ZCOOLQingKeHuangYou-Regular.ttf";
const softShadow: TextStyle = {};
const captionStyle: TextStyle = {};
const titleStyle = (_color: string) => ({ shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 13, shadowDy: 4, font: DISPLAY });

// --- primitives ------------------------------------------------------------
function rect(id: string, startMs: number, endMs: number, x: number, y: number, w: number, h: number, fill: string, opacity: number | ScalarKeyframe[] = 1, rotate = 0): Layer {
  return { type: "shape", id, shape: "rect", width: w, height: h, fill, startMs, endMs, transform: { x, y, opacity, rotate } };
}

function label(id: string, text: string, x: number, y: number, size: number, color: string, startMs: number, endMs: number, opacity: ScalarKeyframe[] = hold(startMs, endMs), style: TextStyle = {}): Layer {
  return { type: "text", id, text, size, color, startMs, endMs, ...style, transform: { x, y, opacity } };
}

function flash(id: string, t: number, color: string, max = 0.92, dur = 260): Layer {
  return {
    type: "shape", id, shape: "rect", width, height, fill: color, startMs: t - 30, endMs: t + dur,
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

// --- neon circle helpers ---------------------------------------------------
// A glowing dot = blurred halo + crisp core.
function glowDot(id: string, gx: number, gy: number, r: number, color: string, startMs: number, endMs: number, op: ScalarKeyframe[] = hold(startMs, endMs), glow = 10): Layer[] {
  const hr = r * 1.7;
  return [
    { type: "shape", id: `${id}-h`, shape: "circle", radius: hr, fill: color, blur: glow, startMs, endMs, transform: { x: gx - hr, y: gy - hr, opacity: scaleKf(op, 0.6) } },
    { type: "shape", id: `${id}-c`, shape: "circle", radius: r, fill: color, startMs, endMs, transform: { x: gx - r, y: gy - r, opacity: op } }
  ];
}

// A static glowing ring (stroked circle) — blurred halo + crisp ring.
function glowRing(id: string, gx: number, gy: number, r: number, strokeW: number, color: string, startMs: number, endMs: number, maxOp = 0.5, glow = 14): Layer[] {
  const op = hold(startMs, endMs, 320, 320);
  return [
    { type: "shape", id: `${id}-h`, shape: "circle", radius: r, stroke: color, strokeWidth: strokeW * 2.2, fill: ink, blur: glow, startMs, endMs, transform: { x: gx - r, y: gy - r, opacity: scaleKf(op, maxOp * 0.7) } },
    { type: "shape", id: `${id}-c`, shape: "circle", radius: r, stroke: color, strokeWidth: strokeW, fill: ink, startMs, endMs, transform: { x: gx - r, y: gy - r, opacity: scaleKf(op, maxOp) } }
  ];
}

// An expanding (or collapsing) ring ripple, centred via x/y compensation.
function ringPulse(id: string, gx: number, gy: number, baseR: number, startMs: number, durMs: number, fromS: number, toS: number, color: string, strokeW: number, maxOp = 0.85, glow = 16): Layer[] {
  const steps = 7;
  const xkf: ScalarKeyframe[] = [];
  const ykf: ScalarKeyframe[] = [];
  const skf: ScalarKeyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    const s = fromS + (toS - fromS) * easeOutCubic(p);
    const t = Math.round(startMs + durMs * p);
    skf.push({ timeMs: t, value: s });
    xkf.push({ timeMs: t, value: gx - baseR * s });
    ykf.push({ timeMs: t, value: gy - baseR * s });
  }
  const op: ScalarKeyframe[] = [
    { timeMs: startMs, value: 0 },
    { timeMs: startMs + Math.round(durMs * 0.14), value: maxOp },
    { timeMs: startMs + durMs, value: 0 }
  ];
  return [
    { type: "shape", id: `${id}-h`, shape: "circle", radius: baseR, stroke: color, strokeWidth: strokeW * 2, fill: ink, blur: glow, startMs, endMs: startMs + durMs, transform: { x: xkf, y: ykf, scale: skf, opacity: scaleKf(op, 0.7) } },
    { type: "shape", id: `${id}-c`, shape: "circle", radius: baseR, stroke: color, strokeWidth: strokeW, fill: ink, startMs, endMs: startMs + durMs, transform: { x: xkf, y: ykf, scale: skf, opacity: op } }
  ];
}

// One particle orbiting a centre on a circular path (sampled cos/sin).
function orbitDot(id: string, gx: number, gy: number, orbitR: number, dotR: number, startMs: number, endMs: number, turns: number, phase: number, color: string, glow = 8): Layer[] {
  const steps = Math.max(20, Math.round((endMs - startMs) / 45));
  const cxkf: ScalarKeyframe[] = [];
  const cykf: ScalarKeyframe[] = [];
  const hxkf: ScalarKeyframe[] = [];
  const hykf: ScalarKeyframe[] = [];
  const hr = dotR * 1.6;
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    const a = phase + turns * 2 * Math.PI * p;
    const t = Math.round(startMs + (endMs - startMs) * p);
    const ox = gx + orbitR * Math.cos(a);
    const oy = gy + orbitR * Math.sin(a);
    cxkf.push({ timeMs: t, value: ox - dotR });
    cykf.push({ timeMs: t, value: oy - dotR });
    hxkf.push({ timeMs: t, value: ox - hr });
    hykf.push({ timeMs: t, value: oy - hr });
  }
  const op = hold(startMs, endMs, 220, 240);
  return [
    { type: "shape", id: `${id}-h`, shape: "circle", radius: hr, fill: color, blur: glow, startMs, endMs, transform: { x: hxkf, y: hykf, opacity: scaleKf(op, 0.55) } },
    { type: "shape", id: `${id}-c`, shape: "circle", radius: dotR, fill: color, startMs, endMs, transform: { x: cxkf, y: cykf, opacity: op } }
  ];
}

function orbitField(prefix: string, gx: number, gy: number, orbitR: number, dotR: number, count: number, startMs: number, endMs: number, turns: number, color: string): Layer[] {
  return Array.from({ length: count }, (_, i) => orbitDot(`${prefix}-${i}`, gx, gy, orbitR, dotR, startMs, endMs, turns, (i / count) * 2 * Math.PI, color)).flat();
}

// A rotating "radar" sweep line around a centre (rotate pivots the layer origin).
function radarSweep(id: string, gx: number, gy: number, len: number, startMs: number, endMs: number, turns: number, color: string, glow = 10): Layer[] {
  const rot: ScalarKeyframe[] = [{ timeMs: startMs, value: 0 }, { timeMs: endMs, value: 360 * turns }];
  const op = hold(startMs, endMs, 200, 240);
  return [
    { type: "shape", id: `${id}-g`, shape: "rect", width: len, height: 7, fill: color, blur: glow, startMs, endMs, transform: { x: gx, y: gy - 3.5, rotate: rot, opacity: scaleKf(op, 0.45) } },
    { type: "shape", id: `${id}-c`, shape: "rect", width: len, height: 2, fill: color, startMs, endMs, transform: { x: gx, y: gy - 1, rotate: rot, opacity: scaleKf(op, 0.85) } }
  ];
}

// Letter-by-letter title: each glyph drops in with an overshoot + neon style.
function kineticTitle(prefix: string, text: string, size: number, baseY: number, startMs: number, stagger: number, endMs: number, color: string): Layer[] {
  const total = textWidth(text, size);
  let x = (width - total) / 2;
  const out: Layer[] = [];
  [...text].forEach((ch, i) => {
    const w = textWidth(ch, size);
    if (ch.trim() !== "") {
      const t0 = startMs + i * stagger;
      out.push({
        type: "text", id: `${prefix}-${i}`, text: ch, size, color: white, ...titleStyle(color), startMs: t0, endMs,
        transform: {
          x: Math.round(x),
          y: track(t0, 440, baseY - 96, baseY, easeOutBack, 7),
          opacity: [
            { timeMs: t0, value: 0 },
            { timeMs: t0 + 80, value: 1 },
            { timeMs: endMs - 140, value: 1 },
            { timeMs: endMs, value: 0 }
          ]
        }
      });
    }
    x += w;
  });
  return out;
}

// --- video helpers ---------------------------------------------------------
// Full-frame clip with a centre-compensated zoom (punch-in or far>near push).
function videoSeg(id: string, startMs: number, endMs: number, trimStartMs: number, fromScale = 1.1, zoomDur = 360): Layer {
  return {
    type: "video", id, src: SRC, startMs, endMs, trimStartMs, width, height,
    transform: {
      scale: track(startMs, zoomDur, fromScale, 1, easeOutCubic, 6),
      x: track(startMs, zoomDur, (width / 2) * (1 - fromScale), 0, easeOutCubic, 6),
      y: track(startMs, zoomDur, (height / 2) * (1 - fromScale), 0, easeOutCubic, 6)
    }
  };
}

// Picture-in-picture window with a glowing neon frame. Optional slide-in.
function pip(id: string, startMs: number, endMs: number, trim: number, x: number, y: number, w: number, h: number, color: string, slideFromX?: number): Layer[] {
  const pad = 6;
  const op = hold(startMs, endMs, 220, 200);
  const xVal: number | ScalarKeyframe[] = slideFromX === undefined ? x : track(startMs, 460, slideFromX, x, easeOutBack, 7);
  const frameXVal: number | ScalarKeyframe[] = slideFromX === undefined ? x - pad : track(startMs, 460, slideFromX - pad, x - pad, easeOutBack, 7);
  return [
    { type: "video", id, src: SRC, startMs, endMs, trimStartMs: trim, width: w, height: h, transform: { x: xVal, y, opacity: op } },
    { type: "shape", id: `${id}-glow`, shape: "rect", width: w + pad * 2, height: h + pad * 2, stroke: color, strokeWidth: 9, fill: ink, blur: 16, startMs, endMs, transform: { x: frameXVal, y: y - pad, opacity: scaleKf(op, 0.6) } },
    { type: "shape", id: `${id}-frame`, shape: "rect", width: w + pad * 2, height: h + pad * 2, stroke: color, strokeWidth: 3, fill: ink, startMs, endMs, transform: { x: frameXVal, y: y - pad, opacity: op } }
  ];
}

// =====================================================================
// INTRO — glowing portal + orbiting particles + kinetic title
// =====================================================================
const introSub = "纯 CPU · 实时视频渲染内核";
const introLayers: Layer[] = [
  rect("intro-bg", 0, introMs + 220, 0, 0, width, height, ink),
  // soft depth vignette frame
  rect("intro-bar-l", 200, introMs, 40, 80, 6, 560, "rgba(39,231,224,0.25)"),
  rect("intro-bar-r", 320, introMs, 1234, 80, 6, 560, "rgba(255,46,136,0.22)"),
  // central glow + structural rings (far/mid layers for depth)
  ...glowDot("intro-core", cx, cy, 9, white, 120, 1500, [
    { timeMs: 120, value: 0 }, { timeMs: 360, value: 1 }, { timeMs: 1100, value: 1 }, { timeMs: 1500, value: 0 }
  ], 16),
  ...glowRing("intro-ring-far", cx, cy, 250, 2, violet, 600, 2700, 0.32, 16),
  ...glowRing("intro-ring-mid", cx, cy, 150, 3, cyan, 700, 2700, 0.4, 13),
  // expanding portal ripples
  ...ringPulse("intro-rip1", cx, cy, 300, 150, 1500, 0.05, 1.08, cyan, 4, 0.9, 18),
  ...ringPulse("intro-rip2", cx, cy, 300, 430, 1500, 0.05, 1.0, magenta, 4, 0.8, 18),
  ...ringPulse("intro-rip3", cx, cy, 300, 720, 1500, 0.05, 0.92, violet, 3, 0.7, 16),
  // orbiting particle fields (two depths, counter-rotating)
  ...orbitField("intro-orb-a", cx, cy, 300, 7, 6, 360, 2700, 0.85, cyan),
  ...orbitField("intro-orb-b", cx, cy, 205, 6, 5, 520, 2700, -0.7, magenta),
  // rotating radar sweep
  ...radarSweep("intro-radar", cx, cy, 300, 420, 2700, 1.7, cyan, 12),
  // kinetic letter title centred in the portal
  ...kineticTitle("intro-title", "OPENHYPERCORE", 76, 398, 950, 52, introMs, cyan),
  label("intro-sub", introSub, centerX(introSub, 26), 478, 26, cyan, 1650, 2900, flick(1650, 2900), softShadow),
  // collapse / warp-in just before the cut
  ...ringPulse("intro-collapse", cx, cy, 320, 2540, 420, 1.05, 0.03, white, 5, 0.95, 22),
  flash("intro-drop", introMs, white, 0.98, 320)
];

// =====================================================================
// BODY — five clips with PiP / split-screen / depth push
// =====================================================================
const captions = [
  "支持画中画叠加，多路视频同屏合成",
  "分屏多视角，左右画面各自取材",
  "由远及近推进，景深层次分明",
  "多机位同框：主画面 + 多路小窗",
  "一次渲染出片：H.264 + AAC，纯 CPU"
];
const words = ["画中画", "多视角", "纵深", "多机位", "出片"];
const wordColors = [cyan, magenta, amber, violet, cyan];
const clipTags = ["镜头 01", "镜头 02", "镜头 03", "镜头 04", "镜头 05"];

function kineticWord(id: string, text: string, startMs: number, endMs: number, color: string): Layer[] {
  const x = 74;
  const size = 80;
  const y = 168;
  const barW = Math.min(textWidth(text, size), 520);
  return [
    rect(`${id}-bar`, startMs, endMs, x - 2, y - 76, barW, 10, color, [
      { timeMs: startMs, value: 0 }, { timeMs: startMs + 90, value: 1 }, { timeMs: endMs - 160, value: 1 }, { timeMs: endMs, value: 0 }
    ]),
    { type: "text", id, text, size, color: white, ...titleStyle(color), startMs, endMs, transform: { x: track(startMs, 320, x - 46, x, easeOutCubic), y, opacity: flick(startMs, endMs) } }
  ];
}

function caption(id: string, text: string, startMs: number, endMs: number): Layer {
  const size = 30;
  return {
    type: "caption", id, text, startMs, endMs, size, color: white,
    backgroundColor: "rgba(5,6,13,0.74)", padding: 16, align: "center",
    maxWidth: Math.round(textWidth(text, size)), lineHeight: size * 1.25, ...captionStyle,
    transform: { x: cx, y: 656, opacity: hold(startMs, endMs, 160, 180) }
  };
}

// Build the video / PiP layers per segment (depth-ordered: main first).
const videoBlock: Layer[] = [
  // Seg 1 — main + PiP inset sliding in from the right (画中画)
  videoSeg("clip1", segStarts[0]!, segEnds[0]!, 4000, 1.12, 360),
  ...pip("clip1-pip", segStarts[0]! + 360, segEnds[0]!, 64000, 836, 372, 380, 214, magenta, 1320),

  // Seg 2 — split screen: left + right halves from different moments (多视角)
  { type: "video", id: "clip2-l", src: SRC, startMs: segStarts[1]!, endMs: segEnds[1]!, trimStartMs: 22000, width: 642, height: 720, transform: { x: track(segStarts[1]!, 380, -200, 0, easeOutCubic, 5), y: 0, opacity: 1 } },
  { type: "video", id: "clip2-r", src: SRC, startMs: segStarts[1]!, endMs: segEnds[1]!, trimStartMs: 98000, width: 642, height: 720, transform: { x: track(segStarts[1]!, 380, width + 200, 638, easeOutCubic, 5), y: 0, opacity: 1 } },
  { type: "shape", id: "clip2-div-g", shape: "rect", width: 16, height, fill: cyan, blur: 14, startMs: segStarts[1]!, endMs: segEnds[1]!, transform: { x: 632, y: 0, opacity: 0.5 } },
  rect("clip2-div", segStarts[1]!, segEnds[1]!, 637, 0, 6, height, white, 0.92),

  // Seg 3 — depth push: a framed window pushes from far (small) to near (full)
  videoSeg("clip3", segStarts[2]!, segEnds[2]!, 47000, 0.4, 900),

  // Seg 4 — multi-cam: main + two stacked PiP windows (多机位)
  videoSeg("clip4", segStarts[3]!, segEnds[3]!, 88000, 1.1, 340),
  ...pip("clip4-pip1", segStarts[3]! + 320, segEnds[3]!, 30000, 858, 96, 360, 203, cyan, width + 60),
  ...pip("clip4-pip2", segStarts[3]! + 520, segEnds[3]!, 116000, 858, 360, 360, 203, amber, width + 60),

  // Seg 5 — finale, slow push
  videoSeg("clip5", segStarts[4]!, segEnds[4]!, 110000, 1.16, 1400)
];

// HUD overlays across the body.
const hud: Layer[] = [
  rect("hud-top", introMs, bodyEndMs, 0, 0, width, 92, "rgba(5,6,13,0.5)"),
  rect("hud-bot", introMs, bodyEndMs, 0, height - 150, width, 150, "rgba(5,6,13,0.6)"),
  { type: "shape", id: "rec-dot", shape: "circle", radius: 8, fill: magenta, blur: 6, startMs: introMs, endMs: bodyEndMs, transform: { x: 46, y: 44, opacity: blink(introMs, bodyEndMs) } },
  label("hud-brand", "OPENHYPERCORE  //  影院级混剪", 72, 52, 22, cyan, introMs, bodyEndMs, hold(introMs, bodyEndMs, 200, 200), softShadow),
  rect("prog-track", introMs, bodyEndMs, 0, height - 6, width, 6, "rgba(255,255,255,0.16)"),
  { type: "shape", id: "prog-head", shape: "rect", width: 90, height: 6, fill: magenta, blur: 5, startMs: introMs, endMs: bodyEndMs, transform: { x: [{ timeMs: introMs, value: -90 }, { timeMs: bodyEndMs, value: width }], y: height - 6, opacity: 0.95 } }
];

const segmentDecor: Layer[] = words.flatMap((word, i) => {
  const start = segStarts[i]! + 140;
  const end = segEnds[i]! - 60;
  return [
    ...kineticWord(`word-${i + 1}`, word, start, end, wordColors[i]!),
    label(`tag-${i + 1}`, clipTags[i]!, width - 196, 56, 22, amber, start, end, hold(start, end, 140, 140), softShadow),
    caption(`cap-${i + 1}`, captions[i]!, segStarts[i]! + 220, segEnds[i]! - 120)
  ];
});

// Seg-3 depth-push HUD: reticle + radar sweep to sell the camera move.
const seg3Hud: Layer[] = [
  ...glowRing("s3-ret-a", cx, cy, 120, 2, cyan, segStarts[2]! + 200, segEnds[2]! - 200, 0.55, 12),
  ...glowRing("s3-ret-b", cx, cy, 175, 1, cyan, segStarts[2]! + 320, segEnds[2]! - 200, 0.4, 12),
  ...radarSweep("s3-radar", cx, cy, 175, segStarts[2]! + 320, segEnds[2]! - 160, 1.2, cyan, 10),
  label("s3-near", "NEAR", cx + 130, cy - 90, 20, amber, segStarts[2]! + 600, segEnds[2]! - 200, hold(segStarts[2]! + 600, segEnds[2]! - 200, 160, 160), softShadow)
];

// =====================================================================
// TRANSITIONS — circular / curved / spinning, beat-synced
// =====================================================================
function whip(id: string, t: number, color: string): Layer {
  return {
    type: "shape", id, shape: "rect", width: 60, height: height * 1.5, fill: color, blur: 6, startMs: t - 120, endMs: t + 220,
    transform: {
      x: track(t - 120, 340, -300, width + 300, easeInOutCubic, 5), y: -120, rotate: 14,
      opacity: [{ timeMs: t - 120, value: 0 }, { timeMs: t - 40, value: 0.85 }, { timeMs: t + 120, value: 0.5 }, { timeMs: t + 220, value: 0 }]
    }
  };
}

function glitch(prefix: string, t: number): Layer[] {
  const dur = 260;
  const splitOpacity: ScalarKeyframe[] = [
    { timeMs: t - 20, value: 0 }, { timeMs: t + 30, value: 0.34 }, { timeMs: t + 70, value: 0.06 },
    { timeMs: t + 110, value: 0.3 }, { timeMs: t + 170, value: 0.08 }, { timeMs: t + dur, value: 0 }
  ];
  const bands = Array.from({ length: 5 }, (_, i) => {
    const y = 90 + i * 130 + (i % 2) * 40;
    const bandH = 8 + (i % 3) * 10;
    const startT = t - 10 + i * 18;
    return rect(`${prefix}-band-${i}`, startT, t + dur, i % 2 === 0 ? -26 : 22, y, width + 40, bandH, i % 2 === 0 ? white : cyan, [
      { timeMs: startT, value: 0 }, { timeMs: startT + 24, value: 0.85 }, { timeMs: startT + 70, value: 0.1 }, { timeMs: startT + 120, value: 0.6 }, { timeMs: t + dur, value: 0 }
    ]);
  });
  return [
    rect(`${prefix}-rgb-m`, t - 20, t + dur, -9, 0, width, height, magenta, splitOpacity),
    rect(`${prefix}-rgb-c`, t - 20, t + dur, 9, 0, width, height, cyan, splitOpacity),
    ...bands,
    flash(`${prefix}-hit`, t, white, 0.5, 130)
  ];
}

const transitionLayers: Layer[] = [
  // cut 1 — iris: expanding rings + bright disc
  ...ringPulse("t1-iris-a", cx, cy, 520, cuts[0]! - 160, 460, 0.02, 1.0, cyan, 6, 0.95, 22),
  ...ringPulse("t1-iris-b", cx, cy, 520, cuts[0]! - 60, 420, 0.02, 0.9, magenta, 5, 0.85, 20),
  flash("t1-flash", cuts[0]!, white, 0.95, 240),

  // cut 2 — whip + a quick ripple
  whip("t2-whip-a", cuts[1]!, cyan),
  whip("t2-whip-b", cuts[1]! + 40, magenta),
  ...ringPulse("t2-ring", cx, cy, 460, cuts[1]! - 100, 380, 0.05, 1.0, white, 5, 0.8, 18),
  flash("t2-flash", cuts[1]!, white, 0.85, 220),

  // cut 3 — glitch + collapsing ring
  ...glitch("t3-glitch", cuts[2]!),
  ...ringPulse("t3-collapse", cx, cy, 460, cuts[2]! - 60, 360, 1.0, 0.04, magenta, 5, 0.9, 20),

  // cut 4 — double radar sweep + flash (spin wipe)
  ...radarSweep("t4-sweep-a", cx, cy, 760, cuts[3]! - 160, cuts[3]! + 180, 0.9, cyan, 16),
  ...radarSweep("t4-sweep-b", cx, cy, 760, cuts[3]! - 160, cuts[3]! + 180, -0.9, magenta, 16),
  ...ringPulse("t4-ring", cx, cy, 500, cuts[3]! - 80, 360, 0.05, 1.0, white, 5, 0.8, 18),
  flash("t4-flash", cuts[3]!, white, 0.9, 230)
];

// =====================================================================
// OUTRO — rings converge, kinetic re-lockup, follow card
// =====================================================================
const tagline = "复杂转场 · 画中画 · 景深推进 · 全程 CPU";
const followText = "关注项目进展  >";
const pillW = 420;
const pillX = (width - pillW) / 2;
const pillY = 470;

const outroLayers: Layer[] = [
  rect("outro-darken", outroMs, durationMs, 0, 0, width, height, ink, [
    { timeMs: outroMs, value: 0 }, { timeMs: outroMs + 360, value: 0.88 }, { timeMs: durationMs, value: 0.88 }
  ]),
  ...glowRing("outro-ring", cx, 320, 230, 2, cyan, outroMs + 200, durationMs, 0.3, 16),
  ...ringPulse("outro-rip", cx, 320, 280, outroMs + 260, 700, 0.05, 1.0, cyan, 4, 0.7, 18),
  ...orbitField("outro-orb", cx, 320, 250, 6, 5, outroMs + 300, durationMs - 200, 0.5, magenta),
  ...kineticTitle("outro-title", "OPENHYPERCORE", 84, 336, outroMs + 320, 46, durationMs, cyan),
  {
    type: "shape", id: "outro-underline", shape: "rect", width: 560, height: 6, fill: cyan, blur: 8, startMs: outroMs + 760, endMs: durationMs,
    transform: { x: 360, y: 366, scale: track(outroMs + 760, 460, 0.001, 1, easeOutCubic, 6), opacity: 1 }
  },
  label("outro-tag", tagline, centerX(tagline, 24), 412, 24, amber, outroMs + 900, durationMs, hold(outroMs + 900, durationMs, 240, 260), softShadow),
  {
    type: "shape", id: "outro-pill", shape: "rect", width: pillW, height: 66, fill: magenta, startMs: outroMs + 1100, endMs: durationMs,
    transform: { x: pillX, y: [{ timeMs: outroMs + 1100, value: pillY + 26 }, ...track(outroMs + 1120, 360, pillY + 26, pillY, easeOutBack, 6)], opacity: hold(outroMs + 1100, durationMs, 180, 240) }
  },
  label("outro-follow", followText, centerX(followText, 28), pillY + 44, 28, white, outroMs + 1180, durationMs, hold(outroMs + 1180, durationMs, 180, 240), softShadow),
  label("outro-handle", "@openhypercore", centerX("@openhypercore", 24), 612, 24, cyan, outroMs + 1320, durationMs, hold(outroMs + 1320, durationMs, 220, 280), softShadow),
  rect("final-fade", durationMs - 420, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 420, value: 0 }, { timeMs: durationMs, value: 1 }])
];

export default defineComposition({
  defaultFont: HEITI,
  fps,
  width,
  height,
  durationMs,
  layers: [
    rect("base", 0, durationMs, 0, 0, width, height, ink),
    ...videoBlock,
    { type: "audio", id: "bgm", src: "examples/assets/bgm-epic.m4a", startMs: 0, endMs: durationMs, volume: 0.5, fadeInMs: 600, fadeOutMs: 1300 },
    {
      type: "audio",
      id: "reel-audio",
      src: SRC,
      startMs: introMs,
      endMs: bodyEndMs + 200,
      volume: 0.6,
      fadeInMs: 240,
      fadeOutMs: 700
    },
    ...hud,
    ...seg3Hud,
    ...segmentDecor,
    ...transitionLayers,
    ...introLayers,
    ...outroLayers
  ]
});
