import { resolveEasing } from "./easing.ts";
import type { AnimatedScalar, ScalarKeyframe } from "./types.ts";

export function resolveScalar(value: AnimatedScalar | undefined, timeMs: number, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "number") {
    return value;
  }

  if (value.length === 0) {
    return fallback;
  }

  const sorted = [...value].sort((a, b) => a.timeMs - b.timeMs);
  const first = sorted[0]!;
  if (timeMs <= first.timeMs) {
    return first.value;
  }

  const last = sorted[sorted.length - 1]!;
  if (timeMs >= last.timeMs) {
    return last.value;
  }

  const nextIndex = sorted.findIndex((frame) => frame.timeMs >= timeMs);
  const previous = sorted[nextIndex - 1]!;
  const next = sorted[nextIndex] as ScalarKeyframe;
  let progress = (timeMs - previous.timeMs) / (next.timeMs - previous.timeMs);
  // The segment's curve is carried by its END keyframe ("ease into this value").
  const ease = resolveEasing(next.easing);
  if (ease) {
    progress = ease(progress);
  }

  return previous.value + (next.value - previous.value) * progress;
}
