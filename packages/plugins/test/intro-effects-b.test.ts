import assert from "node:assert/strict";
import { test } from "node:test";
import { defineComposition, resolveFrame } from "../../core/src/index.ts";
import type { Composition, GroupLayer, Layer, ScalarKeyframe, ShapeLayer, TextLayer } from "../../core/src/index.ts";
import { expandComposition, hasPluginLayers, registerPlugin } from "../src/index.ts";
import { hyperspaceWarp } from "../src/builtins/hyperspace-warp.ts";
import { velocityZoom } from "../src/builtins/velocity-zoom.ts";
import { beatBounce } from "../src/builtins/beat-bounce.ts";
import { rgbGlitchShake } from "../src/builtins/rgb-glitch-shake.ts";
import { stickerPop } from "../src/builtins/sticker-pop.ts";

// Registration is normally handled by the package index; register directly
// here so the tests are independent of that wiring (last-wins, so double
// registration is harmless).
registerPlugin(hyperspaceWarp);
registerPlugin(velocityZoom);
registerPlugin(beatBounce);
registerPlugin(rgbGlitchShake);
registerPlugin(stickerPop);

function comp(layers: Layer[], durationMs = 3000): Composition {
  return defineComposition({ fps: 30, width: 1280, height: 720, durationMs, layers });
}

function expandOne(plugin: string, params: Record<string, unknown>, durationMs: number): GroupLayer {
  const expanded = expandComposition(comp([{ type: "plugin", plugin, params }], durationMs));
  assert.equal(hasPluginLayers(expanded.layers), false);
  const group = expanded.layers[0] as GroupLayer;
  assert.equal(group.type, "group");
  return group;
}

function assertResolvesAcrossWindow(plugin: string, params: Record<string, unknown>, durationMs: number): void {
  const expanded = expandComposition(comp([{ type: "plugin", plugin, params }], durationMs));
  for (const t of [0, Math.round(durationMs / 2), durationMs - 1]) {
    const frame = resolveFrame(expanded, t);
    assert.ok(frame.layers.length > 0, `${plugin} resolves at ${t}ms`);
    const group = frame.layers[0];
    assert.equal(group?.type, "group");
    assert.ok((group as Extract<typeof frame.layers[number], { type: "group" }>).layers.length > 0);
  }
}

test("hyperspace-warp expands to streaks + flash + title and resolves", () => {
  const T = 3800;
  const group = expandOne("hyperspace-warp", { streaks: 60, title: "HYPERSPACE" }, T);
  const streaks = group.layers.find((l) => l.id === "warp-streaks") as GroupLayer;
  assert.ok(streaks, "has streak container");
  assert.equal(streaks.layers.length, 60);
  const flash = group.layers.find((l) => l.id === "warp-flash") as ShapeLayer;
  assert.ok(flash, "has flash");
  // Flash lives around 70% of the window.
  assert.ok((flash.startMs ?? 0) > T * 0.5 && (flash.endMs ?? 0) < T * 0.9);
  const title = group.layers.find((l) => l.id === "warp-title") as TextLayer;
  assert.equal(title.text, "HYPERSPACE");
  // Title punches in from oversize down to 1.
  const scale = title.transform?.scale as ScalarKeyframe[];
  assert.equal(scale[0]!.value, 2.2);
  assert.equal(scale[scale.length - 1]!.value, 1);
  assertResolvesAcrossWindow("hyperspace-warp", {}, T);
});

test("velocity-zoom pulses once per beat across the whole window", () => {
  const T = 2600;
  const beats = 3;
  const group = expandOne("velocity-zoom", { text: "GO VIRAL", beats, zoom: 1.9 }, T);
  const content = group.layers.find((l) => l.id === "vz-content") as GroupLayer;
  assert.ok(content, "has content group");
  const scale = content.transform?.scale as ScalarKeyframe[];
  // One full-zoom keyframe at the start of EVERY beat.
  const peaks = scale.filter((k) => Math.abs(k.value - 1.9) < 1e-9);
  assert.equal(peaks.length, beats);
  for (let k = 0; k < beats; k += 1) {
    assert.ok(peaks.some((p) => Math.abs(p.timeMs - (k * T) / beats) <= 1), `zoom peak at beat ${k}`);
  }
  // The swipe-up tag stays OUTSIDE the shaking group.
  const swipe = group.layers.find((l) => l.id === "vz-swipe");
  assert.ok(swipe && swipe.type === "text");
  // Per-beat motion-blur smear copies exist inside the content group.
  const blurs = content.layers.filter((l) => l.id?.startsWith("vz-punch-blur"));
  assert.equal(blurs.length, beats);
  assert.ok(blurs.every((l) => l.motionBlur && l.motionBlur.distance > 0));
  assertResolvesAcrossWindow("velocity-zoom", {}, T);
});

test("beat-bounce squash-bounces every beat and steps the dot colors", () => {
  const T = 2400;
  const beatMs = 400;
  const group = expandOne("beat-bounce", { text: "LET’S GO", beatMs }, T);
  const caption = group.layers.find((l) => l.id === "bb-caption") as GroupLayer;
  assert.ok(caption, "has caption group");
  const inner = caption.layers[0] as GroupLayer;
  const sx = inner.transform?.scaleX as ScalarKeyframe[];
  const sy = inner.transform?.scaleY as ScalarKeyframe[];
  // Squash opposition: scaleY mirrors scaleX around 1 (s and 2-s).
  for (let i = 0; i < sx.length; i += 1) {
    assert.ok(Math.abs(sx[i]!.value + sy[i]!.value - 2) < 1e-9);
  }
  // The bounce restarts on every beat: a keyframe with the compressed base
  // value at each beat start, across the whole window.
  const base = Math.min(...sx.map((k) => k.value));
  for (let b = 0; b < T / beatMs; b += 1) {
    assert.ok(sx.some((k) => k.timeMs === b * beatMs && Math.abs(k.value - base) < 1e-9), `beat ${b} restarts squashed`);
  }
  // Three beat dots with stepped color tracks.
  const dots = group.layers.filter((l) => l.id?.startsWith("bb-dot-")) as ShapeLayer[];
  assert.equal(dots.length, 3);
  assert.ok(dots.every((d) => Array.isArray(d.fill) && d.fill.length > 2));
  assertResolvesAcrossWindow("beat-bounce", {}, T);
});

test("rgb-glitch-shake keeps jittering the full window with screen-blend channels", () => {
  const T = 2600;
  const group = expandOne("rgb-glitch-shake", { text: "GLITCH" }, T);
  const a = group.layers.find((l) => l.id === "rgs-channel-a") as TextLayer;
  const b = group.layers.find((l) => l.id === "rgs-channel-b") as TextLayer;
  const main = group.layers.find((l) => l.id === "rgs-main") as TextLayer;
  assert.ok(a && b && main);
  assert.equal(a.blendMode, "screen");
  assert.equal(b.blendMode, "screen");
  // Channels sit on opposite sides of centre at t=0.
  const ax = (a.transform?.x as ScalarKeyframe[])[0]!.value;
  const bx = (b.transform?.x as ScalarKeyframe[])[0]!.value;
  assert.ok(ax < 640 && bx > 640);
  // Jitter tracks span (nearly) the whole window — continuous, not one-shot.
  const axTrack = a.transform?.x as ScalarKeyframe[];
  assert.ok(axTrack[axTrack.length - 1]!.timeMs >= T - 80);
  // Slice tears and noise flecks exist.
  const slices = group.layers.filter((l) => l.id?.startsWith("rgs-slice-"));
  assert.equal(slices.length, 6);
  assert.ok(slices.every((s) => s.type === "group" && s.clip?.type === "rect"));
  const noise = group.layers.find((l) => l.id === "rgs-noise") as GroupLayer;
  assert.equal(noise.layers.length, 30);
  assertResolvesAcrossWindow("rgb-glitch-shake", {}, T);
});

test("sticker-pop emits one sticker per emoji slot and an elastic bubble", () => {
  const T = 3000;
  const group = expandOne("sticker-pop", { caption: "OMG 😱", stickers: "✨ 🔥 💖" }, T);
  const bubble = group.layers.find((l) => l.id === "sp-bubble") as GroupLayer;
  assert.ok(bubble, "has bubble");
  const path = bubble.layers[0] as ShapeLayer;
  assert.equal(path.shape, "path");
  // Elastic entrance: starts at 0, overshoots past 1, settles at 1.
  const scale = bubble.transform?.scale as ScalarKeyframe[];
  assert.equal(scale[0]!.value, 0);
  assert.ok(Math.max(...scale.map((k) => k.value)) > 1.05);
  assert.equal(scale[scale.length - 1]!.value, 1);
  // 10 sticker groups cycling the 3 provided emoji.
  const burst = group.layers.find((l) => l.id === "sp-stickers") as GroupLayer;
  assert.equal(burst.layers.length, 10);
  const texts = burst.layers.map((s) => ((s as GroupLayer).layers[1] as TextLayer).text);
  assert.deepEqual(texts.slice(0, 3), ["✨", "🔥", "💖"]);
  assert.equal(texts[3], "✨");
  // Every sticker carries a fallback disc behind the glyph.
  assert.ok(burst.layers.every((s) => ((s as GroupLayer).layers[0] as ShapeLayer).shape === "circle"));
  assertResolvesAcrossWindow("sticker-pop", {}, T);
});
