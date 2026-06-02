import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "环球定位" — a shaded, slowly rotating globe that zooms in while it spins,
// locks onto a point, then dives into the main video.
//
// Land vs ocean: the ocean is a soft-shaded sphere (highlight + limb
// darkening fake the lighting); the continents are points sampled from a
// coarse, hand-authored land mask and projected onto the sphere. Each point's
// brightness uses normal·lightDir for sphere shading, and rotation + zoom are
// baked straight into the per-sample projection, so the globe turns and grows
// together. Fully procedural — no map imagery. Standalone file.
// ---------------------------------------------------------------------------

const width = 1280;
const height = 720;
const fps = 25;

const SRC = "examples/demo.mp4";

const ink = "#04060e";
const cyan = "#27e7e0";
const magenta = "#ff2e88";
const amber = "#ffd23f";
const white = "#ffffff";
const space = "#141036";       // deep indigo background
const spaceGlow = "#322a78";    // soft purple halo behind the globe
const snowColor = "#eef3f7";
const tanColor = "#bda06a";     // arid / desert tan (dominant land tone)
const tanColor2 = "#a98a50";
const oliveColor = "#6f8d4d";   // muted vegetation
const oliveColor2 = "#566d3b";
const oceanBase = "#16487e";    // deep blue ocean
const oceanHi = "#3f8cc6";

// Realistic-ish land tint (matching a satellite globe): snowy high latitudes,
// a tan desert belt through the subtropics, muted olive vegetation elsewhere,
// plus a high-Asia (Tibet/Himalaya) snow speckle. Deterministic.
function landColorFor(latDeg: number, lonDeg: number, seed: number): string {
  const al = Math.abs(latDeg);
  const lon = ((lonDeg % 360) + 360) % 360;
  const h = seed * 7 + Math.round(latDeg) * 3 + Math.round(lon);
  if (al >= 58) return snowColor;                                   // polar snow
  if (al >= 46) return h % 2 === 0 ? snowColor : tanColor;          // sub-polar mix
  if (latDeg >= 28 && latDeg <= 45 && lon >= 70 && lon <= 102 && h % 3 === 0) return snowColor; // high Asia
  if (al >= 14 && al <= 40) return h % 6 === 0 ? oliveColor : (h % 2 === 0 ? tanColor : tanColor2); // desert belt
  return h % 3 === 0 ? tanColor : (h % 2 === 0 ? oliveColor : oliveColor2);  // temperate / equatorial
}

// --- easing / keyframe utils ----------------------------------------------
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

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

const softShadow: TextStyle = { shadowColor: "rgba(0,0,0,0.55)", shadowBlur: 8, shadowDy: 3 };
const captionStyle: TextStyle = { stroke: "rgba(0,0,0,0.5)", strokeWidth: 2, shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 6, shadowDy: 2 };
const titleStyle = (color: string): TextStyle => ({ stroke: color, strokeWidth: 5, shadowColor: "rgba(0,0,0,0.6)", shadowBlur: 13, shadowDy: 4 });

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
// Globe — shaded ocean sphere + land-mask continents, spin + zoom baked in
// =====================================================================
const Rg = 236;
const gx = 640;
const gy = 372;
const spinStart = 200;
const spinEnd = 3400;
const turns = 0.8;          // slow rotation
const Zmax = 2.35;          // zoom in while spinning
const samples = 28;
const diveAt = 3900;        // cut into main video

const deg = (d: number) => (d * Math.PI) / 180;
// Light direction (x right, y up, z toward viewer) — upper-left, front.
const Lx = -0.42, Ly = 0.5, Lz = 0.76;

const times: number[] = [];
for (let s = 0; s <= samples; s += 1) times.push(Math.round(spinStart + (spinEnd - spinStart) * (s / samples)));
const zoomAt = (p: number) => 1 + (Zmax - 1) * Math.pow(p, 1.55);
const latT = deg(15);
const lonT = deg(100);
const phase0 = -(lonT + 2 * Math.PI * turns); // target faces front at p = 1
const angleAt = (p: number) => phase0 + 2 * Math.PI * turns * p;

// Coarse, hand-authored land mask (an original, blocky ~30%-land approximation
// of Earth that leaves clear Pacific / Atlantic / Indian oceans).
function isLand(lat: number, lon: number): boolean {
  lon = ((lon % 360) + 360) % 360;
  const b = (a1: number, a2: number, o1: number, o2: number) => lat >= a1 && lat <= a2 && lon >= o1 && lon <= o2;
  // Africa (wide north, tapering south)
  if (b(12, 35, 0, 40) || b(12, 35, 352, 360)) return true;
  if (b(-12, 12, 8, 42)) return true;
  if (b(-34, -12, 12, 34)) return true;
  if (b(0, 12, 38, 50)) return true; // Horn
  if (b(-25, -12, 44, 50)) return true; // Madagascar
  // Europe
  if (b(40, 60, 0, 30) || b(36, 46, 0, 18) || b(58, 70, 6, 30)) return true;
  if (b(36, 58, 352, 360)) return true;
  // Asia
  if (b(50, 72, 30, 142)) return true;   // Siberia
  if (b(22, 50, 58, 126)) return true;   // China / Central Asia
  if (b(8, 30, 70, 90)) return true;     // India
  if (b(15, 40, 34, 60)) return true;    // Middle East
  if (b(8, 26, 95, 110)) return true;    // Indochina
  if (b(31, 45, 136, 146)) return true;  // Japan
  // Maritime SE Asia (scattered)
  if (b(-9, 7, 96, 122) && ((Math.floor(lon) + Math.floor(lat)) % 3 !== 0)) return true;
  if (b(-9, 0, 128, 140)) return true;
  // Australia + NZ
  if (b(-38, -12, 114, 150)) return true;
  if (b(-47, -34, 166, 179)) return true;
  // North America
  if (b(50, 72, 196, 300)) return true;  // Canada / Alaska
  if (b(30, 50, 234, 295)) return true;  // USA
  if (b(8, 30, 252, 284)) return true;   // Mexico / Cen-Am
  if (b(60, 82, 304, 340)) return true;  // Greenland
  // South America
  if (b(-12, 10, 284, 318)) return true; // north / Brazil bulge
  if (b(-34, -12, 286, 312)) return true;
  if (b(-55, -34, 288, 302)) return true; // cone
  // Antarctica
  if (lat <= -68) return true;
  return false;
}

const latStep = 6;
const lonStep = 6;
const landPts: Array<{ lat: number; lon: number; color: string }> = [];
let latIndex = 0;
for (let lat = -84; lat <= 84; lat += latStep) {
  const lonOffset = (latIndex % 2) * (lonStep / 2); // stagger rows to break the lattice
  for (let lon = lonOffset; lon < 360 + lonOffset; lon += lonStep) {
    if (isLand(lat, lon)) landPts.push({ lat: deg(lat), lon: deg(lon), color: landColorFor(lat, lon, landPts.length) });
  }
  latIndex += 1;
}

function landDotLayers(): Layer[] {
  const dotR = 2.7;
  return landPts.map((pt, idx) => {
    const xkf: ScalarKeyframe[] = []; const ykf: ScalarKeyframe[] = []; const skf: ScalarKeyframe[] = []; const okf: ScalarKeyframe[] = [];
    for (let s = 0; s <= samples; s += 1) {
      const p = s / samples; const a = angleAt(p); const z = zoomAt(p); const R = Rg * z; const t = times[s]!;
      const x3 = Math.cos(pt.lat) * Math.sin(pt.lon + a);
      const y3 = Math.sin(pt.lat);
      const z3 = Math.cos(pt.lat) * Math.cos(pt.lon + a);
      xkf.push({ timeMs: t, value: gx + R * x3 - dotR * z });
      ykf.push({ timeMs: t, value: gy - R * y3 - dotR * z });
      skf.push({ timeMs: t, value: z });
      const ndotl = x3 * Lx + y3 * Ly + z3 * Lz;
      const lightF = 0.3 + 0.7 * Math.max(0, Math.min(1, ndotl));
      const frontF = Math.max(0, Math.min(1, z3 * 6));
      okf.push({ timeMs: t, value: frontF * lightF });
    }
    const last = okf[okf.length - 1]!.value;
    okf.push({ timeMs: spinEnd + 260, value: last });
    okf.push({ timeMs: diveAt, value: 0 });
    return { type: "shape", id: `ld-${idx}`, shape: "circle", radius: dotR, fill: pt.color, startMs: spinStart, endMs: diveAt, transform: { x: xkf, y: ykf, scale: skf, opacity: okf } };
  });
}

// Centre-compensated zoom tracks for a circle offset (offX,offY) from the globe centre.
function zoomCircleTracks(offX: number, offY: number, baseR: number): { x: ScalarKeyframe[]; y: ScalarKeyframe[]; scale: ScalarKeyframe[] } {
  const xkf: ScalarKeyframe[] = []; const ykf: ScalarKeyframe[] = []; const skf: ScalarKeyframe[] = [];
  for (let s = 0; s <= samples; s += 1) {
    const p = s / samples; const z = zoomAt(p); const t = times[s]!;
    xkf.push({ timeMs: t, value: gx + offX * z - baseR * z });
    ykf.push({ timeMs: t, value: gy + offY * z - baseR * z });
    skf.push({ timeMs: t, value: z });
  }
  return { x: xkf, y: ykf, scale: skf };
}

function oceanLayers(): Layer[] {
  const op = hold(spinStart, diveAt, 360, 320);
  const atmo = zoomCircleTracks(0, 0, Rg * 1.13);
  const base = zoomCircleTracks(0, 0, Rg);
  const hi = zoomCircleTracks(Lx * Rg * 0.42, -Ly * Rg * 0.42, Rg * 0.62);
  const rim = zoomCircleTracks(0, 0, Rg * 0.99);
  return [
    { type: "shape", id: "atmo", shape: "circle", radius: Rg * 1.16, fill: cyan, blur: 54, startMs: spinStart, endMs: diveAt, transform: { x: atmo.x, y: atmo.y, scale: atmo.scale, opacity: scaleKf(op, 0.2) } },
    { type: "shape", id: "ocean", shape: "circle", radius: Rg, fill: oceanBase, startMs: spinStart, endMs: diveAt, transform: { x: base.x, y: base.y, scale: base.scale, opacity: op } },
    { type: "shape", id: "ocean-hi", shape: "circle", radius: Rg * 0.62, fill: oceanHi, blur: Rg * 0.2, startMs: spinStart, endMs: diveAt, transform: { x: hi.x, y: hi.y, scale: hi.scale, opacity: scaleKf(op, 0.55) } }
  ];
}

// Drawn on top of the land dots: soft limb darkening only — no hard edge line.
// The luminous edge comes from the blurred atmosphere glow behind the sphere.
function oceanRimLayers(): Layer[] {
  const op = hold(spinStart, diveAt, 360, 320);
  const rim = zoomCircleTracks(0, 0, Rg * 0.98);
  return [
    { type: "shape", id: "limb", shape: "circle", radius: Rg * 0.98, stroke: "#03070f", strokeWidth: Rg * 0.24, fill: ink, blur: Rg * 0.16, startMs: spinStart, endMs: diveAt, transform: { x: rim.x, y: rim.y, scale: rim.scale, opacity: scaleKf(op, 0.55) } }
  ];
}

// Deterministic glowing starfield (background, does not zoom).
function starField(): Layer[] {
  const out: Layer[] = [];
  for (let i = 0; i < 88; i += 1) {
    const x = (i * 89 + 37) % width;
    const y = (i * 47 + 19) % height;
    const bright = i % 6 === 0;
    const r = bright ? 2.3 : i % 3 === 0 ? 1.5 : 1.0;
    const base = 0.4 + ((i * 31) % 55) / 100;
    const col = i % 11 === 0 ? cyan : i % 17 === 0 ? amber : white;
    const tw: ScalarKeyframe[] = [
      { timeMs: 0, value: base * 0.4 },
      { timeMs: 600 + (i % 7) * 240, value: base },
      { timeMs: 1500 + (i % 5) * 260, value: base * 0.4 },
      { timeMs: 2600 + (i % 4) * 180, value: base },
      { timeMs: diveAt, value: 0 }
    ];
    if (bright) {
      out.push({ type: "shape", id: `star-h-${i}`, shape: "circle", radius: r * 2.6, fill: col, blur: 7, startMs: 0, endMs: diveAt, transform: { x: x - r * 2.6, y: y - r * 2.6, opacity: scaleKf(tw, 0.5) } });
    }
    out.push({ type: "shape", id: `star-${i}`, shape: "circle", radius: r, fill: col, startMs: 0, endMs: diveAt, transform: { x: x - r, y: y - r, opacity: tw } });
  }
  return out;
}
const starLayers: Layer[] = starField();

// Final locked target position (front of the globe at full zoom).
const mFinalX = gx + Rg * Zmax * Math.cos(latT) * Math.sin(0);
const mFinalY = gy - Rg * Zmax * Math.sin(latT);
const lockStart = 3380;

const globeLayers: Layer[] = [
  rect("globe-bg", 0, diveAt + 60, 0, 0, width, height, space),
  // soft purple space halo behind the globe
  { type: "shape", id: "space-glow", shape: "circle", radius: Rg * 1.8, fill: spaceGlow, blur: 120, startMs: 0, endMs: diveAt, transform: { x: gx - Rg * 1.8, y: gy - Rg * 1.8, opacity: scaleKf(hold(0, diveAt, 320, 320), 0.6) } },
  ...starLayers,
  ...oceanLayers(),
  ...landDotLayers(),
  ...oceanRimLayers(),
  label("globe-kicker", "GLOBAL UPLINK", centerX("GLOBAL UPLINK", 24), 78, 24, cyan, 300, diveAt, flick(300, diveAt), softShadow),
  label("globe-title", "环球定位", centerX("环球定位", 64), 668, 64, white, 700, diveAt, flick(700, diveAt), titleStyle(cyan)),
  // target lock
  { type: "shape", id: "lock-dot-h", shape: "circle", radius: 13, fill: amber, blur: 12, startMs: lockStart, endMs: diveAt, transform: { x: mFinalX - 13, y: mFinalY - 13, opacity: scaleKf(hold(lockStart, diveAt, 110, 120), 0.6) } },
  { type: "shape", id: "lock-dot-c", shape: "circle", radius: 5, fill: amber, startMs: lockStart, endMs: diveAt, transform: { x: mFinalX - 5, y: mFinalY - 5, opacity: hold(lockStart, diveAt, 110, 120) } },
  rect("lock-tick-v", lockStart, diveAt, mFinalX - 1, mFinalY - 28, 2, 56, amber, hold(lockStart, diveAt, 110, 110)),
  rect("lock-tick-h", lockStart, diveAt, mFinalX - 28, mFinalY - 1, 56, 2, amber, hold(lockStart, diveAt, 110, 110)),
  ...ringPulse("lock-pulse", mFinalX, mFinalY, 70, lockStart, 520, 0.1, 1.0, amber, 2, 0.85, 12),
  label("lock-label", "目标锁定 · 27.5°N 100.1°E", mFinalX + 26, mFinalY - 30, 22, amber, lockStart + 40, diveAt, hold(lockStart + 40, diveAt, 120, 120), softShadow),
  // dive: rings + disc expanding out of the locked point > flash > video
  ...ringPulse("dive-r1", mFinalX, mFinalY, 460, 3520, 420, 0.04, 1.0, cyan, 5, 0.9, 22),
  ...ringPulse("dive-r2", mFinalX, mFinalY, 460, 3620, 400, 0.04, 0.9, white, 4, 0.8, 20),
  {
    type: "shape", id: "dive-disc", shape: "circle", radius: 60, fill: white, startMs: 3540, endMs: diveAt + 60,
    transform: {
      x: track(3540, 360, mFinalX - 60 * 0.1, mFinalX - 60 * 26, easeInCubic, 6),
      y: track(3540, 360, mFinalY - 60 * 0.1, mFinalY - 60 * 26, easeInCubic, 6),
      scale: track(3540, 360, 0.1, 26, easeInCubic, 6),
      opacity: [{ timeMs: 3540, value: 0 }, { timeMs: 3720, value: 0.4 }, { timeMs: 3860, value: 1 }, { timeMs: diveAt + 60, value: 1 }]
    }
  },
  flash("dive-flash", diveAt, white, 0.98, 320)
];

// =====================================================================
// BODY — main video after the dive
// =====================================================================
const bodyCut = 6900;
const bodyEndMs = 9900;
const outroMs = 9700;
const durationMs = 11900;

const bodyLayers: Layer[] = [
  videoSeg("clip1", diveAt, bodyCut, 5000, 1.16, 700),
  videoSeg("clip2", bodyCut, bodyEndMs, 60000, 1.12, 360),
  rect("hud-top", diveAt, bodyEndMs, 0, 0, width, 90, "rgba(4,6,14,0.5)"),
  rect("hud-bot", diveAt, bodyEndMs, 0, height - 150, width, 150, "rgba(4,6,14,0.6)"),
  { type: "shape", id: "rec-dot", shape: "circle", radius: 8, fill: magenta, blur: 6, startMs: diveAt, endMs: bodyEndMs, transform: { x: 46, y: 44, opacity: blink(diveAt, bodyEndMs) } },
  label("hud-brand", "OPENHYPERCORE  //  实拍画面", 72, 52, 22, cyan, diveAt, bodyEndMs, hold(diveAt, bodyEndMs, 200, 200), softShadow),
  {
    type: "caption", id: "cap1", text: "已抵达目标城市 · 进入实拍画面", startMs: diveAt + 200, endMs: bodyCut - 120, size: 30, color: white,
    backgroundColor: "rgba(4,6,14,0.74)", padding: 16, align: "center", maxWidth: Math.round(textWidth("已抵达目标城市 · 进入实拍画面", 30)), lineHeight: 38, ...captionStyle,
    transform: { x: 640, y: 656, opacity: hold(diveAt + 200, bodyCut - 120, 160, 180) }
  },
  {
    type: "caption", id: "cap2", text: "全部由 OpenHyperCore 在 CPU 上合成", startMs: bodyCut + 160, endMs: bodyEndMs - 120, size: 30, color: white,
    backgroundColor: "rgba(4,6,14,0.74)", padding: 16, align: "center", maxWidth: Math.round(textWidth("全部由 OpenHyperCore 在 CPU 上合成", 30)), lineHeight: 38, ...captionStyle,
    transform: { x: 640, y: 656, opacity: hold(bodyCut + 160, bodyEndMs - 120, 160, 180) }
  },
  ...ringPulse("body-ring", 640, 360, 440, bodyCut - 90, 360, 0.05, 1.0, white, 4, 0.7, 16),
  flash("body-flash", bodyCut, white, 0.7, 200)
];

// =====================================================================
// OUTRO
// =====================================================================
const outroLayers: Layer[] = [
  rect("outro-darken", outroMs, durationMs, 0, 0, width, height, ink, [{ timeMs: outroMs, value: 0 }, { timeMs: outroMs + 340, value: 0.88 }, { timeMs: durationMs, value: 0.88 }]),
  label("outro-title", "OPENHYPERCORE", centerX("OPENHYPERCORE", 78), 350, 78, white, outroMs + 260, durationMs, flick(outroMs + 260, durationMs), titleStyle(cyan)),
  label("outro-tag", "环球定位开场 · 纯 CPU 渲染", centerX("环球定位开场 · 纯 CPU 渲染", 24), 410, 24, amber, outroMs + 620, durationMs, hold(outroMs + 620, durationMs, 220, 240), softShadow),
  label("outro-handle", "@openhypercore", centerX("@openhypercore", 22), 470, 22, cyan, outroMs + 820, durationMs, hold(outroMs + 820, durationMs, 220, 260), softShadow),
  rect("final-fade", durationMs - 400, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 400, value: 0 }, { timeMs: durationMs, value: 1 }])
];

export default defineComposition({
  fps,
  width,
  height,
  durationMs,
  layers: [
    rect("base", 0, durationMs, 0, 0, width, height, ink),
    ...bodyLayers,
    {
      type: "audio", id: "reel-audio", src: SRC, startMs: diveAt, endMs: bodyEndMs + 200, volume: 0.85, fadeInMs: 240, fadeOutMs: 700
    },
    ...globeLayers,
    ...outroLayers
  ]
});
