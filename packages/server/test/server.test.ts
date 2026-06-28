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
