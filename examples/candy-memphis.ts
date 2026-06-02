import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "糖果孟菲斯 · CANDY MEMPHIS" — vertical (9:16) opener. Cream background,
// playful Memphis shapes, big rounded colour-block title (cartoon font, solid
// fills, no outline). Transition into the main video: a candy circle-iris.
// Adapted from the cover-design HTML preview. Common BGM with the other two.
// ---------------------------------------------------------------------------

const width = 720;
const height = 1280;
const fps = 30;

const cream = "#fff1dc";
const ink = "#221a3a";
const orange = "#ff5a1f";
const teal = "#12c2a0";
const purple = "#6b3df5";
const yellow = "#ffd23f";
const pink = "#ff3d7f";
const white = "#ffffff";

const KUAILE = "examples/assets/ZCOOLKuaiLe-Regular.ttf";
const HEITI = "/System/Library/Fonts/STHeiti Medium.ttc";
const SRC = "examples/demo.mp4";
const BGM = "examples/assets/bgm-pop.m4a";

const exitAt = 2300;
const videoStart = 2680;
const bodyEnd = 7000;
const durationMs = 7800;
const bandX = 0, bandY = 436, bandW = 720, bandH = 408;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
function track(s: number, d: number, a: number, b: number, e: (t: number) => number, n = 6): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let i = 0; i <= n; i += 1) { const p = i / n; kf.push({ timeMs: Math.round(s + d * p), value: a + (b - a) * e(p) }); }
  return kf;
}
function textWidth(t: string, size: number): number {
  let u = 0;
  for (const ch of t) { const c = ch.codePointAt(0) ?? 0; u += (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x3000 && c <= 0x303f) ? 1 : 0.55; }
  return u * size;
}
function rect(id: string, s: number, e: number, x: number | ScalarKeyframe[], y: number | ScalarKeyframe[], w: number, h: number, fill: string, op: number | ScalarKeyframe[] = 1, rot: number | ScalarKeyframe[] = 0): Layer {
  return { type: "shape", id, shape: "rect", width: w, height: h, fill, startMs: s, endMs: e, transform: { x, y, opacity: op, rotate: rot } };
}
function circle(id: string, s: number, e: number, x: number, y: number, r: number, fill: string, op: number | ScalarKeyframe[] = 1, stroke?: string, sw = 2): Layer {
  return { type: "shape", id, shape: "circle", radius: r, fill, ...(stroke ? { stroke, strokeWidth: sw } : {}), startMs: s, endMs: e, transform: { x, y, opacity: op } };
}
function path(id: string, s: number, e: number, x: number, y: number, d: string, fill: string, op: number | ScalarKeyframe[] = 1, rot = 0, stroke?: string, sw = 2): Layer {
  return { type: "shape", id, shape: "path", path: d, fill, ...(stroke ? { stroke, strokeWidth: sw } : {}), startMs: s, endMs: e, transform: { x, y, opacity: op, rotate: rot } };
}
function text(id: string, t: string, x: number | ScalarKeyframe[], y: number | ScalarKeyframe[], size: number, color: string, s: number, e: number, op: number | ScalarKeyframe[] = 1, font?: string, style: TextStyle = {}): Layer {
  return { type: "text", id, text: t, size, color, ...(font ? { font } : {}), ...style, startMs: s, endMs: e, transform: { x, y, opacity: op } };
}
function flash(id: string, t: number, color: string, max = 0.9, dur = 240): Layer {
  return { type: "shape", id, shape: "rect", width, height, fill: color, startMs: t - 30, endMs: t + dur, transform: { opacity: [{ timeMs: t - 30, value: 0 }, { timeMs: t + 26, value: max }, { timeMs: t + 110, value: max * 0.25 }, { timeMs: t + dur, value: 0 }] } };
}

// spin-pop for a decor shape (opacity + swing rotate); fades at exit
function popDecor(layer: Layer, t0: number): Layer {
  const tf = layer.transform ?? {};
  const baseRot = typeof tf.rotate === "number" ? tf.rotate : 0;
  const op: ScalarKeyframe[] = [{ timeMs: t0, value: 0 }, { timeMs: t0 + 120, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 200, value: 0 }];
  return { ...layer, startMs: t0, endMs: exitAt + 220, transform: { ...tf, opacity: op, rotate: track(t0, 420, -38, baseRot, easeOutBack, 6) } };
}

// title line: rounded colour block + white cartoon text, slammed (spring) in, rotated
function slamLine(id: string, t: string, baseline: number, size: number, blockColor: string, t0: number, rot: number): Layer[] {
  const pad = 26, x = 60;
  const w = textWidth(t, size) + pad * 2;
  const blockTop = baseline - size * 0.86;
  const h = size * 1.2;
  const yk = (target: number): ScalarKeyframe[] => [{ timeMs: t0, value: target - 60 }, { timeMs: t0 + 200, value: target + 12 }, { timeMs: t0 + 300, value: target - 4 }, { timeMs: t0 + 400, value: target }, { timeMs: exitAt, value: target }, { timeMs: exitAt + 220, value: target - 140 }];
  const op: ScalarKeyframe[] = [{ timeMs: t0, value: 0 }, { timeMs: t0 + 60, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }];
  return [
    rect(`${id}-blk`, t0, exitAt + 240, x - pad, yk(blockTop), w, h, blockColor, op, rot),
    text(`${id}-txt`, t, x, yk(baseline), size, white, t0, exitAt + 240, op, KUAILE, { shadowColor: "rgba(34,26,58,0.18)", shadowDx: 6, shadowDy: 7, shadowBlur: 0 })
  ];
}

// dot grid
const dots: Layer[] = [];
for (let gy = 14; gy < height; gy += 44) for (let gx = 14; gx < width; gx += 44) dots.push(circle(`d-${gx}-${gy}`, 0, durationMs, gx, gy, 2, "rgba(34,26,58,0.14)"));

// candy circle-iris transition (centre-compensated scale)
const ix = 360, iy = 640, ir = 70;
const irisScale: ScalarKeyframe[] = track(exitAt, 460, 0.05, 12, easeOutCubic, 6);
const iris: Layer = {
  type: "shape", id: "iris", shape: "circle", radius: ir, fill: yellow, startMs: exitAt, endMs: videoStart + 360,
  transform: {
    x: irisScale.map((k) => ({ timeMs: k.timeMs, value: ix - ir * k.value })),
    y: irisScale.map((k) => ({ timeMs: k.timeMs, value: iy - ir * k.value })),
    scale: irisScale,
    opacity: [{ timeMs: exitAt, value: 1 }, { timeMs: videoStart + 120, value: 1 }, { timeMs: videoStart + 360, value: 0 }]
  }
};

// framed video band + caption + handle
function band(id: string, s: number, e: number, trim: number): Layer[] {
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + 70, value: 1 }];
  return [
    rect(`${id}-f`, s, e, bandX - 12, bandY - 12, bandW + 24, bandH + 24, purple, op),
    rect(`${id}-f2`, s, e, bandX - 5, bandY - 5, bandW + 10, bandH + 10, yellow, op),
    { type: "video", id, src: SRC, startMs: s, endMs: e, trimStartMs: trim, width: bandW, height: bandH, transform: { x: bandX, y: bandY, opacity: op } }
  ];
}
function capPill(t: string, s: number, e: number): Layer[] {
  const size = 40, pad = 22;
  const w = textWidth(t, size) + pad * 2, x = (width - w) / 2, y = 936;
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + 60, value: 1 }, { timeMs: e - 120, value: 1 }, { timeMs: e, value: 0 }];
  return [rect("cap-blk", s, e, x, y, w, size * 1.3, orange, op), text("cap-txt", t, x + pad, y + size * 0.98, size, white, s, e, op, KUAILE)];
}

export default defineComposition({
  fps, width, height, durationMs, defaultFont: HEITI,
  layers: [
    rect("bg", 0, durationMs, 0, 0, width, height, cream),
    ...dots,
    { type: "audio", id: "bgm", src: BGM, startMs: 0, endMs: durationMs, volume: 0.6, fadeInMs: 250, fadeOutMs: 800 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEnd + 150, volume: 0.55, fadeInMs: 200, fadeOutMs: 500 },

    // Memphis decor
    popDecor(path("tri", 0, 0, 540, 110, "M 0 90 L 52 0 L 104 90 Z", teal), 100),
    popDecor(circle("ring", 0, 0, 30, 300, 72, cream, 1, purple, 16), 180),
    popDecor(rect("dia", 0, 0, 250, 220, 52, 52, pink, 1, 45), 260),
    popDecor(rect("plusV", 0, 0, 566, 470, 13, 52, purple), 320),
    popDecor(rect("plusH", 0, 0, 546, 490, 52, 13, purple), 320),
    popDecor(path("half", 0, 0, 20, 1000, "M 0 0 A 80 80 0 0 1 160 0 Z", yellow), 400),
    popDecor(path("squig", 0, 0, 250, 1080, "M 3 24 Q 26 0 50 24 T 96 24 T 150 24", "rgba(0,0,0,0)", 1, 0, pink, 9), 460),

    // tag
    rect("tag-pill", 360, exitAt + 240, 50, 56, textWidth("EP.05", 30) + 36, 48, ink, [{ timeMs: 360, value: 0 }, { timeMs: 460, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }]),
    text("tag-ep", "EP.05", 70, 90, 30, yellow, 360, exitAt + 240, [{ timeMs: 360, value: 0 }, { timeMs: 460, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }]),
    text("tag-note", "// 周末企划", 70 + textWidth("EP.05", 30) + 44, 90, 26, ink, 460, exitAt + 240, [{ timeMs: 460, value: 0 }, { timeMs: 560, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }]),

    // title
    ...slamLine("l1", "周末", 432, 130, orange, 560, -3),
    ...slamLine("l2", "就要", 588, 130, teal, 720, 2),
    ...slamLine("l3", "玩花样", 736, 116, purple, 880, -1.5),

    // burst
    circle("burst-bg", 1060, exitAt + 240, 150, 1010, 78, yellow, [{ timeMs: 1060, value: 0 }, { timeMs: 1140, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 200, value: 0 }]),
    text("burst-txt", "GO!", 96, 1030, 56, ink, 1060, exitAt + 240, [{ timeMs: 1060, value: 0 }, { timeMs: 1140, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 200, value: 0 }], KUAILE),

    // transition
    iris,
    flash("t-flash", videoStart, white, 0.8, 220),

    // body
    ...band("clip1", videoStart, bodyEnd, 5000),
    ...capPill("周末就该这么玩！", videoStart + 250, bodyEnd - 120),
    circle("h-av", videoStart, durationMs, 78, 1186, 20, purple, 1, white, 4),
    text("h-id", "@你的ID", 116, 1196, 34, ink, videoStart, durationMs, 1),
    rect("final-fade", durationMs - 300, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 300, value: 0 }, { timeMs: durationMs, value: 1 }])
  ]
});
