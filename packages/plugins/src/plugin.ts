import type { Layer } from "../../core/src/index.ts";
import type { ParamsOf, ParamsSpec } from "./schema.ts";

// Everything a plugin knows about where it was placed. Sizes come from the
// composition; the time window comes from the plugin node's startMs/endMs.
// `expand()` must emit layers on the LOCAL timeline (0 .. durationMs) — the
// expander wraps them in a group at the node's startMs, so the whole effect
// relocates on the parent timeline without the plugin caring.
export type PluginContext = {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  // Absolute placement on the parent timeline (informational; local-time
  // layers should NOT add these).
  startMs: number;
  endMs: number;
};

export type PluginDefinition<S extends ParamsSpec = ParamsSpec> = {
  // Stable id used in the IR ({ type: "plugin", plugin: <name> }).
  name: string;
  // Editor-facing label; falls back to `name`.
  displayName?: string;
  description?: string;
  // Editor grouping, e.g. "opener" | "map" | "title".
  category?: string;
  params: S;
  // Suggested window length when an editor inserts this plugin.
  defaultDurationMs?: number;
  // Pure function: validated params + placement → plain IR layers (local time).
  expand: (params: ParamsOf<S>, context: PluginContext) => Layer[];
};

// Identity with inference: keeps `expand` params typed from the schema literal.
export function definePlugin<S extends ParamsSpec>(definition: PluginDefinition<S>): PluginDefinition<S> {
  if (!definition.name) {
    throw new Error("definePlugin: name is required");
  }
  return definition;
}
