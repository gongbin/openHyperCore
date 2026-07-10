import { createServer } from "node:http";
import type { Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
// server's filesystem.

export type RenderServerOptions = {
  // Reject request bodies larger than this (default 32 MB).
  maxBodyBytes?: number;
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

export function createRenderServer(options: RenderServerOptions = {}): Server {
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const allowOrigin = options.allowOrigin ?? "*";
  return createServer((req, res) => {
    handle(req, res, maxBody, allowOrigin).catch((error: unknown) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }, allowOrigin);
    });
  });
}

export function startRenderServer(port: number, options: RenderServerOptions = {}): Promise<Server> {
  const server = createRenderServer(options);
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function handle(req: IncomingMessage, res: ServerResponse, maxBody: number, allowOrigin: string): Promise<void> {
  if (req.method === "OPTIONS") {
    cors(res, allowOrigin);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? "/";
  if (req.method === "GET" && (url === "/healthz" || url === "/")) {
    sendJson(res, 200, { ok: true, service: "openhypercore-render" }, allowOrigin);
    return;
  }

  if (req.method !== "POST" || url.split("?")[0] !== "/render") {
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
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-OpenHyper-Frames, X-OpenHyper-Render-Ms, X-OpenHyper-Total-Ms, X-OpenHyper-Renderer");
}

function sendJson(res: ServerResponse, status: number, payload: unknown, allowOrigin: string): void {
  cors(res, allowOrigin);
  const data = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(data)) });
  res.end(data);
}
