export { defineComposition } from "./composition.ts";
export { resolveScalar } from "./animation.ts";
export { frameCount, resolveFrame, timeForFrame } from "./scheduler.ts";
export { fadeTransition, mergeTransforms, scaleTransition, slideTransition } from "./transitions.ts";
export type { FadeTransitionOptions, ScaleTransitionOptions, SlideTransitionOptions, TimedTransitionOptions } from "./transitions.ts";
export type {
  AnimatedScalar,
  AudioLayer,
  BaseLayer,
  CaptionLayer,
  Composition,
  ImageLayer,
  Layer,
  LayerTransform,
  ResolvedFrame,
  ResolvedLayer,
  ResolvedTransform,
  ScalarKeyframe,
  ShapeLayer,
  TextLayer,
  VideoLayer
} from "./types.ts";
