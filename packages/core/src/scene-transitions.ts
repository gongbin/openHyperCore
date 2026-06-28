import { defineComposition } from "./composition.ts";
import { resolveEasing } from "./easing.ts";
import type { EasingLike } from "./easing.ts";
import type { AnimatedScalar, Composition, GroupLayer, GroupReveal, Layer, LayerTransform, ScalarKeyframe } from "./types.ts";

// Scene-level transitions in the spirit of @remotion/transitions: adjacent
// scenes OVERLAP for the transition duration and the incoming scene is
// presented over the outgoing one — a mask reveal (wipe/clockWipe), a push
// (slide), or a squash-flip around the scene centre (flip).

export type SceneTransitionType = "wipe" | "clockWipe" | "slide" | "flip";

export type SceneTransitionDirection = "from-left" | "from-right" | "from-top" | "from-bottom";

export type SceneTransitionSpec = {
  type: SceneTransitionType;
  durationMs: number;
  // wipe/slide: which edge the incoming scene enters from (default from-left).
  // flip: from-left/from-right flip horizontally, from-top/from-bottom
  // vertically. Ignored by clockWipe.
  direction?: SceneTransitionDirection;
  easing?: EasingLike;
};

export type TransitionSceneContext = {
  name: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
};

export type TransitionSceneFactory = (context: TransitionSceneContext) => Layer[];

export type TransitionSeriesMarker = {
  startMs: number;
  endMs: number;
  durationMs: number;
};

export type TransitionSeriesTransitionMarker = TransitionSeriesMarker & {
  type: SceneTransitionType;
  from: string;
  to: string;
};

export type TransitionSeriesBuild = {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  layers: Layer[];
  markers: Record<string, TransitionSeriesMarker>;
  transitions: TransitionSeriesTransitionMarker[];
  composition: Composition;
};

type SceneEntry = {
  name: string;
  durationMs: number;
  factory: TransitionSceneFactory;
};

export function createTransitionSeries(options: { width: number; height: number; fps: number }): TransitionSeriesBuilder {
  return new TransitionSeriesBuilder(options.width, options.height, options.fps);
}

export class TransitionSeriesBuilder {
  readonly #width: number;
  readonly #height: number;
  readonly #fps: number;
  readonly #scenes: SceneEntry[] = [];
  // Transition between scene i and scene i+1 (sparse).
  readonly #transitions: Array<SceneTransitionSpec | undefined> = [];
  #pending: SceneTransitionSpec | undefined;

  constructor(width: number, height: number, fps: number) {
    this.#width = width;
    this.#height = height;
    this.#fps = fps;
  }

  scene(name: string, durationMs: number, factory: TransitionSceneFactory): this {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error("scene durationMs must be positive");
    }
    if (this.#scenes.some((scene) => scene.name === name)) {
      throw new Error(`duplicate scene name: ${name}`);
    }
    if (this.#pending) {
      this.#transitions[this.#scenes.length - 1] = this.#pending;
      this.#pending = undefined;
    }
    this.#scenes.push({ name, durationMs, factory });
    return this;
  }

  transition(spec: SceneTransitionSpec): this {
    if (this.#scenes.length === 0) {
      throw new Error("transition() requires a preceding scene()");
    }
    if (this.#pending) {
      throw new Error("two consecutive transitions — add a scene between them");
    }
    if (!Number.isFinite(spec.durationMs) || spec.durationMs <= 0) {
      throw new Error("transition durationMs must be positive");
    }
    this.#pending = spec;
    return this;
  }

  build(): TransitionSeriesBuild {
    if (this.#pending) {
      throw new Error("a trailing transition has no following scene");
    }
    if (this.#scenes.length === 0) {
      throw new Error("createTransitionSeries needs at least one scene");
    }

    // Overlap timing: each transition pulls the next scene forward, so the
    // total duration is sum(scenes) - sum(transitions).
    const starts: number[] = [];
    let cursorMs = 0;
    for (const [index, scene] of this.#scenes.entries()) {
      const inSpec = index > 0 ? this.#transitions[index - 1] : undefined;
      if (inSpec) {
        if (inSpec.durationMs >= scene.durationMs || inSpec.durationMs >= this.#scenes[index - 1]!.durationMs) {
          throw new Error(`transition between "${this.#scenes[index - 1]!.name}" and "${scene.name}" must be shorter than both scenes`);
        }
        cursorMs -= inSpec.durationMs;
      }
      starts.push(cursorMs);
      cursorMs += scene.durationMs;
    }
    const durationMs = cursorMs;

    const layers: Layer[] = [];
    const markers: Record<string, TransitionSeriesMarker> = {};
    const transitions: TransitionSeriesTransitionMarker[] = [];

    for (const [index, scene] of this.#scenes.entries()) {
      const startMs = starts[index]!;
      markers[scene.name] = { startMs, endMs: startMs + scene.durationMs, durationMs: scene.durationMs };
      layers.push(this.#buildSceneGroup(scene, startMs, this.#transitions[index - 1], this.#transitions[index]));
    }
    for (const [index, spec] of this.#transitions.entries()) {
      if (!spec) {
        continue;
      }
      const startMs = starts[index + 1]!;
      transitions.push({
        type: spec.type,
        from: this.#scenes[index]!.name,
        to: this.#scenes[index + 1]!.name,
        startMs,
        endMs: startMs + spec.durationMs,
        durationMs: spec.durationMs
      });
    }

    const composition = defineComposition({
      fps: this.#fps,
      width: this.#width,
      height: this.#height,
      durationMs,
      layers
    });
    return {
      width: this.#width,
      height: this.#height,
      fps: this.#fps,
      durationMs,
      layers,
      markers,
      transitions,
      composition
    };
  }

  // One scene = one group on the parent timeline. The in/out transitions only
  // touch this group (reveal mask, slide keyframes) or a centre-pivot wrapper
  // inside it (flip), so they compose freely — e.g. flip in + wipe out.
  #buildSceneGroup(scene: SceneEntry, startMs: number, inSpec: SceneTransitionSpec | undefined, outSpec: SceneTransitionSpec | undefined): GroupLayer {
    const width = this.#width;
    const height = this.#height;
    const sceneLayers = scene.factory({
      name: scene.name,
      durationMs: scene.durationMs,
      width,
      height,
      fps: this.#fps
    });

    const transform: LayerTransform = {};
    let reveal: GroupReveal | undefined;
    const pivot: { scaleX?: ScalarKeyframe[]; scaleY?: ScalarKeyframe[] } = {};

    if (inSpec) {
      const d = inSpec.durationMs;
      if (inSpec.type === "wipe" || inSpec.type === "clockWipe") {
        reveal = {
          type: inSpec.type === "wipe" ? "wipe" : "clock",
          direction: inSpec.direction ?? "from-left",
          width,
          height,
          progress: easedKeyframes(0, d, 0, 1, inSpec.easing)
        };
      } else if (inSpec.type === "slide") {
        const { axis, enterFrom } = slideOffsets(inSpec.direction ?? "from-left", width, height);
        transform[axis] = easedKeyframes(0, d, enterFrom, 0, inSpec.easing);
      } else {
        // flip in: hidden (scale 0) through the outgoing scene's half, then
        // unfold around the scene centre during the second half.
        const axis = flipAxis(inSpec.direction);
        pivot[axis] = [
          { timeMs: 0, value: 0 },
          ...easedKeyframes(d / 2, d / 2, 0, 1, inSpec.easing)
        ];
      }
    }

    if (outSpec) {
      const d = outSpec.durationMs;
      const outStart = scene.durationMs - d;
      if (outSpec.type === "slide") {
        // Push: the outgoing scene exits towards the opposite edge the
        // incoming one enters from.
        const { axis, exitTo } = slideOffsets(outSpec.direction ?? "from-left", width, height);
        const track = easedKeyframes(outStart, d, 0, exitTo, outSpec.easing);
        transform[axis] = transform[axis] ? mergeTracks(transform[axis], track) : track;
      } else if (outSpec.type === "flip") {
        // flip out: fold to scale 0 during the first half of the overlap.
        const axis = flipAxis(outSpec.direction);
        const track = easedKeyframes(outStart, d / 2, 1, 0, outSpec.easing);
        pivot[axis] = pivot[axis] ? mergeTracks(pivot[axis], track) : track;
      }
      // wipe/clockWipe out: nothing — the incoming scene's mask covers us.
    }

    // Flip needs a centre pivot: scale around (w/2, h/2) via a wrapper pair.
    const pivotTransform: LayerTransform = { x: width / 2, y: height / 2 };
    if (pivot.scaleX) {
      pivotTransform.scaleX = pivot.scaleX;
    }
    if (pivot.scaleY) {
      pivotTransform.scaleY = pivot.scaleY;
    }
    const children = pivot.scaleX || pivot.scaleY
      ? [{
          type: "group" as const,
          id: `${scene.name}-flip-pivot`,
          transform: pivotTransform,
          layers: [{
            type: "group" as const,
            transform: { x: -width / 2, y: -height / 2 },
            layers: sceneLayers
          }]
        }]
      : sceneLayers;

    return {
      type: "group",
      id: `scene-${scene.name}`,
      startMs,
      endMs: startMs + scene.durationMs,
      ...(Object.keys(transform).length > 0 ? { transform } : {}),
      ...(reveal ? { reveal } : {}),
      layers: children
    };
  }
}

function flipAxis(direction: SceneTransitionDirection | undefined): "scaleX" | "scaleY" {
  return direction === "from-top" || direction === "from-bottom" ? "scaleY" : "scaleX";
}

// Where the incoming scene starts (enterFrom) and the outgoing one ends
// (exitTo) for a push-slide along the direction's axis.
function slideOffsets(direction: SceneTransitionDirection, width: number, height: number): { axis: "x" | "y"; enterFrom: number; exitTo: number } {
  if (direction === "from-right") {
    return { axis: "x", enterFrom: width, exitTo: -width };
  }
  if (direction === "from-top") {
    return { axis: "y", enterFrom: -height, exitTo: height };
  }
  if (direction === "from-bottom") {
    return { axis: "y", enterFrom: height, exitTo: -height };
  }
  return { axis: "x", enterFrom: -width, exitTo: width };
}

const EASING_SAMPLES = 16;

function easedKeyframes(startMs: number, durationMs: number, from: number, to: number, easing?: EasingLike): ScalarKeyframe[] {
  const ease = resolveEasing(easing);
  if (!ease) {
    return [
      { timeMs: startMs, value: from },
      { timeMs: startMs + durationMs, value: to }
    ];
  }
  const frames: ScalarKeyframe[] = [];
  for (let i = 0; i <= EASING_SAMPLES; i++) {
    const t = i / EASING_SAMPLES;
    frames.push({ timeMs: startMs + durationMs * t, value: from + (to - from) * ease(t) });
  }
  return frames;
}

// Concatenate two keyframe tracks of the same property (an entrance and an
// exit segment) sorted by time.
function mergeTracks(a: AnimatedScalar | undefined, b: ScalarKeyframe[]): ScalarKeyframe[] {
  const frames = typeof a === "number" ? [{ timeMs: 0, value: a }] : [...(a ?? [])];
  return [...frames, ...b].sort((x, y) => x.timeMs - y.timeMs);
}
