import assert from "node:assert/strict";
import { after, test } from "node:test";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import type { Composition, GroupLayer, Layer, ShapeLayer, TextLayer } from "../../core/src/index.ts";
import { expandComposition, hasPluginLayers, registerPlugin, unregisterPlugin } from "../src/index.ts";
import { neonTraceTitle } from "../src/builtins/neon-trace-title.ts";
import { apertureReveal } from "../src/builtins/aperture-reveal.ts";
import { radarSweep } from "../src/builtins/radar-sweep.ts";
import { kineticBars } from "../src/builtins/kinetic-bars.ts";
import { particleAssemble } from "../src/builtins/particle-assemble.ts";

// Intro-effect plugins (batch A) are not registered by the package index yet,
// so register them here for the duration of this file.
registerPlugin(neonTraceTitle);
registerPlugin(apertureReveal);
registerPlugin(radarSweep);
registerPlugin(kineticBars);
registerPlugin(particleAssemble);
const PLUGINS: ReadonlyArray<{ name: string; defaultDurationMs?: number }> =
  [neonTraceTitle, apertureReveal, radarSweep, kineticBars, particleAssemble];
after(() => {
  for (const plugin of PLUGINS) {
    unregisterPlugin(plugin.name);
  }
});

function comp(layers: Layer[], durationMs = 4000): Composition {
  return defineComposition({ fps: 30, width: 1280, height: 720, durationMs, layers });
}

// Expand a single plugin node and return the resulting group; also assert the
// expanded composition resolves cleanly at start/mid/end.
function expandOne(plugin: string, params: Record<string, unknown>, durationMs = 4000): GroupLayer {
  const expanded = expandComposition(comp([{ type: "plugin", plugin, params }], durationMs));
  assert.equal(hasPluginLayers(expanded.layers), false);
  assert.equal(expanded.layers.length, 1);
  const group = expanded.layers[0] as GroupLayer;
  assert.equal(group.type, "group");
  assert.ok(group.layers.length > 0);
  for (const t of [0, Math.round(durationMs * 0.5), durationMs - 1]) {
    const frame = resolveFrame(expanded, t);
    assert.ok(frame.layers.length > 0, `no layers at ${t}ms`);
  }
  return group;
}

const flatten = (layers: Layer[]): Layer[] =>
  layers.flatMap((l) => (l.type === "group" ? [l, ...flatten(l.layers)] : [l]));

test("neon-trace-title: one trace + one fill text layer per character, underline and node", () => {
  const text = "NEON";
  const group = expandOne("neon-trace-title", { text });
  const traces = group.layers.filter((l) => l.id?.startsWith("neon-trace-")) as TextLayer[];
  const fills = group.layers.filter((l) => l.id?.startsWith("neon-fill-")) as TextLayer[];
  assert.equal(traces.length, text.length);
  assert.equal(fills.length, text.length);
  assert.deepEqual(traces.map((l) => l.text), [...text]);

  // Ignition is staggered: each char's fill starts after the previous one's.
  const fillStarts = fills.map((l) => (l.transform!.opacity as { timeMs: number }[])[0]!.timeMs);
  for (let i = 1; i < fillStarts.length; i += 1) {
    assert.ok(fillStarts[i]! > fillStarts[i - 1]!, "fill starts must be staggered");
  }

  // Underline grows from the left edge (x pinned, scaleX 0 → 1).
  const underline = group.layers.find((l) => l.id === "neon-underline") as ShapeLayer;
  assert.ok(underline);
  const scaleX = underline.transform!.scaleX as { value: number }[];
  assert.equal(scaleX[0]!.value, 0);
  assert.equal(scaleX[scaleX.length - 1]!.value, 1);
  assert.equal(typeof underline.transform!.x, "number");
  assert.ok(group.layers.some((l) => l.id === "neon-underline-node"));
});

test("aperture-reveal: blades hold shut then travel radially outward; title fades in late", () => {
  const blades = 6;
  const group = expandOne("aperture-reveal", { blades, title: "IRIS" });
  const iris = group.layers.find((l) => l.id === "aperture-iris") as GroupLayer;
  assert.ok(iris);
  const bladeLayers = iris.layers.filter((l) => l.id?.startsWith("aperture-blade-")) as ShapeLayer[];
  assert.equal(bladeLayers.length, blades);
  for (const blade of bladeLayers) {
    const x = blade.transform!.x as { timeMs: number; value: number }[];
    const y = blade.transform!.y as { timeMs: number; value: number }[];
    // Shut at the start of the move, at distance `travel` at the end.
    assert.equal(Math.hypot(x[0]!.value, y[0]!.value), 0);
    const d = Math.hypot(x[x.length - 1]!.value, y[y.length - 1]!.value);
    assert.ok(d > 500, `blade travel too short: ${d}`);
  }
  assert.ok(iris.layers.some((l) => l.id === "aperture-outline"));

  // At t=0 the title is invisible; near the end it is fully in.
  const expanded = expandComposition(comp([{ type: "plugin", plugin: "aperture-reveal", params: { blades, title: "IRIS" } }]));
  const start = resolveFrame(expanded, 0).layers[0] as Extract<ReturnType<typeof resolveFrame>["layers"][number], { type: "group" }>;
  const title0 = start.layers.find((l) => l.id === "aperture-title")!;
  assert.equal(title0.transform.opacity, 0);
  const end = resolveFrame(expanded, 3999).layers[0] as typeof start;
  const title1 = end.layers.find((l) => l.id === "aperture-title")!;
  assert.equal(title1.transform.opacity, 1);
});

test("radar-sweep: rings honour the param, the sweep revolves per sweepMs, blips ping on beam pass", () => {
  const group = expandOne("radar-sweep", { rings: 3, blips: 2, sweepMs: 2000 });
  const furniture = group.layers.find((l) => l.id === "radar-furniture") as GroupLayer;
  const ringShapes = furniture.layers.filter((l) => l.type === "shape" && (l as ShapeLayer).shape === "circle");
  assert.equal(ringShapes.length, 3);

  // 4000ms window at sweepMs 2000 = two revolutions: -90° → 630°.
  const sweep = group.layers.find((l) => l.id === "radar-sweep") as GroupLayer;
  const rotate = sweep.transform!.rotate as { timeMs: number; value: number }[];
  assert.equal(rotate[0]!.value, -90);
  assert.equal(rotate[rotate.length - 1]!.value, -90 + 720);
  assert.ok(sweep.layers.some((l) => l.id === "radar-beam"));
  assert.ok(sweep.layers.filter((l) => l.id?.startsWith("radar-trail-")).length >= 3);

  // Each blip has ping spikes (opacity rises to 1) and an expanding ring.
  const blips = group.layers.filter((l) => l.id?.startsWith("radar-blip-") && !l.id!.includes("ring")) as ShapeLayer[];
  assert.equal(blips.length, 2);
  for (const blip of blips) {
    const opacity = blip.transform!.opacity as { value: number }[];
    assert.ok(opacity.some((kf) => kf.value === 1), "blip never pings");
  }
  assert.equal(group.layers.filter((l) => l.id?.startsWith("radar-blip-ring-")).length, 2);
});

test("kinetic-bars: honours the line count, alternates entry side, and keeps text screen-centred", () => {
  const group = expandOne("kinetic-bars", { lines: "ONE / TWO / THREE / FOUR" });
  const rows = group.layers.filter((l) => l.id?.startsWith("kinetic-row-")) as GroupLayer[];
  assert.equal(rows.length, 4);

  const entrySides = rows.map((row) => Math.sign((row.transform!.x as { value: number }[])[0]!.value));
  assert.deepEqual(entrySides, [1, -1, 1, -1]);

  for (const row of rows) {
    assert.ok(row.clip && row.clip.type === "rect");
    const rowX = row.transform!.x as { timeMs: number; value: number }[];
    const text = row.layers.find((l) => l.type === "text") as TextLayer;
    const textX = text.transform!.x as { timeMs: number; value: number }[];
    // Counter-move: group x + text x stays at the screen centre throughout.
    for (let i = 0; i < rowX.length; i += 1) {
      assert.equal(rowX[i]!.value + textX[i]!.value, 1280 / 2);
    }
    // Bars land (x = 0) when the slide ends.
    assert.equal(rowX[rowX.length - 1]!.value, 0);
  }

  // The second row uses the outline style with a separate stroke rect.
  assert.ok(group.layers.some((l) => l.id === "kinetic-outline-1"));
  assert.ok(!group.layers.some((l) => l.id === "kinetic-outline-0"));
});

test("particle-assemble: emits `count` particles converging to targets, ring + title fade late", () => {
  const count = 24;
  const group = expandOne("particle-assemble", { count, title: "MARK" });
  const particles = group.layers.find((l) => l.id === "assemble-particles") as GroupLayer;
  assert.equal(particles.layers.length, count);

  const cx = 1280 / 2;
  const cy = 720 * 0.44;
  const R = 720 * 0.24;
  for (const p of particles.layers as ShapeLayer[]) {
    const x = p.transform!.x as { value: number }[];
    const y = p.transform!.y as { value: number }[];
    const pr = p.radius!;
    const dist = Math.hypot(x[x.length - 1]!.value + pr - cx, y[y.length - 1]!.value + pr - cy);
    assert.ok(dist < R + 1, `particle target outside the ring: ${dist}`);
    // Opacity ramps 0.2 → 1 during assembly.
    const opacity = p.transform!.opacity as { value: number }[];
    assert.equal(opacity[0]!.value, 0.2);
    assert.equal(opacity[opacity.length - 1]!.value, 1);
  }

  assert.ok(group.layers.some((l) => l.id === "assemble-ring"));
  const expanded = expandComposition(comp([{ type: "plugin", plugin: "particle-assemble", params: { count, title: "MARK" } }]));
  const start = resolveFrame(expanded, 0).layers[0] as Extract<ReturnType<typeof resolveFrame>["layers"][number], { type: "group" }>;
  assert.equal(start.layers.find((l) => l.id === "assemble-title")!.transform.opacity, 0);
  const end = resolveFrame(expanded, 3999).layers[0] as typeof start;
  assert.equal(end.layers.find((l) => l.id === "assemble-title")!.transform.opacity, 1);
});

test("all five expand with pure defaults and resolve across their default windows", () => {
  for (const plugin of PLUGINS) {
    const durationMs = plugin.defaultDurationMs ?? 4000;
    const expanded = expandComposition(comp([{ type: "plugin", plugin: plugin.name }], durationMs));
    assert.equal(hasPluginLayers(expanded.layers), false);
    for (const frac of [0, 0.3, 0.6, 0.95]) {
      const frame = resolveFrame(expanded, Math.round(durationMs * frac));
      assert.ok(frame.layers.length > 0, `${plugin.name}: empty frame at ${frac}`);
    }
    // Deterministic: expanding twice yields identical IR (seeded randomness).
    const again = expandComposition(comp([{ type: "plugin", plugin: plugin.name }], durationMs));
    assert.deepEqual(again.layers, expanded.layers);
  }
});
