import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "环球航线 重庆 > 杭州" — the rotating satellite globe spins in and centres
// on Chongqing, a flight trajectory (with a vector plane at its head) draws
// from Chongqing to Hangzhou, then the globe dives into Hangzhou and hands off
// to the main video.
//
// The globe is the pre-baked clip examples/assets/globe-route.mp4 (built by
// examples/assets/build-globe-route.ts). During its steady "hold" phase the
// camera is locked on Chongqing, so the route overlay — whose screen positions
// are computed with the SAME orthographic projection — sits exactly on the map.
// The constants below MUST match build-globe-route.ts.
// ---------------------------------------------------------------------------

const width = 1280;
const height = 720;
const fps = 25;

const SRC = "examples/demo.mp4";
const GLOBE = "examples/assets/globe-route.mp4";

const ink = "#04060e";
const cyan = "#27e7e0";
const magenta = "#ff2e88";
const amber = "#ffd23f";
const white = "#ffffff";

// --- projection constants (match build-globe-route.ts) ---------------------
const D2R = Math.PI / 180;
const cqLat = 29.563 * D2R, cqLon = 106.551 * D2R; // 重庆 (screen centre during hold)
const R0 = 214;
const Zsteady = 6.4;
// clip is 6.0s; camera holds on Chongqing during [pA, pB]
const clipDur = 6000;
const holdStart = 0.42 * clipDur; // 2520
const holdEnd = 0.76 * clipDur;   // 4560

// Forward orthographic projection of a geo point to screen, at the steady
// (Chongqing-centred) camera. Mirrors the inverse mapping in the builder.
function projectCity(latDeg: number, lonDeg: number): { x: number; y: number } {
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  const spin = cqLon, tilt = -cqLat, R = R0 * Zsteady;
  const mx = Math.cos(lat) * Math.sin(lon), my = Math.sin(lat), mz = Math.cos(lat) * Math.cos(lon);
  const ax = mx * Math.cos(spin) - mz * Math.sin(spin);
  const az = mx * Math.sin(spin) + mz * Math.cos(spin);
  const nx = ax;
  const ny = my * Math.cos(tilt) + az * Math.sin(tilt);
  return { x: 640 + R * nx, y: 360 - R * ny };
}

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

function glowRing(id: string, gx: number, gy: number, r: number, strokeW: number, color: string, startMs: number, endMs: number, maxOp = 0.5, glow = 12): Layer[] {
  const op = hold(startMs, endMs, 220, 220);
  return [
    { type: "shape", id: `${id}-h`, shape: "circle", radius: r, stroke: color, strokeWidth: strokeW * 2.2, fill: ink, blur: glow, startMs, endMs, transform: { x: gx - r, y: gy - r, opacity: scaleKf(op, maxOp * 0.7) } },
    { type: "shape", id: `${id}-c`, shape: "circle", radius: r, stroke: color, strokeWidth: strokeW, fill: ink, startMs, endMs, transform: { x: gx - r, y: gy - r, opacity: scaleKf(op, maxOp) } }
  ];
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

function glowDot(id: string, gx: number, gy: number, r: number, color: string, startMs: number, endMs: number, op: ScalarKeyframe[] = hold(startMs, endMs), glow = 10): Layer[] {
  const hr = r * 1.7;
  return [
    { type: "shape", id: `${id}-h`, shape: "circle", radius: hr, fill: color, blur: glow, startMs, endMs, transform: { x: gx - hr, y: gy - hr, opacity: scaleKf(op, 0.6) } },
    { type: "shape", id: `${id}-c`, shape: "circle", radius: r, fill: color, startMs, endMs, transform: { x: gx - r, y: gy - r, opacity: op } }
  ];
}

function flash(id: string, t: number, color: string, max = 0.92, dur = 260): Layer {
  return {
    type: "shape", id, shape: "rect", width, height, fill: color, startMs: t - 30, endMs: t + dur,
    transform: { opacity: [{ timeMs: t - 30, value: 0 }, { timeMs: t + Math.round(dur * 0.12), value: max }, { timeMs: t + Math.round(dur * 0.42), value: max * 0.25 }, { timeMs: t + dur, value: 0 }] }
  };
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
// Route on the globe (steady-phase screen coords)
// =====================================================================
const A = { x: 640, y: 360 };          // 重庆 sits at screen centre during hold
const B = projectCity(30.27, 120.15);  // 杭州
const C = { x: (A.x + B.x) / 2, y: Math.min(A.y, B.y) - 92 }; // arc control

const routeStart = 2680;
const routeEnd = 4380;
const steps = 26;

function bezier(t: number): { x: number; y: number } {
  const u = 1 - t;
  return { x: u * u * A.x + 2 * u * t * C.x + t * t * B.x, y: u * u * A.y + 2 * u * t * C.y + t * t * B.y };
}
function heading(t: number): number {
  const u = 1 - t;
  const dx = 2 * u * (C.x - A.x) + 2 * t * (B.x - C.x);
  const dy = 2 * u * (C.y - A.y) + 2 * t * (B.y - C.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// dive / hand-off timing (descent starts when the globe leaves its hold)
const descentStart = holdEnd;     // 4560
const videoStart = 4720;
const globeFadeEnd = 5650;

const routeDots: Layer[] = Array.from({ length: steps + 1 }, (_, k) => {
  const t = k / steps;
  const p = bezier(t);
  const lightT = Math.round(routeStart + t * (routeEnd - routeStart));
  const r = k % 3 === 0 ? 3.4 : 2.4;
  return {
    type: "shape", id: `route-${k}`, shape: "circle", radius: r, fill: cyan, blur: k % 3 === 0 ? 6 : 0, startMs: lightT, endMs: descentStart,
    transform: { x: p.x - r, y: p.y - r, opacity: [{ timeMs: lightT, value: 0 }, { timeMs: lightT + 80, value: 0.92 }, { timeMs: descentStart - 120, value: 0.92 }, { timeMs: descentStart, value: 0 }] }
  };
});

// Vector airplane silhouette (points +x at rotation 0), following the route.
const planePath = "M 20 0 L 4 -3 L 2 -12 L -2 -13 L -3 -3 L -12 -3 L -16 -8 L -19 -8 L -17 -1 L -19 0 L -17 1 L -19 8 L -16 8 L -12 3 L -3 3 L -2 13 L 2 12 L 4 3 Z";
const planeX: ScalarKeyframe[] = []; const planeY: ScalarKeyframe[] = []; const planeRot: ScalarKeyframe[] = [];
for (let s = 0; s <= steps; s += 1) {
  const t = s / steps;
  const p = bezier(t);
  const time = Math.round(routeStart + t * (routeEnd - routeStart));
  planeX.push({ timeMs: time, value: p.x });
  planeY.push({ timeMs: time, value: p.y });
  planeRot.push({ timeMs: time, value: heading(t) });
}
const planeEnd = descentStart;
const planeLayers: Layer[] = [
  { type: "shape", id: "plane-glow", shape: "path", path: planePath, fill: white, blur: 11, startMs: routeStart, endMs: planeEnd, transform: { x: planeX, y: planeY, rotate: planeRot, opacity: scaleKf(hold(routeStart, planeEnd, 120, 150), 0.55) } },
  { type: "shape", id: "plane", shape: "path", path: planePath, fill: white, startMs: routeStart, endMs: planeEnd, transform: { x: planeX, y: planeY, rotate: planeRot, opacity: hold(routeStart, planeEnd, 120, 150) } }
];

// =====================================================================
// GLOBE + route + dive
// =====================================================================
const globeLayers: Layer[] = [
  rect("globe-bg", 0, globeFadeEnd, 0, 0, width, height, ink),
  { type: "video", id: "globe-clip", src: GLOBE, startMs: 0, endMs: globeFadeEnd, trimStartMs: 0, width, height, transform: { x: 0, y: 0, opacity: [{ timeMs: 0, value: 0 }, { timeMs: 300, value: 1 }, { timeMs: descentStart, value: 1 }, { timeMs: globeFadeEnd, value: 0 }] } },
  label("globe-kicker", "GLOBAL UPLINK", centerX("GLOBAL UPLINK", 24), 64, 24, cyan, 300, descentStart, flick(300, descentStart), softShadow),
  label("globe-title", "环球航线 重庆 > 杭州", centerX("环球航线 重庆 > 杭州", 44), 684, 44, white, 700, descentStart, flick(700, descentStart), titleStyle(cyan)),
  label("globe-dist", "航程 ≈ 1000 km · 直飞", width - 320, 50, 22, amber, holdStart, descentStart, hold(holdStart, descentStart, 180, 160), softShadow),
  // route trail + plane (only during the steady hold)
  ...routeDots,
  ...planeLayers,
  // origin pin 重庆 (centre) and destination 杭州
  ...glowDot("pin-a", A.x, A.y, 7, magenta, holdStart, descentStart, hold(holdStart, descentStart, 160, 160), 10),
  ...glowRing("pin-a-ring", A.x, A.y, 18, 2, magenta, holdStart, descentStart, 0.6, 8),
  label("pin-a-label", "重庆 CKG", A.x - 76, A.y + 42, 24, white, holdStart + 60, descentStart, hold(holdStart + 60, descentStart, 160, 160), softShadow),
  ...glowDot("pin-b", B.x, B.y, 7, amber, holdStart, descentStart, hold(holdStart, descentStart, 160, 160), 10),
  ...glowRing("pin-b-ring", B.x, B.y, 18, 2, amber, holdStart, descentStart, 0.6, 8),
  label("pin-b-label", "杭州 HGH", B.x + 16, B.y - 28, 24, white, holdStart + 60, descentStart, hold(holdStart + 60, descentStart, 160, 160), softShadow),
  // arrival lock + dive (globe pans/zooms into Hangzhou; ripples + cloud bloom
  // bridge to the footage revealed beneath)
  ...ringPulse("arrive-1", B.x, B.y, 60, routeEnd - 80, 560, 0.1, 1.0, amber, 2, 0.85, 12),
  label("arrive-label", "已到达 杭州 · 进入实拍", B.x - 120, B.y + 52, 26, amber, routeEnd, descentStart, flick(routeEnd, descentStart), softShadow),
  ...ringPulse("dive-r1", 640, 360, 470, descentStart, 700, 0.05, 1.0, cyan, 4, 0.7, 18),
  ...ringPulse("dive-r2", 640, 360, 510, descentStart + 200, 660, 0.05, 1.0, white, 3, 0.6, 16),
  {
    type: "shape", id: "cloud-punch", shape: "circle", radius: 96, fill: white, blur: 48, startMs: descentStart, endMs: globeFadeEnd + 80,
    transform: {
      x: track(descentStart, 820, 640 - 96 * 0.4, 640 - 96 * 12, easeInCubic, 6),
      y: track(descentStart, 820, 360 - 96 * 0.4, 360 - 96 * 12, easeInCubic, 6),
      scale: track(descentStart, 820, 0.4, 12, easeInCubic, 6),
      opacity: [{ timeMs: descentStart, value: 0 }, { timeMs: descentStart + 540, value: 0.6 }, { timeMs: globeFadeEnd + 80, value: 0 }]
    }
  },
  rect("bloom", descentStart, globeFadeEnd + 160, 0, 0, width, height, white, [{ timeMs: descentStart, value: 0 }, { timeMs: descentStart + 560, value: 0.4 }, { timeMs: globeFadeEnd + 160, value: 0 }])
];

// =====================================================================
// BODY + OUTRO
// =====================================================================
const bodyCut = 7700;
const bodyEndMs = 10700;
const outroMs = 10500;
const durationMs = 12700;

const bodyLayers: Layer[] = [
  videoSeg("clip1", videoStart, bodyCut, 5000, 1.7, 1150),
  videoSeg("clip2", bodyCut, bodyEndMs, 60000, 1.12, 360),
  rect("hud-top", globeFadeEnd, bodyEndMs, 0, 0, width, 90, "rgba(4,6,14,0.5)"),
  rect("hud-bot", globeFadeEnd, bodyEndMs, 0, height - 150, width, 150, "rgba(4,6,14,0.6)"),
  { type: "shape", id: "rec-dot", shape: "circle", radius: 8, fill: magenta, blur: 6, startMs: globeFadeEnd, endMs: bodyEndMs, transform: { x: 46, y: 44, opacity: blink(globeFadeEnd, bodyEndMs) } },
  label("hud-brand", "OPENHYPERCORE  //  杭州实拍", 72, 52, 22, cyan, globeFadeEnd, bodyEndMs, hold(globeFadeEnd, bodyEndMs, 200, 200), softShadow),
  {
    type: "caption", id: "cap1", text: "已抵达杭州 · 进入实拍画面", startMs: globeFadeEnd + 120, endMs: bodyCut - 120, size: 30, color: white,
    backgroundColor: "rgba(4,6,14,0.74)", padding: 16, align: "center", maxWidth: Math.round(textWidth("已抵达杭州 · 进入实拍画面", 30)), lineHeight: 38, ...captionStyle,
    transform: { x: 640, y: 656, opacity: hold(globeFadeEnd + 120, bodyCut - 120, 160, 180) }
  },
  {
    type: "caption", id: "cap2", text: "环球航线开场 + 实拍，全程 CPU 合成", startMs: bodyCut + 160, endMs: bodyEndMs - 120, size: 30, color: white,
    backgroundColor: "rgba(4,6,14,0.74)", padding: 16, align: "center", maxWidth: Math.round(textWidth("环球航线开场 + 实拍，全程 CPU 合成", 30)), lineHeight: 38, ...captionStyle,
    transform: { x: 640, y: 656, opacity: hold(bodyCut + 160, bodyEndMs - 120, 160, 180) }
  },
  ...ringPulse("body-ring", 640, 360, 440, bodyCut - 90, 360, 0.05, 1.0, white, 4, 0.7, 16),
  flash("body-flash", bodyCut, white, 0.7, 200)
];

const outroLayers: Layer[] = [
  rect("outro-darken", outroMs, durationMs, 0, 0, width, height, ink, [{ timeMs: outroMs, value: 0 }, { timeMs: outroMs + 340, value: 0.88 }, { timeMs: durationMs, value: 0.88 }]),
  label("outro-title", "OPENHYPERCORE", centerX("OPENHYPERCORE", 78), 350, 78, white, outroMs + 260, durationMs, flick(outroMs + 260, durationMs), titleStyle(cyan)),
  label("outro-tag", "环球航线开场 · 纯 CPU 渲染", centerX("环球航线开场 · 纯 CPU 渲染", 24), 410, 24, amber, outroMs + 620, durationMs, hold(outroMs + 620, durationMs, 220, 240), softShadow),
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
    { type: "audio", id: "bgm", src: "examples/assets/bgm-epic.m4a", startMs: 0, endMs: durationMs, volume: 0.5, fadeInMs: 600, fadeOutMs: 1300 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEndMs + 200, volume: 0.6, fadeInMs: 360, fadeOutMs: 700 },
    ...globeLayers,
    ...outroLayers
  ]
});
