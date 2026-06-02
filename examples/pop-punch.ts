import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "活力撞色大字 · POP PUNCH" — vertical (9:16) opener that slams in a big
// solid-block title, then block-wipes into the main video (shown in a framed
// 16:9 band over the punchy background) with captions, and a block end-card.
// Flat clashing colours, solid fills, no outlines. Cartoon font default.
// ---------------------------------------------------------------------------

const width = 720;
const height = 1280;
const fps = 30;

const blue = "#2433ff";
const acid = "#eaff00";
const pink = "#ff2e88";
const white = "#ffffff";
const black = "#141414";

const SRC = "examples/demo.mp4";

// timeline
const exitAt = 2300;          // title leaves
const videoStart = 2620;      // framed video band comes in
const cut2 = 5060;
const bodyEnd = 7460;
const outroAt = 7460;
const durationMs = 9300;

// framed video band (16:9 inside the 9:16 frame)
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

function rect(id: string, startMs: number, endMs: number, x: number | ScalarKeyframe[], y: number | ScalarKeyframe[], w: number, h: number, fill: string, opacity: number | ScalarKeyframe[] = 1, rotate: number | ScalarKeyframe[] = 0): Layer {
  return { type: "shape", id, shape: "rect", width: w, height: h, fill, startMs, endMs, transform: { x, y, opacity, rotate } };
}
function text(id: string, t: string, x: number | ScalarKeyframe[], y: number | ScalarKeyframe[], size: number, color: string, startMs: number, endMs: number, opacity: number | ScalarKeyframe[] = 1, style: TextStyle = {}): Layer {
  return { type: "text", id, text: t, size, color, startMs, endMs, ...style, transform: { x, y, opacity } };
}

// slam-in (overshoot) then fly-up-out, for an absolute y target
function lineY(target: number, t0: number): ScalarKeyframe[] {
  return [{ timeMs: t0, value: target - 66 }, { timeMs: t0 + 170, value: target + 13 }, { timeMs: t0 + 262, value: target - 4 }, { timeMs: t0 + 360, value: target }, { timeMs: exitAt, value: target }, { timeMs: exitAt + 240, value: target - 150 }];
}
const lineOp = (t0: number): ScalarKeyframe[] => [{ timeMs: t0, value: 0 }, { timeMs: t0 + 50, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }];

function slamLine(id: string, t: string, baseline: number, size: number, blockColor: string, textColor: string, t0: number): Layer[] {
  const pad = 24, x = 48;
  const w = textWidth(t, size) + pad * 2;
  const blockTop = baseline - size * 0.84;
  const h = size * 1.16;
  return [
    rect(`${id}-blk`, t0, exitAt + 260, x - pad, lineY(blockTop, t0), w, h, blockColor, lineOp(t0)),
    text(`${id}-txt`, t, x, lineY(baseline, t0), size, textColor, t0, exitAt + 260, lineOp(t0))
  ];
}

// halftone dot field (whole duration)
const halftone: Layer[] = [];
for (let gy = 8; gy < height; gy += 56) {
  for (let gx = 8; gx < width; gx += 56) {
    halftone.push({ type: "shape", id: `ht-${gx}-${gy}`, shape: "circle", radius: 2.3, fill: white, startMs: 0, endMs: durationMs, transform: { x: gx, y: gy, opacity: 0.1 } });
  }
}

// acid circle pop (centre-compensated), fades at exit
const acx = 70, acy = 320, ar = 120;
const acidScale: ScalarKeyframe[] = [{ timeMs: 250, value: 0.2 }, { timeMs: 500, value: 1.15 }, { timeMs: 650, value: 1 }];
const acidLayer: Layer = {
  type: "shape", id: "acid", shape: "circle", radius: ar, fill: acid, startMs: 250, endMs: exitAt + 260,
  transform: {
    x: acidScale.map((k) => ({ timeMs: k.timeMs, value: acx - ar * k.value })),
    y: acidScale.map((k) => ({ timeMs: k.timeMs, value: acy - ar * k.value })),
    scale: acidScale,
    opacity: [{ timeMs: 250, value: 0 }, { timeMs: 300, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }]
  }
};

const epW = textWidth("EP.07", 30) + 24;

// solid-block caption (pink block + white text), no outline
function capBlock(id: string, t: string, startMs: number, endMs: number): Layer[] {
  const size = 40, pad = 18;
  const w = textWidth(t, size) + pad * 2;
  const x = (width - w) / 2;
  const y = 980;
  const op: ScalarKeyframe[] = [{ timeMs: startMs, value: 0 }, { timeMs: startMs + 60, value: 1 }, { timeMs: endMs - 120, value: 1 }, { timeMs: endMs, value: 0 }];
  return [
    rect(`${id}-blk`, startMs, endMs, x, y, w, size * 1.2, pink, op),
    text(`${id}-txt`, t, x + pad, y + size * 0.92, size, white, startMs, endMs, op)
  ];
}

// framed video band: acid + pink offset frame, slammed in with a flash
function band(id: string, startMs: number, endMs: number, trim: number): Layer[] {
  const op: ScalarKeyframe[] = [{ timeMs: startMs, value: 0 }, { timeMs: startMs + 70, value: 1 }];
  return [
    rect(`${id}-f1`, startMs, endMs, bandX - 14, bandY - 14, bandW + 28, bandH + 28, acid, op),
    rect(`${id}-f2`, startMs, endMs, bandX - 6, bandY - 6, bandW + 12, bandH + 12, pink, op),
    { type: "video", id, src: SRC, startMs, endMs, trimStartMs: trim, width: bandW, height: bandH, transform: { x: bandX, y: bandY, opacity: op } }
  ];
}

function flash(id: string, t: number, color: string, max = 0.9, dur = 240): Layer {
  return { type: "shape", id, shape: "rect", width, height, fill: color, startMs: t - 30, endMs: t + dur, transform: { opacity: [{ timeMs: t - 30, value: 0 }, { timeMs: t + 28, value: max }, { timeMs: t + 110, value: max * 0.25 }, { timeMs: t + dur, value: 0 }] } };
}

export default defineComposition({
  defaultFont: "examples/assets/ZCOOLKuaiLe-Regular.ttf",
  fps, width, height, durationMs,
  layers: [
    rect("bg", 0, durationMs, 0, 0, width, height, blue),
    ...halftone,
    { type: "audio", id: "bgm", src: "examples/assets/bgm-pop.m4a", startMs: 0, endMs: durationMs, volume: 0.55, fadeInMs: 300, fadeOutMs: 900 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEnd + 150, volume: 0.6, fadeInMs: 200, fadeOutMs: 500 },

    // persistent top tag + handle (whole duration)
    rect("ep-blk", 380, durationMs, 48, track(380, 360, 66 - 12, 66, easeOutCubic), epW, 44, acid, [{ timeMs: 380, value: 0 }, { timeMs: 440, value: 1 }]),
    text("ep-txt", "EP.07", 60, track(380, 360, 98 - 12, 98, easeOutCubic), 30, blue, 380, durationMs, [{ timeMs: 380, value: 0 }, { timeMs: 440, value: 1 }]),
    text("note", "// 美食探店", 60 + epW, track(520, 360, 98 - 14, 98, easeOutCubic), 26, white, 520, durationMs, [{ timeMs: 520, value: 0 }, { timeMs: 580, value: 1 }]),
    { type: "shape", id: "h-dot", shape: "circle", radius: 18, fill: acid, startMs: 1350, endMs: durationMs, transform: { x: 48, y: 1176, opacity: [{ timeMs: 1350, value: 0 }, { timeMs: 1410, value: 1 }] } },
    text("h-id", "@你的ID", 92, 1204, 34, white, 1350, durationMs, [{ timeMs: 1350, value: 0 }, { timeMs: 1410, value: 1 }]),

    // intro decor + title (fly out at exit)
    rect("pink", 100, exitAt + 260, track(100, 520, width + 40, width - 250, easeOutCubic), -60, 320, 320, pink, [{ timeMs: 100, value: 0 }, { timeMs: 190, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }], 18),
    acidLayer,
    ...slamLine("l1", "今天", 372, 120, white, blue, 600),
    ...slamLine("l2", "到底", 512, 120, acid, black, 760),
    ...slamLine("l3", "吃什么", 646, 104, pink, white, 920),
    text("bang", "!?", 542, lineY(1070, 1150)[3]!.value, 110, acid, 1150, exitAt + 260,
      [{ timeMs: 1150, value: 0 }, { timeMs: 1230, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }],
      { shadowColor: pink, shadowDx: 7, shadowDy: 7, shadowBlur: 0 }),

    // block-wipe transition into the video
    rect("wipe", 2360, 2900, track(2360, 360, -width - 60, width + 60, easeOutCubic), 0, width + 60, height, acid, [{ timeMs: 2360, value: 1 }, { timeMs: 2900, value: 1 }], -6),
    flash("t-flash", videoStart, white, 0.85, 220),

    // body: framed video band + captions (two clips, beat cut)
    ...band("clip1", videoStart, cut2, 5000),
    ...band("clip2", cut2, bodyEnd, 60000),
    ...capBlock("cap1", "重庆小面 · 灵魂在油辣子", videoStart + 250, cut2 - 120),
    ...capBlock("cap2", "这一口 · 直接封神！", cut2 + 150, bodyEnd - 120),
    flash("cut-flash", cut2, white, 0.7, 180),
    rect("cut-blk", cut2 - 20, cut2 + 320, track(cut2 - 20, 300, width + 40, -width, easeOutCubic), 0, width, height, pink, [{ timeMs: cut2 - 20, value: 1 }, { timeMs: cut2 + 320, value: 1 }], 6),

    // outro block card
    rect("o-bg", outroAt, durationMs, 0, 0, width, height, blue, [{ timeMs: outroAt, value: 0 }, { timeMs: outroAt + 200, value: 1 }]),
    ...halftone.map((l, i) => ({ ...l, id: `o-ht-${i}`, startMs: outroAt, endMs: durationMs })),
    ...slamLineOutro("o1", "下期", 560, 120, acid, black, outroAt + 200),
    ...slamLineOutro("o2", "不见不散", 700, 96, white, blue, outroAt + 360),
    text("o-bang", "!", 470, 800, 110, pink, outroAt + 560, durationMs, [{ timeMs: outroAt + 560, value: 0 }, { timeMs: outroAt + 640, value: 1 }], { shadowColor: acid, shadowDx: 7, shadowDy: 7, shadowBlur: 0 }),
    { type: "shape", id: "o-dot", shape: "circle", radius: 18, fill: acid, startMs: outroAt + 700, endMs: durationMs, transform: { x: centerX("@你的ID", 34) - 44, y: 940, opacity: [{ timeMs: outroAt + 700, value: 0 }, { timeMs: outroAt + 760, value: 1 }] } },
    text("o-id", "@你的ID", centerX("@你的ID", 34), 968, 34, white, outroAt + 700, durationMs, [{ timeMs: outroAt + 700, value: 0 }, { timeMs: outroAt + 760, value: 1 }]),
    rect("final-fade", durationMs - 320, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 320, value: 0 }, { timeMs: durationMs, value: 1 }])
  ]
});

// outro slam (no fly-out)
function slamLineOutro(id: string, t: string, baseline: number, size: number, blockColor: string, textColor: string, t0: number): Layer[] {
  const pad = 24;
  const w = textWidth(t, size) + pad * 2;
  const x = (width - w) / 2 + pad;
  const yk = (target: number): ScalarKeyframe[] => [{ timeMs: t0, value: target - 66 }, { timeMs: t0 + 170, value: target + 13 }, { timeMs: t0 + 262, value: target - 4 }, { timeMs: t0 + 360, value: target }];
  const op: ScalarKeyframe[] = [{ timeMs: t0, value: 0 }, { timeMs: t0 + 50, value: 1 }];
  const blockTop = baseline - size * 0.84;
  return [
    rect(`${id}-blk`, t0, durationMs, x - pad, yk(blockTop), w, size * 1.16, blockColor, op),
    text(`${id}-txt`, t, x, yk(baseline), size, textColor, t0, durationMs, op)
  ];
}
