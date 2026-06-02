import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "剪纸拼贴 · PAPER-CUT COLLAGE" — vertical (9:16) opener. Warm paper stage,
// torn-paper pieces pasted in, a photo cutout with a ring, washi tape, a star
// sticker and a torn-paper title ribbon (serif title — no brush/calligraphy).
// Transition into the main video: a paper sheet slides across. BGM differs.
// ---------------------------------------------------------------------------

const width = 720;
const height = 1280;
const fps = 30;

const paper = "#e7d9bd";
const ink = "#38301f";
const tan = "#d98b54";
const green = "#6fae8f";
const gold = "#e2b13c";
const red = "#c7543f";
const cream = "#fff8ea";
const white = "#ffffff";

const SONGTI = "/System/Library/Fonts/Supplemental/Songti.ttc";
const HEITI = "/System/Library/Fonts/STHeiti Medium.ttc";
const SRC = "examples/demo.mp4";
const BGM = "examples/assets/bgm-uplift.m4a";

const exitAt = 2400;
const videoStart = 2780;
const bodyEnd = 7100;
const durationMs = 7900;
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
const centerX = (t: string, size: number) => Math.round((width - textWidth(t, size)) / 2);
function rect(id: string, s: number, e: number, x: number | ScalarKeyframe[], y: number | ScalarKeyframe[], w: number, h: number, fill: string, op: number | ScalarKeyframe[] = 1, rot: number | ScalarKeyframe[] = 0, stroke?: string, sw = 2, dash?: number[]): Layer {
  return { type: "shape", id, shape: "rect", width: w, height: h, fill, ...(stroke ? { stroke, strokeWidth: sw } : {}), ...(dash ? { dash } : {}), startMs: s, endMs: e, transform: { x, y, opacity: op, rotate: rot } };
}
function circle(id: string, s: number, e: number, x: number, y: number, r: number, fill: string, op: number | ScalarKeyframe[] = 1, stroke?: string, sw = 2, dash?: number[]): Layer {
  return { type: "shape", id, shape: "circle", radius: r, fill, ...(stroke ? { stroke, strokeWidth: sw } : {}), ...(dash ? { dash } : {}), startMs: s, endMs: e, transform: { x, y, opacity: op } };
}
function path(id: string, s: number, e: number, x: number, y: number, d: string, fill: string, op: number | ScalarKeyframe[] = 1, rot = 0): Layer {
  return { type: "shape", id, shape: "path", path: d, fill, startMs: s, endMs: e, transform: { x, y, opacity: op, rotate: rot } };
}
function text(id: string, t: string, x: number | ScalarKeyframe[], y: number, size: number, color: string, s: number, e: number, op: number | ScalarKeyframe[] = 1, font?: string, style: TextStyle = {}): Layer {
  return { type: "text", id, text: t, size, color, ...(font ? { font } : {}), ...style, startMs: s, endMs: e, transform: { x, y, opacity: op } };
}

const exitOp = (s: number, fadeIn = 90): ScalarKeyframe[] => [{ timeMs: s, value: 0 }, { timeMs: s + fadeIn, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 220, value: 0 }];

// torn-paper piece that slides up into place
function paste(id: string, s: number, x: number, y: number, w: number, h: number, fill: string, rot: number): Layer {
  return rect(id, s, exitAt + 240, x, track(s, 440, y + 30, y, easeOutCubic), w, h, fill, exitOp(s), rot);
}

function band(id: string, s: number, e: number, trim: number): Layer[] {
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + 70, value: 1 }];
  return [
    rect(`${id}-sh`, s, e, bandX + 8, bandY + 12, bandW, bandH, "rgba(40,28,10,0.25)", op),
    rect(`${id}-f`, s, e, bandX - 10, bandY - 10, bandW + 20, bandH + 20, cream, op),
    { type: "video", id, src: SRC, startMs: s, endMs: e, trimStartMs: trim, width: bandW, height: bandH, transform: { x: bandX, y: bandY, opacity: op } }
  ];
}
function caption(t: string, s: number, e: number): Layer[] {
  const size = 38, pad = 18;
  const w = textWidth(t, size) + pad * 2, x = (width - w) / 2, y = 922;
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + 60, value: 1 }, { timeMs: e - 120, value: 1 }, { timeMs: e, value: 0 }];
  return [rect("cap-b", s, e, x, y, w, size * 1.35, cream, op, -1.5), text("cap-t", t, x + pad, y + size * 1.0, size, ink, s, e, op, SONGTI)];
}

const starPath = "M 38 0 L 48 26 L 76 26 L 53 44 L 62 72 L 38 54 L 14 72 L 23 44 L 0 26 L 28 26 Z";

export default defineComposition({
  fps, width, height, durationMs, defaultFont: HEITI,
  layers: [
    rect("bg", 0, durationMs, 0, 0, width, height, paper),
    { type: "audio", id: "bgm", src: BGM, startMs: 0, endMs: durationMs, volume: 0.6, fadeInMs: 250, fadeOutMs: 900 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEnd + 150, volume: 0.55, fadeInMs: 200, fadeOutMs: 500 },

    // torn paper pieces
    paste("pp1", 100, -60, -80, 280, 300, tan, -8),
    paste("pp2", 180, 500, -40, 280, 320, green, 7),
    paste("pp3", 260, -40, 1020, 360, 320, gold, 5),
    circle("pp4", 360, exitAt + 240, 600, 1080, 150, red, exitOp(360)),

    // kicker pill
    rect("kick", 360, exitAt + 240, centerX("VOL.03 · 生活碎片", 24) - 24, 62, textWidth("VOL.03 · 生活碎片", 24) + 48, 46, ink, exitOp(360)),
    text("kick-t", "VOL.03 · 生活碎片", centerX("VOL.03 · 生活碎片", 24), 93, 24, cream, 360, exitAt + 240, exitOp(360)),

    // square photo cutout (top-left) — dashed cut border
    rect("sq", 600, exitAt + 240, 60, 230, 120, 120, "#8aa9b8", exitOp(600), -9, white, 6, [15, 11]),
    // avatar cutout (centre) — photo placeholder + dashed "marching-ants" ring
    circle("av-ph", 720, exitAt + 240, 360, 380, 120, "#b7a07a", exitOp(720)),
    circle("av-ring", 720, exitAt + 240, 360, 380, 128, "rgba(0,0,0,0)", exitOp(720), cream, 8, [17, 12]),
    text("av-t", "[ 你的头像 ]", centerX("[ 你的头像 ]", 22), 388, 22, "#6c5c3b", 760, exitAt + 240, exitOp(760)),

    // washi tape + star
    rect("tape1", 740, exitAt + 240, 320, 250, 96, 30, "rgba(255,247,225,0.66)", exitOp(740), -18),
    rect("tape2", 700, exitAt + 240, 110, 168, 80, 28, "rgba(255,247,225,0.66)", exitOp(700), 14),
    path("star", 900, exitAt + 240, 560, 250, starPath, gold, exitOp(900), 0),
    text("star-t", "NEW", 583, 296, 17, ink, 940, exitAt + 240, exitOp(940)),

    // torn-paper title ribbon
    rect("rib", 1000, exitAt + 240, 46, track(1000, 460, 980, 950, easeOutBack, 6), 628, 150, cream, exitOp(1000), -2),
    text("rib-ttl", "我的一周", centerX("我的一周", 70), 1040, 70, ink, 1040, exitAt + 240, exitOp(1040), SONGTI),
    text("rib-meta", "A WEEK IN MY LIFE", centerX("A WEEK IN MY LIFE", 18), 1078, 18, red, 1120, exitAt + 240, exitOp(1120)),
    text("handle", "@你的ID", centerX("@你的ID", 24), 1180, 24, "#5c4f33", 1200, exitAt + 240, exitOp(1200), SONGTI),

    // paper-slide transition (a sheet sweeps up over the screen)
    rect("sheet", exitAt, videoStart + 320, 0, track(exitAt, 520, height, -height, easeOutCubic), width, height, cream, 1),
    { type: "shape", id: "sheet-sh", shape: "rect", width, height: 26, fill: "rgba(40,28,10,0.18)", startMs: exitAt, endMs: videoStart + 320, transform: { x: 0, y: track(exitAt, 520, height - 26, -height - 26, easeOutCubic), opacity: 1 } },

    // body
    ...band("clip1", videoStart, bodyEnd, 5000),
    ...caption("记录我的一周生活", videoStart + 260, bodyEnd - 120),
    text("b-handle", "@你的ID", centerX("@你的ID", 24), 1190, 24, ink, videoStart, durationMs, 1, SONGTI),
    rect("final-fade", durationMs - 300, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 300, value: 0 }, { timeMs: durationMs, value: 1 }])
  ]
});
