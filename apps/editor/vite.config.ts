import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // canvaskit-wasm ships a large .wasm; let Vite serve it as an asset URL.
  assetsInclude: ["**/*.wasm"]
});
