import { resolveEasing } from "./easing.ts";
import type { EasingLike } from "./easing.ts";
import type { ScalarKeyframe } from "./types.ts";

// Arc / motion-path animation (HyperFrames "Arc Motion" parity): move a layer
// along a smooth curve through waypoints instead of straight per-axis lines.
// Like springKeyframes(), the curve is BAKED into plain x/y (+rotate)
// keyframe tracks — fully serializable, renderers untouched.

export type MotionPathOptions = {
  // Waypoints the curve passes through, in order (start … end, ≥2).
  points: [number, number][];
  durationMs: number;
  startMs?: number;
  // 0 = straight polyline; 1 = gentle arc (default); up to ~3 for big swings.
  curviness?: number;
  // Bake a rotate track that follows the path tangent; a number adds a
  // degree offset (e.g. 90 for an element whose artwork points up).
  autoRotate?: boolean | number;
  // Progress curve over the whole path (named preset, fn, or bezier tuple);
  // travel speed is arc-length uniform before easing is applied.
  easing?: EasingLike;
  // Baked keyframes per track (more = smoother curve; default 24).
  keyframes?: number;
};

export type MotionPathTracks = {
  x: ScalarKeyframe[];
  y: ScalarKeyframe[];
  rotate?: ScalarKeyframe[];
};

const SAMPLES = 256;

export function motionPathKeyframes(options: MotionPathOptions): MotionPathTracks {
  const { points, durationMs } = options;
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("motionPathKeyframes requires at least 2 points");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("motionPathKeyframes durationMs must be positive");
  }
  const startMs = options.startMs ?? 0;
  const curviness = Math.max(0, options.curviness ?? 1);
  const keyframeCount = Math.max(2, Math.round(options.keyframes ?? 24));
  const ease = resolveEasing(options.easing) ?? ((t: number) => t);

  // Dense samples along the spline + cumulative arc length, so progress maps
  // to distance travelled (constant speed) rather than raw parameter t.
  const samples: [number, number][] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    samples.push(splinePoint(points, curviness, i / SAMPLES));
  }
  const lengths: number[] = [0];
  for (let i = 1; i < samples.length; i += 1) {
    lengths.push(lengths[i - 1]! + Math.hypot(samples[i]![0] - samples[i - 1]![0], samples[i]![1] - samples[i - 1]![1]));
  }
  const total = lengths[lengths.length - 1]! || 1;

  const pointAtLength = (target: number): { p: [number, number]; index: number } => {
    let lo = 0;
    let hi = lengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const span = lengths[i]! - lengths[i - 1]! || 1;
    const f = (target - lengths[i - 1]!) / span;
    const a = samples[i - 1]!;
    const b = samples[i]!;
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], index: i };
  };

  const rotateOffset = typeof options.autoRotate === "number" ? options.autoRotate : 0;
  const wantRotate = options.autoRotate === true || typeof options.autoRotate === "number";

  const x: ScalarKeyframe[] = [];
  const y: ScalarKeyframe[] = [];
  const rotate: ScalarKeyframe[] = [];
  let lastAngle = 0;
  for (let k = 0; k <= keyframeCount; k += 1) {
    const t = k / keyframeCount;
    const { p, index } = pointAtLength(Math.min(1, Math.max(0, ease(t))) * total);
    const timeMs = Math.round(startMs + t * durationMs);
    x.push({ timeMs, value: round2(p[0]) });
    y.push({ timeMs, value: round2(p[1]) });
    if (wantRotate) {
      const a = samples[index - 1]!;
      const b = samples[index]!;
      let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + rotateOffset;
      // Unwrap so the track never jumps across ±180 (no sudden spins).
      while (angle - lastAngle > 180) angle -= 360;
      while (angle - lastAngle < -180) angle += 360;
      lastAngle = angle;
      rotate.push({ timeMs, value: round2(angle) });
    }
  }

  return wantRotate ? { x, y, rotate } : { x, y };
}

// Catmull-Rom-style spline through the waypoints; `curviness` scales the
// tangents (0 = straight segments, 1 ≈ GSAP's gentle default).
function splinePoint(points: [number, number][], curviness: number, t: number): [number, number] {
  const segments = points.length - 1;
  const clamped = Math.min(1, Math.max(0, t));
  const seg = Math.min(segments - 1, Math.floor(clamped * segments));
  const local = clamped * segments - seg;

  const p0 = points[Math.max(0, seg - 1)]!;
  const p1 = points[seg]!;
  const p2 = points[seg + 1]!;
  const p3 = points[Math.min(points.length - 1, seg + 2)]!;

  const tension = curviness * 0.5;
  const h00 = (2 * local ** 3 - 3 * local ** 2 + 1);
  const h10 = (local ** 3 - 2 * local ** 2 + local);
  const h01 = (-2 * local ** 3 + 3 * local ** 2);
  const h11 = (local ** 3 - local ** 2);

  const m1x = tension * (p2[0] - p0[0]);
  const m1y = tension * (p2[1] - p0[1]);
  const m2x = tension * (p3[0] - p1[0]);
  const m2y = tension * (p3[1] - p1[1]);

  return [
    h00 * p1[0] + h10 * m1x + h01 * p2[0] + h11 * m2x,
    h00 * p1[1] + h10 * m1y + h01 * p2[1] + h11 * m2y
  ];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
