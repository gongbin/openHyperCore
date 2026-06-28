import { resolveEasing } from "./easing.ts";
import type { EasingLike } from "./easing.ts";
import type { AnimatedScalar, LayerTransform, ScalarKeyframe } from "./types.ts";

// How many segments to sample non-linear easings into. 16 keeps the baked
// curve visually smooth at typical transition durations.
const EASING_SAMPLES = 16;

export type TimedTransitionOptions = {
  startMs: number;
  durationMs: number;
  easing?: EasingLike;
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

const TRANSFORM_PROPERTIES = ["x", "y", "scale", "scaleX", "scaleY", "rotate", "opacity"] as const;

export function mergeTransforms(...transforms: LayerTransform[]): LayerTransform {
  const merged: LayerTransform = {};
  for (const transform of transforms) {
    for (const property of TRANSFORM_PROPERTIES) {
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

function toKeyframes(value: AnimatedScalar): ScalarKeyframe[] {
  return typeof value === "number" ? [{ timeMs: 0, value }] : value;
}

// Timeline DSL: compose several transitions of the SAME property over time
// into one keyframe track — e.g. an entrance fade-in followed by an exit
// fade-out on `opacity`. Unlike `mergeTransforms`, overlapping properties are
// concatenated (sorted by time) instead of rejected, so you can choreograph
// multi-stage entrance/exit animations on a single layer.
export function composeTimeline(...transforms: LayerTransform[]): LayerTransform {
  const out: LayerTransform = {};
  for (const property of TRANSFORM_PROPERTIES) {
    const tracks = transforms
      .map((transform) => transform[property])
      .filter((value): value is AnimatedScalar => value !== undefined);
    if (tracks.length === 0) {
      continue;
    }
    const frames = tracks.flatMap(toKeyframes).sort((a, b) => a.timeMs - b.timeMs);
    out[property] = frames;
  }
  return out;
}

// Shift every keyframe of a transform by `offsetMs` — handy for staggering a
// shared entrance across multiple layers, or delaying an exit.
export function delayTransition(transform: LayerTransform, offsetMs: number): LayerTransform {
  const out: LayerTransform = {};
  for (const property of TRANSFORM_PROPERTIES) {
    const value = transform[property];
    if (value === undefined) {
      continue;
    }
    out[property] = toKeyframes(value).map((frame) => ({ ...frame, timeMs: frame.timeMs + offsetMs }));
  }
  return out;
}

function keyframes(options: TimedTransitionOptions, from: number, to: number): ScalarKeyframe[] {
  assertTransitionTiming(options);
  const ease = resolveEasing(options.easing);
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
