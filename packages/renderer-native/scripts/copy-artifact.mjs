// Copy the cargo-built cdylib to `<pkg>/renderer-native.node` so Node can load
// it. Cross-platform; profile via NATIVE_PROFILE (debug|release, default debug).
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.env.NATIVE_PROFILE ?? "debug";
const artifact = process.platform === "win32"
  ? "renderer_native.dll"
  : process.platform === "darwin"
    ? "librenderer_native.dylib"
    : "librenderer_native.so";

const src = join(root, "target", profile, artifact);
const dst = join(root, "renderer-native.node");
copyFileSync(src, dst);
console.log(`copied ${src} -> ${dst}`);
