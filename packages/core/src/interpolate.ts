import type { GroupLayer, Layer, ScalarKeyframe } from "./types.ts";
import type { EasingFn } from "./easing.ts";

export type ExtrapolateType = "extend" | "clamp" | "identity";

export type InterpolateOptions = {
  easing?: EasingFn;
  extrapolateLeft?: ExtrapolateType;
  extrapolateRight?: ExtrapolateType;
};

// Remotion-compatible interpolate(): maps `input` across multi-segment
// `inputRange` → `outputRange`, with optional easing per segment and
// extend/clamp/identity extrapolation outside the range.
export function interpolate(input: number, inputRange: readonly number[], outputRange: readonly number[], options: InterpolateOptions = {}): number {
  if (inputRange.length < 2) {
    throw new Error("inputRange must have at least 2 elements");
  }
  if (inputRange.length !== outputRange.length) {
    throw new Error("inputRange and outputRange must have the same length");
  }
  for (const value of inputRange) {
    if (!Number.isFinite(value)) {
      throw new Error("inputRange must contain only finite numbers");
    }
  }
  for (const value of outputRange) {
    if (!Number.isFinite(value)) {
      throw new Error("outputRange must contain only finite numbers");
    }
  }
  for (let i = 1; i < inputRange.length; i++) {
    if (inputRange[i]! <= inputRange[i - 1]!) {
      throw new Error("inputRange must be strictly monotonically increasing");
    }
  }
  if (!Number.isFinite(input)) {
    throw new Error("input must be a finite number");
  }

  const extrapolateLeft = options.extrapolateLeft ?? "extend";
  const extrapolateRight = options.extrapolateRight ?? "extend";

  if (input < inputRange[0]!) {
    if (extrapolateLeft === "identity") {
      return input;
    }
    if (extrapolateLeft === "clamp") {
      return outputRange[0]!;
    }
  }
  if (input > inputRange[inputRange.length - 1]!) {
    if (extrapolateRight === "identity") {
      return input;
    }
    if (extrapolateRight === "clamp") {
      return outputRange[outputRange.length - 1]!;
    }
  }

  // Pick the segment containing the input (first for left-extend, last for
  // right-extend).
  let segment = inputRange.length - 2;
  for (let i = 1; i < inputRange.length; i++) {
    if (input < inputRange[i]!) {
      segment = i - 1;
      break;
    }
  }

  const x0 = inputRange[segment]!;
  const x1 = inputRange[segment + 1]!;
  const y0 = outputRange[segment]!;
  const y1 = outputRange[segment + 1]!;

  let progress = (input - x0) / (x1 - x0);
  if (options.easing) {
    progress = options.easing(progress);
  }
  return y0 + (y1 - y0) * progress;
}

export type SpringConfig = {
  mass?: number;
  stiffness?: number;
  damping?: number;
  // Initial velocity in units of (to - from) per second.
  initialVelocity?: number;
  // When true the value never passes `to` (no bounce past the target).
  overshootClamping?: boolean;
};

export type SpringOptions = SpringConfig & {
  from?: number;
  to?: number;
};

const DEFAULT_MASS = 1;
const DEFAULT_STIFFNESS = 100;
const DEFAULT_DAMPING = 10;

// Evaluate a damped spring at `timeMs` since the animation start, moving from
// `from` to `to`. Closed-form solution of the damped harmonic oscillator, so
// it can be sampled at any time without stepping a simulation.
export function spring(timeMs: number, options: SpringOptions = {}): number {
  const from = options.from ?? 0;
  const to = options.to ?? 1;
  if (timeMs <= 0) {
    return from;
  }

  const mass = options.mass ?? DEFAULT_MASS;
  const stiffness = options.stiffness ?? DEFAULT_STIFFNESS;
  const damping = options.damping ?? DEFAULT_DAMPING;
  if (mass <= 0 || stiffness <= 0 || damping < 0) {
    throw new Error("spring requires mass > 0, stiffness > 0 and damping >= 0");
  }

  const t = timeMs / 1000;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  // Normalised: x(0) = 1 (full displacement from target), x(∞) = 0.
  const v0 = -(options.initialVelocity ?? 0);

  let displacement: number;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    displacement = Math.exp(-zeta * omega0 * t) *
      (Math.cos(omegaD * t) + ((zeta * omega0 + v0) / omegaD) * Math.sin(omegaD * t));
  } else if (zeta === 1) {
    displacement = Math.exp(-omega0 * t) * (1 + (omega0 + v0) * t);
  } else {
    const omegaR = omega0 * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * omega0 + omegaR;
    const r2 = -zeta * omega0 - omegaR;
    const c2 = (v0 - r1) / (r2 - r1);
    const c1 = 1 - c2;
    displacement = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
  }

  if (options.overshootClamping && displacement < 0) {
    displacement = 0;
  }

  return to - (to - from) * displacement;
}

export type SpringKeyframesOptions = SpringOptions & {
  startMs?: number;
  // Sampling rate; match the composition fps for exact per-frame values.
  fps?: number;
  // Hard cap on the sampled duration. Without it, sampling stops once the
  // spring has visibly settled.
  durationMs?: number;
};

// How close to the target (as a fraction of the from→to distance) the spring
// must stay to be considered settled.
const SPRING_SETTLE_THRESHOLD = 0.005;
const SPRING_MAX_DURATION_MS = 10_000;

// Sample a spring into ScalarKeyframe[] for the keyframe IR. The track starts
// at `startMs` and ends once the spring settles (or at `durationMs`), with the
// final keyframe pinned to `to` so the layer holds the target value.
export function springKeyframes(options: SpringKeyframesOptions = {}): ScalarKeyframe[] {
  const from = options.from ?? 0;
  const to = options.to ?? 1;
  const startMs = options.startMs ?? 0;
  const fps = options.fps ?? 30;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("fps must be positive");
  }

  const stepMs = 1000 / fps;
  const maxMs = options.durationMs ?? SPRING_MAX_DURATION_MS;
  const range = Math.abs(to - from) || 1;

  const frames: ScalarKeyframe[] = [];
  let settledRunMs = 0;
  for (let elapsed = 0; elapsed <= maxMs; elapsed += stepMs) {
    const value = spring(elapsed, options);
    frames.push({ timeMs: startMs + elapsed, value });

    if (options.durationMs === undefined) {
      // Stop after the value has stayed within the settle threshold for a few
      // consecutive frames (a single zero-crossing isn't settled).
      if (Math.abs(value - to) / range < SPRING_SETTLE_THRESHOLD) {
        settledRunMs += stepMs;
        if (settledRunMs >= stepMs * 3) {
          break;
        }
      } else {
        settledRunMs = 0;
      }
    }
  }

  const last = frames[frames.length - 1]!;
  if (last.value !== to) {
    frames.push({ timeMs: last.timeMs + stepMs, value: to });
  }
  return frames;
}

// Total time until the spring settles — useful for sizing layer/scene
// durations around a spring entrance.
export function springDurationMs(options: SpringOptions = {}, fps = 30): number {
  const frames = springKeyframes({ ...options, fps });
  return frames[frames.length - 1]!.timeMs;
}

// Remotion-compatible deterministic random: the same seed always yields the
// same number in [0, 1) — safe for renders that must be reproducible across
// frames, workers and machines (never use Math.random in a composition).
export function random(seed: string | number | null): number {
  const s = String(seed);
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 0x1_0000_0000;
}

// Stagger a cascade: each layer is wrapped in a group starting stepMs after
// the previous one, so the layer's own startMs/keyframes become LOCAL and the
// whole entrance replays per item (Remotion <Series>/stagger semantics).
export function stagger(layers: Layer[], stepMs: number, startMs = 0): GroupLayer[] {
  if (!Number.isFinite(stepMs) || stepMs < 0) {
    throw new Error("stagger stepMs must be a non-negative number");
  }
  return layers.map((layer, index) => ({
    type: "group",
    startMs: startMs + index * stepMs,
    layers: [layer]
  }));
}
