import type { Layer } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { shade } from "./color.ts";

// Camera-iris opener: a ring of dark blades holds shut over the scene, then
// the whole iris rotates slowly while each blade slides radially outward with
// a cubic ease, opening an N-gon hole that exposes the backdrop and a glowing
// accent circle at its centre. An accent-stroked polygon outline expands with
// the hole's edge, and the title fades in once the last blade clears.
//
// Blade construction: blade i is a huge rectangle covering the half-plane
// beyond edge i of the hole polygon (its inner edge is the edge's tangent
// line). With every blade at distance 0 the union covers the full frame; as
// each translates outward along its own normal the uncovered intersection is
// exactly the regular N-gon hole — no seams, whatever the blade count.
export const apertureReveal = definePlugin({
  name: "aperture-reveal",
  displayName: "Aperture Reveal",
  description: "A camera iris of angled blades holds shut, then rotates apart to expose the scene behind, dropping a centred title as the last blade clears.",
  category: "opener",
  defaultDurationMs: 3600,
  params: {
    blades: { type: "number", default: 8, min: 3, max: 16, step: 1, label: "Blades" },
    color: { type: "color", default: "#4f8cff", label: "Accent color" },
    holdMs: { type: "number", default: 300, min: 0, step: 50, label: "Hold shut (ms)" },
    openMs: { type: "number", default: 1600, min: 200, step: 50, label: "Open duration (ms)" },
    title: { type: "string", default: "APERTURE", label: "Title text" },
    background: { type: "color", default: "#2a3b66", label: "Backdrop color" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const cx = w / 2;
    const cy = h / 2;
    const blades = Math.max(3, Math.round(params.blades));
    const holdMs = Math.min(params.holdMs, durationMs);
    const openEnd = Math.min(holdMs + params.openMs, durationMs);
    const diag = Math.hypot(w, h);
    // Hole circumradius at full open (demo: 0.62 × frame diagonal) and the
    // matching apothem — the distance each blade travels along its normal.
    const holeR = diag * 0.62;
    const travel = holeR * Math.cos(Math.PI / blades);
    const bladeW = diag * 2.6;
    const bladeH = diag * 1.2;
    const glowR = h * 0.13;

    const bladeLayers: Layer[] = [];
    for (let i = 0; i < blades; i += 1) {
      const theta = (i / blades) * Math.PI * 2;
      bladeLayers.push({
        type: "shape",
        id: `aperture-blade-${i}`,
        shape: "path",
        path: `M ${-bladeW / 2} 0 H ${bladeW / 2} V ${bladeH} H ${-bladeW / 2} Z`,
        fill: "#05080f",
        transform: {
          // Local +y points along the blade's outward normal after rotation.
          rotate: (theta * 180) / Math.PI - 90,
          x: [
            { timeMs: holdMs, value: 0 },
            { timeMs: openEnd, value: Math.cos(theta) * travel, easing: "easeOutCubic" }
          ],
          y: [
            { timeMs: holdMs, value: 0 },
            { timeMs: openEnd, value: Math.sin(theta) * travel, easing: "easeOutCubic" }
          ]
        }
      });
    }

    // Accent outline tracing the hole's edge: a regular N-gon scaled up with
    // the same ease, riding inside the rotating iris group. The hole's
    // vertices sit BETWEEN the blade normals, hence the half-step offset.
    const outlinePath = Array.from({ length: blades }, (_, i) => {
      const a = ((i + 0.5) / blades) * Math.PI * 2;
      const px = Math.cos(a) * holeR;
      const py = Math.sin(a) * holeR;
      return `${i === 0 ? "M" : "L"} ${px.toFixed(2)} ${py.toFixed(2)}`;
    }).join(" ") + " Z";
    bladeLayers.push({
      type: "shape",
      id: "aperture-outline",
      shape: "path",
      path: outlinePath,
      stroke: params.color,
      strokeWidth: 2,
      transform: {
        scale: [
          { timeMs: holdMs, value: 0.001 },
          { timeMs: openEnd, value: 1, easing: "easeOutCubic" }
        ],
        opacity: [
          { timeMs: holdMs, value: 0 },
          { timeMs: Math.min(holdMs + 200, openEnd), value: 0.55 }
        ]
      }
    });

    // Title fades in as the iris finishes clearing.
    const titleSize = Math.round(h * 0.11);
    const titleStart = Math.min(Math.round(holdMs + params.openMs * 0.95), Math.max(0, durationMs - 400));
    const titleEnd = Math.min(titleStart + Math.round(durationMs * 0.18), durationMs);

    const layers: Layer[] = [
      {
        type: "shape",
        id: "aperture-bg",
        shape: "rect",
        width: w,
        height: h,
        fill: {
          type: "linear",
          from: [0, 0],
          to: [0, h],
          stops: [
            { offset: 0, color: params.background },
            { offset: 1, color: shade(params.background, -0.68) }
          ]
        }
      },
      // Glowing accent circle at the centre — revealed as the hole opens.
      // A soft blurred halo behind a near-solid core (canvas shadowBlur look).
      {
        type: "shape",
        id: "aperture-glow-halo",
        shape: "circle",
        radius: glowR,
        fill: params.color,
        blur: Math.round(h * 0.045),
        transform: { x: cx - glowR, y: cy - glowR, opacity: 0.6 }
      },
      {
        type: "shape",
        id: "aperture-glow",
        shape: "circle",
        radius: glowR,
        fill: params.color,
        blur: Math.max(2, Math.round(h * 0.008)),
        transform: { x: cx - glowR, y: cy - glowR, opacity: 0.85 }
      },
      // The iris: blades + outline in one slowly counter-rotating group.
      {
        type: "group",
        id: "aperture-iris",
        cache: false,
        layers: bladeLayers,
        transform: {
          x: cx,
          y: cy,
          rotate: [
            { timeMs: 0, value: 0 },
            { timeMs: durationMs, value: -40 }
          ]
        }
      }
    ];

    if (params.title) {
      layers.push({
        type: "text",
        id: "aperture-title",
        text: params.title,
        size: titleSize,
        color: "#ffffff",
        align: "center",
        transform: {
          x: cx,
          y: cy + titleSize * 0.35,
          opacity: [
            { timeMs: titleStart, value: 0 },
            { timeMs: titleEnd, value: 1 }
          ]
        }
      });
    }
    return layers;
  }
});
