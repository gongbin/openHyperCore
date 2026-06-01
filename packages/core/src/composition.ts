import type { Composition } from "./types.ts";

export function defineComposition(input: Omit<Composition, "type"> | Composition): Composition {
  const composition = {
    ...input,
    type: "composition" as const,
    layers: input.layers ?? []
  };

  assertPositive("fps", composition.fps);
  assertPositive("width", composition.width);
  assertPositive("height", composition.height);
  assertPositive("durationMs", composition.durationMs);

  return composition;
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}
