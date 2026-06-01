import type { LayerTransform, ScalarKeyframe } from "./types.ts";

export type TimedTransitionOptions = {
  startMs: number;
  durationMs: number;
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
  return [
    { timeMs: options.startMs, value: from },
    { timeMs: options.startMs + options.durationMs, value: to }
  ];
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
