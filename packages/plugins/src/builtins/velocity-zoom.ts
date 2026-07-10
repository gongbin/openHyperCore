import type { Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { seeded, withAlpha } from "./globe-common.ts";

// TikTok/CapCut speed-ramp opener: the whole frame (gradient bg + radial
// speed lines + echoed title) punch-zooms on every beat with a hard-decaying
// shake and a horizontal motion-blur smear, then snaps back to rest — and it
// keeps hitting for the full window. A small "swipe up" tag sits outside the
// shaking group. The beat count splits the window into equal pulses.
export const velocityZoom = definePlugin({
  name: "velocity-zoom",
  displayName: "Velocity Zoom",
  description: "The CapCut speed-ramp opener: the frame punch-zooms on the beat with a hard motion-blur shake, then snaps to the title. Screams \"swipe up\".",
  category: "tiktok",
  defaultDurationMs: 2600,
  params: {
    text: { type: "string", default: "GO VIRAL", label: "Title text" },
    beats: { type: "number", default: 3, min: 1, max: 8, step: 1, label: "Beats" },
    zoom: { type: "number", default: 1.9, min: 1.1, max: 3, step: 0.1, label: "Punch zoom" },
    shake: { type: "number", default: 14, min: 0, max: 40, step: 1, label: "Shake (px)" },
    blur: { type: "number", default: 0.6, min: 0, max: 1, step: 0.05, label: "Motion blur" },
    accent: { type: "color", default: "#4f8cff", label: "Accent color" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs: T } = ctx;
    const cx = w / 2;
    const cy = h / 2;
    const unit = h / 576;
    const beats = Math.max(1, Math.round(params.beats));
    const period = T / beats;
    const shakeAmp = params.shake * unit;
    const rand = seeded(9);

    // punch(u): 1 at the beat, quadratic decay to 0 by 40% of the beat period.
    const punchAt = (u: number): number => Math.pow(1 - Math.min(1, u / 0.4), 2);
    const decayUs = [0, 0.08, 0.16, 0.24, 0.32, 0.4];

    // Bake one keyframe track that repeats a per-beat envelope across every
    // beat, pinning the rest value just before the next hit for a hard snap.
    const perBeat = (valueAt: (u: number) => number): ScalarKeyframe[] => {
      const track: ScalarKeyframe[] = [];
      for (let k = 0; k < beats; k += 1) {
        const start = k * period;
        if (k > 0) track.push({ timeMs: Math.round(start) - 1, value: valueAt(1) });
        for (const u of decayUs) {
          track.push({ timeMs: Math.round(start + u * period), value: valueAt(u) });
        }
      }
      return track;
    };

    const scaleTrack = perBeat((u) => 1 + (params.zoom - 1) * punchAt(u));
    // Seeded shake: a fresh offset at every sample, scaled by the punch decay.
    const shakeTrack = (base: number): ScalarKeyframe[] => {
      const track: ScalarKeyframe[] = [];
      for (let k = 0; k < beats; k += 1) {
        const start = k * period;
        if (k > 0) track.push({ timeMs: Math.round(start) - 1, value: base });
        for (const u of decayUs) {
          track.push({ timeMs: Math.round(start + u * period), value: base + (rand() * 2 - 1) * shakeAmp * punchAt(u) });
        }
      }
      return track;
    };

    // ---- content group children (coordinates relative to the frame centre) ----
    const content: Layer[] = [
      // Oversized gradient bg so punch shakes never expose the frame edge.
      {
        type: "shape",
        shape: "rect",
        width: w * 1.2,
        height: h * 1.2,
        fill: {
          type: "linear",
          from: [0, 0],
          to: [w * 1.2, h * 1.2],
          stops: [
            { offset: 0, color: "#1a1030" },
            { offset: 1, color: "#05070d" }
          ]
        },
        transform: { x: -w * 0.6, y: -h * 0.6 }
      }
    ];

    // Radial speed lines: rotated wrapper groups so scaleX shoots each line
    // outward along its own direction on every beat.
    const lines: Layer[] = [];
    for (let i = 0; i < 40; i += 1) {
      const angle = rand() * Math.PI * 2;
      const r0 = h * 0.2 * rand();
      const alpha = 0.1 + 0.4 * rand();
      const maxLen = 200 * unit; // 40 + 160 at full punch
      lines.push({
        type: "group",
        layers: [{
          type: "shape",
          shape: "rect",
          width: maxLen,
          height: 2 * unit,
          fill: "#ffffff",
          transform: {
            x: r0,
            y: -unit,
            scaleX: perBeat((u) => (40 + punchAt(u) * 160) / 200),
            opacity: alpha
          }
        }],
        transform: { rotate: (angle * 180) / Math.PI }
      });
    }
    content.push({
      type: "group",
      id: "vz-lines",
      cache: false,
      layers: lines,
      transform: { opacity: perBeat((u) => 0.25 + 0.5 * punchAt(u)) }
    });

    // Motion-blur echo title: accent copies smeared to the right of the main
    // white copy, collapsing back onto it as each punch decays.
    const size = Math.round(h * 0.17);
    const baseline = size * 0.35;
    const echoAlpha = 0.2 * params.blur;
    for (let e = 4; e >= 1; e -= 1) {
      content.push({
        type: "text",
        id: `vz-echo-${e}`,
        text: params.text,
        size,
        color: params.accent,
        align: "center",
        transform: {
          x: perBeat((u) => e * 0.4 * shakeAmp * punchAt(u)),
          y: baseline,
          opacity: echoAlpha
        }
      });
    }
    content.push({
      type: "text",
      id: "vz-title",
      text: params.text,
      size,
      color: "#ffffff",
      align: "center",
      shadowColor: "rgba(0,0,0,0.5)",
      shadowBlur: Math.round(size * 0.1),
      shadowDy: Math.round(size * 0.05),
      transform: { x: 0, y: baseline }
    });
    // Accent underline.
    content.push({
      type: "shape",
      id: "vz-underline",
      shape: "rect",
      width: w * 0.36,
      height: 4 * unit,
      fill: params.accent,
      transform: { x: -w * 0.18, y: h * 0.12 }
    });
    // Per-beat motion-blur smear copies: only alive during the punch frames.
    if (params.blur > 0) {
      for (let k = 0; k < beats; k += 1) {
        const start = Math.round(k * period);
        const end = Math.min(T, Math.round(start + 0.4 * period));
        content.push({
          type: "text",
          id: `vz-punch-blur-${k}`,
          text: params.text,
          size,
          color: "#ffffff",
          align: "center",
          startMs: start,
          endMs: end,
          motionBlur: { angle: 0, distance: params.blur * 80 * unit, samples: 6 },
          transform: {
            x: 0,
            y: baseline,
            opacity: [
              { timeMs: start, value: 0.55 },
              { timeMs: end, value: 0, easing: "easeOut" }
            ]
          }
        });
      }
    }

    return [
      {
        type: "group",
        id: "vz-content",
        cache: false,
        layers: content,
        transform: {
          x: shakeTrack(cx),
          y: shakeTrack(cy),
          scale: scaleTrack
        }
      },
      // Outside the shaking group: the "swipe up" tag.
      {
        type: "text",
        id: "vz-swipe",
        text: "▲ swipe up",
        size: Math.round(h * 0.045),
        color: withAlpha(params.accent, 0.7),
        align: "left",
        transform: { x: w * 0.05, y: h * 0.08 + h * 0.045 }
      }
    ];
  }
});
