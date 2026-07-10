import type { Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { estimateTextWidth } from "./glitch-title.ts";
import { seeded } from "./globe-common.ts";

// TikTok "hacker" opener — glitch-title's aggressive cousin: two screen-blended
// colour channels of the title split apart and jitter continuously (the split
// breathes with a |sin| intensity wave), hard slice bands tear offset copies
// across the word, and digital noise flecks flicker — for the WHOLE window.
// All randomness is seeded, so renders are deterministic.
export const rgbGlitchShake = definePlugin({
  name: "rgb-glitch-shake",
  displayName: "RGB Glitch Shake",
  description: "Chromatic-aberration glitch: RGB channels split and jitter, slice bars tear across the title, and digital noise flickers — that edgy \"hacker\" opener.",
  category: "tiktok",
  defaultDurationMs: 2600,
  params: {
    text: { type: "string", default: "GLITCH", label: "Title text" },
    split: { type: "number", default: 16, min: 0, max: 48, step: 1, label: "Channel split (px)" },
    sliceRate: { type: "number", default: 0.4, min: 0, max: 1, step: 0.05, label: "Slice tear rate" },
    noise: { type: "number", default: 0.3, min: 0, max: 1, step: 0.05, label: "Noise amount" },
    color: { type: "color", default: "#ff2e63", label: "Channel A color" },
    colorB: { type: "color", default: "#2effe6", label: "Channel B color" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs: T } = ctx;
    const BG = "#07060a";
    const cx = w / 2;
    const cy = h / 2;
    const unit = h / 576;
    const size = Math.round(h * 0.2);
    const baseline = cy + size * 0.35;
    const rand = seeded(11);
    const stepMs = 80;
    const steps = Math.max(1, Math.ceil(T / stepMs));

    // Split intensity breathes over the window: 0.4 + 0.6·|sin(3π·t/T)|.
    const intensity = (t: number): number => 0.4 + 0.6 * Math.abs(Math.sin((t / T) * Math.PI * 3));

    // Hard-stepped track: a new seeded value every `stepMs`, held (not eased)
    // until the next step — the per-frame re-randomize feel of the reference.
    const stepped = (valueAt: (t: number) => number): ScalarKeyframe[] => {
      const track: ScalarKeyframe[] = [];
      for (let k = 0; k < steps; k += 1) {
        const t = k * stepMs;
        const value = valueAt(t);
        track.push({ timeMs: t, value });
        track.push({ timeMs: Math.min(T, t + stepMs) - 1, value });
      }
      return track;
    };

    const splitPx = params.split * unit;
    const channel = (id: string, color: string, dir: -1 | 1): Layer => ({
      type: "text",
      id: `rgs-${id}`,
      text: params.text,
      size,
      color,
      align: "center",
      blendMode: "screen",
      transform: {
        x: stepped((t) => {
          const s = splitPx * intensity(t);
          return cx + dir * s + (rand() * 2 - 1) * s * 0.3;
        }),
        y: stepped(() => baseline + (rand() * 2 - 1) * 2.5 * unit)
      }
    });

    const layers: Layer[] = [
      { type: "shape", id: "rgs-bg", shape: "rect", width: w, height: h, fill: BG },
      channel("channel-a", params.color, -1),
      channel("channel-b", params.colorB, 1),
      // White top copy with a tiny jitter.
      {
        type: "text",
        id: "rgs-main",
        text: params.text,
        size,
        color: "rgba(255,255,255,0.92)",
        align: "center",
        blendMode: "screen",
        transform: {
          x: stepped((t) => cx + (rand() * 2 - 1) * splitPx * intensity(t) * 0.2),
          y: baseline
        }
      }
    ];

    // Slice tears: full-width thin bands at seeded heights; each band blanks
    // the title behind it and shows an offset colour copy, flickering on/off
    // per 80ms bucket with probability `sliceRate`.
    const estW = estimateTextWidth(params.text, size);
    for (let i = 0; i < 6; i += 1) {
      const bandY = (0.28 + rand() * 0.44) * h; // keep bands over the title zone
      const bandH = (4 + rand() * 18) * unit;
      const off = (rand() * 2 - 1) * 40 * unit;
      const color = rand() > 0.5 ? params.color : params.colorB;
      const flicker: ScalarKeyframe[] = [];
      for (let k = 0; k < steps; k += 1) {
        const t = k * stepMs;
        const on = rand() < params.sliceRate ? 1 : 0;
        flicker.push({ timeMs: t, value: on });
        flicker.push({ timeMs: Math.min(T, t + stepMs) - 1, value: on });
      }
      layers.push({
        type: "group",
        id: `rgs-slice-${i}`,
        cache: false,
        clip: { type: "rect", x: 0, y: bandY, width: w, height: bandH },
        layers: [
          { type: "shape", shape: "rect", width: estW + 120 * unit, height: bandH, fill: BG, transform: { x: cx - estW / 2 - 60 * unit, y: bandY } },
          { type: "text", text: params.text, size, color, align: "center", transform: { x: cx + off, y: baseline } }
        ],
        transform: { opacity: flicker }
      });
    }

    // Digital noise: tiny seeded flecks flickering in coarser 160ms buckets.
    if (params.noise > 0) {
      const flecks: Layer[] = [];
      const onAlpha = Math.min(0.9, params.noise * 1.5);
      const noiseStep = 160;
      const noiseSteps = Math.max(1, Math.ceil(T / noiseStep));
      for (let i = 0; i < 30; i += 1) {
        const fx = rand() * w;
        const fy = rand() * h;
        const fill = rand() > 0.4 ? "#ffffff" : (rand() > 0.5 ? params.color : params.colorB);
        const flicker: ScalarKeyframe[] = [];
        for (let k = 0; k < noiseSteps; k += 1) {
          const t = k * noiseStep;
          const on = rand() < 0.4 ? onAlpha : 0;
          flicker.push({ timeMs: t, value: on });
          flicker.push({ timeMs: Math.min(T, t + noiseStep) - 1, value: on });
        }
        flecks.push({
          type: "shape",
          shape: "rect",
          width: 2.5 * unit,
          height: 2.5 * unit,
          fill,
          transform: { x: fx, y: fy, opacity: flicker }
        });
      }
      layers.push({ type: "group", id: "rgs-noise", cache: false, layers: flecks });
    }

    return layers;
  }
});
