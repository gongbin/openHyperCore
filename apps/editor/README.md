# openHyperEditor

A decoupled web tool for authoring [openhypercore](https://www.npmjs.com/package/openhypercore) compositions: edit the scene-graph IR, preview it live in the browser with **canvaskit-wasm** (WYSIWYG), and render the final **MP4** via the openhypercore render service.

It consumes the published `openhypercore` package — the engine knows nothing about the editor (one-way dependency).

## Run

This app is standalone (not part of the engine's pnpm workspace), so install with
`--ignore-workspace`:

```bash
cd apps/editor
pnpm install --ignore-workspace
pnpm dev
```

For the **Render MP4** button, run the engine's render service in another terminal:

```bash
npx openhyper serve --port 8787
```

(The service URL is editable in the UI; default `http://localhost:8787`.)

## What it does (MVP)

- **Live preview** of the composition IR with canvaskit-wasm — the vector subset:
  shapes, gradients, groups, clip, blend modes, blur, motion blur, transforms.
- **Time scrubber** over the composition duration.
- **IR editor** (JSON) with live re-preview and validation.
- **Render MP4** — POSTs the IR to the render service and downloads the result;
  the server produces the full-fidelity output (including text/image/video).

## Roadmap

- Timeline + a structured properties panel (replacing the raw JSON editor).
- Reuse the engine's exact draw path in the browser via a renderer "asset
  provider" abstraction (so text/image/video preview matches the final render),
  instead of the current compact preview mirror.
