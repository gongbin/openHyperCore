import type { ColorKeyframe, Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { estimateTextWidth } from "./glitch-title.ts";

// TikTok caption-on-the-beat lyric style: a bold word in a solid box slams in
// and squash-bounces (scaleX up / scaleY down in opposition, slight rotate) on
// every beat, with an accent bar under the box and three beat-indicator dots
// stepping the accent colour in time. The bounce repeats for the whole window.
export const beatBounce = definePlugin({
  name: "beat-bounce",
  displayName: "Beat Bounce Type",
  description: "Bold word slams in and squash-bounces on every beat with a drop shadow — the classic caption-on-the-beat lyric style.",
  category: "tiktok",
  defaultDurationMs: 2400,
  params: {
    text: { type: "string", default: "LET’S GO", label: "Caption text" },
    bounce: { type: "number", default: 0.7, min: 0, max: 1, step: 0.05, label: "Bounce amount" },
    beatMs: { type: "number", default: 400, min: 120, max: 1200, step: 20, label: "Beat period (ms)" },
    boxColor: { type: "color", default: "#000000", label: "Box color" },
    textColor: { type: "color", default: "#ffffff", label: "Text color" },
    accent: { type: "color", default: "#4f8cff", label: "Accent color" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs: T } = ctx;
    const cx = w / 2;
    const cy = h / 2;
    const unit = h / 576;
    const beatMs = Math.max(60, params.beatMs);
    const beats = Math.max(1, Math.ceil(T / beatMs));

    // Beat envelope (matches the reference design): a fast cubic ease-out rise
    // over the first 18% of the beat, then a decaying sine settle around 1.
    const env = (x: number): number => {
      const rise = 1 - Math.pow(1 - Math.min(1, x / 0.18), 3);
      const settle = x > 0.18 ? Math.exp(-(x - 0.18) * 6) * Math.sin((x - 0.18) * 40) * 0.12 : 0;
      return rise - settle;
    };
    // Sample the rise plus each settle-wobble extreme ((x-0.18)*40 = π/2 + kπ).
    const xs = [0, 0.06, 0.12, 0.18, 0.2193, 0.2978, 0.3763, 0.4548, 0.5333, 0.7, 1];

    const amp = 0.4 * params.bounce;
    const base = 1.1 - amp;
    const bake = (valueAt: (e: number) => number): ScalarKeyframe[] => {
      const track: ScalarKeyframe[] = [];
      for (let k = 0; k < beats; k += 1) {
        const start = k * beatMs;
        for (const x of xs) {
          const timeMs = Math.round(start + x * beatMs);
          if (timeMs > T) break;
          track.push({ timeMs, value: valueAt(env(x)) });
        }
      }
      return track;
    };
    const scaleTrack = bake((e) => base + amp * e);
    const squashTrack = bake((e) => 2 - (base + amp * e));
    const rotateTrack = bake((e) => ((e - 0.5) * 0.05 * 180) / Math.PI);

    // ---- caption block (inner coords centred on the box) ----
    const size = Math.round(h * 0.2);
    const textW = estimateTextWidth(params.text, size);
    const pad = size * 0.35;
    const boxW = textW + pad * 2;
    const boxLeft = -textW / 2 - pad;
    const block: Layer[] = [
      // Soft drop shadow behind the box.
      {
        type: "shape",
        shape: "rect",
        width: boxW,
        height: size * 1.24,
        fill: "rgba(0,0,0,0.4)",
        blur: 6 * unit,
        transform: { x: boxLeft + 7 * unit, y: -size * 0.62 + 9 * unit }
      },
      { type: "shape", shape: "rect", width: boxW, height: size * 1.24, fill: params.boxColor, transform: { x: boxLeft, y: -size * 0.62 } },
      { type: "shape", shape: "rect", width: boxW, height: 6 * unit, fill: params.accent, transform: { x: boxLeft, y: size * 0.5 } },
      {
        type: "text",
        text: params.text,
        size,
        color: params.textColor,
        align: "center",
        transform: { x: 0, y: size * 0.35 }
      }
    ];

    const layers: Layer[] = [
      {
        type: "shape",
        id: "bb-bg",
        shape: "rect",
        width: w,
        height: h,
        fill: {
          type: "linear",
          from: [0, 0],
          to: [0, h],
          stops: [
            { offset: 0, color: "#141824" },
            { offset: 1, color: "#080b12" }
          ]
        }
      },
      // Outer group rotates (matching the demo's translate→rotate→scale order),
      // the inner group carries the squash so it happens in the rotated space.
      {
        type: "group",
        id: "bb-caption",
        cache: false,
        layers: [{
          type: "group",
          cache: false,
          layers: block,
          transform: { scaleX: scaleTrack, scaleY: squashTrack }
        }],
        transform: { x: cx, y: cy, rotate: rotateTrack }
      }
    ];

    // Beat-indicator dots: fill steps to the accent colour on this dot's beat.
    const inactive = "#2a3346";
    for (let i = 0; i < 3; i += 1) {
      const fill: ColorKeyframe[] = [];
      for (let k = 0; k < beats; k += 1) {
        const start = k * beatMs;
        if (start > T) break;
        const color = k % 3 === i ? params.accent : inactive;
        if (k > 0) fill.push({ timeMs: Math.round(start) - 1, color: (k - 1) % 3 === i ? params.accent : inactive });
        fill.push({ timeMs: Math.round(start), color });
      }
      const r = 5 * unit;
      layers.push({
        type: "shape",
        id: `bb-dot-${i}`,
        shape: "circle",
        radius: r,
        fill,
        transform: { x: cx + (i - 1) * 22 * unit - r, y: h * 0.86 - r }
      });
    }

    return layers;
  }
});
