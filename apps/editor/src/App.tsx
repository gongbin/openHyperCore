import { useEffect, useMemo, useRef, useState } from "react";
import { defineComposition, resolveFrame } from "openhypercore";
import type { Composition, Layer, ResolvedFrame } from "openhypercore";
import { PreviewRenderer } from "./preview.ts";
import { sampleComposition } from "./sample.ts";

const DEFAULT_SERVICE = "http://localhost:8787";
const EMPH: [number, number, number, number] = [0.2, 0, 0, 1];
const BACK: [number, number, number, number] = [0.34, 1.56, 0.64, 1];
const KEY_EPS = 16; // ms tolerance (~1 frame) for "is there a key at the playhead"

const FACTORIES: Record<string, () => Layer> = {
  Rect: () => ({ type: "shape", shape: "rect", width: 320, height: 180, fill: "#3a7bd5", transform: { x: 200, y: 200 } }),
  Circle: () => ({ type: "shape", shape: "circle", radius: 90, fill: "#e7c36a", transform: { x: 320, y: 220 } }),
  Text: () => ({ type: "text", text: "Hello", size: 96, color: "#ffffff", align: "left", transform: { x: 160, y: 380 } }),
  Group: () => ({ type: "group", transform: { x: 220, y: 200 }, layers: [{ type: "shape", shape: "rect", width: 260, height: 150, fill: "#d76d77" }] })
};
const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "color-dodge", "color-burn", "soft-light", "hard-light", "difference", "exclusion"];
const TRANSFORM_KEYS = ["x", "y", "scale", "rotate", "opacity"] as const;
type TKey = (typeof TRANSFORM_KEYS)[number];

type AnyLayer = Layer & Record<string, unknown>;
type Kf = { timeMs: number; value: number; easing?: unknown };

const dfltVal = (k: string): number => (k === "scale" || k === "opacity" ? 1 : 0);
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [ready, setReady] = useState(false);

  const [composition, setComposition] = useState<Composition>(sampleComposition);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(sampleComposition, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [selected, setSelected] = useState(0);

  const [timeMs, setTimeMs] = useState(0);
  const [serviceUrl, setServiceUrl] = useState(DEFAULT_SERVICE);
  const [status, setStatus] = useState("");

  const resolved = useMemo<ResolvedFrame | null>(() => {
    try { return resolveFrame(composition, timeMs); } catch { return null; }
  }, [composition, timeMs]);

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
      rendererRef.current.renderFrame(composition, timeMs).catch((e: unknown) => setStatus(`preview error: ${String(e)}`));
    }
  }, [ready, composition, timeMs]);

  function apply(next: Composition): void {
    const v = defineComposition(next);
    setComposition(v);
    setJsonText(JSON.stringify(v, null, 2));
    setJsonError(null);
  }
  function patchComposition(patch: Partial<Composition>): void { apply({ ...composition, ...patch }); }
  function patchLayer(i: number, patch: Record<string, unknown>): void {
    apply({ ...composition, layers: composition.layers.map((l, idx) => (idx === i ? { ...l, ...patch } as Layer : l)) });
  }
  function transformOf(i: number): Record<string, unknown> {
    return ((composition.layers[i] as AnyLayer | undefined)?.transform as Record<string, unknown>) ?? {};
  }
  function patchTransform(i: number, patch: Record<string, unknown>): void {
    patchLayer(i, { transform: { ...transformOf(i), ...patch } });
  }
  function resolvedVal(i: number, key: string): number {
    const t = resolved?.layers[i]?.transform as Record<string, number> | undefined;
    return t?.[key] ?? dfltVal(key);
  }

  function addLayer(make: () => Layer): void {
    const layers = [...composition.layers, make()];
    apply({ ...composition, layers });
    setSelected(layers.length - 1);
  }
  function removeLayer(i: number): void {
    apply({ ...composition, layers: composition.layers.filter((_, idx) => idx !== i) });
    setSelected((s) => Math.max(0, Math.min(s, composition.layers.length - 2)));
  }
  function moveLayer(i: number, dir: -1 | 1): void {
    const t = i + dir;
    if (t < 0 || t >= composition.layers.length) return;
    const layers = [...composition.layers];
    [layers[i], layers[t]] = [layers[t]!, layers[i]!];
    apply({ ...composition, layers });
    setSelected(t);
  }
  function onJsonEdit(text: string): void {
    setJsonText(text);
    try { setComposition(defineComposition(JSON.parse(text))); setJsonError(null); }
    catch (e) { setJsonError(e instanceof Error ? e.message : String(e)); }
  }

  // --- keyframe editing -----------------------------------------------------
  function editTransform(i: number, key: TKey, v: number): void {
    if (Array.isArray(transformOf(i)[key])) upsertKey(i, key, v);
    else patchTransform(i, { [key]: v });
  }
  function upsertKey(i: number, key: TKey, value: number): void {
    const cur = transformOf(i)[key];
    const arr: Kf[] = Array.isArray(cur) ? [...cur as Kf[]] : [];
    const at = Math.round(timeMs);
    const idx = arr.findIndex((k) => Math.abs(k.timeMs - at) <= KEY_EPS);
    if (idx >= 0) arr[idx] = { ...arr[idx]!, value };
    else { arr.push({ timeMs: at, value, easing: EMPH }); arr.sort((a, b) => a.timeMs - b.timeMs); }
    patchTransform(i, { [key]: arr });
  }
  function toggleKey(i: number, key: TKey): void {
    const cur = transformOf(i)[key];
    const at = Math.round(timeMs);
    if (Array.isArray(cur)) {
      const arr = [...cur as Kf[]];
      const idx = arr.findIndex((k) => Math.abs(k.timeMs - at) <= KEY_EPS);
      if (idx >= 0) {
        arr.splice(idx, 1);
        if (arr.length === 0) { patchTransform(i, { [key]: (cur as Kf[])[(cur as Kf[]).length - 1]!.value }); return; }
      } else arr.push({ timeMs: at, value: resolvedVal(i, key), easing: EMPH });
      arr.sort((a, b) => a.timeMs - b.timeMs);
      patchTransform(i, { [key]: arr });
    } else {
      patchTransform(i, { [key]: [{ timeMs: at, value: typeof cur === "number" ? cur : resolvedVal(i, key), easing: EMPH }] });
    }
  }
  function moveKey(i: number, key: TKey, kfIdx: number, newTime: number): void {
    const cur = transformOf(i)[key];
    if (!Array.isArray(cur)) return;
    const arr = [...cur as Kf[]];
    if (!arr[kfIdx]) return;
    arr[kfIdx] = { ...arr[kfIdx]!, timeMs: Math.round(Math.max(0, Math.min(composition.durationMs, newTime))) };
    arr.sort((a, b) => a.timeMs - b.timeMs);
    patchTransform(i, { [key]: arr });
  }
  function deleteKey(i: number, key: TKey, kfIdx: number): void {
    const cur = transformOf(i)[key];
    if (!Array.isArray(cur)) return;
    const arr = [...cur as Kf[]];
    arr.splice(kfIdx, 1);
    patchTransform(i, { [key]: arr.length ? arr : (cur as Kf[])[(cur as Kf[]).length - 1]!.value });
  }

  // --- preset animations ----------------------------------------------------
  function applyAnim(name: string): void {
    const tr = transformOf(selected);
    const base = (k: string, d: number) => { const v = tr[k]; return typeof v === "number" ? v : Array.isArray(v) && v.length ? (v[0] as Kf).value : d; };
    const dur = composition.durationMs;
    const enter = Math.min(700, Math.round(dur * 0.4));
    const leaveAt = Math.max(0, dur - Math.min(600, Math.round(dur * 0.35)));
    const bx = base("x", 0), by = base("y", 0), bs = base("scale", 1);
    let patch: Record<string, unknown> | undefined;
    switch (name) {
      case "Fade In": patch = { opacity: [{ timeMs: 0, value: 0 }, { timeMs: enter, value: 1, easing: EMPH }] }; break;
      case "Fade Out": patch = { opacity: [{ timeMs: leaveAt, value: 1 }, { timeMs: dur, value: 0, easing: EMPH }] }; break;
      case "Slide ←": patch = { x: [{ timeMs: 0, value: bx + 320 }, { timeMs: enter, value: bx, easing: EMPH }] }; break;
      case "Slide →": patch = { x: [{ timeMs: 0, value: bx - 320 }, { timeMs: enter, value: bx, easing: EMPH }] }; break;
      case "Slide ↑": patch = { y: [{ timeMs: 0, value: by + 220 }, { timeMs: enter, value: by, easing: EMPH }] }; break;
      case "Slide ↓": patch = { y: [{ timeMs: 0, value: by - 220 }, { timeMs: enter, value: by, easing: EMPH }] }; break;
      case "Pop In": patch = { scale: [{ timeMs: 0, value: 0.3 }, { timeMs: enter, value: bs || 1, easing: BACK }] }; break;
      case "Zoom In": patch = { scale: [{ timeMs: 0, value: 0.7 }, { timeMs: enter, value: bs || 1, easing: EMPH }] }; break;
      case "Clear": {
        const c: Record<string, unknown> = {};
        for (const k of TRANSFORM_KEYS) { const v = tr[k]; if (Array.isArray(v) && v.length) c[k] = (v[v.length - 1] as Kf).value; }
        patch = c; break;
      }
    }
    if (patch) patchTransform(selected, patch);
  }

  async function renderMp4(): Promise<void> {
    setStatus("rendering…");
    try {
      const res = await fetch(`${serviceUrl.replace(/\/$/, "")}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(composition) });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "openhyper.mp4"; a.click();
      URL.revokeObjectURL(url);
      setStatus(`done — ${(blob.size / 1024).toFixed(0)} KB`);
    } catch (e) { setStatus(`render failed: ${e instanceof Error ? e.message : String(e)} (run \`openhyper serve\`)`); }
  }

  const layer = composition.layers[selected] as AnyLayer | undefined;
  const trRaw = transformOf(selected);
  const animOf = (k: TKey) => Array.isArray(trRaw[k]);
  const keyOf = (k: TKey) => Array.isArray(trRaw[k]) && (trRaw[k] as Kf[]).some((kf) => Math.abs(kf.timeMs - timeMs) <= KEY_EPS);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", color: "#e6e8ec", background: "#0d1117", fontSize: 13 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid #21262d", background: "#161b22" }}>
        <strong style={{ fontSize: 15 }}>openHyperEditor</strong>
        <span style={{ opacity: 0.4 }}>|</span>
        <span style={{ opacity: 0.6, fontSize: 11 }}>Add</span>
        {Object.keys(FACTORIES).map((n) => <button key={n} onClick={() => addLayer(FACTORIES[n]!)} style={btnSm}>+ {n}</button>)}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowJson((s) => !s)} style={btnSm}>{showJson ? "Hide JSON" : "JSON"}</button>
        <input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} style={{ ...input, width: 190 }} />
        <button onClick={renderMp4} style={btn}>Render MP4</button>
        <span style={{ opacity: 0.7, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <aside style={{ width: 190, borderRight: "1px solid #21262d", display: "flex", flexDirection: "column", padding: 10, gap: 4, overflow: "auto" }}>
          <div style={lbl}>Layers</div>
          {composition.layers.map((l, i) => (
            <div key={i} onClick={() => setSelected(i)} style={{ ...rowItem, background: i === selected ? "#1f6feb33" : "transparent", border: i === selected ? "1px solid #1f6feb" : "1px solid transparent" }}>
              <span style={dot(l as AnyLayer)} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{layerLabel(l as AnyLayer, i)}</span>
              <button onClick={(e) => { e.stopPropagation(); moveLayer(i, -1); }} style={iconBtn}>↑</button>
              <button onClick={(e) => { e.stopPropagation(); moveLayer(i, 1); }} style={iconBtn}>↓</button>
              <button onClick={(e) => { e.stopPropagation(); removeLayer(i); }} style={iconBtn}>✕</button>
            </div>
          ))}
        </aside>

        <div style={{ flex: 1, display: "grid", placeItems: "center", minWidth: 0, padding: 14, background: "#010409" }}>
          <canvas ref={canvasRef} width={composition.width} height={composition.height} style={{ width: "100%", maxHeight: "100%", aspectRatio: `${composition.width} / ${composition.height}`, height: "auto", boxShadow: "0 8px 40px #0008", borderRadius: 4 }} />
        </div>

        <aside style={{ width: 308, borderLeft: "1px solid #21262d", display: "flex", flexDirection: "column", padding: 12, gap: 9, overflow: "auto" }}>
          {layer ? (
            <>
              <div style={lbl}>Animation — {layerLabel(layer, selected)}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {["Fade In", "Fade Out", "Slide ←", "Slide →", "Slide ↑", "Slide ↓", "Pop In", "Zoom In"].map((a) => <button key={a} onClick={() => applyAnim(a)} style={chip}>{a}</button>)}
                <button onClick={() => applyAnim("Clear")} style={{ ...chip, color: "#f0a0a0" }}>Clear</button>
              </div>

              <div style={lbl}>Transform <span style={{ textTransform: "none", opacity: 0.7 }}>· scrub timeline, type a value or ◆ to key</span></div>
              <Row>
                <KfNum label="x" value={resolvedVal(selected, "x")} animated={animOf("x")} hasKey={keyOf("x")} onChange={(v) => editTransform(selected, "x", v)} onToggle={() => toggleKey(selected, "x")} />
                <KfNum label="y" value={resolvedVal(selected, "y")} animated={animOf("y")} hasKey={keyOf("y")} onChange={(v) => editTransform(selected, "y", v)} onToggle={() => toggleKey(selected, "y")} />
              </Row>
              <Row>
                <KfNum label="scale" step={0.05} value={resolvedVal(selected, "scale")} animated={animOf("scale")} hasKey={keyOf("scale")} onChange={(v) => editTransform(selected, "scale", v)} onToggle={() => toggleKey(selected, "scale")} />
                <KfNum label="rotate°" value={resolvedVal(selected, "rotate")} animated={animOf("rotate")} hasKey={keyOf("rotate")} onChange={(v) => editTransform(selected, "rotate", v)} onToggle={() => toggleKey(selected, "rotate")} />
              </Row>
              <KfRange label="opacity" value={resolvedVal(selected, "opacity")} animated={animOf("opacity")} hasKey={keyOf("opacity")} onChange={(v) => editTransform(selected, "opacity", v)} onToggle={() => toggleKey(selected, "opacity")} />

              <div style={lbl}>Layer</div>
              <Col label="id"><input value={(layer.id as string) ?? ""} onChange={(e) => patchLayer(selected, { id: e.target.value || undefined })} style={input} /></Col>
              <Row>
                <Num label="startMs" value={(layer.startMs as number) ?? 0} onChange={(v) => patchLayer(selected, { startMs: v || undefined })} />
                <Num label="endMs" value={(layer.endMs as number) ?? composition.durationMs} onChange={(v) => patchLayer(selected, { endMs: v })} />
              </Row>

              <div style={lbl}>Effects</div>
              <Sel label="blendMode" value={(layer.blendMode as string) ?? "normal"} options={BLEND_MODES} onChange={(v) => patchLayer(selected, { blendMode: v === "normal" ? undefined : v })} />
              <Num label="blur" value={(layer.blur as number) ?? 0} onChange={(v) => patchLayer(selected, { blur: v || undefined })} />

              {layer.type === "shape" ? <ShapeProps layer={layer} set={(p) => patchLayer(selected, p)} /> : null}
              {layer.type === "text" ? <TextProps layer={layer} set={(p) => patchLayer(selected, p)} /> : null}
            </>
          ) : <div style={{ opacity: 0.6 }}>No layer selected.</div>}

          <div style={{ flex: 1 }} />
          <div style={lbl}>Composition</div>
          <Row><Num label="fps" value={composition.fps} onChange={(v) => patchComposition({ fps: v })} /><Num label="durationMs" value={composition.durationMs} onChange={(v) => patchComposition({ durationMs: v })} /></Row>
          <Row><Num label="width" value={composition.width} onChange={(v) => patchComposition({ width: v })} /><Num label="height" value={composition.height} onChange={(v) => patchComposition({ height: v })} /></Row>

          {showJson ? (
            <>
              <div style={lbl}>IR JSON</div>
              <textarea value={jsonText} onChange={(e) => onJsonEdit(e.target.value)} spellCheck={false} style={{ height: 200, resize: "vertical", background: "#010409", color: "#c9d1d9", border: `1px solid ${jsonError ? "#f85149" : "#21262d"}`, borderRadius: 6, padding: 8, fontFamily: "ui-monospace, monospace", fontSize: 11 }} />
              {jsonError ? <div style={{ color: "#f85149", fontSize: 11 }}>{jsonError}</div> : null}
            </>
          ) : null}
        </aside>
      </div>

      <Timeline composition={composition} timeMs={timeMs} selected={selected} onSeek={setTimeMs} onSelect={setSelected} onKfDrag={moveKey} onKfDelete={deleteKey} />
    </div>
  );
}

function Timeline({ composition, timeMs, selected, onSeek, onSelect, onKfDrag, onKfDelete }: {
  composition: Composition; timeMs: number; selected: number; onSeek: (t: number) => void; onSelect: (i: number) => void;
  onKfDrag: (i: number, key: TKey, kfIdx: number, t: number) => void; onKfDelete: (i: number, key: TKey, kfIdx: number) => void;
}) {
  const dur = composition.durationMs || 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const seek = (clientX: number) => {
    const el = trackRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(dur, ((clientX - r.left - 120) / (r.width - 120)) * dur)));
  };
  const pct = (t: number) => `${(t / dur) * 100}%`;
  return (
    <div style={{ height: 180, borderTop: "1px solid #21262d", background: "#161b22", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: "1px solid #21262d" }}>
        <span style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}>Timeline</span>
        <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{(timeMs / 1000).toFixed(2)}s</span>
        <span style={{ opacity: 0.4 }}>/ {(dur / 1000).toFixed(2)}s</span>
        <span style={{ flex: 1 }} />
        <span style={{ opacity: 0.45, fontSize: 11 }}>drag ◆ to retime · double-click ◆ to delete</span>
      </div>
      <div ref={trackRef} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seek(e.clientX); }} onPointerMove={(e) => { if (e.buttons) seek(e.clientX); }}
        style={{ position: "relative", flex: 1, overflow: "auto", cursor: "text", paddingLeft: 120 }}>
        {composition.layers.map((l, i) => {
          const al = l as AnyLayer;
          const start = (al.startMs as number) ?? 0;
          const end = (al.endMs as number) ?? dur;
          const tr = (al.transform as Record<string, unknown>) ?? {};
          return (
            <div key={i} style={{ position: "relative", height: 28, borderBottom: "1px solid #1c2128" }}>
              <div onClick={() => onSelect(i)} style={{ position: "absolute", left: -120, width: 116, height: "100%", display: "flex", alignItems: "center", padding: "0 6px", fontSize: 11, color: i === selected ? "#58a6ff" : "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{layerLabel(al, i)}</div>
              <div style={{ position: "absolute", top: 6, height: 16, left: pct(start), width: pct(end - start), background: i === selected ? "#1f6feb44" : "#30363d", border: `1px solid ${i === selected ? "#1f6feb" : "#3d444d"}`, borderRadius: 4 }} />
              {TRANSFORM_KEYS.flatMap((key) => Array.isArray(tr[key]) ? (tr[key] as Kf[]).map((kf, j) => (
                <div key={`${key}-${j}`} title={`${key} @ ${Math.round(kf.timeMs)}ms`}
                  onPointerDown={(e) => { e.stopPropagation(); onSelect(i); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
                  onPointerMove={(e) => { if (e.buttons) { e.stopPropagation(); const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); onKfDrag(i, key, j, ((e.clientX - r.left) / r.width) * dur); } }}
                  onDoubleClick={(e) => { e.stopPropagation(); onKfDelete(i, key, j); }}
                  style={{ position: "absolute", top: 9, left: pct(kf.timeMs), width: 11, height: 11, marginLeft: -5, transform: "rotate(45deg)", background: i === selected ? "#e7c36a" : "#9c834a", border: "1px solid #b9962f", cursor: "ew-resize" }} />
              )) : [])}
            </div>
          );
        })}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(120px + (100% - 120px) * ${timeMs / dur})`, width: 2, background: "#f85149", pointerEvents: "none" }}>
          <div style={{ position: "absolute", top: -1, left: -4, width: 10, height: 8, background: "#f85149", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      </div>
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
        ? <Col label="fill"><input type="color" value={fill} onChange={(e) => set({ fill: e.target.value })} style={swatch} /></Col>
        : <div style={{ opacity: 0.6, fontSize: 11 }}>fill is a gradient — edit in JSON</div>}
      <Row>
        <Col label="stroke"><input type="color" value={typeof layer.stroke === "string" ? layer.stroke : "#000000"} onChange={(e) => set({ stroke: e.target.value })} style={swatch} /></Col>
        <Num label="strokeWidth" value={(layer.strokeWidth as number) ?? 0} onChange={(v) => set({ strokeWidth: v || undefined, stroke: v ? layer.stroke : undefined })} />
      </Row>
    </>
  );
}

function TextProps({ layer, set }: { layer: AnyLayer; set: (p: Record<string, unknown>) => void }) {
  const color = typeof layer.color === "string" ? layer.color : "#ffffff";
  return (
    <>
      <div style={lbl}>Text</div>
      <Col label="text"><textarea value={(layer.text as string) ?? ""} onChange={(e) => set({ text: e.target.value })} rows={2} style={{ ...input, resize: "vertical" }} /></Col>
      <Row><Num label="size" value={(layer.size as number) ?? 16} onChange={(v) => set({ size: v })} /><Sel label="align" value={(layer.align as string) ?? "left"} options={["left", "center", "right"]} onChange={(v) => set({ align: v })} /></Row>
      <Row><Num label="lineHeight" step={0.1} value={(layer.lineHeight as number) ?? 1.3} onChange={(v) => set({ lineHeight: v })} /><Col label="color"><input type="color" value={color} onChange={(e) => set({ color: e.target.value })} style={swatch} /></Col></Row>
      <Col label="font (URL, optional)"><input value={(layer.font as string) ?? ""} placeholder="https://…/Font.ttf" onChange={(e) => set({ font: e.target.value || undefined })} style={input} /></Col>
    </>
  );
}

// --- field components --------------------------------------------------------
function KfNum({ label, value, step, animated, hasKey, onChange, onToggle }: { label: string; value: number; step?: number; animated: boolean; hasKey: boolean; onChange: (v: number) => void; onToggle: () => void }) {
  return <Col label={label}><div style={{ display: "flex", gap: 4 }}>
    <input type="number" value={r2(value)} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value))} style={input} />
    <button onClick={onToggle} title="keyframe at playhead" style={kfBtn(animated, hasKey)}>◆</button>
  </div></Col>;
}
function KfRange({ label, value, animated, hasKey, onChange, onToggle }: { label: string; value: number; animated: boolean; hasKey: boolean; onChange: (v: number) => void; onToggle: () => void }) {
  return <Col label={`${label} · ${r2(value)}`}><div style={{ display: "flex", gap: 6, alignItems: "center" }}>
    <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} />
    <button onClick={onToggle} title="keyframe at playhead" style={kfBtn(animated, hasKey)}>◆</button>
  </div></Col>;
}
function Num({ label, value, step, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return <Col label={label}><input type="number" value={value} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value))} style={input} /></Col>;
}
function Sel({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return <Col label={label}><select value={value} onChange={(e) => onChange(e.target.value)} style={input}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></Col>;
}
function Col({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}><span style={{ opacity: 0.6, fontSize: 11 }}>{label}</span>{children}</label>;
}
function Row({ children }: { children: React.ReactNode }) { return <div style={{ display: "flex", gap: 8 }}>{children}</div>; }

function layerLabel(l: AnyLayer, i: number): string {
  const id = typeof l.id === "string" ? l.id : "";
  const kind = l.type === "shape" ? (l.shape as string) : l.type;
  return `${i + 1}. ${kind}${id ? ` · ${id}` : l.type === "text" ? ` · ${String(l.text).slice(0, 10)}` : ""}`;
}
function dot(l: AnyLayer): React.CSSProperties {
  const c = l.type === "text" ? "#58a6ff" : l.type === "group" ? "#d2a8ff" : l.type === "video" || l.type === "image" ? "#7ee787" : "#e7c36a";
  return { width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 };
}
function kfBtn(animated: boolean, hasKey: boolean): React.CSSProperties {
  return { width: 28, background: hasKey ? "#3d3416" : "#1c2128", color: animated ? (hasKey ? "#e7c36a" : "#b9962f") : "#484f58", border: `1px solid ${animated ? "#6e5a1f" : "#30363d"}`, borderRadius: 6, cursor: "pointer", fontSize: 11 };
}

const lbl: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.5, marginTop: 4 };
const btn: React.CSSProperties = { background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontWeight: 600 };
const btnSm: React.CSSProperties = { background: "#21262d", color: "#e6e8ec", border: "1px solid #30363d", borderRadius: 6, padding: "5px 9px", cursor: "pointer" };
const chip: React.CSSProperties = { background: "#1c2128", color: "#c9d1d9", border: "1px solid #30363d", borderRadius: 14, padding: "4px 11px", cursor: "pointer", fontSize: 12 };
const iconBtn: React.CSSProperties = { background: "none", color: "#8b949e", border: "none", cursor: "pointer", padding: "0 3px" };
const rowItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", borderRadius: 5, cursor: "pointer" };
const input: React.CSSProperties = { background: "#010409", color: "#c9d1d9", border: "1px solid #21262d", borderRadius: 6, padding: "6px 8px", fontSize: 12, width: "100%", boxSizing: "border-box" };
const swatch: React.CSSProperties = { width: "100%", height: 30, border: "none", background: "none" };
