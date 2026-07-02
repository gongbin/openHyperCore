import type { Layer } from "../../../core/src/index.ts";

// Shared pieces for the globe-* plugins: starfield, atmosphere glow, and the
// view-space projection math matching the engine's globe mesh/route drawing.

// Static seeded starfield in ONE cached group: content never changes, so the
// renderer rasters it once and blits it for every following frame.
export function starfield(w: number, h: number): Layer {
  const rand = seeded(7);
  const stars: Layer[] = [];
  for (let i = 0; i < 90; i += 1) {
    const r = 0.6 + rand() * 1.1;
    stars.push({
      type: "shape",
      shape: "circle",
      radius: r,
      fill: "#dfe9ff",
      transform: { x: rand() * w, y: rand() * h, opacity: 0.25 + rand() * 0.6 }
    });
  }
  return { type: "group", id: "stars", cache: true, layers: stars };
}

export function atmosphere(globeRadius: number, color: string): Layer {
  const r = Math.round(globeRadius * 1.24);
  return {
    type: "shape",
    id: "atmosphere",
    shape: "circle",
    radius: r,
    fill: {
      type: "radial",
      center: [r, r],
      radius: r,
      stops: [
        { offset: 0, color: "rgba(0,0,0,0)" },
        { offset: 0.72, color: "rgba(0,0,0,0)" },
        { offset: 0.84, color: withAlpha(color, 0.4) },
        { offset: 1, color: "rgba(0,0,0,0)" }
      ]
    },
    transform: { x: -r, y: -r }
  };
}

// Project a [lat, lng] point to globe-local screen space for a given settled
// yaw/pitch — the same model→view transpose the renderers use, so labels
// placed with this land exactly on the drawn surface point.
export function projectLatLng(latLng: readonly [number, number], radius: number, yaw: number, pitch: number): { x: number; y: number; front: boolean } {
  const la = (latLng[0] * Math.PI) / 180;
  const lo = (latLng[1] * Math.PI) / 180;
  const mx = Math.cos(la) * Math.sin(lo);
  const my = Math.sin(la);
  const mz = Math.cos(la) * Math.cos(lo);
  const cosS = Math.cos(yaw);
  const sinS = Math.sin(yaw);
  const cosT = Math.cos(pitch);
  const sinT = Math.sin(pitch);
  const nx = cosS * mx - sinS * mz;
  const ny = sinT * sinS * mx + cosT * my + sinT * cosS * mz;
  const nz = cosT * sinS * mx - sinT * my + cosT * cosS * mz;
  return { x: nx * radius, y: -ny * radius, front: nz > 0 };
}

// Great-circle midpoint of two [lat, lng] points, as [lat, lng].
export function greatCircleMidpoint(a: readonly [number, number], b: readonly [number, number]): [number, number] {
  const vec = ([lat, lng]: readonly [number, number]): [number, number, number] => {
    const la = (lat * Math.PI) / 180;
    const lo = (lng * Math.PI) / 180;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  };
  const va = vec(a);
  const vb = vec(b);
  const m: [number, number, number] = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]];
  const len = Math.hypot(m[0], m[1], m[2]) || 1;
  const [mx, my, mz] = [m[0] / len, m[1] / len, m[2] / len];
  return [(Math.asin(Math.max(-1, Math.min(1, my))) * 180) / Math.PI, (Math.atan2(mx, mz) * 180) / Math.PI];
}

export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function seeded(seed: number): () => number {
  let state = Math.max(1, Math.floor(seed)) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
