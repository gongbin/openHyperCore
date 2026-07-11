import { createServer } from "node:http";
import type { Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineComposition } from "../../core/src/index.ts";
import { expandComposition } from "../../plugins/src/index.ts";
import type { Composition } from "../../core/src/index.ts";
import { extractAudioInputs, renderVideo } from "../../cli/src/index.ts";
import type { RenderOptions } from "../../cli/src/index.ts";

// HTTP render service: POST a composition IR (JSON) and get an MP4 back. Reuses
// the exact CLI render pipeline (wasm/native renderer + ffmpeg), so the same
// engine serves both agents (scripted) and the editor (browser). Assets
// referenced by the IR (video/image/audio/font) must be reachable from the
// server's filesystem — browser-local files are uploaded via POST /assets
// first, and their /assets/<id> URLs are rewritten to the temp file paths
// before rendering.

export type RenderServerOptions = {
  // Reject request bodies larger than this (default 32 MB).
  maxBodyBytes?: number;
  // Reject POST /assets uploads larger than this (default 1 GB).
  maxAssetBytes?: number;
  // CORS allow-origin for browser/editor calls (default "*").
  allowOrigin?: string;
};

// Request body: a bare composition, or { composition, ...overrides }.
type RenderRequest = {
  composition?: Omit<Composition, "type"> | Composition;
  renderer?: "wasm" | "native";
  workers?: number | "auto";
  workerWindow?: number;
  fps?: number;
  size?: { width: number; height: number };
};

const DEFAULT_MAX_BODY = 32 * 1024 * 1024;
const DEFAULT_MAX_ASSET = 1024 * 1024 * 1024;

// Uploaded assets live in one temp dir for the lifetime of the process; the
// IR references them as /assets/<id> which the render handler rewrites to
// these local paths.
const assetStore = new Map<string, { path: string; type: string; size: number }>();
let assetsDirPromise: Promise<string> | null = null;
const assetsDir = (): Promise<string> => (assetsDirPromise ??= mkdtemp(join(tmpdir(), "openhyper-assets-")));

export function createRenderServer(options: RenderServerOptions = {}): Server {
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const maxAsset = options.maxAssetBytes ?? DEFAULT_MAX_ASSET;
  const allowOrigin = options.allowOrigin ?? "*";
  return createServer((req, res) => {
    handle(req, res, maxBody, maxAsset, allowOrigin).catch((error: unknown) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }, allowOrigin);
    });
  });
}

export function startRenderServer(port: number, options: RenderServerOptions = {}): Promise<Server> {
  const server = createRenderServer(options);
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function handle(req: IncomingMessage, res: ServerResponse, maxBody: number, maxAsset: number, allowOrigin: string): Promise<void> {
  if (req.method === "OPTIONS") {
    cors(res, allowOrigin);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  if (req.method === "GET" && (path === "/healthz" || path === "/")) {
    sendJson(res, 200, { ok: true, service: "openhypercore-render" }, allowOrigin);
    return;
  }

  if (req.method === "POST" && path === "/assets") {
    await handleAssetUpload(req, res, maxAsset, allowOrigin);
    return;
  }

  const assetMatch = /^\/assets\/([0-9a-f-]+)$/.exec(path);
  if (assetMatch && (req.method === "GET" || req.method === "HEAD")) {
    const asset = assetStore.get(assetMatch[1]!);
    if (!asset) {
      sendJson(res, 404, { error: "unknown asset" }, allowOrigin);
      return;
    }
    cors(res, allowOrigin);
    res.writeHead(200, { "Content-Type": asset.type, "Content-Length": String(asset.size) });
    if (req.method === "HEAD") res.end();
    else createReadStream(asset.path).pipe(res);
    return;
  }

  if (req.method !== "POST" || path !== "/render") {
    sendJson(res, 404, { error: "not found — POST /render with a composition IR" }, allowOrigin);
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req, maxBody);
  } catch (error) {
    sendJson(res, 413, { error: error instanceof Error ? error.message : "request body too large" }, allowOrigin);
    return;
  }

  let body: RenderRequest;
  try {
    const parsed = JSON.parse(raw) as RenderRequest | (Omit<Composition, "type"> | Composition);
    body = parsed && (parsed as { type?: string }).type === "composition"
      ? { composition: parsed as Composition }
      : (parsed as RenderRequest);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" }, allowOrigin);
    return;
  }

  const input = body.composition;
  if (!input || typeof input !== "object") {
    sendJson(res, 400, { error: "missing `composition` in request body" }, allowOrigin);
    return;
  }
  rewriteAssetUrls(input);

  let composition: Composition;
  try {
    composition = expandComposition(defineComposition({
      ...input,
      fps: body.fps ?? input.fps,
      width: body.size?.width ?? input.width,
      height: body.size?.height ?? input.height
    }));
  } catch (error) {
    sendJson(res, 400, { error: `invalid composition: ${error instanceof Error ? error.message : String(error)}` }, allowOrigin);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "openhyper-render-"));
  const out = join(dir, "out.mp4");
  try {
    const renderOptions: RenderOptions = { out, ffmpegArgsPrefix: [] };
    if (body.renderer) {
      renderOptions.renderer = body.renderer;
    }
    if (body.workers !== undefined) {
      renderOptions.workers = body.workers;
    }
    if (body.workerWindow !== undefined) {
      renderOptions.workerWindow = body.workerWindow;
    }

    const metrics = await renderVideo(composition, renderOptions, await extractAudioInputs(composition));
    const mp4 = await readFile(out);

    cors(res, allowOrigin);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": String(mp4.length),
      "X-OpenHyper-Frames": String(metrics.frames ?? ""),
      "X-OpenHyper-Render-Ms": String(metrics.renderMs ?? ""),
      "X-OpenHyper-Total-Ms": String(metrics.totalMs ?? ""),
      "X-OpenHyper-Renderer": String(metrics.renderer ?? "")
    });
    res.end(mp4);
  } catch (error) {
    sendJson(res, 500, { error: `render failed: ${error instanceof Error ? error.message : String(error)}` }, allowOrigin);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Accept a raw asset body, persist it to the process temp dir and hand back
// an /assets/<id> URL the composition IR can reference.
async function handleAssetUpload(req: IncomingMessage, res: ServerResponse, maxBytes: number, allowOrigin: string): Promise<void> {
  const id = randomUUID();
  const filePath = join(await assetsDir(), id);
  const type = req.headers["content-type"] ?? "application/octet-stream";
  try {
    const size = await new Promise<number>((resolve, reject) => {
      const out = createWriteStream(filePath);
      let written = 0;
      req.on("data", (chunk: Buffer) => {
        written += chunk.length;
        if (written > maxBytes) {
          reject(new Error(`asset exceeds ${maxBytes} bytes`));
          req.destroy();
        }
      });
      req.pipe(out);
      out.on("finish", () => resolve(written));
      out.on("error", reject);
      req.on("error", reject);
    });
    assetStore.set(id, { path: filePath, type, size });
    sendJson(res, 200, { id, url: `/assets/${id}`, size }, allowOrigin);
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    sendJson(res, 413, { error: error instanceof Error ? error.message : String(error) }, allowOrigin);
  }
}

// Swap every ".../assets/<id>" string in the IR (layer srcs, plugin params —
// wherever it appears) for the uploaded file's local path so the render
// pipeline reads straight from disk.
function rewriteAssetUrls(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteAssetUrls(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      const match = /\/assets\/([0-9a-f-]+)$/.exec(value);
      const asset = match ? assetStore.get(match[1]!) : undefined;
      if (asset) record[key] = asset.path;
    } else {
      rewriteAssetUrls(value);
    }
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function cors(res: ServerResponse, allowOrigin: string): void {
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-OpenHyper-Frames, X-OpenHyper-Render-Ms, X-OpenHyper-Total-Ms, X-OpenHyper-Renderer");
}

function sendJson(res: ServerResponse, status: number, payload: unknown, allowOrigin: string): void {
  cors(res, allowOrigin);
  const data = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(data)) });
  res.end(data);
}
