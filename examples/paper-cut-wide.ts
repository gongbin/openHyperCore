import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "剪纸拼贴 · PAPER-CUT (16:9)" — landscape variant. The avatar cut-out holds
// the actual video (circular crop with a dashed "cut" ring); that circle keeps
// zooming up until it fills the frame, then cross-fades into the full main
// video. Serif title (no brush), heiti small text.
// ---------------------------------------------------------------------------

const width = 1280;
const height = 720;
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

const decorExit = 2000;
const avatarAppear = 700;
const zoomStart = 2000;
const zoomEnd = 3700;
const fullStart = 3500;
const bodyEnd = 7200;
const durationMs = 8000;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;
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
function circle(id: string, s: number, e: number, x: number | ScalarKeyframe[], y: number | ScalarKeyframe[], r: number, fill: string, op: number | ScalarKeyframe[] = 1, scale: number | ScalarKeyframe[] = 1, stroke?: string, sw = 2, dash?: number[]): Layer {
  return { type: "shape", id, shape: "circle", radius: r, fill, ...(stroke ? { stroke, strokeWidth: sw } : {}), ...(dash ? { dash } : {}), startMs: s, endMs: e, transform: { x, y, opacity: op, scale } };
}
function path(id: string, s: number, e: number, x: number, y: number, d: string, fill: string, op: number | ScalarKeyframe[] = 1, rot = 0): Layer {
  return { type: "shape", id, shape: "path", path: d, fill, startMs: s, endMs: e, transform: { x, y, opacity: op, rotate: rot } };
}
function text(id: string, t: string, x: number | ScalarKeyframe[], y: number, size: number, color: string, s: number, e: number, op: number | ScalarKeyframe[] = 1, font?: string, style: TextStyle = {}): Layer {
  return { type: "text", id, text: t, size, color, ...(font ? { font } : {}), ...style, startMs: s, endMs: e, transform: { x, y, opacity: op } };
}

const exitOp = (s: number, fadeIn = 90): ScalarKeyframe[] => [{ timeMs: s, value: 0 }, { timeMs: s + fadeIn, value: 1 }, { timeMs: decorExit, value: 1 }, { timeMs: decorExit + 280, value: 0 }];
function paste(id: string, s: number, x: number, y: number, w: number, h: number, fill: string, rot: number): Layer {
  return rect(id, s, decorExit + 300, x, track(s, 440, y + 30, y, easeOutCubic), w, h, fill, exitOp(s), rot);
}

// avatar: video cropped to a circle, with a dashed cut ring, growing to fill
const aCx = 640, aCy = 360, aR = 150;       // ring radius
const vW = 530, vH = 300;                   // cover-sized video (clip circle r=150)
const Smax = 5.7;                            // scale that fills the frame
const sched: Array<{ t: number; s: number }> = [{ t: avatarAppear, s: 1 }, { t: zoomStart, s: 1 }];
for (let i = 0; i <= 8; i += 1) { const p = i / 8; sched.push({ t: Math.round(zoomStart + (zoomEnd - zoomStart) * p), s: 1 + (Smax - 1) * easeInCubic(p) }); }
const vX = sched.map((k) => ({ timeMs: k.t, value: aCx - (vW / 2) * k.s }));
const vY = sched.map((k) => ({ timeMs: k.t, value: aCy - (vH / 2) * k.s }));
const vS = sched.map((k) => ({ timeMs: k.t, value: k.s }));
const rX = sched.map((k) => ({ timeMs: k.t, value: aCx - aR * k.s }));
const rY = sched.map((k) => ({ timeMs: k.t, value: aCy - aR * k.s }));

const starPath = "M 38 0 L 48 26 L 76 26 L 53 44 L 62 72 L 38 54 L 14 72 L 23 44 L 0 26 L 28 26 Z";

function caption(t: string, s: number, e: number): Layer[] {
  const size = 42, pad = 20;
  const w = textWidth(t, size) + pad * 2, x = (width - w) / 2, y = 612;
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + 60, value: 1 }, { timeMs: e - 120, value: 1 }, { timeMs: e, value: 0 }];
  return [rect("cap-b", s, e, x, y, w, size * 1.35, cream, op, -1.5), text("cap-t", t, x + pad, y + size, size, ink, s, e, op, SONGTI)];
}

export default defineComposition({
  fps, width, height, durationMs, defaultFont: HEITI,
  layers: [
    rect("bg", 0, durationMs, 0, 0, width, height, paper),
    { type: "audio", id: "bgm", src: BGM, startMs: 0, endMs: durationMs, volume: 0.6, fadeInMs: 250, fadeOutMs: 900 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: fullStart, endMs: bodyEnd + 150, volume: 0.55, fadeInMs: 300, fadeOutMs: 500 },

    // torn paper pieces
    paste("pp1", 100, -70, -90, 320, 300, tan, -8),
    paste("pp2", 180, 1050, -70, 320, 340, green, 7),
    paste("pp3", 260, -80, 520, 360, 300, gold, 5),
    circle("pp4", 360, decorExit + 300, 1190, 690, 150, red, exitOp(360)),

    // kicker + sticker + tape + star
    rect("kick", 360, decorExit + 300, centerX("VOL.03 · 生活碎片", 26) - 26, 36, textWidth("VOL.03 · 生活碎片", 26) + 52, 50, ink, exitOp(360)),
    text("kick-t", "VOL.03 · 生活碎片", centerX("VOL.03 · 生活碎片", 26), 70, 26, cream, 360, decorExit + 300, exitOp(360)),
    rect("sq", 560, decorExit + 300, 96, 120, 130, 130, "#8aa9b8", exitOp(560), -9, white, 6, [15, 11]),
    rect("tape1", 700, decorExit + 300, 150, 96, 96, 30, "rgba(255,247,225,0.66)", exitOp(700), 12),
    path("star", 820, decorExit + 300, 1070, 150, starPath, gold, exitOp(820), 0),
    text("star-t", "NEW", 1093, 196, 17, ink, 860, decorExit + 300, exitOp(860)),

    // title ribbon (fades before the zoom takes over)
    rect("rib", 1000, decorExit + 300, 360, track(1000, 460, 624, 600, easeOutBack, 6), 560, 124, cream, exitOp(1000), -2),
    text("rib-ttl", "我的一周", centerX("我的一周", 64), 678, 64, ink, 1040, decorExit + 300, exitOp(1040), SONGTI),
    text("rib-meta", "A WEEK IN MY LIFE", centerX("A WEEK IN MY LIFE", 18), 706, 18, red, 1120, decorExit + 300, exitOp(1120)),

    // avatar — video cropped to a circle, growing to fill the frame
    { type: "video", id: "av-vid", src: SRC, startMs: avatarAppear, endMs: fullStart + 500, trimStartMs: 5000, width: vW, height: vH, clip: { type: "circle", radius: Math.min(vW, vH) / 2, cx: vW / 2, cy: vH / 2 }, transform: { x: vX, y: vY, scale: vS, opacity: [{ timeMs: avatarAppear, value: 0 }, { timeMs: avatarAppear + 110, value: 1 }] } },
    circle("av-ring", avatarAppear, zoomEnd + 60, rX, rY, aR, "rgba(0,0,0,0)", [{ timeMs: avatarAppear, value: 0 }, { timeMs: avatarAppear + 110, value: 1 }, { timeMs: 3300, value: 1 }, { timeMs: 3650, value: 0 }], vS, cream, 9, [17, 12]),
    text("av-cap", "[ 你的头像 ]", centerX("[ 你的头像 ]", 22), aCy - aR - 22, 22, "#6c5c3b", avatarAppear + 200, zoomStart, [{ timeMs: avatarAppear + 200, value: 0 }, { timeMs: avatarAppear + 320, value: 1 }, { timeMs: zoomStart - 100, value: 1 }, { timeMs: zoomStart, value: 0 }]),

    // full main video cross-fades in as the circle fills the frame
    { type: "video", id: "full", src: SRC, startMs: fullStart, endMs: bodyEnd, trimStartMs: 7800, width, height, transform: { x: 0, y: 0, opacity: [{ timeMs: fullStart, value: 0 }, { timeMs: 3950, value: 1 }] } },
    ...caption("记录我的一周生活", 4100, bodyEnd - 120),
    text("b-handle", "@你的ID", centerX("@你的ID", 26), 678, 26, white, 4100, durationMs, [{ timeMs: 4100, value: 0 }, { timeMs: 4220, value: 1 }], SONGTI),
    rect("final-fade", durationMs - 320, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 320, value: 0 }, { timeMs: durationMs, value: 1 }])
  ]
});
