import type { EasingLike } from "./easing.ts";

export type ScalarKeyframe = {
  timeMs: number;
  value: number;
  // Easing for the segment that ENDS at this keyframe ("ease into this value").
  // A named preset, a custom function, or a cubic-bezier tuple [x1,y1,x2,y2].
  // The first keyframe's easing is unused (no preceding segment).
  easing?: EasingLike;
};

export type AnimatedScalar = number | ScalarKeyframe[];

export type LayerTransform = {
  x?: AnimatedScalar;
  y?: AnimatedScalar;
  scale?: AnimatedScalar;
  // Per-axis scale, multiplied with the uniform `scale` (default 1). scaleX 1→0
  // is the basis of flip transitions.
  scaleX?: AnimatedScalar;
  scaleY?: AnimatedScalar;
  rotate?: AnimatedScalar;
  opacity?: AnimatedScalar;
};

export type ResolvedTransform = {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  opacity: number;
};

export type GradientStop = { offset: number; color: string };

// Gradient paint for fills/colors. Coordinates are in the layer's LOCAL space
// (the same space the shape/text is drawn in, before the layer transform).
export type Gradient =
  | { type: "linear"; from: [number, number]; to: [number, number]; stops: GradientStop[] }
  | { type: "radial"; center: [number, number]; radius: number; stops: GradientStop[] };

// A fill is a solid CSS color string or a gradient.
export type Fill = string | Gradient;

// Porter-Duff / separable blend modes applied when a layer composites onto the
// content beneath it. "normal" is the default source-over.
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "add"
  | "color-dodge"
  | "color-burn"
  | "soft-light"
  | "hard-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

// Directional (accumulation) motion blur: the layer is drawn `samples` times
// smeared along `angle` over a total `distance` (parent-space px), each sample
// at reduced alpha. Set `angle`/`distance` to match the layer's motion.
export type MotionBlur = { angle: number; distance: number; samples?: number };

// Arbitrary clip region applied to a layer's own content (in its LOCAL space,
// after the layer transform). Clips any layer type — shape, text, image, video
// or a whole group — so a subtree can be masked to a rounded card, a circle
// avatar, or any SVG path.
export type LayerClip =
  | { type: "rect"; width: number; height: number; x?: number; y?: number; radius?: number }
  | { type: "circle"; radius: number; cx?: number; cy?: number }
  | { type: "path"; path: string; fillRule?: "nonzero" | "evenodd" };

export type BaseLayer = {
  id?: string;
  startMs?: number;
  endMs?: number;
  transform?: LayerTransform;
  clip?: LayerClip;
  // Blend mode for compositing this layer onto the content beneath it.
  blendMode?: BlendMode;
  // Gaussian blur (sigma, px) over the whole rendered layer. NOTE: shape layers
  // interpret their own `blur` as a mask-filter glow instead (see ShapeLayer);
  // for every other layer type this blurs the composited result.
  blur?: number;
  // Directional accumulation motion blur.
  motionBlur?: MotionBlur;
};

export type TextStyle = {
  // Outline drawn behind the fill — great for making titles pop.
  stroke?: string;
  strokeWidth?: number;
  // Soft drop shadow for legibility / depth.
  shadowColor?: string;
  shadowBlur?: number;
  shadowDx?: number;
  shadowDy?: number;
};

export type TextLayer = BaseLayer & TextStyle & {
  type: "text";
  text: string;
  font?: string;
  size?: number;
  color?: Fill;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  // When set, long text auto-wraps to fit within this pixel width (CJK breaks
  // per-character, Latin breaks on word boundaries). Explicit `\n` is honoured.
  maxWidth?: number;
};

export type CaptionLayer = BaseLayer & TextStyle & {
  type: "caption";
  text: string;
  font?: string;
  size?: number;
  color?: Fill;
  backgroundColor?: Fill;
  padding?: number;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  maxWidth?: number;
};

export type ShapeLayer = BaseLayer & {
  type: "shape";
  shape: "rect" | "circle" | "path";
  width?: number;
  height?: number;
  radius?: number;
  path?: string;
  fill?: Fill;
  stroke?: string;
  strokeWidth?: number;
  // Dashed stroke intervals [on, off, ...] (+ optional phase offset).
  dash?: number[];
  dashPhase?: number;
  // Soft blur (mask filter sigma) — enables neon glow / soft light shapes.
  blur?: number;
  // Animatable draw window over the path's TOTAL length, both 0..1: only the
  // [trimStart, trimEnd] fraction is drawn. Keyframing trimEnd 0→1 "draws"
  // the path over time (route lines, signatures). shape:"path" only.
  trimStart?: AnimatedScalar;
  trimEnd?: AnimatedScalar;
};

export type ImageLayer = BaseLayer & {
  type: "image";
  src: string;
  fit?: "cover" | "contain" | "fill";
  width?: number;
  height?: number;
};

export type VideoLayer = BaseLayer & {
  type: "video";
  src: string;
  fit?: "cover" | "contain" | "fill";
  width?: number;
  height?: number;
  trimStartMs?: number;
  trimEndMs?: number;
  volume?: AnimatedScalar;
  // Playback speed multiplier (default 1). 2 plays the source twice as fast,
  // 0.5 at half speed; the layer still occupies its start..end window on the
  // timeline, so a faster rate consumes more source footage over the same span.
  playbackRate?: number;
  // Loop the trimmed window [trimStartMs, trimEndMs] for the layer's whole
  // duration (requires trimEndMs > trimStartMs). Without it the last frame
  // holds once the source is exhausted.
  loop?: boolean;
};

export type AudioLayer = BaseLayer & {
  type: "audio";
  src: string;
  // Constant gain, or a keyframe envelope for volume automation (ducking,
  // swells). Keyframe times are relative to the audio's own start.
  volume?: AnimatedScalar;
  fadeInMs?: number;
  fadeOutMs?: number;
};

// Pre-composition: groups children under a shared transform/opacity (drawn as
// one unit, so group opacity doesn't double-blend overlapping children).
// The group's LOCAL timeline starts at its startMs: child startMs/endMs,
// child keyframes AND the group's own transform keyframes are all relative to
// it, so the whole block — including its entrance/exit animation — relocates
// to any point of the parent timeline by changing startMs alone (Remotion
// Sequence semantics).
// Animated mask that progressively reveals a group's content — the renderer
// clips the group to the revealed region. `progress` runs 0 (hidden) → 1
// (fully shown) on the group's LOCAL timeline. "wipe" sweeps a rect across
// the w×h box from `direction`; "clock" sweeps a wedge clockwise from 12
// o'clock around the box centre.
export type GroupReveal = {
  type: "wipe" | "clock";
  width: number;
  height: number;
  direction?: "from-left" | "from-right" | "from-top" | "from-bottom";
  progress: AnimatedScalar;
};

export type GroupLayer = BaseLayer & {
  type: "group";
  layers: Layer[];
  reveal?: GroupReveal;
  // Renderers may raster-cache a group whose resolved content is static across
  // frames (only its transform/opacity/reveal animating). `false` opts out —
  // e.g. when the group will be scaled up far beyond 1:1 and must stay vector
  // crisp.
  cache?: boolean;
};

// A plugin node: an authored placeholder that a registered plugin expands into
// plain layers (a group) BEFORE rendering — see `expandComposition` in the
// plugins package. Keeps the IR non-destructive (params stay editable) while
// renderers never see anything but core layer types. Base props (startMs/endMs,
// transform, clip, ...) carry over to the expanded group; the plugin's content
// lives on the group's LOCAL timeline, so the whole effect relocates by
// changing startMs alone.
export type PluginLayer = BaseLayer & {
  type: "plugin";
  plugin: string;
  params?: Record<string, unknown>;
};

export type Layer = TextLayer | CaptionLayer | ShapeLayer | ImageLayer | VideoLayer | AudioLayer | GroupLayer | PluginLayer;

export type Composition = {
  type: "composition";
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  // Default font (path) applied to text/caption layers that don't set their own
  // `font`. Lets each composition pick its typeface; not hardcoded in the engine.
  defaultFont?: string;
  layers: Layer[];
};

export type ResolvedGroupReveal = Omit<GroupReveal, "progress"> & {
  progress: number;
};

// A resolved group carries recursively resolved children (each already
// evaluated at the group's local time).
export type ResolvedGroupLayer = Omit<GroupLayer, "transform" | "layers" | "reveal"> & {
  transform: ResolvedTransform;
  layers: ResolvedLayer[];
  reveal?: ResolvedGroupReveal;
};

// A resolved shape carries trim values evaluated to plain numbers.
export type ResolvedShapeLayer = Omit<ShapeLayer, "transform" | "trimStart" | "trimEnd"> & {
  transform: ResolvedTransform;
  trimStart?: number;
  trimEnd?: number;
};

// Plugin nodes never survive to resolve time (expandComposition replaces them),
// so they are excluded here and renderers only ever meet core layer types.
export type ResolvedLayer<T extends Layer = Layer> = T extends GroupLayer ? ResolvedGroupLayer : T extends ShapeLayer ? ResolvedShapeLayer : T extends PluginLayer ? never : T extends Layer ? Omit<T, "transform"> & {
  transform: ResolvedTransform;
} : never;

export type ResolvedFrame = {
  composition: Pick<Composition, "fps" | "width" | "height" | "durationMs">;
  timeMs: number;
  layers: ResolvedLayer[];
};
