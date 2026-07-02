import { registerPlugin } from "./registry.ts";
import { countdown } from "./builtins/countdown.ts";
import { curtainOpen } from "./builtins/curtain-open.ts";
import { lightSweepTitle } from "./builtins/light-sweep-title.ts";
import { kenBurns } from "./builtins/ken-burns.ts";
import { glitchTitle } from "./builtins/glitch-title.ts";
import { globeIntro } from "./builtins/globe-intro.ts";
import { globeRoute } from "./builtins/globe-route.ts";
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
registerPlugin(globeIntro);
registerPlugin(globeRoute);
registerPlugin(countdown);
registerPlugin(lightSweepTitle);

export { countdown, curtainOpen, glitchTitle, globeIntro, globeRoute, kenBurns, lightSweepTitle, mapRoute };
export { WORLD_LAND_PATH, WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from "./builtins/world-land-110m.ts";
