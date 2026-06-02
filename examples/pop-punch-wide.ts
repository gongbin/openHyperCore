import { defineComposition } from "../packages/core/src/index.ts";
import type { Layer, ScalarKeyframe, TextStyle } from "../packages/core/src/index.ts";

// ---------------------------------------------------------------------------
// "活力撞色大字 · POP PUNCH (16:9)" — landscape variant. The big solid-block
// title slams in, block-wipes out, then the main video plays FULL-FRAME (its
// native landscape fits naturally) with pop chrome + captions, into a block
// end-card. Flat clashing colours, solid fills, no outlines. Cartoon font.
// ---------------------------------------------------------------------------

const width = 1280;
const height = 720;
const fps = 30;

const blue = "#2433ff";
const acid = "#eaff00";
const pink = "#ff2e88";
const white = "#ffffff";
const black = "#141414";

const SRC = "examples/demo.mp4";

const exitAt = 2300;
const videoStart = 2620;
const cut2 = 5060;
const bodyEnd = 7460;
const outroAt = 7460;
const durationMs = 9300;

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

// slam-in (overshoot) then fly-up-out
function lineY(target: number, t0: number): ScalarKeyframe[] {
  return [{ timeMs: t0, value: target - 66 }, { timeMs: t0 + 170, value: target + 13 }, { timeMs: t0 + 262, value: target - 4 }, { timeMs: t0 + 360, value: target }, { timeMs: exitAt, value: target }, { timeMs: exitAt + 240, value: target - 150 }];
}
const lineOp = (t0: number): ScalarKeyframe[] => [{ timeMs: t0, value: 0 }, { timeMs: t0 + 50, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }];

function slamLine(id: string, t: string, baseline: number, size: number, blockColor: string, textColor: string, t0: number, x = 72): Layer[] {
  const pad = 24;
  const w = textWidth(t, size) + pad * 2;
  const blockTop = baseline - size * 0.84;
  const h = size * 1.16;
  return [
    rect(`${id}-blk`, t0, exitAt + 260, x - pad, lineY(blockTop, t0), w, h, blockColor, lineOp(t0)),
    text(`${id}-txt`, t, x, lineY(baseline, t0), size, textColor, t0, exitAt + 260, lineOp(t0))
  ];
}

// halftone field
const halftone: Layer[] = [];
for (let gy = 8; gy < height; gy += 56) {
  for (let gx = 8; gx < width; gx += 56) {
    halftone.push({ type: "shape", id: `ht-${gx}-${gy}`, shape: "circle", radius: 2.3, fill: white, startMs: 0, endMs: durationMs, transform: { x: gx, y: gy, opacity: 0.1 } });
  }
}

// acid circle pop (centre-compensated), fades at exit
const acx = 70, acy = 660, ar = 120;
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

// full-frame video with a centre-compensated punch-in
function videoSeg(id: string, startMs: number, endMs: number, trim: number, fromScale = 1.12, zoomDur = 620): Layer {
  return {
    type: "video", id, src: SRC, startMs, endMs, trimStartMs: trim, width, height,
    transform: {
      scale: track(startMs, zoomDur, fromScale, 1, easeOutCubic, 6),
      x: track(startMs, zoomDur, (width / 2) * (1 - fromScale), 0, easeOutCubic, 6),
      y: track(startMs, zoomDur, (height / 2) * (1 - fromScale), 0, easeOutCubic, 6),
      opacity: [{ timeMs: startMs, value: 0 }, { timeMs: startMs + 60, value: 1 }]
    }
  };
}

// solid-block caption (pink block + white text), bottom-centre
function capBlock(id: string, t: string, startMs: number, endMs: number): Layer[] {
  const size = 42, pad = 20;
  const w = textWidth(t, size) + pad * 2;
  const x = (width - w) / 2;
  const y = 600;
  const op: ScalarKeyframe[] = [{ timeMs: startMs, value: 0 }, { timeMs: startMs + 60, value: 1 }, { timeMs: endMs - 120, value: 1 }, { timeMs: endMs, value: 0 }];
  return [
    rect(`${id}-blk`, startMs, endMs, x, y, w, size * 1.25, pink, op),
    text(`${id}-txt`, t, x + pad, y + size * 0.96, size, white, startMs, endMs, op)
  ];
}

function flash(id: string, t: number, color: string, max = 0.9, dur = 240): Layer {
  return { type: "shape", id, shape: "rect", width, height, fill: color, startMs: t - 30, endMs: t + dur, transform: { opacity: [{ timeMs: t - 30, value: 0 }, { timeMs: t + 28, value: max }, { timeMs: t + 110, value: max * 0.25 }, { timeMs: t + dur, value: 0 }] } };
}

function slamLineOutro(id: string, t: string, baseline: number, size: number, blockColor: string, textColor: string, t0: number): Layer[] {
  const pad = 24;
  const w = textWidth(t, size) + pad * 2;
  const x = (width - w) / 2 + pad;
  const yk = (target: number): ScalarKeyframe[] => [{ timeMs: t0, value: target - 66 }, { timeMs: t0 + 170, value: target + 13 }, { timeMs: t0 + 262, value: target - 4 }, { timeMs: t0 + 360, value: target }];
  const op: ScalarKeyframe[] = [{ timeMs: t0, value: 0 }, { timeMs: t0 + 50, value: 1 }];
  return [
    rect(`${id}-blk`, t0, durationMs, x - pad, yk(baseline - size * 0.84), w, size * 1.16, blockColor, op),
    text(`${id}-txt`, t, x, yk(baseline), size, textColor, t0, durationMs, op)
  ];
}

// pop chrome over the full-frame video (edge bars + tag + handle + caption)
const bodyOp: ScalarKeyframe[] = [{ timeMs: videoStart, value: 0 }, { timeMs: videoStart + 70, value: 1 }, { timeMs: bodyEnd - 100, value: 1 }, { timeMs: bodyEnd, value: 0 }];

export default defineComposition({
  defaultFont: "examples/assets/ZCOOLKuaiLe-Regular.ttf",
  fps, width, height, durationMs,
  layers: [
    rect("bg", 0, durationMs, 0, 0, width, height, blue),
    ...halftone,
    { type: "audio", id: "bgm", src: "examples/assets/bgm-pop.m4a", startMs: 0, endMs: durationMs, volume: 0.55, fadeInMs: 300, fadeOutMs: 900 },
    { type: "audio", id: "reel-audio", src: SRC, startMs: videoStart, endMs: bodyEnd + 150, volume: 0.6, fadeInMs: 200, fadeOutMs: 500 },

    // intro decor + title (fly out at exit)
    rect("pink", 100, exitAt + 260, track(100, 520, width + 40, width - 360, easeOutCubic), -60, 360, 360, pink, [{ timeMs: 100, value: 0 }, { timeMs: 190, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }], 18),
    acidLayer,
    text("ep-txt", "EP.07", 84, track(380, 360, 92 - 12, 92, easeOutCubic), 30, blue, 380, exitAt + 260, [{ timeMs: 380, value: 0 }, { timeMs: 440, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }]),
    rect("ep-blk", 380, exitAt + 260, 72, track(380, 360, 60 - 12, 60, easeOutCubic), epW, 44, acid, [{ timeMs: 380, value: 0 }, { timeMs: 440, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }]),
    text("note", "// 美食探店", 84 + epW, track(520, 360, 92 - 14, 92, easeOutCubic), 26, white, 520, exitAt + 260, [{ timeMs: 520, value: 0 }, { timeMs: 580, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }]),
    ...slamLine("l1", "今天", 248, 112, white, blue, 600),
    ...slamLine("l2", "到底", 384, 112, acid, black, 760),
    ...slamLine("l3", "吃什么", 516, 96, pink, white, 920),
    text("bang", "!?", 690, lineY(470, 1150)[3]!.value, 120, acid, 1150, exitAt + 260,
      [{ timeMs: 1150, value: 0 }, { timeMs: 1230, value: 1 }, { timeMs: exitAt, value: 1 }, { timeMs: exitAt + 230, value: 0 }],
      { shadowColor: pink, shadowDx: 8, shadowDy: 8, shadowBlur: 0 }),

    // block-wipe transition
    rect("wipe", 2360, 2900, track(2360, 360, -width - 60, width + 60, easeOutCubic), 0, width + 60, height, acid, [{ timeMs: 2360, value: 1 }, { timeMs: 2900, value: 1 }], -4),
    flash("t-flash", videoStart, white, 0.85, 220),

    // body: full-frame video (two clips, beat cut)
    videoSeg("clip1", videoStart, cut2, 5000),
    videoSeg("clip2", cut2, bodyEnd, 60000),
    // pop chrome
    rect("bar-top", videoStart, bodyEnd, 0, 0, width, 12, acid, bodyOp),
    rect("bar-bot", videoStart, bodyEnd, 0, height - 12, width, 12, pink, bodyOp),
    rect("tag2-blk", videoStart, bodyEnd, 36, 36, epW, 44, acid, bodyOp),
    text("tag2-txt", "EP.07", 48, 68, 30, blue, videoStart, bodyEnd, bodyOp),
    text("note2", "// 美食探店", 48 + epW, 68, 26, white, videoStart, bodyEnd, bodyOp),
    { type: "shape", id: "h-dot", shape: "circle", radius: 16, fill: acid, startMs: videoStart, endMs: bodyEnd, transform: { x: width - 220, y: 52, opacity: bodyOp } },
    text("h-id", "@你的ID", width - 192, 70, 30, white, videoStart, bodyEnd, bodyOp),
    ...capBlock("cap1", "重庆小面 · 灵魂在油辣子", videoStart + 250, cut2 - 120),
    ...capBlock("cap2", "这一口 · 直接封神！", cut2 + 150, bodyEnd - 120),
    flash("cut-flash", cut2, white, 0.7, 180),
    rect("cut-blk", cut2 - 20, cut2 + 340, track(cut2 - 20, 320, width + 40, -width, easeOutCubic), 0, width, height, pink, [{ timeMs: cut2 - 20, value: 1 }, { timeMs: cut2 + 340, value: 1 }], 4),

    // outro block card
    rect("o-bg", outroAt, durationMs, 0, 0, width, height, blue, [{ timeMs: outroAt, value: 0 }, { timeMs: outroAt + 200, value: 1 }]),
    ...halftone.map((l, i) => ({ ...l, id: `o-ht-${i}`, startMs: outroAt, endMs: durationMs })),
    ...slamLineOutro("o1", "下期", 320, 110, acid, black, outroAt + 200),
    ...slamLineOutro("o2", "不见不散", 456, 92, white, blue, outroAt + 360),
    text("o-bang", "!", centerX("不见不散", 92) + textWidth("不见不散", 92) + 30, 556, 110, pink, outroAt + 560, durationMs, [{ timeMs: outroAt + 560, value: 0 }, { timeMs: outroAt + 640, value: 1 }], { shadowColor: acid, shadowDx: 8, shadowDy: 8, shadowBlur: 0 }),
    { type: "shape", id: "o-dot", shape: "circle", radius: 17, fill: acid, startMs: outroAt + 700, endMs: durationMs, transform: { x: centerX("@你的ID", 32) - 42, y: 612, opacity: [{ timeMs: outroAt + 700, value: 0 }, { timeMs: outroAt + 760, value: 1 }] } },
    text("o-id", "@你的ID", centerX("@你的ID", 32), 638, 32, white, outroAt + 700, durationMs, [{ timeMs: outroAt + 700, value: 0 }, { timeMs: outroAt + 760, value: 1 }]),
    rect("final-fade", durationMs - 320, durationMs, 0, 0, width, height, "#000000", [{ timeMs: durationMs - 320, value: 0 }, { timeMs: durationMs, value: 1 }])
  ]
});
