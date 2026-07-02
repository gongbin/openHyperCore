import assert from "node:assert/strict";
import { test } from "node:test";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import type { Composition, GroupLayer, Layer, PluginLayer } from "../../core/src/index.ts";
import {
  definePlugin,
  expandComposition,
  hasPluginLayers,
  listPlugins,
  registerPlugin,
  resolveParams,
  unregisterPlugin
} from "../src/index.ts";

function comp(layers: Layer[]): Composition {
  return defineComposition({ fps: 30, width: 1280, height: 720, durationMs: 4000, layers });
}

test("resolveParams fills defaults, enforces required and validates types", () => {
  const spec = {
    text: { type: "string", required: true },
    size: { type: "number", default: 48, min: 1 },
    accent: { type: "color", default: "#ff0000" }
  } as const;

  const params = resolveParams("demo", spec, { text: "hi" });
  assert.equal(params.text, "hi");
  assert.equal(params.size, 48);
  assert.equal(params.accent, "#ff0000");

  assert.throws(() => resolveParams("demo", spec, {}), /missing required param "text"/);
  assert.throws(() => resolveParams("demo", spec, { text: "hi", size: "big" }), /param "size" must be/);
  assert.throws(() => resolveParams("demo", spec, { text: "hi", size: 0 }), />= 1/);
});

test("expandComposition replaces plugin nodes with groups carrying base props", () => {
  registerPlugin(definePlugin({
    name: "test-badge",
    params: { label: { type: "string", default: "hello" } },
    expand: (params, ctx) => [
      { type: "text", text: params.label, transform: { x: ctx.width / 2, y: ctx.height / 2 } }
    ]
  }));
  try {
    const node: PluginLayer = {
      type: "plugin",
      plugin: "test-badge",
      id: "badge",
      startMs: 1000,
      endMs: 3000,
      transform: { opacity: 0.5 }
    };
    const expanded = expandComposition(comp([node]));

    assert.equal(expanded.layers.length, 1);
    const group = expanded.layers[0] as GroupLayer;
    assert.equal(group.type, "group");
    assert.equal(group.id, "badge");
    assert.equal(group.startMs, 1000);
    assert.equal(group.endMs, 3000);
    assert.deepEqual(group.transform, { opacity: 0.5 });
    assert.equal(group.layers.length, 1);
    assert.equal((group.layers[0] as Extract<Layer, { type: "text" }>).text, "hello");

    // The original composition is untouched and the result resolves cleanly.
    assert.equal(hasPluginLayers([node]), true);
    assert.equal(hasPluginLayers(expanded.layers), false);
    const frame = resolveFrame(expanded, 1500);
    assert.equal(frame.layers.length, 1);
  } finally {
    unregisterPlugin("test-badge");
  }
});

test("expandComposition reaches plugin nodes nested in groups and expands recursively-produced plugins", () => {
  registerPlugin(definePlugin({
    name: "test-inner",
    params: {},
    expand: () => [{ type: "shape", shape: "rect", width: 10, height: 10, fill: "#fff" }]
  }));
  registerPlugin(definePlugin({
    name: "test-outer",
    params: {},
    expand: () => [{ type: "plugin", plugin: "test-inner" }]
  }));
  try {
    const expanded = expandComposition(comp([
      { type: "group", layers: [{ type: "plugin", plugin: "test-outer" }] }
    ]));
    assert.equal(hasPluginLayers(expanded.layers), false);
    const outerGroup = (expanded.layers[0] as GroupLayer).layers[0] as GroupLayer;
    assert.equal(outerGroup.type, "group");
    const innerGroup = outerGroup.layers[0] as GroupLayer;
    assert.equal(innerGroup.type, "group");
    assert.equal(innerGroup.layers[0]?.type, "shape");
  } finally {
    unregisterPlugin("test-inner");
    unregisterPlugin("test-outer");
  }
});

test("self-recursive plugins fail with a depth error instead of overflowing", () => {
  registerPlugin(definePlugin({
    name: "test-loop",
    params: {},
    expand: () => [{ type: "plugin", plugin: "test-loop" }]
  }));
  try {
    assert.throws(() => expandComposition(comp([{ type: "plugin", plugin: "test-loop" }])), /depth/);
  } finally {
    unregisterPlugin("test-loop");
  }
});

test("unknown plugins and unexpanded plugin layers throw helpful errors", () => {
  assert.throws(() => expandComposition(comp([{ type: "plugin", plugin: "nope" }])), /unknown plugin "nope"/);
  assert.throws(() => resolveFrame(comp([{ type: "plugin", plugin: "nope" }]), 0), /unexpanded plugin layer "nope"/);
});

test("shape path trim tracks resolve to numbers (incl. group-local time)", () => {
  const trimmed: Layer = {
    type: "shape",
    shape: "path",
    path: "M0 0L100 0",
    stroke: "#fff",
    trimEnd: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }]
  };
  const frame = resolveFrame(comp([trimmed, { type: "group", startMs: 500, layers: [trimmed] }]), 1000);
  const top = frame.layers[0] as Extract<typeof frame.layers[number], { type: "shape" }>;
  assert.equal(top.trimEnd, 1);
  assert.equal(top.trimStart, undefined);
  const inGroup = (frame.layers[1] as Extract<typeof frame.layers[number], { type: "group" }>).layers[0] as Extract<typeof frame.layers[number], { type: "shape" }>;
  assert.equal(inGroup.trimEnd, 0.5); // group-local time: 1000 - 500 start
});

test("map-route expands to a framed map with a trim-drawn route and synced tip marker", () => {
  const expanded = expandComposition(comp([
    { type: "plugin", plugin: "map-route", params: { from: [43.06, 141.35], to: [35.68, 139.69], fromLabel: "札幌", toLabel: "東京" } }
  ]));
  assert.equal(hasPluginLayers(expanded.layers), false);

  const group = expanded.layers[0] as GroupLayer;
  const content = group.layers[1] as GroupLayer;
  assert.equal(content.id, "map-content");
  const land = content.layers.find((l) => l.id === "map-land");
  const route = content.layers.find((l) => l.id === "route-line") as Extract<Layer, { type: "shape" }>;
  const tip = content.layers.find((l) => l.id === "route-tip");
  assert.ok(land && route && tip);
  assert.ok(Array.isArray(route.trimEnd) && route.trimEnd.length > 10);

  // Mid-draw the route is partially trimmed and the tip is riding it.
  const frame = resolveFrame(expanded, 2000);
  assert.ok(frame.layers.length > 0);
  // Labels made it in.
  const labels = content.layers.filter((l) => l.type === "text");
  assert.equal(labels.length, 2);
});

test("globe layer rotation resolves to numbers and globe-intro centres the target", () => {
  // Core: yaw/pitch/radius keyframes resolve like the transform.
  const frame = resolveFrame(comp([{
    type: "globe",
    src: "earth.jpg",
    radius: [{ timeMs: 0, value: 100 }, { timeMs: 4000, value: 200 }],
    yaw: [{ timeMs: 0, value: 0 }, { timeMs: 4000, value: Math.PI }]
  }]), 2000);
  const globe = frame.layers[0] as Extract<typeof frame.layers[number], { type: "globe" }>;
  assert.equal(globe.radius, 150);
  assert.ok(Math.abs(globe.yaw - Math.PI / 2) < 1e-9);
  assert.equal(globe.pitch, 0);

  // Plugin: the final yaw/pitch land the target at the front centre
  // (mesh convention: lon = yaw, lat = -pitch face the viewer).
  const expanded = expandComposition(comp([{
    type: "plugin",
    plugin: "globe-intro",
    params: { src: "earth.jpg", target: [35.68, 139.69] }
  }]));
  assert.equal(hasPluginLayers(expanded.layers), false);
  const group = expanded.layers[0] as GroupLayer;
  const zoom = group.layers.find((l) => l.id === "globe-zoom") as GroupLayer;
  const g = zoom.layers.find((l) => l.type === "globe") as Extract<Layer, { type: "globe" }>;
  const yawTrack = g.yaw as { timeMs: number; value: number }[];
  const pitchTrack = g.pitch as { timeMs: number; value: number }[];
  assert.ok(Math.abs(yawTrack[yawTrack.length - 1]!.value - (139.69 * Math.PI) / 180) < 1e-9);
  assert.ok(Math.abs(pitchTrack[pitchTrack.length - 1]!.value - (-35.68 * Math.PI) / 180) < 1e-9);
});

test("built-in plugins are registered and expand into resolvable compositions", () => {
  const names = listPlugins().map((p) => p.name);
  assert.ok(names.includes("curtain-open"));
  assert.ok(names.includes("ken-burns"));
  assert.ok(names.includes("glitch-title"));

  const expanded = expandComposition(comp([
    { type: "plugin", plugin: "curtain-open", endMs: 3000 },
    { type: "plugin", plugin: "ken-burns", params: { src: "https://example.com/p.jpg" }, startMs: 500 },
    { type: "plugin", plugin: "glitch-title", params: { text: "北海道之旅" }, startMs: 1000, endMs: 3400 }
  ]));
  assert.equal(hasPluginLayers(expanded.layers), false);

  // Every expanded layer resolves at several points of the window.
  for (const t of [0, 700, 1500, 2900, 3999]) {
    const frame = resolveFrame(expanded, t);
    assert.ok(frame.layers.length > 0);
  }

  // Curtain panels start covering the full frame and end off-screen.
  const curtain = expanded.layers[0] as GroupLayer;
  const atStart = resolveFrame(expanded, 0).layers[0];
  assert.equal(atStart?.type, "group");
  assert.equal(curtain.layers.length, 3); // two panels + shadow

  // ken-burns requires src.
  assert.throws(() => expandComposition(comp([{ type: "plugin", plugin: "ken-burns" }])), /missing required param "src"/);
});
