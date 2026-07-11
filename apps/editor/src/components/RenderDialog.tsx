import { useEffect, useRef, useState } from "react";
import type { Composition, Layer } from "openhypercore";
import { Icon } from "../icons.tsx";
import { Col, Row, Sel } from "../fields.tsx";
import type { AnyLayer } from "../helpers.ts";
import { t } from "../i18n.ts";

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

// Every distinct blob: URL anywhere in the IR (layer srcs, plugin params).
function collectBlobUrls(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) { for (const item of node) collectBlobUrls(item, found); return; }
  if (!node || typeof node !== "object") return;
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (typeof v === "string" && v.startsWith("blob:")) found.add(v);
    else collectBlobUrls(v, found);
  }
}

function replaceStrings(node: unknown, map: Map<string, string>): void {
  if (Array.isArray(node)) { for (const item of node) replaceStrings(item, map); return; }
  if (!node || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === "string" && map.has(v)) rec[k] = map.get(v)!;
    else replaceStrings(v, map);
  }
}

// blob URL → uploaded service URL, remembered per (service, blob) for the
// session so re-exports skip the upload; entries are re-validated with a HEAD
// (the service may have restarted and lost its temp assets).
const uploadedAssets = new Map<string, string>();

async function uploadBlobAsset(base: string, blobUrl: string): Promise<string> {
  const cacheKey = `${base}|${blobUrl}`;
  const cached = uploadedAssets.get(cacheKey);
  if (cached) {
    try {
      const head = await fetch(cached, { method: "HEAD", signal: AbortSignal.timeout(4000) });
      if (head.ok) return cached;
    } catch { /* fall through to re-upload */ }
    uploadedAssets.delete(cacheKey);
  }
  const blob = await fetch(blobUrl).then((r) => r.blob());
  const res = await fetch(`${base}/assets`, {
    method: "POST",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob
  });
  if (res.status === 404) throw new Error(t("渲染服务版本过旧，不支持素材上传 — 请重启 npx openhyper serve（0.6.1+）"));
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { url } = (await res.json()) as { url: string };
  const absolute = `${base}${url}`;
  uploadedAssets.set(cacheKey, absolute);
  return absolute;
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
  const [uploadNote, setUploadNote] = useState<string | null>(null);
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
      const base = serviceUrl.replace(/\/$/, "");
      // Browser-local blob assets can't be read by the service — upload them
      // first and point the IR at the uploaded copies.
      const comp = JSON.parse(JSON.stringify(composition)) as Composition;
      const blobUrls = new Set<string>();
      collectBlobUrls(comp, blobUrls);
      if (blobUrls.size) {
        const list = [...blobUrls];
        const swaps = new Map<string, string>();
        for (let i = 0; i < list.length; i += 1) {
          setUploadNote(t("上传素材 {i}/{n}…", { i: i + 1, n: list.length }));
          swaps.set(list[i]!, await uploadBlobAsset(base, list[i]!));
        }
        replaceStrings(comp, swaps);
        setUploadNote(null);
      }
      const body: Record<string, unknown> = { composition: comp };
      if (renderer === "native" || renderer === "wasm") body.renderer = renderer;
      const res = await fetch(`${base}/render`, {
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
      setResult(t("完成 — {mb} MB", { mb: (blob.size / 1024 / 1024).toFixed(2) }) + (renderMs ? t(" · 服务端渲染 {s}s", { s: (Number(renderMs) / 1000).toFixed(1) }) : ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setUploadNote(null);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal">
        <h2><Icon name="export" size={17} />{t("导出视频")}<span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose} disabled={busy}><Icon name="close" size={15} /></button>
        </h2>

        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          {composition.width}×{composition.height} · {composition.fps} fps · {(composition.durationMs / 1000).toFixed(1)}s
          · {t("服务端逐帧渲染，与预览完全一致")}
        </div>

        <Col label={t("渲染服务地址（openhyper serve）")}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} />
            <span className="status-dot" title={health === "ok" ? t("服务在线") : health === "down" ? t("无法连接") : t("检查中")}
              style={{ background: health === "ok" ? "var(--ok)" : health === "down" ? "var(--danger)" : "var(--gold)", flexShrink: 0 }} />
          </div>
        </Col>
        {health === "down" ? (
          <div style={{ color: "var(--gold)", fontSize: 11.5, lineHeight: 1.5 }}>
            {t("服务未响应 — 在装有 openhypercore 的机器上运行")} <code style={{ background: "var(--panel)", padding: "1px 5px", borderRadius: 4 }}>npx openhyper serve</code>
          </div>
        ) : null}

        <Row>
          <Sel label={t("渲染后端")} value={renderer} options={["默认", "native", "wasm"]}
            labels={{ 默认: t("默认（服务端自动）"), native: t("native（Rust + Skia）"), wasm: t("wasm（CanvasKit）") }} onChange={setRenderer} />
        </Row>

        {blobLayers.length ? (
          <div style={{ display: "flex", gap: 8, color: "var(--muted)", fontSize: 11.5, lineHeight: 1.5 }}>
            <Icon name="check" size={14} />
            <span>{t("本地素材（{list}）会在导出时自动上传给渲染服务。", { list: blobLayers.join(t("、")) })}</span>
          </div>
        ) : null}

        {error ? <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div> : null}
        {result ? <div style={{ color: "var(--ok)", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}><Icon name="check" size={14} />{result}</div> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>{t("关闭")}</button>
          <button className="btn btn-primary" onClick={render} disabled={busy || health !== "ok"}>
            {busy ? <><span className="spinner" />{uploadNote ?? t("渲染中 {s}s…", { s: elapsed })}</> : <> <Icon name="export" size={14} />{t("渲染并下载 MP4")}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
