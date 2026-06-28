import { useEffect, useRef, useState } from "react";
import { defineComposition } from "openhypercore";
import type { Composition, Layer } from "openhypercore";
import { PreviewRenderer } from "./preview.ts";
import { sampleComposition } from "./sample.ts";

const DEFAULT_SERVICE = "http://localhost:8787";

// Sensible default layers for the "add component" toolbar — beginners click to
// drop a component in, then tweak it visually.
const FACTORIES: Record<string, () => Layer> = {
  Rect: () => ({ type: "shape", shape: "rect", width: 320, height: 180, fill: "#3a7bd5", transform: { x: 200, y: 200 } }),
  Circle: () => ({ type: "shape", shape: "circle", radius: 90, fill: "#e7c36a", transform: { x: 320, y: 220 } }),
  Text: () => ({ type: "text", text: "Hello", size: 96, color: "#ffffff", align: "left", transform: { x: 160, y: 380 } }),
  Group: () => ({ type: "group", transform: { x: 220, y: 200 }, layers: [{ type: "shape", shape: "rect", width: 260, height: 150, fill: "#d76d77" }] })
};

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "color-dodge", "color-burn", "soft-light", "hard-light", "difference", "exclusion"];

type AnyLayer = Layer & Record<string, unknown>;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [ready, setReady] = useState(false);

  const [composition, setComposition] = useState<Composition>(sampleComposition);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(sampleComposition, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  const [timeMs, setTimeMs] = useState(0);
  const [serviceUrl, setServiceUrl] = useState(DEFAULT_SERVICE);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!canvasRef.current) return;
    PreviewRenderer.create(canvasRef.current)
      .then((r) => { if (!cancelled) { rendererRef.current = r; setReady(true); } })
      .catch((e: unknown) => setStatus(`preview init failed: ${String(e)}`));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ready && rendererRef.current) {
      try {
        rendererRef.current.renderFrame(composition, timeMs);
      } catch (e) {
        setStatus(`preview error: ${String(e)}`);
      }
    }
  }, [ready, composition, timeMs]);

  // Apply a composition from the UI: update state + mirror into the JSON box.
  function apply(next: Composition): void {
    const validated = defineComposition(next);
    setComposition(validated);
    setJsonText(JSON.stringify(validated, null, 2));
    setJsonError(null);
  }

  function patchComposition(patch: Partial<Composition>): void {
    apply({ ...composition, ...patch });
  }

  function patchLayer(index: number, patch: Record<string, unknown>): void {
    const layers = composition.layers.map((l, i) => (i === index ? { ...l, ...patch } as Layer : l));
    apply({ ...composition, layers });
  }

  function patchTransform(index: number, patch: Record<string, unknown>): void {
    const layer = composition.layers[index] as AnyLayer | undefined;
    if (!layer) return;
    const transform = { ...(layer.transform as Record<string, unknown> ?? {}), ...patch };
    patchLayer(index, { transform });
  }

  function addLayer(make: () => Layer): void {
    const layers = [...composition.layers, make()];
    apply({ ...composition, layers });
    setSelected(layers.length - 1);
  }

  function removeLayer(index: number): void {
    const layers = composition.layers.filter((_, i) => i !== index);
    apply({ ...composition, layers });
    setSelected((s) => Math.max(0, Math.min(s, layers.length - 1)));
  }

  function moveLayer(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= composition.layers.length) return;
    const layers = [...composition.layers];
    [layers[index], layers[target]] = [layers[target]!, layers[index]!];
    apply({ ...composition, layers });
    setSelected(target);
  }

  function onJsonEdit(text: string): void {
    setJsonText(text);
    try {
      setComposition(defineComposition(JSON.parse(text)));
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
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
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "openhyper.mp4";
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`done — ${(blob.size / 1024).toFixed(0)} KB`);
    } catch (e) {
      setStatus(`render failed: ${e instanceof Error ? e.message : String(e)} (is \`openhyper serve\` running?)`);
    }
  }

  const layer = composition.layers[selected] as AnyLayer | undefined;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif", color: "#e6e8ec", background: "#0d1117", fontSize: 13 }}>
      {/* Left: layers + add toolbar */}
      <aside style={{ width: 220, borderRight: "1px solid #21262d", display: "flex", flexDirection: "column", padding: 12, gap: 10 }}>
        <strong style={{ fontSize: 15 }}>openHyperEditor</strong>
        <div>
          <div style={lbl}>Add component</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.keys(FACTORIES).map((name) => (
              <button key={name} onClick={() => addLayer(FACTORIES[name]!)} style={btnSm}>+ {name}</button>
            ))}
          </div>
        </div>
        <div style={lbl}>Layers</div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {composition.layers.map((l, i) => (
            <div key={i} onClick={() => setSelected(i)} style={{ ...row, background: i === selected ? "#1f6feb33" : "transparent", border: i === selected ? "1px solid #1f6feb" : "1px solid transparent" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{layerLabel(l as AnyLayer, i)}</span>
              <button onClick={(e) => { e.stopPropagation(); moveLayer(i, -1); }} style={iconBtn}>↑</button>
              <button onClick={(e) => { e.stopPropagation(); moveLayer(i, 1); }} style={iconBtn}>↓</button>
              <button onClick={(e) => { e.stopPropagation(); removeLayer(i); }} style={iconBtn}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      {/* Center: preview */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, padding: 12, gap: 10 }}>
        <div style={{ flex: 1, display: "grid", placeItems: "center", background: "#000", borderRadius: 8, overflow: "hidden" }}>
          <canvas ref={canvasRef} width={composition.width} height={composition.height} style={{ width: "100%", aspectRatio: `${composition.width} / ${composition.height}`, height: "auto" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input type="range" min={0} max={composition.durationMs} value={timeMs} onChange={(e) => setTimeMs(Number(e.target.value))} style={{ flex: 1 }} />
          <span style={{ minWidth: 96, textAlign: "right", fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{(timeMs / 1000).toFixed(2)}s / {(composition.durationMs / 1000).toFixed(2)}s</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={renderMp4} style={btn}>Render MP4</button>
          <input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} style={{ ...input, width: 220 }} />
          <span style={{ opacity: 0.7 }}>{status}</span>
        </div>
      </div>

      {/* Right: properties + JSON */}
      <aside style={{ width: 320, borderLeft: "1px solid #21262d", display: "flex", flexDirection: "column", padding: 12, gap: 10, overflow: "auto" }}>
        <div style={lbl}>Composition</div>
        <Row><Num label="fps" value={composition.fps} onChange={(v) => patchComposition({ fps: v })} /><Num label="durationMs" value={composition.durationMs} onChange={(v) => patchComposition({ durationMs: v })} /></Row>
        <Row><Num label="width" value={composition.width} onChange={(v) => patchComposition({ width: v })} /><Num label="height" value={composition.height} onChange={(v) => patchComposition({ height: v })} /></Row>

        {layer ? (
          <>
            <div style={lbl}>Transform — {layerLabel(layer, selected)}</div>
            <Row><TNum l={layer} k="x" label="x" set={(p) => patchTransform(selected, p)} /><TNum l={layer} k="y" label="y" set={(p) => patchTransform(selected, p)} /></Row>
            <Row><TNum l={layer} k="scale" label="scale" step={0.05} dflt={1} set={(p) => patchTransform(selected, p)} /><TNum l={layer} k="rotate" label="rotate°" set={(p) => patchTransform(selected, p)} /></Row>
            <TRange l={layer} k="opacity" label="opacity" set={(p) => patchTransform(selected, p)} />

            <div style={lbl}>Effects</div>
            <Sel label="blendMode" value={(layer.blendMode as string) ?? "normal"} options={BLEND_MODES} onChange={(v) => patchLayer(selected, { blendMode: v === "normal" ? undefined : v })} />
            <Num label="blur" value={(layer.blur as number) ?? 0} step={1} onChange={(v) => patchLayer(selected, { blur: v || undefined })} />

            {layer.type === "shape" ? <ShapeProps layer={layer} set={(p) => patchLayer(selected, p)} /> : null}
            {layer.type === "text" ? <TextProps layer={layer} set={(p) => patchLayer(selected, p)} /> : null}
          </>
        ) : <div style={{ opacity: 0.6 }}>No layer selected.</div>}

        <div style={lbl}>Composition IR (JSON)</div>
        <textarea value={jsonText} onChange={(e) => onJsonEdit(e.target.value)} spellCheck={false} style={{ height: 220, resize: "vertical", background: "#010409", color: "#c9d1d9", border: `1px solid ${jsonError ? "#f85149" : "#21262d"}`, borderRadius: 6, padding: 8, fontFamily: "ui-monospace, monospace", fontSize: 11, lineHeight: 1.5 }} />
        {jsonError ? <div style={{ color: "#f85149", fontSize: 11 }}>{jsonError}</div> : null}
      </aside>
    </div>
  );
}

function ShapeProps({ layer, set }: { layer: AnyLayer; set: (p: Record<string, unknown>) => void }) {
  const fill = typeof layer.fill === "string" ? layer.fill : undefined;
  return (
    <>
      <div style={lbl}>Shape</div>
      <Sel label="shape" value={(layer.shape as string) ?? "rect"} options={["rect", "circle", "path"]} onChange={(v) => set({ shape: v })} />
      {layer.shape === "circle"
        ? <Num label="radius" value={(layer.radius as number) ?? 0} onChange={(v) => set({ radius: v })} />
        : <Row><Num label="width" value={(layer.width as number) ?? 0} onChange={(v) => set({ width: v })} /><Num label="height" value={(layer.height as number) ?? 0} onChange={(v) => set({ height: v })} /></Row>}
      {fill !== undefined
        ? <Col label="fill"><input type="color" value={fill} onChange={(e) => set({ fill: e.target.value })} style={{ width: "100%", height: 30, background: "none", border: "none" }} /></Col>
        : <div style={{ opacity: 0.6, fontSize: 11 }}>fill is a gradient — edit in JSON</div>}
    </>
  );
}

function TextProps({ layer, set }: { layer: AnyLayer; set: (p: Record<string, unknown>) => void }) {
  const color = typeof layer.color === "string" ? layer.color : "#ffffff";
  return (
    <>
      <div style={lbl}>Text</div>
      <Col label="text"><input value={(layer.text as string) ?? ""} onChange={(e) => set({ text: e.target.value })} style={input} /></Col>
      <Row><Num label="size" value={(layer.size as number) ?? 16} onChange={(v) => set({ size: v })} /><Sel label="align" value={(layer.align as string) ?? "left"} options={["left", "center", "right"]} onChange={(v) => set({ align: v })} /></Row>
      <Col label="color"><input type="color" value={color} onChange={(e) => set({ color: e.target.value })} style={{ width: "100%", height: 30, background: "none", border: "none" }} /></Col>
    </>
  );
}

// --- small field components ---
function num(v: unknown, dflt = 0): number { return typeof v === "number" ? v : dflt; }

function TNum({ l, k, label, step, dflt = 0, set }: { l: AnyLayer; k: string; label: string; step?: number; dflt?: number; set: (p: Record<string, unknown>) => void }) {
  const t = (l.transform as Record<string, unknown>) ?? {};
  const v = t[k];
  if (Array.isArray(v)) return <Col label={label}><span style={{ opacity: 0.5, fontSize: 11 }}>animated</span></Col>;
  return <Num label={label} value={num(v, dflt)} step={step} onChange={(nv) => set({ [k]: nv })} />;
}
function TRange({ l, k, label, set }: { l: AnyLayer; k: string; label: string; set: (p: Record<string, unknown>) => void }) {
  const t = (l.transform as Record<string, unknown>) ?? {};
  const v = t[k];
  if (Array.isArray(v)) return <Col label={label}><span style={{ opacity: 0.5, fontSize: 11 }}>animated</span></Col>;
  return <Col label={label}><input type="range" min={0} max={1} step={0.01} value={num(v, 1)} onChange={(e) => set({ [k]: Number(e.target.value) })} style={{ width: "100%" }} /></Col>;
}
function Num({ label, value, step, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return <Col label={label}><input type="number" value={value} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value))} style={input} /></Col>;
}
function Sel({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return <Col label={label}><select value={value} onChange={(e) => onChange(e.target.value)} style={input}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></Col>;
}
function Col({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}><span style={{ opacity: 0.6, fontSize: 11 }}>{label}</span>{children}</label>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 8 }}>{children}</div>;
}

function layerLabel(l: AnyLayer, i: number): string {
  const id = typeof l.id === "string" ? l.id : "";
  const kind = l.type === "shape" ? (l.shape as string) : l.type;
  return `${i + 1}. ${kind}${id ? ` · ${id}` : l.type === "text" ? ` · ${String(l.text).slice(0, 10)}` : ""}`;
}

const lbl: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.5, marginTop: 4 };
const btn: React.CSSProperties = { background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontWeight: 600 };
const btnSm: React.CSSProperties = { background: "#21262d", color: "#e6e8ec", border: "1px solid #30363d", borderRadius: 6, padding: "5px 9px", cursor: "pointer" };
const iconBtn: React.CSSProperties = { background: "none", color: "#8b949e", border: "none", cursor: "pointer", padding: "0 3px" };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 2, padding: "5px 7px", borderRadius: 5, cursor: "pointer" };
const input: React.CSSProperties = { background: "#010409", color: "#c9d1d9", border: "1px solid #21262d", borderRadius: 6, padding: "6px 8px", fontSize: 12, width: "100%", boxSizing: "border-box" };
