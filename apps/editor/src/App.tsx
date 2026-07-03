import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defineComposition } from "openhypercore";
import type { Composition, Layer } from "openhypercore";
import { expandComposition, listPlugins } from "openhypercore/plugins";
import type { PluginDefinition } from "openhypercore/plugins";
import { PreviewRenderer } from "./preview.ts";
import { sampleComposition } from "./sample.ts";
import { useHistory } from "./history.ts";
import {
  BACK, EMPH, KEY_EPS, TRANSFORM_KEYS, clamp, dfltVal, layerAtPath, pluginDefaults,
  resolveLayerAt, updateLayerAtPath
} from "./helpers.ts";
import type { AnyLayer, Bezier, Kf, SelPath, TKey } from "./helpers.ts";
import { TopBar } from "./components/TopBar.tsx";
import { LibraryPanel, importFile } from "./components/LibraryPanel.tsx";
import type { EditorAsset } from "./components/LibraryPanel.tsx";
import { StagePanel } from "./components/StagePanel.tsx";
import { Inspector } from "./components/Inspector.tsx";
import type { KfSel } from "./components/Inspector.tsx";
import { TimelinePanel } from "./components/TimelinePanel.tsx";
import { RenderDialog } from "./components/RenderDialog.tsx";

const PLUGINS = listPlugins();
const AUTOSAVE_KEY = "ohe.project.v1";

function loadAutosaved(): { name: string; composition: Composition } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { name?: string; composition?: unknown };
    return { name: data.name ?? "未命名项目", composition: defineComposition(data.composition as Composition) };
  } catch {
    return null;
  }
}

export function App() {
  const restored = useMemo(loadAutosaved, []);
  const history = useHistory(restored?.composition ?? sampleComposition);
  const composition = history.comp;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [projectName, setProjectName] = useState(restored?.name ?? "未命名项目");
  const [selection, setSelection] = useState<SelPath>([]);
  const [selKf, setSelKf] = useState<KfSel>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [assets, setAssets] = useState<EditorAsset[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("ohe.theme") === "light" ? "light" : "dark"));
  const fileRef = useRef<HTMLInputElement>(null);
  const filePurpose = useRef<{ mode: "layer" | "svg" | "project"; at?: [number, number] }>({ mode: "layer" });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ohe.theme", theme);
  }, [theme]);

  // ---- plugin expansion (preview == server render) -----------------------
  const expansion = useMemo<{ comp: Composition | null; error: string | null }>(() => {
    try { return { comp: expandComposition(composition), error: null }; }
    catch (e) { return { comp: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [composition]);

  // ---- preview rendering --------------------------------------------------
  const renderBusy = useRef(false);
  const renderPending = useRef<{ comp: Composition; t: number } | null>(null);
  const drawFrame = useCallback((comp: Composition, t: number): void => {
    const r = rendererRef.current;
    if (!r) return;
    if (renderBusy.current) { renderPending.current = { comp, t }; return; }
    renderBusy.current = true;
    r.renderFrame(comp, t)
      .catch((e: unknown) => { console.error("preview render failed at t=", t, e); setStatus(`预览错误: ${String(e)}`); })
      .finally(() => {
        renderBusy.current = false;
        const p = renderPending.current;
        renderPending.current = null;
        if (p) drawFrame(p.comp, p.t);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!canvasRef.current) return;
    PreviewRenderer.create(canvasRef.current)
      .then((r) => { if (!cancelled) { rendererRef.current = r; setReady(true); } })
      .catch((e: unknown) => setStatus(`预览初始化失败: ${String(e)}`));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ready && canvasRef.current) rendererRef.current?.resize(canvasRef.current);
  }, [ready, composition.width, composition.height]);

  useEffect(() => {
    if (ready && expansion.comp) drawFrame(expansion.comp, timeMs);
  }, [ready, expansion, timeMs, drawFrame]);

  // ---- playback ------------------------------------------------------------
  const durRef = useRef(composition.durationMs);
  durRef.current = composition.durationMs;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = now - last;
      last = now;
      let stop = false;
      setTimeMs((t) => {
        let nt = t + dt;
        if (nt >= durRef.current) {
          if (loopRef.current) nt %= Math.max(1, durRef.current);
          else { nt = durRef.current; stop = true; }
        }
        return nt;
      });
      if (stop) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ---- autosave -------------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = JSON.stringify({ name: projectName, composition });
        if (raw.length < 4_000_000) localStorage.setItem(AUTOSAVE_KEY, raw);
      } catch { /* quota — skip */ }
    }, 600);
    return () => clearTimeout(t);
  }, [composition, projectName]);

  // ---- mutations -------------------------------------------------------------
  const syncJson = useCallback((c: Composition): void => {
    setJsonText(JSON.stringify(c, null, 2));
    setJsonError(null);
  }, []);

  function apply(next: Composition, tag?: string): void {
    const v = defineComposition(next);
    history.set(v, tag);
    if (showJson) syncJson(v);
  }
  function applyLive(next: Composition): void {
    try {
      const v = defineComposition(next);
      history.live(v);
      if (showJson) syncJson(v);
    } catch { /* mid-gesture invalid state — ignore */ }
  }
  const patchComposition = (patch: Partial<Composition>): void => apply({ ...composition, ...patch }, "comp");
  const patchLayer = (path: SelPath, patch: Record<string, unknown>, tag?: string): void => {
    if (!path.length) return;
    apply(updateLayerAtPath(composition, path, (l) => ({ ...l, ...patch } as Layer)), tag && `${tag}@${path.join(".")}`);
  };
  const patchLayerLive = (path: SelPath, patch: Record<string, unknown>): void => {
    if (!path.length) return;
    applyLive(updateLayerAtPath(composition, path, (l) => ({ ...l, ...patch } as Layer)));
  };
  const transformOf = (path: SelPath): Record<string, unknown> =>
    ((layerAtPath(composition, path)?.transform as Record<string, unknown>) ?? {});
  const patchTransform = (path: SelPath, patch: Record<string, unknown>, tag?: string): void =>
    patchLayer(path, { transform: { ...transformOf(path), ...patch } }, tag);

  const resolvedSel = useMemo(
    () => (expansion.comp && selection.length ? resolveLayerAt(expansion.comp, selection, timeMs) : null),
    [expansion, selection, timeMs]
  );

  function resolvedVal(path: SelPath, key: TKey): number {
    const t = resolvedSel?.transform as Record<string, number> | undefined;
    const v = t?.[key];
    if (typeof v === "number") return v;
    const raw = transformOf(path)[key];
    if (typeof raw === "number") return raw;
    if (Array.isArray(raw) && raw.length) return (raw[0] as Kf).value;
    return dfltVal(key);
  }

  // ---- keyframes -------------------------------------------------------------
  function editTransform(key: TKey, v: number): void {
    if (!selection.length) return;
    if (Array.isArray(transformOf(selection)[key])) upsertKey(selection, key, v);
    else patchTransform(selection, { [key]: v }, `t-${key}`);
  }
  function upsertKey(path: SelPath, key: TKey, value: number): void {
    const cur = transformOf(path)[key];
    const arr: Kf[] = Array.isArray(cur) ? [...(cur as Kf[])] : [];
    const at = Math.round(timeMs);
    const idx = arr.findIndex((k) => Math.abs(k.timeMs - at) <= KEY_EPS);
    if (idx >= 0) arr[idx] = { ...arr[idx]!, value };
    else { arr.push({ timeMs: at, value, easing: EMPH }); arr.sort((a, b) => a.timeMs - b.timeMs); }
    patchTransform(path, { [key]: arr }, `kf-${key}`);
  }
  function toggleKey(key: TKey): void {
    const path = selection;
    if (!path.length) return;
    const cur = transformOf(path)[key];
    const at = Math.round(timeMs);
    if (Array.isArray(cur)) {
      const arr = [...(cur as Kf[])];
      const idx = arr.findIndex((k) => Math.abs(k.timeMs - at) <= KEY_EPS);
      if (idx >= 0) {
        arr.splice(idx, 1);
        if (arr.length === 0) { patchTransform(path, { [key]: (cur as Kf[])[(cur as Kf[]).length - 1]!.value }); return; }
      } else arr.push({ timeMs: at, value: resolvedVal(path, key), easing: EMPH });
      arr.sort((a, b) => a.timeMs - b.timeMs);
      patchTransform(path, { [key]: arr });
    } else {
      patchTransform(path, { [key]: [{ timeMs: at, value: typeof cur === "number" ? cur : resolvedVal(path, key), easing: EMPH }] });
    }
  }
  function kfRetime(path: SelPath, key: TKey, items: Kf[], newSelIdx: number): void {
    if (!path.length) return;
    applyLive(updateLayerAtPath(composition, path, (l) => ({
      ...l,
      transform: { ...(((l as AnyLayer).transform as Record<string, unknown>) ?? {}), [key]: items }
    } as Layer)));
    setSelKf({ path, key, kfIdx: newSelIdx });
  }
  function deleteKey(path: SelPath, key: TKey, kfIdx: number): void {
    const cur = transformOf(path)[key];
    if (!Array.isArray(cur)) return;
    const arr = [...(cur as Kf[])];
    arr.splice(kfIdx, 1);
    patchTransform(path, { [key]: arr.length ? arr : (cur as Kf[])[(cur as Kf[]).length - 1]!.value });
    setSelKf(null);
  }
  function setKfEasing(sel: NonNullable<KfSel>, easing: Bezier): void {
    const cur = transformOf(sel.path)[sel.key];
    if (!Array.isArray(cur) || !cur[sel.kfIdx]) return;
    const arr = [...(cur as Kf[])];
    arr[sel.kfIdx] = { ...arr[sel.kfIdx]!, easing };
    patchTransform(sel.path, { [sel.key]: arr }, "easing");
  }

  // ---- preset animations -------------------------------------------------------
  function applyAnim(name: string): void {
    const path = selection;
    if (!path.length) return;
    const layer = layerAtPath(composition, path);
    const tr = transformOf(path);
    const base = (k: string, d: number): number => {
      const v = tr[k];
      return typeof v === "number" ? v : Array.isArray(v) && v.length ? (v[0] as Kf).value : d;
    };
    // Non-group layers keyframe on the composition clock — anchor the presets
    // at the clip's own start/end instead of 0/duration.
    const local = layer?.type === "group" || layer?.type === "plugin";
    const clipStart = local ? 0 : ((layer?.startMs as number) ?? 0);
    const clipEnd = local
      ? ((layer?.endMs as number) ?? composition.durationMs) - ((layer?.startMs as number) ?? 0)
      : ((layer?.endMs as number) ?? composition.durationMs);
    const span = clipEnd - clipStart;
    const enter = Math.min(700, Math.round(span * 0.4));
    const leaveAt = Math.max(clipStart, clipEnd - Math.min(600, Math.round(span * 0.35)));
    const bx = base("x", 0), by = base("y", 0), bs = base("scale", 1);
    let patch: Record<string, unknown> | undefined;
    switch (name) {
      case "淡入": patch = { opacity: [{ timeMs: clipStart, value: 0 }, { timeMs: clipStart + enter, value: 1, easing: EMPH }] }; break;
      case "淡出": patch = { opacity: [{ timeMs: leaveAt, value: 1 }, { timeMs: clipEnd, value: 0, easing: EMPH }] }; break;
      case "左滑入": patch = { x: [{ timeMs: clipStart, value: bx + 320 }, { timeMs: clipStart + enter, value: bx, easing: EMPH }] }; break;
      case "右滑入": patch = { x: [{ timeMs: clipStart, value: bx - 320 }, { timeMs: clipStart + enter, value: bx, easing: EMPH }] }; break;
      case "上滑入": patch = { y: [{ timeMs: clipStart, value: by + 220 }, { timeMs: clipStart + enter, value: by, easing: EMPH }] }; break;
      case "下滑入": patch = { y: [{ timeMs: clipStart, value: by - 220 }, { timeMs: clipStart + enter, value: by, easing: EMPH }] }; break;
      case "弹出": patch = { scale: [{ timeMs: clipStart, value: 0.3 }, { timeMs: clipStart + enter, value: bs || 1, easing: BACK }] }; break;
      case "缩放入": patch = { scale: [{ timeMs: clipStart, value: 0.7 }, { timeMs: clipStart + enter, value: bs || 1, easing: EMPH }] }; break;
      case "清除": {
        const c: Record<string, unknown> = {};
        for (const k of TRANSFORM_KEYS) { const v = tr[k]; if (Array.isArray(v) && v.length) c[k] = (v[v.length - 1] as Kf).value; }
        patch = c;
        break;
      }
    }
    if (patch) patchTransform(path, patch);
  }

  // ---- layer management ----------------------------------------------------------
  function addLayer(layer: Layer, select = true): void {
    const layers = [...composition.layers, layer];
    apply({ ...composition, layers });
    if (select) { setSelection([layers.length - 1]); setSelKf(null); }
  }
  function addFactory(kind: string, at?: [number, number]): void {
    const W = composition.width, H = composition.height;
    const [cx, cy] = at ?? [W / 2, H / 2];
    switch (kind) {
      case "rect": addLayer({ type: "shape", shape: "rect", width: 320, height: 180, fill: "#4d8dff", transform: { x: cx - 160, y: cy - 90 } }); return;
      case "circle": addLayer({ type: "shape", shape: "circle", radius: 90, fill: "#f2c94c", transform: { x: cx - 90, y: cy - 90 } }); return;
      case "text": addLayer({ type: "text", text: "双击右侧编辑文字", size: 72, color: "#ffffff", align: "center", transform: { x: cx, y: cy } }); return;
      case "caption": addLayer({
        type: "caption", text: "这里是字幕", size: Math.round(H * 0.05), color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.55)", padding: 10, align: "center",
        transform: { x: cx, y: Math.round(H * 0.9) }
      }); return;
      case "group": addLayer({ type: "group", transform: { x: cx - 130, y: cy - 75 }, layers: [{ type: "shape", shape: "rect", width: 260, height: 150, fill: "#9a6ee8" }] }); return;
      case "image": case "video": case "audio": {
        filePurpose.current = { mode: "layer", ...(at ? { at } : {}) };
        if (fileRef.current) {
          fileRef.current.accept = `${kind}/*`;
          fileRef.current.click();
        }
        return;
      }
      case "svg": {
        filePurpose.current = { mode: "svg", ...(at ? { at } : {}) };
        if (fileRef.current) {
          fileRef.current.accept = ".svg,image/svg+xml";
          fileRef.current.click();
        }
        return;
      }
      default: return;
    }
  }
  function addPlugin(def: PluginDefinition): void {
    const endMs = Math.min(def.defaultDurationMs ?? composition.durationMs, composition.durationMs);
    addLayer({ type: "plugin", plugin: def.name, params: pluginDefaults(def), endMs } as Layer);
  }
  function addAssetLayer(asset: EditorAsset, at?: [number, number]): void {
    const W = composition.width, H = composition.height;
    const [cx, cy] = at ?? [W / 2, H / 2];
    if (asset.kind === "audio") {
      addLayer({ type: "audio", src: asset.url } as Layer);
      setStatus(`已添加音频「${asset.name}」（导出时混音）`);
      return;
    }
    const w = Math.round(W * (asset.kind === "video" ? 0.62 : 0.5));
    const h = Math.round((w * 9) / 16);
    addLayer({
      type: asset.kind, src: asset.url, fit: "contain", width: w, height: h,
      transform: { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) }
    } as Layer);
  }

  async function importFiles(files: File[], addAt?: [number, number]): Promise<void> {
    let first = true;
    for (const f of files) {
      if (/\.svg$/i.test(f.name) || f.type === "image/svg+xml") {
        await importSvg(f, addAt);
        continue;
      }
      const asset = await importFile(f);
      if (!asset) { setStatus(`不支持的文件类型: ${f.name}`); continue; }
      setAssets((a) => [asset, ...a]);
      if (addAt && first) { addAssetLayer(asset, addAt); first = false; }
      else if (!addAt) setStatus(`已导入「${asset.name}」— 点击素材添加到画布`);
    }
  }

  async function importSvg(file: File, at?: [number, number]): Promise<void> {
    try {
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      const svg = doc.querySelector("svg");
      const paths = [...doc.querySelectorAll("path")];
      if (!svg || !paths.length) { setStatus(`SVG 中没有 <path>：${file.name}（可先在矢量工具中转换为路径）`); return; }
      const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
      const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite)
        ? (vb as [number, number, number, number])
        : [0, 0, Number(svg.getAttribute("width")) || 100, Number(svg.getAttribute("height")) || 100];
      const norm = (v: string | null): string | undefined =>
        v && v !== "none" && v !== "inherit" && v !== "currentColor" ? v : undefined;
      const children: Layer[] = paths.map((p) => {
        const fill = norm(p.getAttribute("fill"));
        const stroke = norm(p.getAttribute("stroke"));
        const sw = Number(p.getAttribute("stroke-width"));
        return {
          type: "shape", shape: "path", path: p.getAttribute("d") ?? "",
          width: vw, height: vh,
          ...(fill || !stroke ? { fill: fill ?? "#e9ecf5" } : {}),
          ...(stroke ? { stroke, strokeWidth: Number.isFinite(sw) && sw > 0 ? sw : 2 } : {}),
          transform: { x: -vx, y: -vy }
        } as Layer;
      });
      const W = composition.width, H = composition.height;
      const [cx, cy] = at ?? [W / 2, H / 2];
      const scale = Math.min(1, (W * 0.4) / vw, (H * 0.4) / vh);
      addLayer({
        type: "group", id: file.name.replace(/\.svg$/i, ""),
        transform: { x: Math.round(cx - (vw * scale) / 2), y: Math.round(cy - (vh * scale) / 2), scale },
        layers: children
      } as Layer);
      setStatus(`已导入 SVG「${file.name}」（${children.length} 条路径）`);
    } catch (e) {
      setStatus(`SVG 解析失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function removeLayer(path: SelPath): void {
    apply(updateLayerAtPath(composition, path, () => null));
    setSelection([]);
    setSelKf(null);
  }
  function moveLayer(i: number, dir: -1 | 1): void {
    const t = i + dir;
    if (t < 0 || t >= composition.layers.length) return;
    const layers = [...composition.layers];
    [layers[i], layers[t]] = [layers[t]!, layers[i]!];
    apply({ ...composition, layers });
    setSelection([t]);
  }
  function duplicateLayer(i: number): void {
    const src = composition.layers[i];
    if (!src) return;
    const copy = structuredClone(src) as AnyLayer;
    if (typeof copy.id === "string" && copy.id) copy.id = `${copy.id}-副本`;
    const layers = [...composition.layers];
    layers.splice(i + 1, 0, copy as Layer);
    apply({ ...composition, layers });
    setSelection([i + 1]);
  }

  // ---- project files ------------------------------------------------------------
  function saveProject(): void {
    const blob = new Blob([JSON.stringify({ name: projectName, composition }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName || "openhyper"}.ohproj.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("已保存工程文件");
  }
  function openProject(): void {
    filePurpose.current = { mode: "project" };
    if (fileRef.current) {
      fileRef.current.accept = ".json,application/json";
      fileRef.current.click();
    }
  }
  async function onProjectFile(f: File): Promise<void> {
    try {
      const data = JSON.parse(await f.text()) as { name?: string; composition?: unknown; type?: string };
      const comp = defineComposition((data.type === "composition" ? data : data.composition) as Composition);
      history.reset(comp);
      setProjectName(data.name ?? f.name.replace(/\.(ohproj\.)?json$/i, ""));
      setSelection([]); setSelKf(null); setTimeMs(0);
      if (showJson) syncJson(comp);
      setStatus(`已打开「${f.name}」`);
    } catch (e) {
      setStatus(`打开失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  function newProject(): void {
    if (!window.confirm("新建项目？当前项目请先保存。")) return;
    history.reset(sampleComposition);
    setProjectName("未命名项目");
    setSelection([]); setSelKf(null); setTimeMs(0);
  }

  function onJsonEdit(text: string): void {
    setJsonText(text);
    try {
      history.set(defineComposition(JSON.parse(text) as Composition), "json");
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  }

  // ---- keyboard shortcuts ----------------------------------------------------------
  const frameMs = 1000 / (composition.fps || 30);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
      else if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); history.undo(); }
      else if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey) || e.key === "y")) { e.preventDefault(); history.redo(); }
      else if (mod && e.key === "s") { e.preventDefault(); saveProject(); }
      else if (mod && e.key === "d") { e.preventDefault(); if (selection.length === 1) duplicateLayer(selection[0]!); }
      else if (e.key === "Backspace" || e.key === "Delete") { if (selection.length) { e.preventDefault(); removeLayer(selection); } }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setTimeMs((t) => clamp(0, durRef.current, t - frameMs * (e.shiftKey ? 10 : 1))); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setTimeMs((t) => clamp(0, durRef.current, t + frameMs * (e.shiftKey ? 10 : 1))); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selLayer = selection.length ? layerAtPath(composition, selection) : undefined;

  return (
    <div className="app">
      <input ref={fileRef} type="file" multiple style={{ display: "none" }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          const purpose = filePurpose.current;
          filePurpose.current = { mode: "layer" };
          if (!files.length) return;
          if (purpose.mode === "project") void onProjectFile(files[0]!);
          else void importFiles(files, purpose.at ?? [composition.width / 2, composition.height / 2]);
        }} />

      <TopBar
        projectName={projectName} onProjectName={setProjectName}
        canUndo={history.canUndo} canRedo={history.canRedo}
        onUndo={history.undo} onRedo={history.redo}
        onNew={newProject} onOpen={openProject} onSave={saveProject}
        showJson={showJson}
        onToggleJson={() => { if (!showJson) syncJson(composition); setShowJson((s) => !s); }}
        theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onExport={() => setRenderOpen(true)}
        status={status}
      />

      <div className="body">
        <LibraryPanel
          composition={composition} selection={selection} assets={assets} plugins={PLUGINS}
          onImportFiles={(files) => void importFiles(files)}
          onAddAssetLayer={(a) => addAssetLayer(a)}
          onAddFactory={(kind) => addFactory(kind)}
          onAddPlugin={addPlugin}
          onSelect={(p) => { setSelection(p); setSelKf(null); }}
          onMove={moveLayer} onDuplicate={duplicateLayer} onRemove={removeLayer}
        />

        <StagePanel
          canvasRef={canvasRef}
          composition={composition} expanded={expansion.comp} timeMs={timeMs}
          selection={selection} error={expansion.error}
          mediaSize={(src) => rendererRef.current?.mediaSize(src)}
          onSelect={(p) => { setSelection(p); setSelKf(null); }}
          onGestureStart={history.begin}
          onLivePatchTransform={(index, patch) => {
            applyLive(updateLayerAtPath(composition, [index], (l) => ({
              ...l,
              transform: { ...(((l as AnyLayer).transform as Record<string, unknown>) ?? {}), ...patch }
            } as Layer)));
          }}
          onDropAsset={(id, x, y) => { const a = assets.find((x2) => x2.id === id); if (a) addAssetLayer(a, [x, y]); }}
          onDropFiles={(files, x, y) => void importFiles(files, [x, y])}
        />

        <Inspector
          composition={composition}
          layer={selLayer}
          selection={selection}
          onSelect={(p) => { setSelection(p); setSelKf(null); }}
          timeMs={timeMs}
          resolved={resolvedSel}
          plugins={PLUGINS}
          assets={assets}
          selKf={selKf}
          showJson={showJson} jsonText={jsonText} jsonError={jsonError}
          patchLayer={(patch, tag) => patchLayer(selection, patch, tag)}
          editTransform={editTransform}
          toggleKey={toggleKey}
          setKfEasing={setKfEasing}
          applyAnim={applyAnim}
          patchComposition={patchComposition}
          onJsonEdit={onJsonEdit}
        />
      </div>

      <TimelinePanel
        composition={composition} timeMs={timeMs} playing={playing} loop={loop}
        selection={selection} selKf={selKf}
        onSeek={(t) => setTimeMs(clamp(0, composition.durationMs, t))}
        onSelect={(p) => { setSelection(p); setSelKf(null); }}
        onTogglePlay={() => setPlaying((p) => !p)}
        onToggleLoop={() => setLoop((l) => !l)}
        onStepFrame={(dir) => setTimeMs((t) => clamp(0, composition.durationMs, t + dir * frameMs))}
        onGestureStart={history.begin}
        onLiveLayerPatch={(index, patch) => patchLayerLive([index], patch)}
        onSelectKf={setSelKf}
        onKfRetime={kfRetime}
        onKfDelete={deleteKey}
      />

      {renderOpen ? <RenderDialog composition={composition} projectName={projectName} onClose={() => setRenderOpen(false)} /> : null}
    </div>
  );
}
