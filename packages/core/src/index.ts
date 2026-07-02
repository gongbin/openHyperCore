export { defineComposition } from "./composition.ts";
export { resolveScalar } from "./animation.ts";
export { frameCount, resolveFrame, timeForFrame } from "./scheduler.ts";
export { TimelineBuilder, cinematicBars, createTimeline, flashTransitionLayer, glitchTitle, speedLineBurst } from "./effects.ts";
export type {
  CinematicBarsOptions,
  FlashTransitionOptions,
  FullFrameEffectOptions,
  GlitchTitleOptions,
  SpeedLineBurstOptions,
  TimelineBuild,
  TimelineContext,
  TimelineMarker
} from "./effects.ts";
export { cubicBezier, resolveEasing } from "./easing.ts";
export type { CubicBezierPoints, Easing, EasingFn, EasingLike } from "./easing.ts";
export { composeTimeline, delayTransition, fadeTransition, mergeTransforms, scaleTransition, slideTransition } from "./transitions.ts";
export type { FadeTransitionOptions, ScaleTransitionOptions, SlideTransitionOptions, TimedTransitionOptions } from "./transitions.ts";
export { TransitionSeriesBuilder, createTransitionSeries } from "./scene-transitions.ts";
export type {
  SceneTransitionDirection,
  SceneTransitionSpec,
  SceneTransitionType,
  TransitionSceneContext,
  TransitionSceneFactory,
  TransitionSeriesBuild,
  TransitionSeriesMarker,
  TransitionSeriesTransitionMarker
} from "./scene-transitions.ts";
export { interpolate, spring, springDurationMs, springKeyframes } from "./interpolate.ts";
export type { ExtrapolateType, InterpolateOptions, SpringConfig, SpringKeyframesOptions, SpringOptions } from "./interpolate.ts";
export { parseSubtitles, subtitlesToCaptions } from "./subtitles.ts";
export type { SubtitleCaptionOptions, SubtitleCue } from "./subtitles.ts";
export type {
  AnimatedScalar,
  AudioLayer,
  BaseLayer,
  BlendMode,
  CaptionLayer,
  Composition,
  Fill,
  GlobeLayer,
  Gradient,
  GradientStop,
  GroupLayer,
  GroupReveal,
  ImageLayer,
  Layer,
  LayerClip,
  LayerTransform,
  MotionBlur,
  PluginLayer,
  ResolvedFrame,
  ResolvedGlobeLayer,
  ResolvedGroupLayer,
  ResolvedGroupReveal,
  ResolvedLayer,
  ResolvedShapeLayer,
  ResolvedTransform,
  ScalarKeyframe,
  ShapeLayer,
  TextLayer,
  TextStyle,
  VideoLayer
} from "./types.ts";
