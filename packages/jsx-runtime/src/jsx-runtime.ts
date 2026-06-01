import { defineComposition } from "../../core/src/index.ts";
import type { CaptionLayer as CaptionLayerIR, Composition as CompositionIR, ImageLayer as ImageLayerIR, Layer, ShapeLayer as ShapeLayerIR, TextLayer as TextLayerIR } from "../../core/src/index.ts";

type Props = Record<string, unknown>;
type Component<T = unknown> = (props: Props) => T;

export function jsx<T>(type: Component<T>, props: Props): T;
export function jsx(type: string, props: Props): unknown;
export function jsx(type: string | Component, props: Props): unknown {
  return createElement(type, props ?? {});
}

export function jsxs<T>(type: Component<T>, props: Props): T;
export function jsxs(type: string, props: Props): unknown;
export function jsxs(type: string | Component, props: Props): unknown {
  return createElement(type, props ?? {});
}

export function Fragment(props: Props): unknown[] {
  return normalizeChildren(props.children);
}

export function Composition(props: Props): CompositionIR {
  return defineComposition({
    fps: numberProp(props, "fps"),
    width: numberProp(props, "width"),
    height: numberProp(props, "height"),
    durationMs: requiredNumberAlias(props, "durationMs", "duration"),
    layers: normalizeChildren(props.children) as Layer[]
  });
}

export function TextLayer(props: Props): TextLayerIR {
  return omitUndefined({
    type: "text",
    id: optionalStringProp(props, "id"),
    text: stringProp(props, "text"),
    font: optionalStringProp(props, "font"),
    size: optionalNumberProp(props, "size"),
    color: optionalStringProp(props, "color"),
    align: props.align as TextLayerIR["align"],
    lineHeight: optionalNumberProp(props, "lineHeight"),
    startMs: optionalNumberAlias(props, "startMs", "from"),
    endMs: optionalNumberAlias(props, "endMs", "to"),
    transform: props.transform as TextLayerIR["transform"]
  }) as TextLayerIR;
}

export function CaptionLayer(props: Props): CaptionLayerIR {
  return omitUndefined({
    type: "caption",
    id: optionalStringProp(props, "id"),
    text: stringProp(props, "text"),
    font: optionalStringProp(props, "font"),
    size: optionalNumberProp(props, "size"),
    color: optionalStringProp(props, "color"),
    backgroundColor: optionalStringProp(props, "backgroundColor"),
    padding: optionalNumberProp(props, "padding"),
    align: props.align as CaptionLayerIR["align"],
    lineHeight: optionalNumberProp(props, "lineHeight"),
    maxWidth: optionalNumberProp(props, "maxWidth"),
    startMs: optionalNumberAlias(props, "startMs", "from"),
    endMs: optionalNumberAlias(props, "endMs", "to"),
    transform: props.transform as CaptionLayerIR["transform"]
  }) as CaptionLayerIR;
}

export function ShapeLayer(props: Props): ShapeLayerIR {
  return omitUndefined({
    type: "shape",
    id: optionalStringProp(props, "id"),
    shape: (props.shape as ShapeLayerIR["shape"]) ?? "rect",
    width: optionalNumberProp(props, "width"),
    height: optionalNumberProp(props, "height"),
    radius: optionalNumberProp(props, "radius"),
    path: optionalStringProp(props, "path"),
    fill: optionalStringProp(props, "fill"),
    stroke: optionalStringProp(props, "stroke"),
    strokeWidth: optionalNumberProp(props, "strokeWidth"),
    startMs: optionalNumberAlias(props, "startMs", "from"),
    endMs: optionalNumberAlias(props, "endMs", "to"),
    transform: props.transform as ShapeLayerIR["transform"]
  }) as ShapeLayerIR;
}

export function ImageLayer(props: Props): ImageLayerIR {
  return omitUndefined({
    type: "image",
    id: optionalStringProp(props, "id"),
    src: stringProp(props, "src"),
    fit: props.fit as ImageLayerIR["fit"],
    width: optionalNumberProp(props, "width"),
    height: optionalNumberProp(props, "height"),
    startMs: optionalNumberAlias(props, "startMs", "from"),
    endMs: optionalNumberAlias(props, "endMs", "to"),
    transform: props.transform as ImageLayerIR["transform"]
  }) as ImageLayerIR;
}

function createElement(type: string | Component, props: Props): unknown {
  if (typeof type === "function") {
    return type(props);
  }

  throw new Error(`Unsupported JSX element: ${type}`);
}

function normalizeChildren(children: unknown): unknown[] {
  if (children === undefined || children === null || children === false) {
    return [];
  }

  if (Array.isArray(children)) {
    return children.flatMap((child) => normalizeChildren(child));
  }

  return [children];
}

function numberProp(props: Props, name: string, fallback?: number): number {
  const value = props[name] ?? fallback;
  if (typeof value !== "number") {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function optionalNumberProp(props: Props, name: string): number | undefined {
  const value = props[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function optionalNumberAlias(props: Props, primary: string, alias: string): number | undefined {
  return optionalNumberProp(props, primary) ?? optionalNumberProp(props, alias);
}

function requiredNumberAlias(props: Props, primary: string, alias: string): number {
  const value = optionalNumberAlias(props, primary, alias);
  if (value === undefined) {
    throw new Error(`${primary} must be a number`);
  }
  return value;
}

function stringProp(props: Props, name: string): string {
  const value = props[name];
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function optionalStringProp(props: Props, name: string): string | undefined {
  const value = props[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as Partial<T>;
}
