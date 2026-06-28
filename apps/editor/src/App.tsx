import { useEffect, useMemo, useRef, useState } from "react";
import { defineComposition } from "openhypercore";
import type { Composition } from "openhypercore";
import { PreviewRenderer } from "./preview.ts";
import { sampleComposition } from "./sample.ts";

const DEFAULT_SERVICE = "http://localhost:8787";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [ready, setReady] = useState(false);

  const [jsonText, setJsonText] = useState(() => JSON.stringify(sampleComposition, null, 2));
  const [composition, setComposition] = useState<Composition>(sampleComposition);
  const [parseError, setParseError] = useState<string | null>(null);

  const [timeMs, setTimeMs] = useState(0);
  const [serviceUrl, setServiceUrl] = useState(DEFAULT_SERVICE);
  const [status, setStatus] = useState<string>("");

  // Initialise the canvaskit preview surface once.
  useEffect(() => {
    let cancelled = false;
    if (!canvasRef.current) {
      return;
    }
    PreviewRenderer.create(canvasRef.current)
      .then((renderer) => {
        if (cancelled) {
          return;
        }
        rendererRef.current = renderer;
        setReady(true);
      })
      .catch((error: unknown) => setStatus(`preview init failed: ${String(error)}`));
    return () => {
      cancelled = true;
    };
  }, []);

  // Redraw whenever the composition or playhead changes.
  useEffect(() => {
    if (ready && rendererRef.current) {
      try {
        rendererRef.current.renderFrame(composition, timeMs);
      } catch (error) {
        setStatus(`preview error: ${String(error)}`);
      }
    }
  }, [ready, composition, timeMs]);

  function applyJson(next: string): void {
    setJsonText(next);
    try {
      const parsed = JSON.parse(next) as Omit<Composition, "type">;
      const validated = defineComposition(parsed);
      setComposition(validated);
      setParseError(null);
      setTimeMs((t) => Math.min(t, validated.durationMs));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
    }
  }

  async function renderMp4(): Promise<void> {
    setStatus("rendering on the service…");
    try {
      const res = await fetch(`${serviceUrl.replace(/\/$/, "")}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(composition)
      });
      if (!res.ok) {
        throw new Error(`${res.status}: ${await res.text()}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "openhyper.mp4";
      a.click();
      URL.revokeObjectURL(url);
      const ms = res.headers.get("x-openhyper-render-ms");
      setStatus(`done — ${(blob.size / 1024).toFixed(0)} KB${ms ? `, render ${ms}ms` : ""}`);
    } catch (error) {
      setStatus(`render failed: ${error instanceof Error ? error.message : String(error)} (is \`openhyper serve\` running?)`);
    }
  }

  const aspect = useMemo(() => composition.height / composition.width, [composition]);

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif", color: "#e6e8ec", background: "#0d1117" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, padding: 16, gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>openHyperEditor <span style={{ opacity: 0.5, fontWeight: 400 }}>· canvaskit preview (vector)</span></h1>
        <div style={{ flex: 1, display: "grid", placeItems: "center", background: "#000", borderRadius: 8, overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            width={composition.width}
            height={composition.height}
            style={{ width: "100%", maxWidth: "100%", aspectRatio: `${composition.width} / ${composition.height}`, height: "auto" }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="range"
            min={0}
            max={composition.durationMs}
            value={timeMs}
            onChange={(e) => setTimeMs(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ minWidth: 92, textAlign: "right", fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>
            {(timeMs / 1000).toFixed(2)}s / {(composition.durationMs / 1000).toFixed(2)}s
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={renderMp4} style={btn}>Render MP4</button>
          <input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} style={{ ...input, width: 240 }} />
          <span style={{ opacity: 0.7, fontSize: 13 }}>{status}</span>
        </div>
      </div>
      <aside style={{ width: 420, borderLeft: "1px solid #21262d", display: "flex", flexDirection: "column", padding: 16, gap: 8 }}>
        <div style={{ fontSize: 13, opacity: 0.7 }}>Composition IR (edit → live preview)</div>
        <textarea
          value={jsonText}
          onChange={(e) => applyJson(e.target.value)}
          spellCheck={false}
          style={{ flex: 1, resize: "none", background: "#010409", color: "#c9d1d9", border: `1px solid ${parseError ? "#f85149" : "#21262d"}`, borderRadius: 6, padding: 10, fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.5 }}
        />
        {parseError ? <div style={{ color: "#f85149", fontSize: 12 }}>{parseError}</div> : null}
        <div style={{ fontSize: 11, opacity: 0.5 }}>Preview covers the vector subset (shapes/gradients/groups/clip/blend/motion). Text/image/video render in the final MP4 via the service.</div>
      </aside>
    </div>
  );
}

const btn: React.CSSProperties = { background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontWeight: 600 };
const input: React.CSSProperties = { background: "#010409", color: "#c9d1d9", border: "1px solid #21262d", borderRadius: 6, padding: "7px 9px", fontSize: 13 };
