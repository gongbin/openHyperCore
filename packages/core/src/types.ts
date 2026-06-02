export type ScalarKeyframe = {
  timeMs: number;
  value: number;
};

export type AnimatedScalar = number | ScalarKeyframe[];

export type LayerTransform = {
  x?: AnimatedScalar;
  y?: AnimatedScalar;
  scale?: AnimatedScalar;
  rotate?: AnimatedScalar;
  opacity?: AnimatedScalar;
};

export type ResolvedTransform = {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
};

export type BaseLayer = {
  id?: string;
  startMs?: number;
  endMs?: number;
  transform?: LayerTransform;
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
  color?: string;
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
  color?: string;
  backgroundColor?: string;
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
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  // Dashed stroke intervals [on, off, ...] (+ optional phase offset).
  dash?: number[];
  dashPhase?: number;
  // Soft blur (mask filter sigma) — enables neon glow / soft light shapes.
  blur?: number;
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
  volume?: number;
  // Crop the drawn frame to a circle (inscribed in the shorter side) — e.g. a
  // video inside an avatar. The clip scales/moves with the layer transform.
  clip?: "circle";
};

export type AudioLayer = BaseLayer & {
  type: "audio";
  src: string;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
};

export type Layer = TextLayer | CaptionLayer | ShapeLayer | ImageLayer | VideoLayer | AudioLayer;

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

export type ResolvedLayer<T extends Layer = Layer> = T extends Layer ? Omit<T, "transform"> & {
  transform: ResolvedTransform;
} : never;

export type ResolvedFrame = {
  composition: Pick<Composition, "fps" | "width" | "height" | "durationMs">;
  timeMs: number;
  layers: ResolvedLayer[];
};
