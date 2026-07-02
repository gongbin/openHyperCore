import { registerPlugin } from "./registry.ts";
import { curtainOpen } from "./builtins/curtain-open.ts";
import { kenBurns } from "./builtins/ken-burns.ts";
import { glitchTitle } from "./builtins/glitch-title.ts";
import { mapRoute } from "./builtins/map-route.ts";

export { definePlugin } from "./plugin.ts";
export type { PluginContext, PluginDefinition } from "./plugin.ts";
export { getPlugin, hasPlugin, listPlugins, registerPlugin, unregisterPlugin } from "./registry.ts";
export { expandComposition, hasPluginLayers } from "./expand.ts";
export { resolveParams } from "./schema.ts";
export type {
  AssetParam,
  BooleanParam,
  ColorParam,
  LatLngParam,
  NumberParam,
  ParamSpec,
  ParamsOf,
  ParamsSpec,
  SelectParam,
  StringParam
} from "./schema.ts";
export { shade } from "./builtins/color.ts";

// Built-ins register on import so `expandComposition` works out of the box for
// the CLI, server and editor alike.
registerPlugin(curtainOpen);
registerPlugin(kenBurns);
registerPlugin(glitchTitle);
registerPlugin(mapRoute);

export { curtainOpen, glitchTitle, kenBurns, mapRoute };
export { WORLD_LAND_PATH, WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from "./builtins/world-land-110m.ts";
