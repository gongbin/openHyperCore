import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "糖果孟菲斯 · 周末去哪玩 (16:9, 加长版)" — same opener as candy-memphis-wide,
// but a longer 6-clip highlight body from demo2.mov with candy beat cuts.
// ---------------------------------------------------------------------------

const width = 1920;
const height = 1080;
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
const SRC = "examples/demo2.mov";
const BGM = "examples/assets/bgm-pop.m4a";

// opener identical to candy-memphis-wide
const exitAt = 2300;
const videoStart = 2680;
// 6 highlight segments
const segDur = 3000;
const segStarts = [0, 1, 2, 3, 4, 5].map((i) => videoStart + i * segDur);
const segEnds = [...segStarts.slice(1), videoStart + 6 * segDur];
const bodyEnd = videoStart + 6 * segDur; // 20680
const durationMs = bodyEnd + 2700;       // ~23.4s

const trims = [9000, 15000, 22000, 28000, 35000, 40000];
const caps = ["这周末，跟我去逛老街！", "青石巷弄，慢慢走～", "转角全是小惊喜", "在地小吃，必须冲！", "红灯笼下，拍一张", "傍晚的老街最好看"];
const cutColors = [teal, pink, purple, orange, teal];

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
const centerX = (t: string, size: number) => Math.round((width - textWidth(t, size)) / 2);
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
function popDecor(layer: Layer, t0: number): Layer {
  const tf = layer.transform ?? {};
  const baseRot = typeof tf.rotate === "number" ? tf.rotate : 0;
  const op: ScalarKeyframe[] = [{ timeMs: t0, value: 0 }, { timeMs: t0 + 120, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 200, value: 0 }];
  return { ...layer, startMs: t0, endMs: exitAt + 220, transform: { ...tf, opacity: op, rotate: track(t0, 420, -38, baseRot, easeOutBack, 6) } };
}
function slamLine(id: string, t: string, baseline: number, size: number, blockColor: string, t0: number, rot: number): Layer[] {
  const pad = 30, x = 140;
  const w = textWidth(t, size) + pad * 2;
  const blockTop = baseline - size * 0.86;
  const h = size * 1.2;
  const yk = (target: number): ScalarKeyframe[] => [{ timeMs: t0, value: target - 70 }, { timeMs: t0 + 200, value: target + 14 }, { timeMs: t0 + 300, value: target - 5 }, { timeMs: t0 + 400, value: target }, { timeMs: exitAt, value: target }, { timeMs: exitAt + 220, value: target - 180 }];
  const op: ScalarKeyframe[] = [{ timeMs: t0, value: 0 }, { timeMs: t0 + 60, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }];
  return [
    rect(`${id}-blk`, t0, exitAt + 240, x - pad, yk(blockTop), w, h, blockColor, op, rot),
    text(`${id}-txt`, t, x, yk(baseline), size, white, t0, exitAt + 240, op, KUAILE, { shadowColor: "rgba(34,26,58,0.2)", shadowDx: 9, shadowDy: 11, shadowBlur: 0 })
  ];
}

const dots: Layer[] = [];
for (let gy = 18; gy < height; gy += 72) for (let gx = 18; gx < width; gx += 72) dots.push(circle(`d-${gx}-${gy}`, 0, durationMs, gx, gy, 3, "rgba(34,26,58,0.13)"));

const ix = 960, iy = 540, ir = 80;
const irisScale: ScalarKeyframe[] = track(exitAt, 480, 0.04, 18, easeOutCubic, 6);
const iris: Layer = {
  type: "shape", id: "iris", shape: "circle", radius: ir, fill: yellow, startMs: exitAt, endMs: videoStart + 380,
  transform: { x: irisScale.map((k) => ({ timeMs: k.timeMs, value: ix - ir * k.value })), y: irisScale.map((k) => ({ timeMs: k.timeMs, value: iy - ir * k.value })), scale: irisScale, opacity: [{ timeMs: exitAt, value: 1 }, { timeMs: videoStart + 140, value: 1 }, { timeMs: videoStart + 380, value: 0 }] }
};

function videoSeg(id: string, s: number, e: number, trim: number, fromScale = 1.08, zoomDur = 440): Layer {
  return { type: "video", id, src: SRC, startMs: s, endMs: e, trimStartMs: trim, width, height, transform: { scale: track(s, zoomDur, fromScale, 1, easeOutCubic, 6), x: track(s, zoomDur, (width / 2) * (1 - fromScale), 0, easeOutCubic, 6), y: track(s, zoomDur, (height / 2) * (1 - fromScale), 0, easeOutCubic, 6), opacity: [{ timeMs: s, value: 0 }, { timeMs: s + 60, value: 1 }] } };
}
function capPill(id: string, t: string, s: number, e: number): Layer[] {
  const size = 56, pad = 28;
  const w = textWidth(t, size) + pad * 2, x = (width - w) / 2, y = 940;
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + 60, value: 1 }, { timeMs: e - 120, value: 1 }, { timeMs: e, value: 0 }];
  return [rect(`${id}-blk`, s, e, x, y, w, size * 1.3, orange, op), text(`${id}-txt`, t, x + pad, y + size, size, white, s, e, op, KUAILE)];
}
function slamLineCenter(id: string, t: string, baseline: number, size: number, blockColor: string, textColor: string, t0: number): Layer[] {
  const pad = 30;
  const w = textWidth(t, size) + pad * 2;
  const x = (width - w) / 2 + pad;
  const yk = (target: number): ScalarKeyframe[] => [{ timeMs: t0, value: target - 70 }, { timeMs: t0 + 200, value: target + 14 }, { timeMs: t0 + 300, value: target - 5 }, { timeMs: t0 + 400, value: target }];
  const op: ScalarKeyframe[] = [{ timeMs: t0, value: 0 }, { timeMs: t0 + 60, value: 1 }];
  return [rect(`${id}-blk`, t0, durationMs, x - pad, yk(baseline - size * 0.86), w, size * 1.2, blockColor, op, -2), text(`${id}-txt`, t, x, yk(baseline), size, textColor, t0, durationMs, op, KUAILE)];
}

const epW = textWidth("EP.05", 44) + 36;
const bodyOp: ScalarKeyframe[] = [{ timeMs: videoStart, value: 0 }, { timeMs: videoStart + 80, value: 1 }, { timeMs: bodyEnd - 100, value: 1 }, { timeMs: bodyEnd, value: 0 }];
const starPath = "M 38 0 L 48 26 L 76 26 L 53 44 L 62 72 L 38 54 L 14 72 L 23 44 L 0 26 L 28 26 Z";

const clips: Layer[] = segStarts.map((s, i) => videoSeg(`clip${i + 1}`, s, segEnds[i]!, trims[i]!, i === 0 ? 1.1 : 1.08, i === 0 ? 640 : 430));
const captions: Layer[] = segStarts.flatMap((s, i) => capPill(`cap${i + 1}`, caps[i]!, s + (i === 0 ? 280 : 120), segEnds[i]! - 120));
const beatCuts: Layer[] = segStarts.slice(1).flatMap((s, i) => [
  flash(`cut-f${i}`, s, white, 0.65, 170),
  circle(`cut-p${i}`, s - 20, s + 340, ix, iy, 80, cutColors[i % cutColors.length]!, [{ timeMs: s - 20, value: 1 }, { timeMs: s + 340, value: 0 }])
]);

export default defineComposition({
  fps, width, height, durationMs, defaultFont: HEITI,
  layers: [
    rect("bg", 0, durationMs, 0, 0, width, height, cream),
    ...dots,
    { type: "audio", id: "bgm", src: BGM, startMs: 0, endMs: durationMs, volume: 0.6, fadeInMs: 250, fadeOutMs: 900 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEnd + 150, volume: 0.5, fadeInMs: 200, fadeOutMs: 500 },

    // Memphis decor (opener)
    popDecor(path("tri", 0, 0, 1470, 150, "M 0 130 L 76 0 L 152 130 Z", teal), 100),
    popDecor(circle("ring", 0, 0, 40, 430, 104, cream, 1, purple, 24), 180),
    popDecor(rect("dia", 0, 0, 560, 250, 76, 76, pink, 1, 45), 260),
    popDecor(rect("plusV", 0, 0, 1560, 560, 19, 76, purple), 320),
    popDecor(rect("plusH", 0, 0, 1531, 588, 76, 19, purple), 320),
    popDecor(path("half", 0, 0, 70, 980, "M 0 0 A 110 110 0 0 1 220 0 Z", yellow), 400),
    popDecor(path("star", 0, 0, 1700, 820, starPath, pink), 460),

    // tag + title (opener)
    rect("tag-pill", 360, exitAt + 240, 130, 80, epW, 64, ink, [{ timeMs: 360, value: 0 }, { timeMs: 460, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }]),
    text("tag-ep", "EP.05", 156, 126, 44, yellow, 360, exitAt + 240, [{ timeMs: 360, value: 0 }, { timeMs: 460, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }], KUAILE),
    text("tag-note", "// 周末企划", 156 + epW + 24, 126, 38, ink, 460, exitAt + 240, [{ timeMs: 460, value: 0 }, { timeMs: 560, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }]),
    ...slamLine("l1", "周末", 470, 200, orange, 560, -3),
    ...slamLine("l2", "去哪", 720, 200, teal, 720, 2),
    ...slamLine("l3", "玩？", 940, 180, purple, 880, -1.5),
    iris,
    flash("t-flash", videoStart, white, 0.8, 240),

    // body: 6 full-frame highlights with candy beat cuts
    ...clips,
    rect("bar-top", videoStart, bodyEnd, 0, 0, width, 16, yellow, bodyOp),
    rect("bar-bot", videoStart, bodyEnd, 0, height - 16, width, 16, pink, bodyOp),
    rect("tag2", videoStart, bodyEnd, 50, 50, epW, 64, yellow, bodyOp),
    text("tag2-t", "EP.05", 76, 96, 44, ink, videoStart, bodyEnd, bodyOp, KUAILE),
    { type: "shape", id: "h-av", shape: "circle", radius: 24, fill: purple, startMs: videoStart, endMs: bodyEnd, transform: { x: width - 300, y: 78, opacity: bodyOp } },
    text("h-id", "@你的ID", width - 262, 96, 44, ink, videoStart, bodyEnd, bodyOp, KUAILE),
    ...captions,
    ...beatCuts,

    // outro card
    rect("o-bg", bodyEnd, durationMs, 0, 0, width, height, cream, [{ timeMs: bodyEnd, value: 0 }, { timeMs: bodyEnd + 200, value: 1 }]),
    ...dots.map((l, i) => ({ ...l, id: `o-d${i}`, startMs: bodyEnd, endMs: durationMs })),
    ...slamLineCenter("o1", "周末愉快", 520, 200, yellow, ink, bodyEnd + 200),
    text("o-bang", "GO!", centerX("GO!", 120), 720, 120, pink, bodyEnd + 480, durationMs, [{ timeMs: bodyEnd + 480, value: 0 }, { timeMs: bodyEnd + 560, value: 1 }], KUAILE, { shadowColor: teal, shadowDx: 9, shadowDy: 11, shadowBlur: 0 }),
    text("o-id", "@你的ID", centerX("@你的ID", 56), 840, 56, ink, bodyEnd + 700, durationMs, [{ timeMs: bodyEnd + 700, value: 0 }, { timeMs: bodyEnd + 760, value: 1 }], KUAILE),
    rect("final-fade", durationMs - 320, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 320, value: 0 }, { timeMs: durationMs, value: 1 }])
  ]
});
