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

export type TextLayer = BaseLayer & {
  type: "text";
  text: string;
  font?: string;
  size?: number;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
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
};

export type AudioLayer = BaseLayer & {
  type: "audio";
  src: string;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
};

export type Layer = TextLayer | ShapeLayer | ImageLayer | VideoLayer | AudioLayer;

export type Composition = {
  type: "composition";
  fps: number;
  width: number;
  height: number;
  durationMs: number;
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
