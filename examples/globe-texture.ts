import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "环球定位 · 卫星版" — a photoreal rotating + zooming Earth (warped from a
// public-domain NASA Blue Marble texture, pre-baked by examples/assets/
// build-globe.ts into globe.mp4) that locks onto a point and dives into the
// main video.
//
// The engine has no 3D, so the globe is rendered offline as a clip and played
// here as a VideoLayer; the lock marker, dive and cut are composition overlays.
// Rebuild the clip with:
//   node --experimental-strip-types examples/assets/build-globe.ts
// ---------------------------------------------------------------------------

const width = 1280;
const height = 720;
const fps = 25;

const SRC = "examples/demo.mp4";
const GLOBE = "examples/assets/globe.mp4";

const ink = "#04060e";
const cyan = "#27e7e0";
const magenta = "#ff2e88";
const amber = "#ffd23f";
const white = "#ffffff";

// --- keyframe utils --------------------------------------------------------
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

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
    { timeMs: startMs, value: 0 }, { timeMs: startMs + fadeIn, value: 1 },
    { timeMs: endMs - fadeOut, value: 1 }, { timeMs: endMs, value: 0 }
  ];
}

function flick(startMs: number, endMs: number): ScalarKeyframe[] {
  return [
    { timeMs: startMs, value: 0 }, { timeMs: startMs + 55, value: 1 }, { timeMs: startMs + 90, value: 0.2 },
    { timeMs: startMs + 130, value: 1 }, { timeMs: startMs + 175, value: 0.4 }, { timeMs: startMs + 210, value: 1 },
    { timeMs: endMs - 180, value: 1 }, { timeMs: endMs, value: 0 }
  ];
}

function blink(startMs: number, endMs: number, period = 700): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let t = startMs; t <= endMs; t += period) {
    kf.push({ timeMs: t, value: 1 });
    kf.push({ timeMs: Math.min(endMs, t + Math.round(period * 0.42)), value: 0.15 });
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

// Typography: small text = heiti, plain (colour only); big titles = display
// font with a soft glow only (no light-on-light stroke).
const HEITI = "/System/Library/Fonts/STHeiti Medium.ttc";
const DISPLAY = "examples/assets/ZCOOLXiaoWei-Regular.ttf";
const softShadow: TextStyle = {};
const captionStyle: TextStyle = {};
const titleStyle = (_color: string) => ({ shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 12, shadowDy: 4, font: DISPLAY });

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
        { timeMs: t - 30, value: 0 }, { timeMs: t + Math.round(dur * 0.12), value: max },
        { timeMs: t + Math.round(dur * 0.42), value: max * 0.25 }, { timeMs: t + dur, value: 0 }
      ]
    }
  };
}

function ringPulse(id: string, gx: number, gy: number, baseR: number, startMs: number, durMs: number, fromS: number, toS: number, color: string, strokeW: number, maxOp = 0.85, glow = 16): Layer[] {
  const steps = 7;
  const xkf: ScalarKeyframe[] = []; const ykf: ScalarKeyframe[] = []; const skf: ScalarKeyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps; const s = fromS + (toS - fromS) * easeOutCubic(p); const t = Math.round(startMs + durMs * p);
    skf.push({ timeMs: t, value: s }); xkf.push({ timeMs: t, value: gx - baseR * s }); ykf.push({ timeMs: t, value: gy - baseR * s });
  }
  const op: ScalarKeyframe[] = [
    { timeMs: startMs, value: 0 }, { timeMs: startMs + Math.round(durMs * 0.14), value: maxOp }, { timeMs: startMs + durMs, value: 0 }
  ];
  return [
    { type: "shape", id: `${id}-h`, shape: "circle", radius: baseR, stroke: color, strokeWidth: strokeW * 2, fill: ink, blur: glow, startMs, endMs: startMs + durMs, transform: { x: xkf, y: ykf, scale: skf, opacity: scaleKf(op, 0.7) } },
    { type: "shape", id: `${id}-c`, shape: "circle", radius: baseR, stroke: color, strokeWidth: strokeW, fill: ink, startMs, endMs: startMs + durMs, transform: { x: xkf, y: ykf, scale: skf, opacity: op } }
  ];
}

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

// =====================================================================
// INTRO — pre-rendered photoreal globe clip + lock + dive
// =====================================================================
const mX = 640, mY = 360;     // Chongqing sits at screen centre at full zoom
const lockStart = 2300;       // reticle locks onto the city
const lockEnd = 3250;
const descentStart = 3100;    // begin the gradual descent / hand-off
const videoStart = 3250;      // main video appears (zoomed) beneath the globe
const globeFadeEnd = 4050;    // globe fully dissolved into the footage

const globeLayers: Layer[] = [
  rect("globe-bg", 0, globeFadeEnd, 0, 0, width, height, ink),
  // the warped satellite globe (rotating + zooming), played as a video; it
  // keeps pushing in on Chongqing while dissolving into the revealed footage.
  { type: "video", id: "globe-clip", src: GLOBE, startMs: 0, endMs: globeFadeEnd, trimStartMs: 0, width, height, transform: { x: 0, y: 0, opacity: [{ timeMs: 0, value: 0 }, { timeMs: 260, value: 1 }, { timeMs: descentStart, value: 1 }, { timeMs: globeFadeEnd, value: 0 }] } },
  label("globe-kicker", "GLOBAL UPLINK", centerX("GLOBAL UPLINK", 24), 70, 24, cyan, 300, lockEnd, flick(300, lockEnd), softShadow),
  label("globe-title", "环球定位 重庆", centerX("环球定位 重庆", 60), 672, 60, white, 700, lockEnd, flick(700, lockEnd), titleStyle(cyan)),
  // target lock reticle on the city
  { type: "shape", id: "lock-ring", shape: "circle", radius: 60, stroke: amber, strokeWidth: 2, fill: ink, startMs: lockStart, endMs: lockEnd, transform: { x: mX - 60, y: mY - 60, opacity: scaleKf(hold(lockStart, lockEnd, 160, 160), 0.5) } },
  { type: "shape", id: "lock-dot-h", shape: "circle", radius: 13, fill: amber, blur: 12, startMs: lockStart, endMs: lockEnd, transform: { x: mX - 13, y: mY - 13, opacity: scaleKf(hold(lockStart, lockEnd, 140, 140), 0.6) } },
  { type: "shape", id: "lock-dot-c", shape: "circle", radius: 5, fill: amber, startMs: lockStart, endMs: lockEnd, transform: { x: mX - 5, y: mY - 5, opacity: hold(lockStart, lockEnd, 140, 140) } },
  rect("lock-tick-v", lockStart, lockEnd, mX - 1, mY - 30, 2, 60, amber, hold(lockStart, lockEnd, 140, 140)),
  rect("lock-tick-h", lockStart, lockEnd, mX - 30, mY - 1, 60, 2, amber, hold(lockStart, lockEnd, 140, 140)),
  ...ringPulse("lock-pulse", mX, mY, 72, lockStart, 560, 0.1, 1.0, amber, 2, 0.85, 12),
  label("lock-label", "重庆 CHONGQING · 29.6°N 106.5°E", mX + 30, mY - 34, 22, amber, lockStart + 60, lockEnd, hold(lockStart + 60, lockEnd, 140, 160), softShadow),
  // gradual dive: soft ripples + a cloud-bloom while the globe dissolves and the
  // zoomed footage is revealed beneath (matched motion > no hard cut).
  ...ringPulse("dive-r1", mX, mY, 480, descentStart, 720, 0.05, 1.0, cyan, 4, 0.7, 18),
  ...ringPulse("dive-r2", mX, mY, 520, descentStart + 220, 680, 0.05, 1.0, white, 3, 0.6, 16),
  {
    type: "shape", id: "cloud-punch", shape: "circle", radius: 96, fill: white, blur: 48, startMs: descentStart, endMs: globeFadeEnd + 80,
    transform: {
      x: track(descentStart, 820, mX - 96 * 0.4, mX - 96 * 12, easeInCubic, 6),
      y: track(descentStart, 820, mY - 96 * 0.4, mY - 96 * 12, easeInCubic, 6),
      scale: track(descentStart, 820, 0.4, 12, easeInCubic, 6),
      opacity: [{ timeMs: descentStart, value: 0 }, { timeMs: descentStart + 520, value: 0.6 }, { timeMs: globeFadeEnd + 80, value: 0 }]
    }
  },
  rect("bloom", descentStart, globeFadeEnd + 160, 0, 0, width, height, white, [{ timeMs: descentStart, value: 0 }, { timeMs: descentStart + 560, value: 0.4 }, { timeMs: globeFadeEnd + 160, value: 0 }])
];

// =====================================================================
// BODY + OUTRO
// =====================================================================
const bodyCut = 7300;
const bodyEndMs = 10300;
const outroMs = 10100;
const durationMs = 12300;

const bodyLayers: Layer[] = [
  // clip1 starts zoomed (1.7×) and settles — its push-in continues the dive
  // motion so the globe hand-off reads as one continuous move.
  videoSeg("clip1", videoStart, bodyCut, 5000, 1.7, 1150),
  videoSeg("clip2", bodyCut, bodyEndMs, 60000, 1.12, 360),
  rect("hud-top", globeFadeEnd, bodyEndMs, 0, 0, width, 90, "rgba(4,6,14,0.5)"),
  rect("hud-bot", globeFadeEnd, bodyEndMs, 0, height - 150, width, 150, "rgba(4,6,14,0.6)"),
  { type: "shape", id: "rec-dot", shape: "circle", radius: 8, fill: magenta, blur: 6, startMs: globeFadeEnd, endMs: bodyEndMs, transform: { x: 46, y: 44, opacity: blink(globeFadeEnd, bodyEndMs) } },
  label("hud-brand", "OPENHYPERCORE  //  重庆实拍", 72, 52, 22, cyan, globeFadeEnd, bodyEndMs, hold(globeFadeEnd, bodyEndMs, 200, 200), softShadow),
  {
    type: "caption", id: "cap1", text: "已抵达重庆 · 进入实拍画面", startMs: globeFadeEnd + 120, endMs: bodyCut - 120, size: 30, color: white,
    backgroundColor: "rgba(4,6,14,0.74)", padding: 16, align: "center", maxWidth: Math.round(textWidth("已抵达重庆 · 进入实拍画面", 30)), lineHeight: 38, ...captionStyle,
    transform: { x: 640, y: 656, opacity: hold(globeFadeEnd + 120, bodyCut - 120, 160, 180) }
  },
  {
    type: "caption", id: "cap2", text: "卫星底图开场 + 实拍，全程 CPU 合成", startMs: bodyCut + 160, endMs: bodyEndMs - 120, size: 30, color: white,
    backgroundColor: "rgba(4,6,14,0.74)", padding: 16, align: "center", maxWidth: Math.round(textWidth("卫星底图开场 + 实拍，全程 CPU 合成", 30)), lineHeight: 38, ...captionStyle,
    transform: { x: 640, y: 656, opacity: hold(bodyCut + 160, bodyEndMs - 120, 160, 180) }
  },
  ...ringPulse("body-ring", 640, 360, 440, bodyCut - 90, 360, 0.05, 1.0, white, 4, 0.7, 16),
  flash("body-flash", bodyCut, white, 0.7, 200)
];

const outroLayers: Layer[] = [
  rect("outro-darken", outroMs, durationMs, 0, 0, width, height, ink, [{ timeMs: outroMs, value: 0 }, { timeMs: outroMs + 340, value: 0.88 }, { timeMs: durationMs, value: 0.88 }]),
  label("outro-title", "OPENHYPERCORE", centerX("OPENHYPERCORE", 78), 350, 78, white, outroMs + 260, durationMs, flick(outroMs + 260, durationMs), titleStyle(cyan)),
  label("outro-tag", "卫星地球开场 · 纯 CPU 渲染", centerX("卫星地球开场 · 纯 CPU 渲染", 24), 410, 24, amber, outroMs + 620, durationMs, hold(outroMs + 620, durationMs, 220, 240), softShadow),
  label("outro-handle", "@openhypercore", centerX("@openhypercore", 22), 470, 22, cyan, outroMs + 820, durationMs, hold(outroMs + 820, durationMs, 220, 260), softShadow),
  rect("final-fade", durationMs - 400, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 400, value: 0 }, { timeMs: durationMs, value: 1 }])
];

export default defineComposition({
  defaultFont: HEITI,
  fps,
  width,
  height,
  durationMs,
  layers: [
    rect("base", 0, durationMs, 0, 0, width, height, ink),
    ...bodyLayers,
    { type: "audio", id: "bgm", src: "examples/assets/bgm-uplift.m4a", startMs: 0, endMs: durationMs, volume: 0.5, fadeInMs: 600, fadeOutMs: 1300 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEndMs + 200, volume: 0.6, fadeInMs: 360, fadeOutMs: 700 },
    ...globeLayers,
    ...outroLayers
  ]
});
