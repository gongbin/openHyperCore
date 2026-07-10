import { registerPlugin } from "./registry.ts";
import { countdown } from "./builtins/countdown.ts";
import { curtainOpen } from "./builtins/curtain-open.ts";
import { lightSweepTitle } from "./builtins/light-sweep-title.ts";
import { kenBurns } from "./builtins/ken-burns.ts";
import { glitchTitle } from "./builtins/glitch-title.ts";
import { globeIntro } from "./builtins/globe-intro.ts";
import { globeRoute } from "./builtins/globe-route.ts";
import { mapRoute } from "./builtins/map-route.ts";
import { neonTraceTitle } from "./builtins/neon-trace-title.ts";
import { apertureReveal } from "./builtins/aperture-reveal.ts";
import { radarSweep } from "./builtins/radar-sweep.ts";
import { kineticBars } from "./builtins/kinetic-bars.ts";
import { particleAssemble } from "./builtins/particle-assemble.ts";
import { hyperspaceWarp } from "./builtins/hyperspace-warp.ts";
import { velocityZoom } from "./builtins/velocity-zoom.ts";
import { beatBounce } from "./builtins/beat-bounce.ts";
import { rgbGlitchShake } from "./builtins/rgb-glitch-shake.ts";
import { stickerPop } from "./builtins/sticker-pop.ts";

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
// Intro-effect pack (openers + TikTok-style, matching the Intro Effects Lab).
registerPlugin(neonTraceTitle);
registerPlugin(apertureReveal);
registerPlugin(radarSweep);
registerPlugin(kineticBars);
registerPlugin(particleAssemble);
registerPlugin(hyperspaceWarp);
registerPlugin(velocityZoom);
registerPlugin(beatBounce);
registerPlugin(rgbGlitchShake);
registerPlugin(stickerPop);

export { countdown, curtainOpen, glitchTitle, globeIntro, globeRoute, kenBurns, lightSweepTitle, mapRoute };
export { apertureReveal, beatBounce, hyperspaceWarp, kineticBars, neonTraceTitle, particleAssemble, radarSweep, rgbGlitchShake, stickerPop, velocityZoom };
export { WORLD_LAND_PATH, WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from "./builtins/world-land-110m.ts";
