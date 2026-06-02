export { defineComposition } from "./composition.ts";
export { resolveScalar } from "./animation.ts";
export { frameCount, resolveFrame, timeForFrame } from "./scheduler.ts";
export { composeTimeline, delayTransition, fadeTransition, mergeTransforms, scaleTransition, slideTransition } from "./transitions.ts";
export type { Easing, EasingFn, FadeTransitionOptions, ScaleTransitionOptions, SlideTransitionOptions, TimedTransitionOptions } from "./transitions.ts";
export { parseSubtitles, subtitlesToCaptions } from "./subtitles.ts";
export type { SubtitleCaptionOptions, SubtitleCue } from "./subtitles.ts";
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
  TextStyle,
  VideoLayer
} from "./types.ts";
