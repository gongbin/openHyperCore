import type { ResolvedFrame, ResolvedLayer } from "../../core/src/index.ts";

export function renderSvgFrame(frame: ResolvedFrame): string {
  const { width, height } = frame.composition;
  const body = frame.layers.map(renderLayer).join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    body,
    `</svg>`
  ].filter(Boolean).join("\n");
}

function renderLayer(layer: ResolvedLayer): string {
  const attrs = groupAttributes(layer);
  const content = renderLayerContent(layer);
  return `  <g${attrs}>${content}</g>`;
}

function renderLayerContent(layer: ResolvedLayer): string {
  switch (layer.type) {
    case "text":
      return `<text x="0" y="0" font-family="${escapeAttribute(layer.font ?? "sans-serif")}" font-size="${layer.size ?? 16}" fill="${escapeAttribute(layer.color ?? "#000")}" text-anchor="${textAnchor(layer.align)}">${escapeText(layer.text)}</text>`;
    case "shape":
      return renderShape(layer);
    case "image":
      return `<image href="${escapeAttribute(layer.src)}" width="${layer.width ?? "100%"}" height="${layer.height ?? "100%"}" preserveAspectRatio="${preserveAspectRatio(layer.fit)}" />`;
    default:
      return "";
  }
}

function renderShape(layer: Extract<ResolvedLayer, { type: "shape" }>): string {
  const common = shapeAttributes(layer);

  if (layer.shape === "circle") {
    const radius = layer.radius ?? Math.min(layer.width ?? 0, layer.height ?? 0) / 2;
    return `<circle cx="${radius}" cy="${radius}" r="${radius}"${common} />`;
  }

  if (layer.shape === "path") {
    return `<path d="${escapeAttribute(layer.path ?? "")}"${common} />`;
  }

  return `<rect x="0" y="0" width="${layer.width ?? 0}" height="${layer.height ?? 0}"${common} />`;
}

function groupAttributes(layer: ResolvedLayer): string {
  const { x, y, scale, rotate, opacity } = layer.transform;
  const transform = `translate(${formatNumber(x)} ${formatNumber(y)}) scale(${formatNumber(scale)}) rotate(${formatNumber(rotate)})`;
  const id = layer.id ? ` id="${escapeAttribute(layer.id)}"` : "";
  return `${id} transform="${transform}" opacity="${formatNumber(opacity)}"`;
}

function shapeAttributes(layer: Extract<ResolvedLayer, { type: "shape" }>): string {
  const attrs = [
    `fill="${escapeAttribute(layer.fill ?? "none")}"`,
    layer.stroke ? `stroke="${escapeAttribute(layer.stroke)}"` : undefined,
    layer.strokeWidth !== undefined ? `stroke-width="${layer.strokeWidth}"` : undefined
  ].filter(Boolean);

  return ` ${attrs.join(" ")}`;
}

function textAnchor(align: Extract<ResolvedLayer, { type: "text" }>["align"]): string {
  if (align === "center") {
    return "middle";
  }
  if (align === "right") {
    return "end";
  }
  return "start";
}

function preserveAspectRatio(fit: Extract<ResolvedLayer, { type: "image" }>["fit"]): string {
  if (fit === "cover") {
    return "xMidYMid slice";
  }
  if (fit === "fill") {
    return "none";
  }
  return "xMidYMid meet";
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}
