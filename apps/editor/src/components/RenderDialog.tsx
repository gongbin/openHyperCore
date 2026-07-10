import { useEffect, useRef, useState } from "react";
import type { Composition, Layer } from "openhypercore";
import { Icon } from "../icons.tsx";
import { Col, Row, Sel } from "../fields.tsx";
import type { AnyLayer } from "../helpers.ts";

function collectBlobSrcs(layers: Layer[], found: string[]): void {
  for (const l of layers) {
    const al = l as AnyLayer;
    if (typeof al.src === "string" && al.src.startsWith("blob:")) found.push(`${al.type}${al.id ? ` · ${al.id}` : ""}`);
    if (Array.isArray(al.layers)) collectBlobSrcs(al.layers as Layer[], found);
    if (al.type === "plugin" && al.params) {
      for (const v of Object.values(al.params as Record<string, unknown>)) {
        if (typeof v === "string" && v.startsWith("blob:")) found.push(`✦ ${String(al.plugin)}`);
      }
    }
  }
}

export function RenderDialog({ composition, projectName, onClose }: {
  composition: Composition;
  projectName: string;
  onClose: () => void;
}) {
  const [serviceUrl, setServiceUrl] = useState(() => localStorage.getItem("ohe.service") ?? "http://localhost:8787");
  const [renderer, setRenderer] = useState("默认");
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const blobLayers: string[] = [];
  collectBlobSrcs(composition.layers, blobLayers);

  useEffect(() => { localStorage.setItem("ohe.service", serviceUrl); }, [serviceUrl]);

  useEffect(() => {
    let cancelled = false;
    setHealth("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${serviceUrl.replace(/\/$/, "")}/healthz`, { signal: AbortSignal.timeout(4000) });
        if (!cancelled) setHealth(res.ok ? "ok" : "down");
      } catch {
        if (!cancelled) setHealth("down");
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [serviceUrl]);

  async function render(): Promise<void> {
    setBusy(true); setError(null); setResult(null); setElapsed(0);
    const startAt = Date.now();
    timerRef.current = window.setInterval(() => setElapsed(Math.round((Date.now() - startAt) / 1000)), 500);
    try {
      const body: Record<string, unknown> = { composition };
      if (renderer === "native" || renderer === "wasm") body.renderer = renderer;
      const res = await fetch(`${serviceUrl.replace(/\/$/, "")}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
      const renderMs = res.headers.get("X-OpenHyper-Render-Ms");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName || "openhyper"}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      setResult(`完成 — ${(blob.size / 1024 / 1024).toFixed(2)} MB${renderMs ? ` · 服务端渲染 ${(Number(renderMs) / 1000).toFixed(1)}s` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal">
        <h2><Icon name="export" size={17} />导出视频<span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose} disabled={busy}><Icon name="close" size={15} /></button>
        </h2>

        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          {composition.width}×{composition.height} · {composition.fps} fps · {(composition.durationMs / 1000).toFixed(1)}s
          · 服务端逐帧渲染，与预览完全一致
        </div>

        <Col label="渲染服务地址（openhyper serve）">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} />
            <span className="status-dot" title={health === "ok" ? "服务在线" : health === "down" ? "无法连接" : "检查中"}
              style={{ background: health === "ok" ? "var(--ok)" : health === "down" ? "var(--danger)" : "var(--gold)", flexShrink: 0 }} />
          </div>
        </Col>
        {health === "down" ? (
          <div style={{ color: "var(--gold)", fontSize: 11.5, lineHeight: 1.5 }}>
            服务未响应 — 在装有 openhypercore 的机器上运行 <code style={{ background: "var(--panel)", padding: "1px 5px", borderRadius: 4 }}>npx openhyper serve</code>
          </div>
        ) : null}

        <Row>
          <Sel label="渲染后端" value={renderer} options={["默认", "native", "wasm"]}
            labels={{ 默认: "默认（服务端自动）", native: "native（Rust + Skia）", wasm: "wasm（CanvasKit）" }} onChange={setRenderer} />
        </Row>

        {blobLayers.length ? (
          <div style={{ display: "flex", gap: 8, color: "var(--gold)", fontSize: 11.5, lineHeight: 1.5 }}>
            <Icon name="warn" size={15} />
            <span>这些图层使用了本地 blob 素材，渲染服务读不到：{blobLayers.join("、")}。请改用 http(s) URL、内嵌小图，或把文件放到服务器可访问的路径。</span>
          </div>
        ) : null}

        {error ? <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div> : null}
        {result ? <div style={{ color: "var(--ok)", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}><Icon name="check" size={14} />{result}</div> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>关闭</button>
          <button className="btn btn-primary" onClick={render} disabled={busy || health !== "ok"}>
            {busy ? <><span className="spinner" />渲染中 {elapsed}s…</> : <> <Icon name="export" size={14} />渲染并下载 MP4</>}
          </button>
        </div>
      </div>
    </div>
  );
}
