import type { ParamsSpec } from "./schema.ts";
import type { PluginDefinition } from "./plugin.ts";

// Module-level registry. Registration is last-wins on purpose: built-ins
// register as an import side effect, and dev-server hot reloads re-run that —
// throwing on duplicates would break HMR for no safety gain.
const plugins = new Map<string, PluginDefinition>();

export function registerPlugin<S extends ParamsSpec>(definition: PluginDefinition<S>): PluginDefinition<S> {
  plugins.set(definition.name, definition as unknown as PluginDefinition);
  return definition;
}

export function unregisterPlugin(name: string): void {
  plugins.delete(name);
}

export function getPlugin(name: string): PluginDefinition {
  const definition = plugins.get(name);
  if (!definition) {
    const known = [...plugins.keys()].sort().join(", ") || "(none)";
    throw new Error(`unknown plugin "${name}" — registered plugins: ${known}`);
  }
  return definition;
}

export function hasPlugin(name: string): boolean {
  return plugins.has(name);
}

export function listPlugins(): PluginDefinition[] {
  return [...plugins.values()].sort((a, b) => a.name.localeCompare(b.name));
}
