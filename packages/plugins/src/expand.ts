import type { Composition, GroupLayer, Layer, PluginLayer } from "../../core/src/index.ts";
import { resolveParams } from "./schema.ts";
import { getPlugin } from "./registry.ts";
import type { PluginContext } from "./plugin.ts";

// Plugins may expand into layers that contain plugin nodes themselves; this
// bounds accidental self-reference instead of blowing the stack.
const MAX_DEPTH = 16;

// Replace every { type: "plugin" } node in the composition with the group it
// expands to. Pure: returns a new composition, the input is not mutated.
// Renderers and resolveFrame only ever see core layer types afterwards.
export function expandComposition(composition: Composition): Composition {
  return {
    ...composition,
    layers: expandLayers(composition.layers, composition, composition.durationMs, 0)
  };
}

// True if the layer tree still contains plugin nodes (i.e. expandComposition
// is needed before rendering). Editors use this to decide when to re-expand.
export function hasPluginLayers(layers: Layer[]): boolean {
  return layers.some((layer) => layer.type === "plugin" || (layer.type === "group" && hasPluginLayers(layer.layers)));
}

function expandLayers(layers: Layer[], composition: Composition, parentDurationMs: number, depth: number): Layer[] {
  return layers.map((layer) => expandLayer(layer, composition, parentDurationMs, depth));
}

function expandLayer(layer: Layer, composition: Composition, parentDurationMs: number, depth: number): Layer {
  if (layer.type === "group") {
    const localDurationMs = (layer.endMs ?? parentDurationMs) - (layer.startMs ?? 0);
    return { ...layer, layers: expandLayers(layer.layers, composition, localDurationMs, depth) };
  }
  if (layer.type !== "plugin") {
    return layer;
  }
  if (depth >= MAX_DEPTH) {
    throw new Error(`plugin expansion exceeded depth ${MAX_DEPTH} (recursive plugin "${layer.plugin}"?)`);
  }
  return expandPluginLayer(layer, composition, parentDurationMs, depth);
}

function expandPluginLayer(layer: PluginLayer, composition: Composition, parentDurationMs: number, depth: number): GroupLayer {
  const definition = getPlugin(layer.plugin);
  const startMs = layer.startMs ?? 0;
  const endMs = layer.endMs ?? parentDurationMs;
  const context: PluginContext = {
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationMs: endMs - startMs,
    startMs,
    endMs
  };
  const params = resolveParams(layer.plugin, definition.params, layer.params ?? {});
  const children = definition.expand(params, context);
  // Base props (id/startMs/endMs/transform/clip/blendMode/blur/motionBlur)
  // carry over to the group, so the author can still move/fade/mask the whole
  // expanded effect like any other layer.
  const { type: _type, plugin: _plugin, params: _params, ...base } = layer;
  return {
    ...base,
    type: "group",
    layers: expandLayers(children, composition, context.durationMs, depth + 1)
  };
}
