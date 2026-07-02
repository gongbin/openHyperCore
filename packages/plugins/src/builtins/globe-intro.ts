import type { Layer, ScalarKeyframe } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { atmosphere, starfield } from "./globe-common.ts";

// Rotating-globe opener: a lit satellite globe fades in over a starfield,
// spins toward the target place and zooms into it — the classic travel-intro
// shot. Overlap the next scene (map-route, footage, a title) over the tail.
//
// Uses the engine's globe layer (UV-mesh sphere mapping, wasm/native parity),
// so any 2:1 equirectangular texture works: earth, moon, stylized planets.

const SETTLE_EASE: [number, number, number, number] = [0.5, 0, 0.22, 1];
const ZOOM_EASE: [number, number, number, number] = [0.62, 0, 0.28, 1];

export const globeIntro = definePlugin({
  name: "globe-intro",
  displayName: "Globe Intro",
  description: "A rotating satellite globe spins to the target point and zooms in.",
  category: "opener",
  defaultDurationMs: 6000,
  params: {
    src: {
      type: "asset",
      kind: "image",
      required: true,
      label: "Equirectangular texture (2:1)",
      placeholder: "https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg"
    },
    target: { type: "latlng", required: true, label: "Target [lat, lng]" },
    background: { type: "color", default: "#050a18", label: "Space background" },
    atmosphereColor: { type: "color", default: "#6ab7ff" },
    spin: { type: "number", default: 160, min: 0, max: 720, step: 5, label: "Spin before settling (°)" },
    zoom: { type: "number", default: 3, min: 1, max: 8, step: 0.1, label: "Final zoom" },
    stars: { type: "boolean", default: true }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const radius = Math.round(Math.min(w, h) * 0.34);
    // The mesh convention puts lon=yaw, lat=-pitch at the front centre, so
    // rotating to these values lands the target exactly on the zoom axis.
    const [lat, lng] = params.target;
    const yawEnd = (lng * Math.PI) / 180;
    const pitchEnd = (-lat * Math.PI) / 180;
    const settleAt = Math.round(durationMs * 0.78);
    const fadeMs = Math.round(durationMs * 0.1);

    const layers: Layer[] = [
      { type: "shape", id: "space", shape: "rect", width: w, height: h, fill: params.background }
    ];
    if (params.stars) {
      layers.push(starfield(w, h));
    }
    layers.push({
      // Atmosphere + globe zoom together; the group origin is the globe
      // centre, so scaling stays centred on the target.
      type: "group",
      id: "globe-zoom",
      cache: false, // yaw animates every frame — rastering it would thrash
      transform: {
        x: w / 2,
        y: h / 2,
        scale: [
          { timeMs: 0, value: 0.92 },
          { timeMs: Math.round(durationMs * 0.3), value: 1, easing: "easeOut" },
          { timeMs: durationMs, value: params.zoom, easing: ZOOM_EASE }
        ],
        opacity: [
          { timeMs: 0, value: 0 },
          { timeMs: fadeMs, value: 1 }
        ]
      },
      layers: [
        atmosphere(radius, params.atmosphereColor),
        {
          type: "globe",
          id: "globe",
          src: params.src,
          radius,
          yaw: [
            { timeMs: 0, value: yawEnd - (params.spin * Math.PI) / 180 },
            { timeMs: settleAt, value: yawEnd, easing: SETTLE_EASE }
          ],
          pitch: [
            { timeMs: 0, value: pitchEnd - 0.35 },
            { timeMs: settleAt, value: pitchEnd, easing: SETTLE_EASE }
          ]
        }
      ]
    });
    // Radar pings on the (centred) target as the spin settles.
    layers.push(...ping(w / 2, h / 2, params.atmosphereColor, settleAt, durationMs, 0));
    layers.push(...ping(w / 2, h / 2, params.atmosphereColor, settleAt, durationMs, 1));
    return layers;
  }
});


// One expanding, fading ring; two staggered copies read as a radar ping.
function ping(cx: number, cy: number, color: string, atMs: number, durationMs: number, index: number): Layer[] {
  const startMs = Math.min(atMs + index * 380, durationMs - 1);
  const endMs = Math.min(startMs + 900, durationMs);
  if (endMs - startMs < 120) return [];
  const r = 10;
  const from = 0.2;
  const grow = 4.4;
  // Scale + centre-compensation tracks share the easing, so the ring stays
  // centred on the target at every resolved time (circle origin is top-left).
  const track = (start: number, end: number): ScalarKeyframe[] => [
    { timeMs: startMs, value: start },
    { timeMs: endMs, value: end, easing: "easeOut" }
  ];
  return [{
    type: "shape",
    id: `ping-${index}`,
    shape: "circle",
    radius: r,
    stroke: color,
    strokeWidth: 2.4,
    startMs,
    endMs,
    transform: {
      scale: track(from, grow),
      x: track(cx - r * from, cx - r * grow),
      y: track(cy - r * from, cy - r * grow),
      opacity: track(0.85, 0)
    }
  }];
}



