import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "斜切运动风 · SPEED SPLIT" — vertical (9:16) opener. Dark stage, diagonal
// colour blocks, ghost number, huge bold title (one line white, one outlined
// for contrast), marching chevrons. Transition into the main video: a diagonal
// colour-slab wipe. Adapted from the cover-design HTML. BGM differs per opener.
// ---------------------------------------------------------------------------

const width = 720;
const height = 1280;
const fps = 30;

const dark = "#0d0d10";
const cobalt = "#1542ff";
const lime = "#d4ff00";
const orange = "#ff4d00";
const white = "#ffffff";

const QINGKE = "examples/assets/ZCOOLQingKeHuangYou-Regular.ttf";
const HEITI = "/System/Library/Fonts/STHeiti Medium.ttc";
const SRC = "examples/demo.mp4";
const BGM = "examples/assets/bgm-cyber.m4a";

const exitAt = 2300;
const videoStart = 2700;
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
const centerX = (t: string, size: number) => Math.round((width - textWidth(t, size)) / 2);
function rect(id: string, s: number, e: number, x: number | ScalarKeyframe[], y: number | ScalarKeyframe[], w: number, h: number, fill: string, op: number | ScalarKeyframe[] = 1, rot: number | ScalarKeyframe[] = 0): Layer {
  return { type: "shape", id, shape: "rect", width: w, height: h, fill, startMs: s, endMs: e, transform: { x, y, opacity: op, rotate: rot } };
}
function text(id: string, t: string, x: number | ScalarKeyframe[], y: number, size: number, color: string, s: number, e: number, op: number | ScalarKeyframe[] = 1, font?: string, style: TextStyle = {}): Layer {
  return { type: "text", id, text: t, size, color, ...(font ? { font } : {}), ...style, startMs: s, endMs: e, transform: { x, y, opacity: op } };
}
function flash(id: string, t: number, color: string, max = 0.9, dur = 240): Layer {
  return { type: "shape", id, shape: "rect", width, height, fill: color, startMs: t - 30, endMs: t + dur, transform: { opacity: [{ timeMs: t - 30, value: 0 }, { timeMs: t + 26, value: max }, { timeMs: t + 110, value: max * 0.25 }, { timeMs: t + dur, value: 0 }] } };
}

const fadeExit = (s: number, fadeIn = 90): ScalarKeyframe[] => [{ timeMs: s, value: 0 }, { timeMs: s + fadeIn, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 200, value: 0 }];

// diagonal colour block that wipes in from off-axis, fades at exit
function diagBlock(id: string, s: number, w: number, h: number, x: number, fromY: number, toY: number, fill: string, rot: number): Layer {
  return rect(id, s, exitAt + 220, x, track(s, 460, fromY, toY, easeOutCubic), w, h, fill, fadeExit(s), rot);
}

// huge title line sliding in from a side with overshoot, exits upward
function slamSide(id: string, t: string, baseline: number, size: number, fromX: number, x: number, t0: number, outlined: boolean): Layer {
  const xk: ScalarKeyframe[] = [{ timeMs: t0, value: fromX }, ...track(t0 + 40, 380, fromX, x, easeOutBack, 6)];
  const op: ScalarKeyframe[] = [{ timeMs: t0, value: 0 }, { timeMs: t0 + 70, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 210, value: 0 }];
  const style: TextStyle = outlined ? { stroke: dark, strokeWidth: 4 } : {};
  return text(id, t, xk, baseline, size, white, t0, exitAt + 230, op, QINGKE, style);
}

function band(id: string, s: number, e: number, trim: number): Layer[] {
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + 70, value: 1 }];
  return [
    rect(`${id}-f`, s, e, bandX - 8, bandY - 8, bandW + 16, bandH + 16, lime, op),
    rect(`${id}-f2`, s, e, bandX - 3, bandY - 3, bandW + 6, bandH + 6, dark, op),
    { type: "video", id, src: SRC, startMs: s, endMs: e, trimStartMs: trim, width: bandW, height: bandH, transform: { x: bandX, y: bandY, opacity: op } },
    rect(`${id}-bar`, s, e, bandX, bandY + bandH + 8, 220, 8, orange, op)
  ];
}
function caption(t: string, s: number, e: number): Layer[] {
  const size = 38, pad = 16;
  const w = textWidth(t, size) + pad * 2, x = (width - w) / 2, y = 930;
  const op: ScalarKeyframe[] = [{ timeMs: s, value: 0 }, { timeMs: s + 60, value: 1 }, { timeMs: e - 120, value: 1 }, { timeMs: e, value: 0 }];
  return [rect("cap-blk", s, e, x, y, w, size * 1.25, lime, op), text("cap-txt", t, x + pad, y + size * 0.95, size, dark, s, e, op, QINGKE)];
}

const epkW = textWidth("EP.12", 24) + 28;

export default defineComposition({
  fps, width, height, durationMs, defaultFont: HEITI,
  layers: [
    rect("bg", 0, durationMs, 0, 0, width, height, dark),
    { type: "audio", id: "bgm", src: BGM, startMs: 0, endMs: durationMs, volume: 0.6, fadeInMs: 250, fadeOutMs: 800 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEnd + 150, volume: 0.55, fadeInMs: 200, fadeOutMs: 500 },

    // diagonal colour slabs
    diagBlock("cobalt", 100, 960, 300, -120, -160, 110, cobalt, -12),
    diagBlock("lime", 250, 960, 250, -120, 560, 720, lime, -12),
    diagBlock("orange", 520, 360, 200, 440, 1320, 1120, orange, -12),
    // ghost number
    text("ghost", "12", 430, 360, 320, "rgba(255,255,255,0.12)", 320, exitAt + 220, fadeExit(320), QINGKE),
    // speed lines
    rect("sl1", 560, exitAt + 220, track(560, 420, -300, 30, easeOutCubic), 250, 380, 5, "rgba(255,255,255,0.85)", fadeExit(560)),
    rect("sl2", 600, exitAt + 220, track(600, 420, -300, 30, easeOutCubic), 268, 240, 5, "rgba(255,255,255,0.85)", fadeExit(600)),
    rect("sl3", 640, exitAt + 220, track(640, 420, -300, 30, easeOutCubic), 286, 460, 5, "rgba(255,255,255,0.85)", fadeExit(640)),
    // sysrow
    rect("sys-k", 200, exitAt + 220, 30, 58, epkW, 38, lime, fadeExit(200)),
    text("sys-ep", "EP.12", 44, 84, 24, dark, 200, exitAt + 220, fadeExit(200)),
    text("sys-on", "// 运动挑战", width - 30 - textWidth("// 运动挑战", 22), 84, 22, lime, 240, exitAt + 220, fadeExit(240)),
    text("latin", "FULL SPEED >>", 30, 176, 26, "rgba(255,255,255,0.85)", 520, exitAt + 220, fadeExit(520), QINGKE),
    // title
    slamSide("s1", "全力", 470, 150, -160, 40, 600, false),
    slamSide("s2", "冲刺", 632, 150, width + 160, 40, 760, true),
    // chevrons
    text("chev", ">>>", 40, 880, 70, orange, 1000, exitAt + 220, fadeExit(1000), QINGKE),
    // handle
    { type: "shape", id: "h-av", shape: "circle", radius: 16, fill: lime, startMs: 1100, endMs: exitAt + 220, transform: { x: 46, y: 1170, opacity: fadeExit(1100) } },
    text("h-id", "@你的ID", 84, 1188, 30, white, 1100, exitAt + 220, fadeExit(1100)),

    // diagonal slab transition
    rect("wipe", exitAt, videoStart + 120, track(exitAt, 420, -width - 200, width + 200, easeOutCubic), -100, 520, height + 200, lime, [{ timeMs: exitAt, value: 1 }, { timeMs: videoStart + 120, value: 1 }], -14),
    flash("t-flash", videoStart, white, 0.85, 220),

    // body
    ...band("clip1", videoStart, bodyEnd, 5000),
    ...caption("全力冲刺 不留余力", videoStart + 250, bodyEnd - 120),
    { type: "shape", id: "bh-av", shape: "circle", radius: 16, fill: lime, startMs: videoStart, endMs: durationMs, transform: { x: 46, y: 1182, opacity: 1 } },
    text("bh-id", "@你的ID", 84, 1200, 30, white, videoStart, durationMs, 1),
    rect("final-fade", durationMs - 300, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 300, value: 0 }, { timeMs: durationMs, value: 1 }])
  ]
});
