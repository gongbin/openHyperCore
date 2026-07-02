import type { Layer } from "../../../core/src/index.ts";
import { definePlugin } from "../plugin.ts";
import { atmosphere, greatCircleMidpoint, projectLatLng, starfield } from "./globe-common.ts";

// Spherical map-route: the globe rotates until the route's midpoint faces the
// viewer, then a great-circle arc draws itself from A to B ON the surface
// (hiding behind the horizon while the sphere still turns), with labels
// appearing once the rotation settles. The 3D sibling of map-route.

const SETTLE_EASE: [number, number, number, number] = [0.5, 0, 0.22, 1];
const DRAW_EASE: [number, number, number, number] = [0.55, 0, 0.3, 1];

export const globeRoute = definePlugin({
  name: "globe-route",
  displayName: "Globe Route",
  description: "A great-circle route draws itself between two places on a rotating globe.",
  category: "map",
  defaultDurationMs: 7000,
  params: {
    src: {
      type: "asset",
      kind: "image",
      required: true,
      label: "Equirectangular texture (2:1)",
      placeholder: "https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg"
    },
    from: { type: "latlng", required: true, label: "Start [lat, lng]" },
    to: { type: "latlng", required: true, label: "End [lat, lng]" },
    fromLabel: { type: "string", default: "", label: "Start label" },
    toLabel: { type: "string", default: "", label: "End label" },
    background: { type: "color", default: "#050a18", label: "Space background" },
    atmosphereColor: { type: "color", default: "#6ab7ff" },
    routeColor: { type: "color", default: "#ffb703" },
    spin: { type: "number", default: 120, min: 0, max: 720, step: 5, label: "Spin before settling (°)" },
    zoom: { type: "number", default: 1.7, min: 1, max: 6, step: 0.1, label: "Final zoom" },
    stars: { type: "boolean", default: true }
  },
  expand: (params, ctx) => {
    const { width: w, height: h, durationMs } = ctx;
    const radius = Math.round(Math.min(w, h) * 0.36);
    // Face the route's great-circle midpoint (lon=yaw, lat=-pitch front-centre).
    const [midLat, midLng] = greatCircleMidpoint(params.from, params.to);
    const yawEnd = (midLng * Math.PI) / 180;
    const pitchEnd = (-midLat * Math.PI) / 180;
    const settleAt = Math.round(durationMs * 0.42);
    const drawStart = Math.round(durationMs * 0.3);
    const drawEnd = Math.round(durationMs * 0.82);
    const fadeMs = Math.round(durationMs * 0.1);

    const layers: Layer[] = [
      { type: "shape", id: "space", shape: "rect", width: w, height: h, fill: params.background }
    ];
    if (params.stars) {
      layers.push(starfield(w, h));
    }

    // Labels ride inside the zoom group at the SETTLED projected positions,
    // so they stay glued to their surface points once the rotation stops
    // (they only appear after settleAt) and zoom with the globe.
    const labels: Layer[] = [];
    const label = (text: string, at: readonly [number, number], atMs: number): void => {
      if (!text) return;
      const p = projectLatLng(at, radius, yawEnd, pitchEnd);
      if (!p.front) return;
      labels.push({
        type: "text",
        id: `label-${text}`,
        text,
        size: Math.max(18, Math.round(radius * 0.09)),
        color: "#ffffff",
        align: "center",
        shadowColor: "rgba(0,0,0,0.75)",
        shadowBlur: 6,
        shadowDy: 2,
        startMs: atMs,
        transform: {
          x: p.x,
          y: p.y - radius * 0.07,
          opacity: [
            { timeMs: atMs, value: 0 },
            { timeMs: Math.min(atMs + 350, durationMs), value: 1, easing: "easeOut" }
          ]
        }
      });
    };
    label(params.fromLabel, params.from, Math.round(durationMs * 0.46));
    label(params.toLabel, params.to, Math.min(drawEnd + 150, durationMs));

    layers.push({
      type: "group",
      id: "globe-zoom",
      cache: false, // rotation + route animate every frame
      transform: {
        x: w / 2,
        y: h / 2,
        scale: [
          { timeMs: 0, value: 0.94 },
          { timeMs: durationMs, value: params.zoom, easing: SETTLE_EASE }
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
            { timeMs: 0, value: pitchEnd - 0.3 },
            { timeMs: settleAt, value: pitchEnd, easing: SETTLE_EASE }
          ],
          routes: [{
            from: [params.from[0], params.from[1]],
            to: [params.to[0], params.to[1]],
            color: params.routeColor,
            width: Math.max(2.5, radius * 0.016),
            altitude: 0.14,
            progress: [
              { timeMs: drawStart, value: 0 },
              { timeMs: drawEnd, value: 1, easing: DRAW_EASE }
            ]
          }]
        },
        ...labels
      ]
    });
    return layers;
  }
});
