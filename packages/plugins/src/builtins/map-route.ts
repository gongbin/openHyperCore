import { cubicBezier } from "../../../core/src/index.ts";
import type { Layer, ScalarKeyframe, ShapeLayer } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { shade } from "./color.ts";
import { WORLD_LAND_PATH, WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from "./world-land-110m.ts";

// Travel-route opener: a stylized world map (bundled Natural Earth vectors,
// public domain) auto-framed on the start/end points, with an arced route that
// draws itself from A to B (path-trim animation) while a marker rides its tip.
//
// Timeline (fractions of the plugin window): map/labels settle in the first
// ~15%, the route draws from 18% to 72%, the destination pops at the end of
// the draw. Overlap the next scene (or a video layer) over the tail to
// transition onward.

const ROUTE_EASE: [number, number, number, number] = [0.55, 0, 0.3, 1];
const POP: [number, number, number, number] = [0.34, 1.56, 0.64, 1];
// Dense keyframes approximating the eased route draw; trim and the marker use
// the SAME eased length fractions so the marker stays glued to the tip.
const DRAW_STEPS = 48;

export const mapRoute = definePlugin({
  name: "map-route",
  displayName: "Map Route",
  description: "An animated route draws itself between two places on a world map.",
  category: "map",
  defaultDurationMs: 5000,
  params: {
    from: { type: "latlng", required: true, label: "Start [lat, lng]" },
    to: { type: "latlng", required: true, label: "End [lat, lng]" },
    fromLabel: { type: "string", default: "", label: "Start label" },
    toLabel: { type: "string", default: "", label: "End label" },
    background: { type: "color", default: "#0b1526", label: "Ocean / background" },
    landColor: { type: "color", default: "#2b4a68", label: "Land color" },
    routeColor: { type: "color", default: "#ffb703", label: "Route color" },
    lineStyle: { type: "select", options: ["dashed", "solid"], default: "dashed" },
    zoom: { type: "number", default: 1, min: 0.3, max: 6, step: 0.1, label: "Zoom (auto-fit ×)" },
    drift: { type: "boolean", default: true, label: "Cinematic drift" }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;

    // Equirectangular projection into the bundled map's pixel space.
    const project = ([lat, lng]: readonly [number, number]): [number, number] => [
      ((lng + 180) / 360) * WORLD_MAP_WIDTH,
      ((90 - lat) / 180) * WORLD_MAP_HEIGHT
    ];
    const a = project(params.from);
    const b = project(params.to);

    // Auto-fit: scale so the two points span comfortably inside the frame,
    // centred on their midpoint. `zoom` multiplies the fitted scale.
    const spanX = Math.max(Math.abs(b[0] - a[0]), 24);
    const spanY = Math.max(Math.abs(b[1] - a[1]), 24);
    const s = Math.min((w * 0.52) / spanX, (h * 0.42) / spanY, 7) * params.zoom;
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    const toScreen = ([x, y]: readonly [number, number]): [number, number] => [
      w / 2 + (x - cx) * s,
      h / 2 + (y - cy) * s
    ];
    const p1 = toScreen(a);
    const p2 = toScreen(b);

    // Route arc: quadratic bezier whose control point is lifted perpendicular
    // to the chord (biased upward on screen, like a flight path).
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dist = Math.hypot(dx, dy) || 1;
    const lift = dist * 0.22;
    const nx = -dy / dist;
    const ny = dx / dist;
    const sign = ny < 0 ? 1 : -1; // pick the normal that points up-screen
    const c: [number, number] = [mx + nx * lift * sign, my + ny * lift * sign];
    const routePath = `M${r1(p1[0])} ${r1(p1[1])}Q${r1(c[0])} ${r1(c[1])} ${r1(p2[0])} ${r1(p2[1])}`;

    // Arc-length table so marker keyframes advance by LENGTH fraction —
    // matching how path trim progresses — not by bezier parameter t.
    const samples: { x: number; y: number; len: number }[] = [];
    let total = 0;
    for (let i = 0; i <= 256; i += 1) {
      const t = i / 256;
      const u = 1 - t;
      const x = u * u * p1[0] + 2 * u * t * c[0] + t * t * p2[0];
      const y = u * u * p1[1] + 2 * u * t * c[1] + t * t * p2[1];
      if (i > 0) total += Math.hypot(x - samples[i - 1]!.x, y - samples[i - 1]!.y);
      samples.push({ x, y, len: total });
    }
    const pointAtLength = (fraction: number): { x: number; y: number } => {
      const target = Math.min(1, Math.max(0, fraction)) * total;
      let lo = 0;
      while (lo < samples.length - 1 && samples[lo + 1]!.len < target) lo += 1;
      const s0 = samples[lo]!;
      const s1 = samples[Math.min(lo + 1, samples.length - 1)]!;
      const span = s1.len - s0.len || 1;
      const k = (target - s0.len) / span;
      return { x: s0.x + (s1.x - s0.x) * k, y: s0.y + (s1.y - s0.y) * k };
    };

    // Route draw window + eased dense keyframes.
    const drawStart = Math.round(durationMs * 0.18);
    const drawEnd = Math.round(durationMs * 0.72);
    const ease = cubicBezier(...ROUTE_EASE);
    const trimTrack: ScalarKeyframe[] = [];
    const markerX: ScalarKeyframe[] = [];
    const markerY: ScalarKeyframe[] = [];
    for (let k = 0; k <= DRAW_STEPS; k += 1) {
      const timeMs = Math.round(drawStart + ((drawEnd - drawStart) * k) / DRAW_STEPS);
      const f = ease(k / DRAW_STEPS);
      const p = pointAtLength(f);
      trimTrack.push({ timeMs, value: f });
      markerX.push({ timeMs, value: r1(p.x) });
      markerY.push({ timeMs, value: r1(p.y) });
    }

    const routeBase: Omit<ShapeLayer, "strokeWidth" | "blur"> = {
      type: "shape",
      shape: "path",
      path: routePath,
      stroke: params.routeColor,
      trimEnd: trimTrack,
      ...(params.lineStyle === "dashed" ? { dash: [12, 8] } : {})
    };

    const settle = Math.min(500, Math.round(durationMs * 0.12));
    const layers: Layer[] = [
      // Ocean.
      { type: "shape", id: "map-bg", shape: "rect", width: w, height: h, fill: params.background },
      // Content that drifts together: land, route, dots, labels.
      {
        type: "group",
        id: "map-content",
        cache: false,
        ...(params.drift ? {
          transform: {
            scale: [{ timeMs: 0, value: 1.05 }, { timeMs: durationMs, value: 1, easing: "easeOut" }],
            x: [{ timeMs: 0, value: (1 - 1.05) * (w / 2) }, { timeMs: durationMs, value: 0, easing: "easeOut" }],
            y: [{ timeMs: 0, value: (1 - 1.05) * (h / 2) }, { timeMs: durationMs, value: 0, easing: "easeOut" }]
          }
        } : {}),
        layers: [
          // Land vectors, framed on the route.
          {
            type: "shape",
            id: "map-land",
            shape: "path",
            path: WORLD_LAND_PATH,
            fill: params.landColor,
            transform: { x: w / 2 - cx * s, y: h / 2 - cy * s, scale: s, opacity: [{ timeMs: 0, value: 0 }, { timeMs: settle, value: 1 }] }
          },
          // Soft glow under the route line.
          { ...routeBase, id: "route-glow", strokeWidth: 9, blur: 5, transform: { opacity: 0.4 } },
          { ...routeBase, id: "route-line", strokeWidth: 3.5 },
          // Start dot.
          ...placeDot("from", p1, params.routeColor, Math.round(durationMs * 0.1), durationMs),
          // Tip marker riding the draw, hidden once the route lands.
          {
            type: "shape",
            id: "route-tip",
            shape: "circle",
            radius: 7,
            fill: "#ffffff",
            blur: 2,
            startMs: drawStart,
            endMs: drawEnd + 40,
            transform: { x: offsetTrack(markerX, -7), y: offsetTrack(markerY, -7) }
          },
          // Destination dot pops when the route arrives.
          ...placeDot("to", p2, params.routeColor, drawEnd, durationMs),
          ...label(params.fromLabel, p1, Math.round(durationMs * 0.12), durationMs, w),
          ...label(params.toLabel, p2, drawEnd + 80, durationMs, w)
        ]
      }
    ];
    return layers;
  }
});

function placeDot(id: string, p: [number, number], color: string, atMs: number, durationMs: number): Layer[] {
  const endMs = Math.min(atMs + 360, durationMs);
  // Scale pops around the dot's CENTRE: the circle's local origin is its
  // top-left, so x/y counter-shift as scale rises. Both tracks share the POP
  // easing, making the compensation exact at every resolved time.
  const dot = (suffix: string, radius: number, fill: string, opacity?: number): Layer => ({
    type: "shape",
    id: `dot-${id}${suffix}`,
    shape: "circle",
    radius,
    fill,
    startMs: atMs,
    transform: {
      scale: [{ timeMs: atMs, value: 0 }, { timeMs: endMs, value: 1, easing: POP }],
      x: [{ timeMs: atMs, value: p[0] }, { timeMs: endMs, value: p[0] - radius, easing: POP }],
      y: [{ timeMs: atMs, value: p[1] }, { timeMs: endMs, value: p[1] - radius, easing: POP }],
      ...(opacity !== undefined ? { opacity } : {})
    }
  });
  // Halo ring + solid dot + white core (stroke replaces fill, so 3 circles).
  return [
    dot("-halo", 13, shade(color, 0.1), 0.28),
    dot("", 7, color),
    dot("-core", 2.6, "#ffffff")
  ];
}

function label(text: string, p: [number, number], atMs: number, durationMs: number, frameW: number): Layer[] {
  if (!text) return [];
  const flip = p[1] < 90; // keep labels on-screen near the top edge
  return [{
    type: "text",
    id: `label-${text}`,
    text,
    size: 26,
    color: "#ffffff",
    align: "center",
    shadowColor: "rgba(0,0,0,0.7)",
    shadowBlur: 6,
    shadowDy: 2,
    startMs: atMs,
    maxWidth: frameW * 0.4,
    transform: {
      x: p[0],
      y: flip ? p[1] + 44 : p[1] - 24,
      opacity: [
        { timeMs: atMs, value: 0 },
        { timeMs: Math.min(atMs + 320, durationMs), value: 1, easing: "easeOut" }
      ]
    }
  }];
}

function offsetTrack(track: ScalarKeyframe[], offset: number): ScalarKeyframe[] {
  return track.map((k) => ({ ...k, value: k.value + offset }));
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
