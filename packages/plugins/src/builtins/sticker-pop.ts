import type { Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { seeded, withAlpha } from "./globe-common.ts";

// TikTok reaction-video intro: a white speech bubble (rounded rect + tail)
// pops in with an elastic overshoot around a bold caption, while emoji
// stickers burst outward from the centre to a ring, staggered, each drifting
// slowly around the bubble with a gentle rotate wobble. A soft accent-tinted
// disc sits behind every emoji so the burst still reads if the render host
// has no emoji typeface.
export const stickerPop = definePlugin({
  name: "sticker-pop",
  displayName: "Sticker Pop",
  description: "Emoji/sticker confetti bursts in with elastic overshoot around a bouncing speech-bubble caption — the playful reaction-video intro.",
  category: "tiktok",
  defaultDurationMs: 3000,
  params: {
    caption: { type: "string", default: "OMG 😱", label: "Caption" },
    stickers: { type: "string", default: "✨ 🔥 💖 😂 ⭐", label: "Stickers (space-separated)" },
    pop: { type: "number", default: 0.8, min: 0, max: 1, step: 0.05, label: "Pop overshoot" },
    spin: { type: "number", default: 0.3, min: 0, max: 1, step: 0.05, label: "Orbit drift" },
    bubbleColor: { type: "color", default: "#ffffff", label: "Bubble color" },
    accent: { type: "color", default: "#ffd166", label: "Sticker accent" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs: T } = ctx;
    const cx = w / 2;
    const cy = h / 2;
    const rand = seeded(21);

    // Elastic-out with the overshoot wobble scaled by `pop` (normalised so the
    // default 0.8 matches the reference curve exactly). The rise to the first
    // crossing of 1 (x ≈ 0.075) is kept intact so the value still starts at 0.
    const popScale = params.pop / 0.8;
    const elastic = (x: number): number => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      const c = (2 * Math.PI) / 3;
      const v = Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c) + 1;
      return x <= 0.075 ? v : 1 + (v - 1) * popScale;
    };

    // ---- speech bubble: rounded rect + tail as one path, centred on (0,0) ----
    const bw = w * 0.42;
    const bh = h * 0.26;
    const r = bh * 0.3;
    const x0 = -bw / 2;
    const y0 = -bh / 2;
    const x1 = bw / 2;
    const y1 = bh / 2;
    const bubblePath =
      `M ${x0 + r} ${y0} L ${x1 - r} ${y0} Q ${x1} ${y0} ${x1} ${y0 + r} ` +
      `L ${x1} ${y1 - r} Q ${x1} ${y1} ${x1 - r} ${y1} L ${x0 + r} ${y1} ` +
      `Q ${x0} ${y1} ${x0} ${y1 - r} L ${x0} ${y0 + r} Q ${x0} ${y0} ${x0 + r} ${y0} Z ` +
      `M ${-bw * 0.12} ${y1} L ${-bw * 0.02} ${y1 + bh * 0.32} L ${bw * 0.1} ${y1} Z`;

    // Bake the bubble's elastic entrance over the first 45% of the window
    // (dense samples through the wobble, sparse once it has settled).
    const bubbleEnd = 0.45;
    const us = [0, 0.0375, 0.075, 0.1125, 0.15, 0.1875, 0.225, 0.2625, 0.3, 0.3375, 0.375, 0.45, 0.6, 0.8, 1];
    const bubbleScale: ScalarKeyframe[] = us.map((u) => ({
      timeMs: Math.round(u * bubbleEnd * T),
      value: elastic(u)
    }));

    const captionSize = Math.round(h * 0.11);
    const bubble: Layer = {
      type: "group",
      id: "sp-bubble",
      cache: false,
      layers: [
        { type: "shape", shape: "path", path: bubblePath, fill: params.bubbleColor },
        {
          type: "text",
          text: params.caption,
          size: captionSize,
          color: "#1a1030",
          align: "center",
          transform: { x: 0, y: -bh * 0.02 + captionSize * 0.35 }
        }
      ],
      transform: { x: cx, y: cy, scale: bubbleScale }
    };

    // ---- sticker burst ----
    const emojis = (params.stickers ?? "").trim().split(/\s+/).filter((s) => s.length > 0);
    const list = emojis.length > 0 ? emojis : ["✨"];
    const stickers: Layer[] = [];
    const count = 10;
    const emojiSize = Math.round(h * 0.1);
    for (let i = 0; i < count; i += 1) {
      const dist = h * (0.32 + 0.12 * Math.sin(i * 2));
      const delay = (i % 5) * 0.05;
      const baseAngle = (i / count) * Math.PI * 2;
      const angleAt = (p: number): number => baseAngle + p * params.spin * Math.PI;
      const epAt = (p: number): number => elastic(Math.min(1, Math.max(0, (p - delay) / 0.5)));

      const xTrack: ScalarKeyframe[] = [];
      const yTrack: ScalarKeyframe[] = [];
      const oTrack: ScalarKeyframe[] = [];
      for (let p = 0; p <= 1.0001; p += 0.025) {
        const timeMs = Math.round(Math.min(1, p) * T);
        const ep = epAt(p);
        const a = angleAt(p);
        xTrack.push({ timeMs, value: cx + Math.cos(a) * dist * ep });
        yTrack.push({ timeMs, value: cy + Math.sin(a) * dist * ep });
        oTrack.push({ timeMs, value: Math.min(1, Math.max(0, ep)) });
      }
      // Gentle continuous wobble: sin(t/300 + i) * 0.3 rad, sampled coarsely.
      const rotTrack: ScalarKeyframe[] = [];
      for (let t = 0; t <= T; t += 150) {
        rotTrack.push({ timeMs: t, value: (Math.sin(t / 300 + i) * 0.3 * 180) / Math.PI, easing: "easeInOut" });
      }

      const discR = (0.045 + rand() * 0.02) * h;
      stickers.push({
        type: "group",
        id: `sp-sticker-${i}`,
        cache: false,
        layers: [
          // Accent-tinted disc behind the glyph — keeps the burst readable
          // even when no emoji typeface is available.
          {
            type: "shape",
            shape: "circle",
            radius: discR,
            fill: withAlpha(params.accent, 0.28 + rand() * 0.25),
            transform: { x: -discR, y: -discR }
          },
          {
            type: "text",
            text: list[i % list.length]!,
            size: emojiSize,
            align: "center",
            color: "#ffffff",
            transform: { x: 0, y: emojiSize * 0.35 }
          }
        ],
        transform: { x: xTrack, y: yTrack, rotate: rotTrack, opacity: oTrack }
      });
    }

    return [
      {
        type: "shape",
        id: "sp-bg",
        shape: "rect",
        width: w,
        height: h,
        fill: {
          type: "linear",
          from: [0, 0],
          to: [w, h],
          stops: [
            { offset: 0, color: "#221436" },
            { offset: 1, color: "#0a0713" }
          ]
        }
      },
      bubble,
      { type: "group", id: "sp-stickers", cache: false, layers: stickers }
    ];
  }
});
