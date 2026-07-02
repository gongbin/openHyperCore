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
    layers: composition.layers.filter((layer) => isActive(layer, timeMs, composition.durationMs)).map((layer) => resolveLayer(layer, timeMs, composition.durationMs, composition.defaultFont))
  };
}

function isActive(layer: Layer, timeMs: number, durationMs: number): boolean {
  const startMs = layer.startMs ?? 0;
  const endMs = layer.endMs ?? durationMs;
  return timeMs >= startMs && timeMs < endMs;
}

function resolveLayer(layer: Layer, timeMs: number, durationMs: number, defaultFont?: string): ResolvedLayer {
  if (layer.type === "plugin") {
    throw new Error(`unexpanded plugin layer "${layer.plugin}" — run expandComposition() (openhypercore/plugins) before resolving or rendering`);
  }
  const { transform, ...rest } = layer;
  // A group's own transform keyframes are ALSO local to its startMs, so the
  // whole block — including its entrance/exit animation — relocates by just
  // changing startMs.
  const transformTimeMs = layer.type === "group" ? timeMs - (layer.startMs ?? 0) : timeMs;
  const resolved = {
    ...rest,
    transform: resolveTransform(transform, transformTimeMs)
  } as ResolvedLayer;
  // Apply the composition-level default font to text/captions that don't set
  // their own, so each composition can pick its typeface without hardcoding.
  if ((resolved.type === "text" || resolved.type === "caption") && resolved.font === undefined && defaultFont !== undefined) {
    resolved.font = defaultFont;
  }
  // Group children live on the group's local timeline (0 = group startMs), so
  // they are filtered and resolved at the local time. The local window ends at
  // the group's own end on the parent timeline.
  if (layer.type === "group" && resolved.type === "group") {
    const startMs = layer.startMs ?? 0;
    const localTimeMs = timeMs - startMs;
    const localDurationMs = (layer.endMs ?? durationMs) - startMs;
    resolved.layers = layer.layers
      .filter((child) => isActive(child, localTimeMs, localDurationMs))
      .map((child) => resolveLayer(child, localTimeMs, localDurationMs, defaultFont));
    // Reveal progress also runs on the group's local timeline.
    if (layer.reveal) {
      resolved.reveal = {
        ...layer.reveal,
        progress: resolveScalar(layer.reveal.progress, localTimeMs, 1)
      };
    }
  }
  // Globe rotation/radius tracks resolve to plain numbers, like the transform.
  if (layer.type === "globe" && resolved.type === "globe") {
    resolved.radius = resolveScalar(layer.radius, transformTimeMs, 200);
    resolved.yaw = resolveScalar(layer.yaw, transformTimeMs, 0);
    resolved.pitch = resolveScalar(layer.pitch, transformTimeMs, 0);
  }
  // Path trim tracks resolve to plain numbers, like the transform.
  if (layer.type === "shape" && resolved.type === "shape") {
    if (layer.trimStart !== undefined) {
      resolved.trimStart = resolveScalar(layer.trimStart, transformTimeMs, 0);
    }
    if (layer.trimEnd !== undefined) {
      resolved.trimEnd = resolveScalar(layer.trimEnd, transformTimeMs, 1);
    }
  }
  return resolved;
}

function resolveTransform(transform: Layer["transform"], timeMs: number): ResolvedTransform {
  return {
    x: resolveScalar(transform?.x, timeMs, 0),
    y: resolveScalar(transform?.y, timeMs, 0),
    scale: resolveScalar(transform?.scale, timeMs, 1),
    scaleX: resolveScalar(transform?.scaleX, timeMs, 1),
    scaleY: resolveScalar(transform?.scaleY, timeMs, 1),
    rotate: resolveScalar(transform?.rotate, timeMs, 0),
    opacity: resolveScalar(transform?.opacity, timeMs, 1)
  };
}
