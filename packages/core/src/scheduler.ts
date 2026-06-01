import { resolveScalar } from "./animation.ts";
import type { Composition, Layer, ResolvedFrame, ResolvedLayer, ResolvedTransform } from "./types.ts";

export function frameCount(composition: Composition): number {
  return Math.ceil((composition.durationMs / 1000) * composition.fps);
}

export function timeForFrame(composition: Composition, frameIndex: number): number {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new Error("frameIndex must be a non-negative integer");
  }

  return Math.round((frameIndex / composition.fps) * 1000);
}

export function resolveFrame(composition: Composition, timeMs: number): ResolvedFrame {
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    throw new Error("timeMs must be a non-negative number");
  }

  return {
    composition: {
      fps: composition.fps,
      width: composition.width,
      height: composition.height,
      durationMs: composition.durationMs
    },
    timeMs,
    layers: composition.layers.filter((layer) => isActive(layer, timeMs, composition.durationMs)).map((layer) => resolveLayer(layer, timeMs))
  };
}

function isActive(layer: Layer, timeMs: number, durationMs: number): boolean {
  const startMs = layer.startMs ?? 0;
  const endMs = layer.endMs ?? durationMs;
  return timeMs >= startMs && timeMs < endMs;
}

function resolveLayer(layer: Layer, timeMs: number): ResolvedLayer {
  const { transform, ...rest } = layer;
  return {
    ...rest,
    transform: resolveTransform(transform, timeMs)
  } as ResolvedLayer;
}

function resolveTransform(transform: Layer["transform"], timeMs: number): ResolvedTransform {
  return {
    x: resolveScalar(transform?.x, timeMs, 0),
    y: resolveScalar(transform?.y, timeMs, 0),
    scale: resolveScalar(transform?.scale, timeMs, 1),
    rotate: resolveScalar(transform?.rotate, timeMs, 0),
    opacity: resolveScalar(transform?.opacity, timeMs, 1)
  };
}
