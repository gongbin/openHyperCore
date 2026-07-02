// Serializable parameter schema for plugins. The schema drives three things:
// beginner-facing auto-generated forms in the editor, validation/defaults for
// CLI/agent-authored JSON, and typed `expand()` params via `ParamsOf`.

type ParamBase = {
  // Human label for editor forms; falls back to the param key.
  label?: string;
  description?: string;
  // Required params must be provided by the author; everything else needs a
  // `default` (or resolves to undefined when neither is set).
  required?: boolean;
};

export type NumberParam = ParamBase & { type: "number"; default?: number; min?: number; max?: number; step?: number };
export type StringParam = ParamBase & { type: "string"; default?: string; multiline?: boolean };
// A CSS color string; editors should render a color picker.
export type ColorParam = ParamBase & { type: "color"; default?: string };
export type BooleanParam = ParamBase & { type: "boolean"; default?: boolean };
export type SelectParam = ParamBase & { type: "select"; options: readonly string[]; default?: string };
// A URL/path to an external asset (image/video/audio/font). `placeholder` is
// a suggested value editors may prefill for required asset params (not a
// default — validation still demands an explicit value from JSON authors).
export type AssetParam = ParamBase & { type: "asset"; kind?: "image" | "video" | "audio" | "font"; default?: string; placeholder?: string };
// [latitude, longitude] in degrees — for map/globe plugins.
export type LatLngParam = ParamBase & { type: "latlng"; default?: readonly [number, number] };

export type ParamSpec = NumberParam | StringParam | ColorParam | BooleanParam | SelectParam | AssetParam | LatLngParam;
export type ParamsSpec = Record<string, ParamSpec>;

type ParamValueOf<P extends ParamSpec> =
  P extends NumberParam ? number :
  P extends BooleanParam ? boolean :
  P extends LatLngParam ? readonly [number, number] :
  string;

type HasValue<P extends ParamSpec> = P extends { default: unknown } ? true : P extends { required: true } ? true : false;

// The params object `expand()` receives: defaults applied, required enforced.
export type ParamsOf<S extends ParamsSpec> = {
  [K in keyof S]: HasValue<S[K]> extends true ? ParamValueOf<S[K]> : ParamValueOf<S[K]> | undefined;
};

// Fill defaults and validate raw (JSON-authored) params against a spec.
// Unknown keys are ignored so older engines tolerate params added later.
export function resolveParams<S extends ParamsSpec>(pluginName: string, spec: S, raw: Record<string, unknown>): ParamsOf<S> {
  const out: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(spec)) {
    const value = raw[key] ?? param.default;
    if (value === undefined) {
      if (param.required) {
        throw new Error(`plugin "${pluginName}": missing required param "${key}"`);
      }
      continue;
    }
    validateParam(pluginName, key, param, value);
    out[key] = value;
  }
  return out as ParamsOf<S>;
}

function validateParam(pluginName: string, key: string, param: ParamSpec, value: unknown): void {
  const fail = (expected: string): never => {
    throw new Error(`plugin "${pluginName}": param "${key}" must be ${expected}`);
  };
  switch (param.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) fail("a finite number");
      const n = value as number;
      if (param.min !== undefined && n < param.min) fail(`>= ${param.min}`);
      if (param.max !== undefined && n > param.max) fail(`<= ${param.max}`);
      return;
    }
    case "boolean":
      if (typeof value !== "boolean") fail("a boolean");
      return;
    case "select":
      if (typeof value !== "string" || !param.options.includes(value)) fail(`one of: ${param.options.join(", ")}`);
      return;
    case "latlng":
      if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === "number" && Number.isFinite(v))) {
        fail("a [latitude, longitude] pair of numbers");
      }
      return;
    default:
      if (typeof value !== "string") fail("a string");
  }
}
