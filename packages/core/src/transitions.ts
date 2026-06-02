import type { LayerTransform, ScalarKeyframe } from "./types.ts";

// Named easing presets. The render engine only interpolates linearly between
// keyframes, so non-linear easings are baked by sampling the curve into a
// handful of intermediate keyframes (see `keyframes`).
export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeOutBack";

export type EasingFn = (t: number) => number;

const EASINGS: Record<Exclude<Easing, "linear">, EasingFn> = {
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  }
};

// How many segments to sample non-linear easings into. 16 keeps the baked
// curve visually smooth at typical transition durations.
const EASING_SAMPLES = 16;

function easingFn(easing?: Easing | EasingFn): EasingFn | undefined {
  if (easing === undefined || easing === "linear") {
    return undefined;
  }
  if (typeof easing === "function") {
    return easing;
  }
  return EASINGS[easing];
}

export type TimedTransitionOptions = {
  startMs: number;
  durationMs: number;
  easing?: Easing | EasingFn;
};

export type FadeTransitionOptions = TimedTransitionOptions & {
  from?: number;
  to?: number;
};

export type SlideTransitionOptions = TimedTransitionOptions & {
  from: Partial<Pick<LayerTransform, "x" | "y">>;
  to: Partial<Pick<LayerTransform, "x" | "y">>;
};

export type ScaleTransitionOptions = TimedTransitionOptions & {
  from?: number;
  to?: number;
};

export function fadeTransition(options: FadeTransitionOptions): LayerTransform {
  return {
    opacity: keyframes(options, options.from ?? 0, options.to ?? 1)
  };
}

export function slideTransition(options: SlideTransitionOptions): LayerTransform {
  const transform: LayerTransform = {};
  const fromX = scalarValue(options.from.x);
  const toX = scalarValue(options.to.x);
  const fromY = scalarValue(options.from.y);
  const toY = scalarValue(options.to.y);

  if (fromX !== undefined || toX !== undefined) {
    transform.x = keyframes(options, fromX ?? 0, toX ?? 0);
  }
  if (fromY !== undefined || toY !== undefined) {
    transform.y = keyframes(options, fromY ?? 0, toY ?? 0);
  }
  if (transform.x === undefined && transform.y === undefined) {
    throw new Error("slideTransition requires from.x/to.x or from.y/to.y");
  }

  return transform;
}

export function scaleTransition(options: ScaleTransitionOptions): LayerTransform {
  return {
    scale: keyframes(options, options.from ?? 0, options.to ?? 1)
  };
}

export function mergeTransforms(...transforms: LayerTransform[]): LayerTransform {
  const merged: LayerTransform = {};
  for (const transform of transforms) {
    for (const property of ["x", "y", "scale", "rotate", "opacity"] as const) {
      const value = transform[property];
      if (value === undefined) {
        continue;
      }
      if (merged[property] !== undefined) {
        throw new Error(`Duplicate transform property: ${property}`);
      }
      merged[property] = value;
    }
  }
  return merged;
}

function keyframes(options: TimedTransitionOptions, from: number, to: number): ScalarKeyframe[] {
  assertTransitionTiming(options);
  const ease = easingFn(options.easing);
  if (!ease) {
    return [
      { timeMs: options.startMs, value: from },
      { timeMs: options.startMs + options.durationMs, value: to }
    ];
  }
  // Bake the eased curve into evenly-spaced keyframes; the engine then
  // interpolates linearly between these closely-spaced samples.
  const out: ScalarKeyframe[] = [];
  for (let i = 0; i <= EASING_SAMPLES; i++) {
    const t = i / EASING_SAMPLES;
    out.push({
      timeMs: options.startMs + options.durationMs * t,
      value: from + (to - from) * ease(t)
    });
  }
  return out;
}

function assertTransitionTiming(options: TimedTransitionOptions): void {
  if (!Number.isFinite(options.startMs) || options.startMs < 0) {
    throw new Error("startMs must be a non-negative number");
  }
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new Error("durationMs must be positive");
  }
}

function scalarValue(value: LayerTransform["x"]): number | undefined {
  return typeof value === "number" ? value : undefined;
}
