import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "赛博故障霓虹 · CYBER GLITCH" — vertical (9:16) opener with an RGB-split
// glitch title over a synthwave grid (examples/assets/cyber-bg.mp4), that
// glitch-cuts into the main video (framed neon band over the grid) with
// captions, and a glitch end-card. Heavy gothic font (per-layer), no outlines.
// ---------------------------------------------------------------------------

const width = 720;
const height = 1280;
const fps = 30;

const cyan = "#1ff0ff";
const magenta = "#ff21d0";
const white = "#ffffff";
const ink = "#06070d";
const GOTHIC = "/System/Library/Fonts/STHeiti Medium.ttc";
const BG = "examples/assets/cyber-bg.mp4";
const SRC = "examples/demo.mp4";

const exitAt = 2400;
const videoStart = 2720;
const cut2 = 5100;
const bodyEnd = 7500;
const outroAt = 7500;
const durationMs = 9600;

const bandX = 0, bandY = 436, bandW = 720, bandH = 408;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
function track(startMs: number, durMs: number, from: number, to: number, ease: (t: number) => number, steps = 6): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  for (let i = 0; i <= steps; i += 1) { const p = i / steps; kf.push({ timeMs: Math.round(startMs + durMs * p), value: from + (to - from) * ease(p) }); }
  return kf;
}
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

function text(id: string, t: string, x: number | ScalarKeyframe[], y: number, size: number, color: string, startMs: number, endMs: number, opacity: number | ScalarKeyframe[] = 1, font?: string): Layer {
  return { type: "text", id, text: t, size, color, ...(font ? { font } : {}), startMs, endMs, transform: { x, y, opacity } };
}
function rect(id: string, startMs: number, endMs: number, x: number, y: number, w: number, h: number, fill: string, opacity: number | ScalarKeyframe[] = 1, blur?: number): Layer {
  return { type: "shape", id, shape: "rect", width: w, height: h, fill, ...(blur ? { blur } : {}), startMs, endMs, transform: { x, y, opacity } };
}
function strokeRect(id: string, startMs: number, endMs: number, x: number, y: number, w: number, h: number, color: string, sw: number, opacity: number | ScalarKeyframe[] = 1, blur?: number): Layer {
  return { type: "shape", id, shape: "rect", width: w, height: h, stroke: color, strokeWidth: sw, fill: ink, ...(blur ? { blur } : {}), startMs, endMs, transform: { x, y, opacity } };
}

function jitterX(base: number, amp: number, t0: number, endAt: number, period = 110): ScalarKeyframe[] {
  const kf: ScalarKeyframe[] = [];
  let i = 0;
  for (let tt = t0; tt <= endAt; tt += period) { kf.push({ timeMs: tt, value: base + (i % 2 === 0 ? amp : -amp) }); i += 1; }
  return kf;
}

// RGB-split glitch word with flicker-in and fade-out at endAt
function glitchWord(id: string, t: string, baseline: number, size: number, t0: number, endAt: number): Layer[] {
  const x = centerX(t, size);
  const main: ScalarKeyframe[] = [
    { timeMs: t0, value: 0 }, { timeMs: t0 + 55, value: 1 }, { timeMs: t0 + 90, value: 0.2 }, { timeMs: t0 + 140, value: 1 },
    { timeMs: t0 + 190, value: 0.45 }, { timeMs: t0 + 240, value: 1 }, { timeMs: endAt, value: 1 }, { timeMs: endAt + 220, value: 0 }
  ];
  const side = (delay: number): ScalarKeyframe[] => [{ timeMs: t0, value: 0 }, { timeMs: t0 + delay, value: 0.85 }, { timeMs: endAt, value: 0.85 }, { timeMs: endAt + 200, value: 0 }];
  return [
    text(`${id}-m`, t, jitterX(x - 6, 3, t0 + 240, endAt), baseline, size, magenta, t0, endAt + 240, side(90), GOTHIC),
    text(`${id}-c`, t, jitterX(x + 6, 3, t0 + 240, endAt, 130), baseline, size, cyan, t0, endAt + 240, side(110), GOTHIC),
    text(`${id}-w`, t, x, baseline, size, white, t0, endAt + 240, main, GOTHIC)
  ];
}

// brief RGB-split full-frame glitch hit
function glitchHit(idp: string, t: number): Layer[] {
  const op: ScalarKeyframe[] = [{ timeMs: t - 30, value: 0 }, { timeMs: t + 20, value: 0.4 }, { timeMs: t + 70, value: 0.08 }, { timeMs: t + 120, value: 0.34 }, { timeMs: t + 200, value: 0 }];
  return [
    rect(`${idp}-m`, t - 30, t + 220, -10, 0, width, height, magenta, op),
    rect(`${idp}-c`, t - 30, t + 220, 10, 0, width, height, cyan, op),
    rect(`${idp}-w`, t, t + 160, 0, 0, width, height, white, [{ timeMs: t, value: 0 }, { timeMs: t + 26, value: 0.7 }, { timeMs: t + 160, value: 0 }])
  ];
}

// framed neon video band + scanline tint
function band(id: string, startMs: number, endMs: number, trim: number): Layer[] {
  const op: ScalarKeyframe[] = [{ timeMs: startMs, value: 0 }, { timeMs: startMs + 70, value: 1 }];
  return [
    strokeRect(`${id}-glow`, startMs, endMs, bandX - 8, bandY - 8, bandW + 16, bandH + 16, cyan, 10, op.map((k) => ({ timeMs: k.timeMs, value: k.value * 0.6 })), 16),
    { type: "video", id, src: SRC, startMs, endMs, trimStartMs: trim, width: bandW, height: bandH, transform: { x: bandX, y: bandY, opacity: op } },
    strokeRect(`${id}-frame`, startMs, endMs, bandX - 4, bandY - 4, bandW + 8, bandH + 8, cyan, 3, op),
    rect(`${id}-mbar`, startMs, endMs, bandX - 4, bandY + bandH + 6, 200, 6, magenta, op, 5)
  ];
}

function caption(id: string, t: string, startMs: number, endMs: number): Layer[] {
  const size = 34, pad = 16;
  const w = textWidth(t, size) + pad * 2;
  const x = (width - w) / 2;
  const y = 980;
  const op: ScalarKeyframe[] = [{ timeMs: startMs, value: 0 }, { timeMs: startMs + 70, value: 1 }, { timeMs: endMs - 120, value: 1 }, { timeMs: endMs, value: 0 }];
  return [
    rect(`${id}-bar`, startMs, endMs, x, y, w, size * 1.3, "rgba(6,7,13,0.7)", op),
    rect(`${id}-edge`, startMs, endMs, x, y, 5, size * 1.3, cyan, op),
    text(`${id}-txt`, t, x + pad + 6, y + size, size, cyan, startMs, endMs, op, GOTHIC)
  ];
}

const onlineW = textWidth("ONLINE", 22);

export default defineComposition({
  defaultFont: "/System/Library/Fonts/STHeiti Medium.ttc",
  fps, width, height, durationMs,
  layers: [
    rect("base", 0, durationMs, 0, 0, width, height, ink),
    { type: "video", id: "bg", src: BG, startMs: 0, endMs: durationMs, trimStartMs: 0, width, height, transform: { x: 0, y: 0, opacity: [{ timeMs: 0, value: 0 }, { timeMs: 200, value: 1 }] } },
    { type: "audio", id: "bgm", src: "examples/assets/bgm-cyber.m4a", startMs: 0, endMs: durationMs, volume: 0.55, fadeInMs: 300, fadeOutMs: 900 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEnd + 150, volume: 0.6, fadeInMs: 200, fadeOutMs: 500 },

    // system row + handle (persist)
    text("sys-l", "SYSTEM //", 40, 92, 22, cyan, 150, durationMs, [{ timeMs: 150, value: 0 }, { timeMs: 320, value: 1 }], GOTHIC),
    { type: "shape", id: "sys-dot", shape: "circle", radius: 7, fill: magenta, blur: 5, startMs: 150, endMs: durationMs, transform: { x: width - 56 - onlineW - 18, y: 78, opacity: [{ timeMs: 150, value: 0 }, { timeMs: 320, value: 1 }] } },
    text("sys-r", "ONLINE", width - 40 - onlineW, 92, 22, magenta, 150, durationMs, [{ timeMs: 150, value: 0 }, { timeMs: 320, value: 1 }], GOTHIC),
    text("handle", "@你的ID", centerX("@你的ID", 26), 1190, 26, cyan, 1050, durationMs, [{ timeMs: 1050, value: 0 }, { timeMs: 1200, value: 1 }], GOTHIC),

    // opener glitch title (fades out at exit)
    ...glitchWord("gw1", "未来", 432, 132, 300, exitAt),
    ...glitchWord("gw2", "已来", 600, 132, 520, exitAt),
    text("sub", "THE FUTURE IS NOW", centerX("THE FUTURE IS NOW", 30), 686, 30, white, 820, exitAt + 200, [{ timeMs: 820, value: 0 }, { timeMs: 980, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 200, value: 0 }], GOTHIC),
    rect("bar1", 560, exitAt + 200, 60, 742, width - 120, 8, cyan, [{ timeMs: 560, value: 0 }, { timeMs: 620, value: 0.85 }, { timeMs: 760, value: 0.18 }, { timeMs: 900, value: 0.32 }, { timeMs: exitAt, value: 0.32 }, { timeMs: exitAt + 200, value: 0 }]),

    // glitch-cut into the video
    ...glitchHit("t", videoStart),

    // body: framed neon video band + captions (two clips, glitch beat cut)
    ...band("clip1", videoStart, cut2, 5000),
    ...band("clip2", cut2, bodyEnd, 60000),
    ...caption("cap1", "霓虹都市 · 进入现场", videoStart + 260, cut2 - 120),
    ...caption("cap2", "全程 CPU 渲染合成", cut2 + 160, bodyEnd - 120),
    ...glitchHit("cut", cut2),

    // outro glitch card
    rect("o-bg", outroAt, durationMs, 0, 0, width, height, ink, [{ timeMs: outroAt, value: 0 }, { timeMs: outroAt + 200, value: 0.55 }, { timeMs: durationMs, value: 0.55 }]),
    ...glitchWord("o1", "敬请", 540, 120, outroAt + 200, durationMs - 200),
    ...glitchWord("o2", "期待", 700, 120, outroAt + 380, durationMs - 200),
    text("o-id", "@你的ID", centerX("@你的ID", 30), 860, 30, cyan, outroAt + 700, durationMs, [{ timeMs: outroAt + 700, value: 0 }, { timeMs: outroAt + 820, value: 1 }], GOTHIC),
    rect("final-fade", durationMs - 320, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 320, value: 0 }, { timeMs: durationMs, value: 1 }])
  ]
});
