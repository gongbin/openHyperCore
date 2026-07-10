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

// A color track: CSS color keyframes interpolated in RGB space (segment
// easing on the END keyframe, like ScalarKeyframe).
export type ColorKeyframe = {
  timeMs: number;
  color: string;
  easing?: EasingLike;
};

export type AnimatedColor = string | ColorKeyframe[];

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
  // Gaussian blur (sigma, px) over the whole rendered layer — keyframable
  // (focus pulls, dreamy intros). NOTE: shape layers interpret their own
  // `blur` as a mask-filter glow instead (see ShapeLayer); for every other
  // layer type this blurs the composited result.
  blur?: AnimatedScalar;
  // Directional accumulation motion blur.
  motionBlur?: MotionBlur;
};

export type TextStyle = {
  // Extra advance (px) inserted between characters — headline tracking.
  letterSpacing?: number;
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
  // Solid color, gradient, or a keyframed color track (resolved per frame).
  color?: Fill | ColorKeyframe[];
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
  // Solid fills/strokes can be keyframed color tracks; gradients stay static.
  fill?: Fill | ColorKeyframe[];
  stroke?: string | ColorKeyframe[];
  strokeWidth?: AnimatedScalar;
  // Dashed stroke intervals [on, off, ...] (+ optional phase offset).
  dash?: number[];
  dashPhase?: number;
  // Soft blur (mask filter sigma) — enables neon glow / soft light shapes.
  // Keyframable (pulsing glows).
  blur?: AnimatedScalar;
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

// A great-circle route drawn ON a globe's surface: it rotates with the
// sphere, hides behind the horizon, and can draw itself via `progress`.
export type GlobeRoute = {
  from: [number, number]; // [lat, lng] in degrees
  to: [number, number];
  color?: string;
  // Stroke width in the globe's local px (scales with transform.scale).
  width?: number;
  // Drawn fraction 0..1 from `from` toward `to` (animatable; default 1).
  progress?: AnimatedScalar;
  // Arc lift at the midpoint, as a fraction of the radius (default 0.12);
  // 0 hugs the surface.
  altitude?: number;
  // Endpoint + tip markers (default true).
  dots?: boolean;
};

// A sphere-mapped image: an equirectangular texture (satellite earth, moon,
// any planet) rendered as an orthographic globe via a UV triangle mesh, with
// per-vertex Lambert + limb lighting. Rotation is keyframeable; zoom via
// transform.scale (the sphere is centred on the layer origin, so scaling
// stays centred). The renderers build the mesh; the IR stays tiny.
export type GlobeLayer = BaseLayer & {
  type: "globe";
  // Equirectangular texture (2:1), e.g. a blue-marble satellite image.
  src: string;
  // Sphere radius in local px (before the layer transform).
  radius: AnimatedScalar;
  // Rotation about the vertical axis (yaw) / horizontal axis (pitch), in
  // RADIANS. The point at lon=yaw, lat=-pitch faces the viewer, centred.
  yaw?: AnimatedScalar;
  pitch?: AnimatedScalar;
  // Mesh resolution (static; default 64 keeps the silhouette smooth).
  segments?: number;
  // Lambert light direction in view space (x right, y up, z toward viewer).
  light?: [number, number, number];
  // Ambient fill (default 0.32) and diffuse gain (default 0.78), both 0..1.
  ambient?: number;
  diffuse?: number;
  // Great-circle routes drawn on (and above) the surface.
  routes?: GlobeRoute[];
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

export type Layer = TextLayer | CaptionLayer | ShapeLayer | ImageLayer | GlobeLayer | VideoLayer | AudioLayer | GroupLayer | PluginLayer;

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
export type ResolvedGroupLayer = Omit<GroupLayer, "transform" | "layers" | "reveal" | "blur"> & {
  transform: ResolvedTransform;
  layers: ResolvedLayer[];
  reveal?: ResolvedGroupReveal;
  blur?: number;
};

export type ResolvedGlobeRoute = Omit<GlobeRoute, "progress"> & {
  progress: number;
};

// A resolved globe carries rotation/radius/route-progress as plain numbers.
export type ResolvedGlobeLayer = Omit<GlobeLayer, "transform" | "radius" | "yaw" | "pitch" | "routes" | "blur"> & {
  transform: ResolvedTransform;
  radius: number;
  yaw: number;
  pitch: number;
  routes?: ResolvedGlobeRoute[];
  blur?: number;
};

// A resolved shape carries trim/color/stroke tracks evaluated to plain values.
export type ResolvedShapeLayer = Omit<ShapeLayer, "transform" | "trimStart" | "trimEnd" | "fill" | "stroke" | "strokeWidth" | "blur"> & {
  transform: ResolvedTransform;
  trimStart?: number;
  trimEnd?: number;
  fill?: Fill;
  stroke?: string;
  strokeWidth?: number;
  blur?: number;
};

// A resolved text layer carries its color track evaluated to a plain fill.
export type ResolvedTextLayer = Omit<TextLayer, "transform" | "color" | "blur"> & {
  transform: ResolvedTransform;
  color?: Fill;
  blur?: number;
};

// Plugin nodes never survive to resolve time (expandComposition replaces them),
// so they are excluded here and renderers only ever meet core layer types.
export type ResolvedLayer<T extends Layer = Layer> = T extends GroupLayer ? ResolvedGroupLayer : T extends ShapeLayer ? ResolvedShapeLayer : T extends TextLayer ? ResolvedTextLayer : T extends GlobeLayer ? ResolvedGlobeLayer : T extends PluginLayer ? never : T extends Layer ? Omit<T, "transform" | "blur"> & {
  transform: ResolvedTransform;
  blur?: number;
} : never;

export type ResolvedFrame = {
  composition: Pick<Composition, "fps" | "width" | "height" | "durationMs">;
  timeMs: number;
  layers: ResolvedLayer[];
};
