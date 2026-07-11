import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { startRenderServer } from "../src/index.ts";

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

function send(port: number, method: string, path: string, body?: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          connection: "close",
          ...(data ? { "content-type": "application/json", "content-length": data.length } : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

const composition = {
  type: "composition",
  fps: 30,
  width: 32,
  height: 32,
  durationMs: 120,
  layers: [
    { type: "shape", shape: "rect", width: 32, height: 32, fill: "#3366cc" },
    { type: "shape", shape: "circle", radius: 10, fill: "#e7c36a", transform: { x: 6, y: 6 } }
  ]
};

test("POST /render returns an MP4 for a composition IR", async () => {
  const server = await startRenderServer(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await send(port, "POST", "/render", composition);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "video/mp4");
    assert.ok(res.body.length > 0, "non-empty body");
    // MP4 files start with an `ftyp` box at byte offset 4.
    assert.equal(res.body.subarray(4, 8).toString("ascii"), "ftyp");
    assert.ok(Number(res.headers["x-openhyper-frames"]) > 0, "reports frame count");
  } finally {
    server.close();
  }
});

test("POST /render accepts { composition } wrapper + size override", async () => {
  const server = await startRenderServer(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await send(port, "POST", "/render", { composition, size: { width: 48, height: 24 } });
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "video/mp4");
  } finally {
    server.close();
  }
});

test("POST /render rejects an invalid composition with 400", async () => {
  const server = await startRenderServer(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await send(port, "POST", "/render", { composition: { fps: 0, width: 10, height: 10, durationMs: 100, layers: [] } });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test("GET /healthz reports ok", async () => {
  const server = await startRenderServer(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await send(port, "GET", "/healthz");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body.toString()), { ok: true, service: "openhypercore-render" });
  } finally {
    server.close();
  }
});

function sendRaw(port: number, method: string, path: string, body: Buffer, type: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers: { connection: "close", "content-type": type, "content-length": body.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

test("POST /assets stores an upload; /render rewrites its URL to the local file", async () => {
  const server = await startRenderServer(0);
  const port = (server.address() as AddressInfo).port;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  try {
    const up = await sendRaw(port, "POST", "/assets", png, "image/png");
    assert.equal(up.status, 200);
    const { id, url, size } = JSON.parse(up.body.toString()) as { id: string; url: string; size: number };
    assert.equal(url, `/assets/${id}`);
    assert.equal(size, png.length);

    const got = await send(port, "GET", url);
    assert.equal(got.status, 200);
    assert.equal(got.headers["content-type"], "image/png");
    assert.ok(got.body.equals(png), "round-trips the exact bytes");

    // The IR references the uploaded asset by URL; the server must rewrite it
    // to the temp file path so the render pipeline reads from disk.
    const withImage = {
      ...composition,
      layers: [...composition.layers, { type: "image", src: `http://127.0.0.1:${port}${url}`, width: 16, height: 16 }]
    };
    const res = await send(port, "POST", "/render", withImage);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "video/mp4");
  } finally {
    server.close();
  }
});

test("GET /assets/<unknown> is 404", async () => {
  const server = await startRenderServer(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await send(port, "GET", "/assets/deadbeef-0000-0000-0000-000000000000");
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
