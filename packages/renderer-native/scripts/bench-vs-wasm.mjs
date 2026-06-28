// Compare the native (Rust + skia-safe) renderer against the canvaskit-wasm
// renderer on a vector composition. Requires `pnpm build:native:release` first.
//
//   node --experimental-strip-types packages/renderer-native/scripts/bench-vs-wasm.mjs [composition.ts] [frames]
//
// Defaults to the glow-card-slide raster-cache stress scene (heavy static blur +
// styled text, every frame unique) which is the wasm renderer's worst case.
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const { resolveFrame, timeForFrame } = await import(pathToFileURL(resolve(repo, "packages/core/src/index.ts")).href);
const { createRgbaFrameRenderer } = await import(pathToFileURL(resolve(repo, "packages/renderer-skia/src/index.ts")).href);
const { createNativeFrameRenderer } = await import(pathToFileURL(resolve(repo, "packages/renderer-native/src/index.ts")).href);

const compArg = process.argv[2] ?? resolve(repo, "examples/bench/glow-card-slide.ts");
const frameCount = Number(process.argv[3] ?? 60);
const comp = (await import(pathToFileURL(resolve(process.cwd(), compArg)).href)).default;
const frames = Array.from({ length: frameCount }, (_, i) => resolveFrame(comp, timeForFrame(comp, i)));

async function bench(name, renderFn) {
  await renderFn(frames[0]); // warm up (font/Skia init)
  const start = performance.now();
  for (let i = 0; i < frameCount; i += 1) {
    await renderFn(frames[i]);
  }
  const ms = (performance.now() - start) / frameCount;
  console.log(`${name.padEnd(22)} ${ms.toFixed(2)} ms/frame  (${(1000 / ms).toFixed(1)} fps)`);
  return ms;
}

console.log(`Scene: ${compArg} ${comp.width}x${comp.height}, ${frameCount} frames\n`);

const wasmCache = createRgbaFrameRenderer();
const wasmNoCache = createRgbaFrameRenderer({ layerCache: false });
const native = createNativeFrameRenderer();

const w1 = await bench("wasm (layer cache)", (f) => wasmCache.render(f));
const w2 = await bench("wasm (no cache)", (f) => wasmNoCache.render(f));
const n1 = await bench("native (no cache)", (f) => native.render(f));

console.log(`\nnative vs wasm+cache:   ${(w1 / n1).toFixed(2)}x`);
console.log(`native vs wasm-nocache: ${(w2 / n1).toFixed(2)}x`);

wasmCache.dispose();
wasmNoCache.dispose();
