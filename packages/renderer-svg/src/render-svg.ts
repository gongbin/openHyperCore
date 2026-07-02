import type { Fill, ResolvedFrame, ResolvedLayer } from "../../core/src/index.ts";

// The SVG still renderer is a lightweight preview: approximate a gradient fill
// with a representative stop color so output stays a flat, valid SVG.
function solidColor(fill: Fill | undefined, fallback: string): string {
  if (fill === undefined) {
    return fallback;
  }
  if (typeof fill === "string") {
    return fill;
  }
  return fill.stops.length > 0 ? fill.stops[fill.stops.length - 1]!.color : fallback;
}

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
    case "group":
      return layer.layers.map(renderLayer).join("");
    case "text":
      return `<text x="0" y="0" font-family="${escapeAttribute(layer.font ?? "sans-serif")}" font-size="${layer.size ?? 16}" fill="${escapeAttribute(solidColor(layer.color, "#000"))}" text-anchor="${textAnchor(layer.align)}">${escapeText(layer.text)}</text>`;
    case "caption":
      return renderCaption(layer);
    case "shape":
      return renderShape(layer);
    case "image":
      return `<image href="${escapeAttribute(layer.src)}" width="${layer.width ?? "100%"}" height="${layer.height ?? "100%"}" preserveAspectRatio="${preserveAspectRatio(layer.fit)}" />`;
    default:
      return "";
  }
}

function renderCaption(layer: Extract<ResolvedLayer, { type: "caption" }>): string {
  const size = layer.size ?? 32;
  const lineHeight = layer.lineHeight ?? size * 1.2;
  const padding = layer.padding ?? 8;
  const textWidth = layer.maxWidth ?? estimateTextWidth(layer.text, size);
  const x = alignedX(layer.align, textWidth);
  const background = layer.backgroundColor
    ? `<rect x="${formatNumber(x - padding)}" y="${formatNumber(-lineHeight - padding)}" width="${formatNumber(textWidth + padding * 2)}" height="${formatNumber(lineHeight + padding * 2)}" fill="${escapeAttribute(solidColor(layer.backgroundColor, "#000"))}" />`
    : "";
  const text = `<text x="0" y="0" font-family="${escapeAttribute(layer.font ?? "sans-serif")}" font-size="${size}" fill="${escapeAttribute(solidColor(layer.color, "#fff"))}" text-anchor="${textAnchor(layer.align)}">${escapeText(layer.text)}</text>`;
  return [background, text].filter(Boolean).join("");
}

function renderShape(layer: Extract<ResolvedLayer, { type: "shape" }>): string {
  const common = shapeAttributes(layer);

  if (layer.shape === "circle") {
    const radius = layer.radius ?? Math.min(layer.width ?? 0, layer.height ?? 0) / 2;
    return `<circle cx="${radius}" cy="${radius}" r="${radius}"${common} />`;
  }

  if (layer.shape === "path") {
    // Trim window preview: normalize the path length to 1 and use a dash
    // window so only [trimStart, trimEnd] of a STROKED path shows. (Filled
    // trims need real geometry trimming — out of scope for the SVG preview.)
    const hasTrim = layer.trimStart !== undefined || layer.trimEnd !== undefined;
    if (hasTrim && layer.stroke) {
      const start = Math.min(1, Math.max(0, layer.trimStart ?? 0));
      const end = Math.min(1, Math.max(0, layer.trimEnd ?? 1));
      if (end <= start) {
        return "";
      }
      const trim = ` pathLength="1" stroke-dasharray="${formatNumber(end - start)} 1" stroke-dashoffset="${formatNumber(-start)}"`;
      return `<path d="${escapeAttribute(layer.path ?? "")}"${common}${trim} />`;
    }
    return `<path d="${escapeAttribute(layer.path ?? "")}"${common} />`;
  }

  return `<rect x="0" y="0" width="${layer.width ?? 0}" height="${layer.height ?? 0}"${common} />`;
}

function groupAttributes(layer: ResolvedLayer): string {
  const { x, y, scale, scaleX, scaleY, rotate, opacity } = layer.transform;
  const transform = `translate(${formatNumber(x)} ${formatNumber(y)}) scale(${formatNumber(scale * scaleX)} ${formatNumber(scale * scaleY)}) rotate(${formatNumber(rotate)})`;
  const id = layer.id ? ` id="${escapeAttribute(layer.id)}"` : "";
  return `${id} transform="${transform}" opacity="${formatNumber(opacity)}"`;
}

function shapeAttributes(layer: Extract<ResolvedLayer, { type: "shape" }>): string {
  const attrs = [
    `fill="${escapeAttribute(solidColor(layer.fill, "none"))}"`,
    layer.stroke ? `stroke="${escapeAttribute(layer.stroke)}"` : undefined,
    layer.strokeWidth !== undefined ? `stroke-width="${layer.strokeWidth}"` : undefined
  ].filter(Boolean);

  return ` ${attrs.join(" ")}`;
}

function textAnchor(align: Extract<ResolvedLayer, { type: "text" | "caption" }>["align"]): string {
  if (align === "center") {
    return "middle";
  }
  if (align === "right") {
    return "end";
  }
  return "start";
}

function alignedX(align: Extract<ResolvedLayer, { type: "text" | "caption" }>["align"], width: number): number {
  if (align === "center") {
    return -width / 2;
  }
  if (align === "right") {
    return -width;
  }
  return 0;
}

function estimateTextWidth(text: string, size: number): number {
  return text.length * size * 0.6;
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
