import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defineComposition } from "openhypercore";
import type { Composition, Layer } from "openhypercore";
import { expandComposition, listPlugins } from "openhypercore/plugins";
import type { PluginDefinition } from "openhypercore/plugins";
import { PreviewRenderer } from "./preview.ts";
import { getLang, setLang, t as tr } from "./i18n.ts";
import { sampleComposition } from "./sample.ts";
import { useHistory } from "./history.ts";
import {
  AB_EASE_TUPLE, BLOB_PATH, EMPH, KEY_EPS, TRANSFORM_KEYS, clamp, dfltVal, easeKfArrAt, layerAtPath,
  pluginDefaults, polygonPath, presetPatch, removeKfTimes, resolveLayerAt, retimeKfArr, simplifyPath,
  starPath, updateLayerAtPath, upsertKfArr
} from "./helpers.ts";
import type { AbBubble, AbEase, AnyLayer, Bezier, Kf, PathSample, SelPath, TKey } from "./helpers.ts";
import { TopBar } from "./components/TopBar.tsx";
import type { EditorView } from "./components/TopBar.tsx";
import { PluginGallery } from "./components/PluginGallery.tsx";
import { LibraryPanel, importFile } from "./components/LibraryPanel.tsx";
import type { EditorAsset } from "./components/LibraryPanel.tsx";
import { StagePanel } from "./components/StagePanel.tsx";
import { Inspector } from "./components/Inspector.tsx";
import type { KfSel } from "./components/Inspector.tsx";
import { TimelinePanel } from "./components/TimelinePanel.tsx";
import { RenderDialog } from "./components/RenderDialog.tsx";
import { AssistantPanel } from "./components/AssistantPanel.tsx";
import { QuickStart } from "./components/QuickStart.tsx";

const PLUGINS = listPlugins();
const AUTOSAVE_KEY = "ohe.project.v1";

function loadAutosaved(): { name: string; composition: Composition } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { name?: string; composition?: unknown };
    return { name: data.name ?? tr("未命名项目"), composition: defineComposition(data.composition as Composition) };
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
  const [projectName, setProjectName] = useState(restored?.name ?? tr("未命名项目"));
  const [selection, setSelection] = useState<SelPath>([]);
  const [multiSel, setMultiSel] = useState<number[]>([]);
  const [selKf, setSelKf] = useState<KfSel>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [assets, setAssets] = useState<EditorAsset[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("ohe.theme") === "light" ? "light" : "dark"));
  // Language lives in the i18n module; this state only exists to re-render the tree.
  const [, setLangTick] = useState(0);
  const toggleLang = useCallback(() => {
    setLang(getLang() === "zh" ? "en" : "zh");
    setLangTick((n) => n + 1);
  }, []);
  const [view, setView] = useState<EditorView>("editor");
  const [animMode, setAnimMode] = useState(false);
  const [abBubble, setAbBubble] = useState<AbBubble | null>(null);
  // Temporary composition shown instead of the real one while hover-previewing
  // a preset animation ("try before you buy"); never persisted.
  const [ghost, setGhost] = useState<Composition | null>(null);
  const [quickOpen, setQuickOpen] = useState(() => !restored);
  const fileRef = useRef<HTMLInputElement>(null);
  const filePurpose = useRef<{ mode: "layer" | "svg" | "project"; at?: [number, number] }>({ mode: "layer" });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ohe.theme", theme);
  }, [theme]);

  // ---- plugin expansion (preview == server render) -----------------------
  // The ghost comp (hover preset preview) takes over the display when set.
  const expansion = useMemo<{ comp: Composition | null; error: string | null }>(() => {
    try { return { comp: expandComposition(ghost ?? composition), error: null }; }
    catch (e) { return { comp: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [composition, ghost]);

  // ---- preview rendering --------------------------------------------------
  const renderBusy = useRef(false);
  const renderPending = useRef<{ comp: Composition; t: number } | null>(null);
  const drawFrame = useCallback((comp: Composition, t: number): void => {
    const r = rendererRef.current;
    if (!r) return;
    if (renderBusy.current) { renderPending.current = { comp, t }; return; }
    renderBusy.current = true;
    r.renderFrame(comp, t)
      .catch((e: unknown) => { console.error("preview render failed at t=", t, e); setStatus(tr("预览错误: {e}", { e: String(e) })); })
      .finally(() => {
        renderBusy.current = false;
        const p = renderPending.current;
        renderPending.current = null;
        if (p) drawFrame(p.comp, p.t);
      });
  }, []);

  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!canvasRef.current) return;
    PreviewRenderer.create(canvasRef.current)
      .then((r) => {
        if (cancelled) return;
        // Redraw the current frame once the full CJK font finishes loading.
        r.onFontUpgrade = () => setFontTick((t) => t + 1);
        rendererRef.current = r;
        setReady(true);
      })
      .catch((e: unknown) => setStatus(tr("预览初始化失败: {e}", { e: String(e) })));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ready && canvasRef.current) rendererRef.current?.resize(canvasRef.current);
  }, [ready, composition.width, composition.height]);

  useEffect(() => {
    if (ready && expansion.comp) drawFrame(expansion.comp, timeMs);
  }, [ready, expansion, timeMs, drawFrame, fontTick]);

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

  // ---- segment preview -------------------------------------------------------
  // Plays a short time range once (or looped) so every animation edit answers
  // itself immediately on the canvas — the core of the "所见即所得" feedback loop.
  const segRaf = useRef(0);
  const stopSegment = useCallback(() => cancelAnimationFrame(segRaf.current), []);
  const playSegment = useCallback((from: number, to: number, opts?: { restoreTo?: number; loop?: boolean }) => {
    cancelAnimationFrame(segRaf.current);
    setPlaying(false);
    if (to <= from) { setTimeMs(from); return; }
    const dur = to - from;
    const hold = 280; // linger on the end state so the result registers
    let start = performance.now();
    const step = (now: number): void => {
      let el = now - start;
      if (el >= dur + hold) {
        if (!opts?.loop) { setTimeMs(opts?.restoreTo ?? to); return; }
        start = now;
        el = 0;
      }
      setTimeMs(from + Math.min(dur, el));
      segRaf.current = requestAnimationFrame(step);
    };
    segRaf.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => { if (playing) cancelAnimationFrame(segRaf.current); }, [playing]);

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

  // ---- preset animations: hover = live try-on, click = apply --------------------
  // Hovering a preset chip swaps in a ghost composition and loops the affected
  // time range on the canvas; clicking commits and replays it once.
  const previewRestore = useRef<number | null>(null);
  function previewAnim(name: string): void {
    if (!selection.length) return;
    const r = presetPatch(name, layerAtPath(composition, selection), composition);
    if (!r || r.to <= r.from) return;
    if (previewRestore.current === null) previewRestore.current = timeMs;
    const tr = transformOf(selection);
    setGhost(updateLayerAtPath(composition, selection, (l) => ({ ...l, transform: { ...tr, ...r.patch } } as Layer)));
    playSegment(r.from, r.to, { loop: true });
  }
  function endPreviewAnim(): void {
    if (previewRestore.current === null && !ghost) return;
    setGhost(null);
    stopSegment();
    if (previewRestore.current !== null) {
      setTimeMs(previewRestore.current);
      previewRestore.current = null;
    }
  }
  function applyAnim(name: string): void {
    const path = selection;
    if (!path.length) return;
    const r = presetPatch(name, layerAtPath(composition, path), composition);
    if (!r) return;
    setGhost(null);
    const restore = previewRestore.current ?? timeMs;
    previewRestore.current = null;
    patchTransform(path, r.patch);
    if (r.to > r.from) playSegment(r.from, r.to, { restoreTo: restore });
    else stopSegment();
  }

  // ---- 动一动: drag A→B on canvas → two-keyframe move + quick-config bubble -----
  const trackToGlobal = (index: number, t: number): number => {
    const l = layerAtPath(composition, [index]);
    return l?.type === "group" || l?.type === "plugin" ? t + ((l.startMs as number) ?? 0) : t;
  };
  function abPlay(b: AbBubble): void {
    playSegment(trackToGlobal(b.index, b.t0), trackToGlobal(b.index, b.t1), { restoreTo: trackToGlobal(b.index, b.t0) });
  }
  function animateMove(index: number, dx: number, dy: number): void {
    const layer = layerAtPath(composition, [index]);
    if (!layer || (!dx && !dy)) return;
    const rl = expansion.comp ? resolveLayerAt(expansion.comp, [index], timeMs) : null;
    const rt = rl?.transform as unknown as Record<string, number> | undefined;
    const tr = transformOf([index]);
    const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
    const fromX = rt?.x ?? num(tr.x, 0);
    const fromY = rt?.y ?? num(tr.y, 0);
    const local = layer.type === "group" || layer.type === "plugin";
    const startMs = (layer.startMs as number) ?? 0;
    const clipStart = local ? 0 : startMs;
    const clipEnd = local
      ? ((layer.endMs as number) ?? composition.durationMs) - startMs
      : ((layer.endMs as number) ?? composition.durationMs);
    let t0 = Math.round(local ? timeMs - startMs : timeMs);
    t0 = clamp(clipStart, Math.max(clipStart, clipEnd - 300), t0);
    const t1 = t0 + Math.min(800, Math.max(240, clipEnd - t0));
    patchTransform([index], {
      x: upsertKfArr(upsertKfArr(tr.x, t0, fromX), t1, fromX + dx, AB_EASE_TUPLE.emph),
      y: upsertKfArr(upsertKfArr(tr.y, t0, fromY), t1, fromY + dy, AB_EASE_TUPLE.emph)
    });
    const b: AbBubble = { index, t0, t1, ease: "emph" };
    setAbBubble(b);
    abPlay(b);
  }
  function abRetime(durMs: number): void {
    if (!abBubble) return;
    const tr = transformOf([abBubble.index]);
    const t1 = abBubble.t0 + Math.round(durMs);
    patchTransform([abBubble.index], { x: retimeKfArr(tr.x, abBubble.t1, t1), y: retimeKfArr(tr.y, abBubble.t1, t1) }, "ab-dur");
    const b = { ...abBubble, t1 };
    setAbBubble(b);
    abPlay(b);
  }
  function abSetEase(e: AbEase): void {
    if (!abBubble) return;
    const tr = transformOf([abBubble.index]);
    patchTransform([abBubble.index], {
      x: easeKfArrAt(tr.x, abBubble.t1, AB_EASE_TUPLE[e]),
      y: easeKfArrAt(tr.y, abBubble.t1, AB_EASE_TUPLE[e])
    }, "ab-ease");
    const b = { ...abBubble, ease: e };
    setAbBubble(b);
    abPlay(b);
  }
  function abRemove(): void {
    if (!abBubble) return;
    const tr = transformOf([abBubble.index]);
    patchTransform([abBubble.index], {
      x: removeKfTimes(tr.x, [abBubble.t0, abBubble.t1]),
      y: removeKfTimes(tr.y, [abBubble.t0, abBubble.t1])
    });
    setAbBubble(null);
    stopSegment();
  }
  useEffect(() => {
    if (abBubble && selection[0] !== abBubble.index) setAbBubble(null);
  }, [selection, abBubble]);

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
      case "line": addLayer({ type: "shape", shape: "path", path: "M 0 4 L 320 4", width: 320, height: 8, stroke: "#e9ecf5", strokeWidth: 6, transform: { x: cx - 160, y: cy - 4 } } as Layer); return;
      case "star": addLayer({ type: "shape", shape: "path", path: starPath(5, 110, 44), width: 220, height: 220, fill: "#f2c94c", transform: { x: cx - 110, y: cy - 110 } } as Layer); return;
      case "polygon": addLayer({ type: "shape", shape: "path", path: polygonPath(6, 100), width: 200, height: 200, fill: "#4d8dff", transform: { x: cx - 100, y: cy - 100 } } as Layer); return;
      case "blob": addLayer({ type: "shape", shape: "path", path: BLOB_PATH, width: 240, height: 240, fill: "#9a6ee8", transform: { x: cx - 120, y: cy - 120 } } as Layer); return;
      case "text": addLayer({ type: "text", text: tr("双击右侧编辑文字"), size: 72, color: "#ffffff", align: "center", transform: { x: cx, y: cy } }); return;
      case "caption": addLayer({
        type: "caption", text: tr("这里是字幕"), size: Math.round(H * 0.05), color: "#ffffff",
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
  function addPlugin(def: PluginDefinition, params?: Record<string, unknown>): void {
    const endMs = Math.min(def.defaultDurationMs ?? composition.durationMs, composition.durationMs);
    addLayer({ type: "plugin", plugin: def.name, params: params ?? pluginDefaults(def), endMs } as Layer);
  }
  function addAssetLayer(asset: EditorAsset, at?: [number, number]): void {
    const W = composition.width, H = composition.height;
    const [cx, cy] = at ?? [W / 2, H / 2];
    if (asset.kind === "audio") {
      addLayer({ type: "audio", src: asset.url } as Layer);
      setStatus(tr("已添加音频「{name}」（导出时混音）", { name: asset.name }));
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
      if (!asset) { setStatus(tr("不支持的文件类型: {name}", { name: f.name })); continue; }
      setAssets((a) => [asset, ...a]);
      if (addAt && first) { addAssetLayer(asset, addAt); first = false; }
      else if (!addAt) setStatus(tr("已导入「{name}」— 点击素材添加到画布", { name: asset.name }));
    }
  }

  async function importSvg(file: File, at?: [number, number]): Promise<void> {
    try {
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      const svg = doc.querySelector("svg");
      const paths = [...doc.querySelectorAll("path")];
      if (!svg || !paths.length) { setStatus(tr("SVG 中没有 <path>：{name}（可先在矢量工具中转换为路径）", { name: file.name })); return; }
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
      setStatus(tr("已导入 SVG「{name}」（{n} 条路径）", { name: file.name, n: children.length }));
    } catch (e) {
      setStatus(tr("SVG 解析失败: {e}", { e: e instanceof Error ? e.message : String(e) }));
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
    if (typeof copy.id === "string" && copy.id) copy.id = tr("{id}-副本", { id: copy.id });
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
    setStatus(tr("已保存工程文件"));
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
      setStatus(tr("已打开「{name}」", { name: f.name }));
    } catch (e) {
      setStatus(tr("打开失败: {e}", { e: e instanceof Error ? e.message : String(e) }));
    }
  }
  function newProject(): void {
    if (!window.confirm(tr("新建项目？当前项目请先保存。"))) return;
    history.reset(sampleComposition);
    setProjectName(tr("未命名项目"));
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
      else if (mod && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
      }
      else if (e.key === "Backspace" || e.key === "Delete") {
        if (multiSel.length > 1) {
          e.preventDefault();
          apply({ ...composition, layers: composition.layers.filter((_, i) => !multiSel.includes(i)) });
          select([]);
        } else if (selection.length) { e.preventDefault(); removeLayer(selection); }
      }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setTimeMs((t) => clamp(0, durRef.current, t - frameMs * (e.shiftKey ? 10 : 1))); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setTimeMs((t) => clamp(0, durRef.current, t + frameMs * (e.shiftKey ? 10 : 1))); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selLayer = selection.length ? layerAtPath(composition, selection) : undefined;

  // ---- selection (single + shift/⌘ multi on top-level layers) -----------------
  function select(path: SelPath, toggle = false): void {
    setSelKf(null);
    if (!toggle || path.length !== 1) {
      setSelection(path);
      setMultiSel(path.length ? [path[0]!] : []);
      return;
    }
    const i = path[0]!;
    const base = multiSel.length ? multiSel : selection.length === 1 ? [selection[0]!] : [];
    const next = base.includes(i) ? base.filter((x) => x !== i) : [...base, i];
    setMultiSel(next);
    setSelection(next.length ? [next[next.length - 1]!] : []);
  }

  // ---- group / ungroup ---------------------------------------------------------
  function groupSelected(): void {
    const idx = [...new Set(multiSel)].sort((a, b) => a - b);
    if (idx.length < 2) { setStatus(tr("按住 ⇧/⌘ 点选多个图层后再成组")); return; }
    const members = idx.map((i) => composition.layers[i]!).filter(Boolean);
    const layers = composition.layers.filter((_, i) => !idx.includes(i));
    // startMs stays 0 so children keep their own global clocks — grouping is
    // visually lossless; the group then moves/animates as one unit.
    layers.splice(idx[0]!, 0, { type: "group", id: tr("组"), layers: members } as Layer);
    apply({ ...composition, layers });
    select([idx[0]!]);
    setStatus(tr("已将 {n} 个图层成组（⌘G）", { n: members.length }));
  }

  function ungroupSelected(): void {
    if (selection.length !== 1) return;
    const i = selection[0]!;
    const g = composition.layers[i] as AnyLayer | undefined;
    if (!g || g.type !== "group" || !Array.isArray(g.layers)) { setStatus(tr("请选中一个顶层组再解组")); return; }
    const gs = (g.startMs as number) ?? 0;
    const ge = g.endMs as number | undefined;
    const gt = (g.transform as Record<string, unknown>) ?? {};
    const ox = typeof gt.x === "number" ? gt.x : 0;
    const oy = typeof gt.y === "number" ? gt.y : 0;
    const shiftTrack = (v: unknown, d: number): unknown =>
      d === 0 ? v : Array.isArray(v) ? (v as Kf[]).map((k) => ({ ...k, value: k.value + d })) : (typeof v === "number" ? v : 0) + d;
    const children = (g.layers as Layer[]).map((c) => {
      const cc = structuredClone(c) as AnyLayer;
      // Children lived on the group's local clock — shift times back to global.
      if (gs) {
        cc.startMs = ((cc.startMs as number) ?? 0) + gs || undefined;
        if (cc.endMs !== undefined) cc.endMs = (cc.endMs as number) + gs;
        if (cc.type !== "group" && cc.type !== "plugin" && cc.transform) {
          const tr = cc.transform as Record<string, unknown>;
          for (const k of TRANSFORM_KEYS) {
            if (Array.isArray(tr[k])) tr[k] = (tr[k] as Kf[]).map((kf) => ({ ...kf, timeMs: kf.timeMs + gs }));
          }
        }
      }
      if (cc.endMs === undefined && ge !== undefined) cc.endMs = ge;
      // Bake the group's static offset so nothing jumps on screen.
      if (ox || oy) {
        const tr = (cc.transform as Record<string, unknown>) ?? {};
        cc.transform = { ...tr, x: shiftTrack(tr.x, ox), y: shiftTrack(tr.y, oy) } as Layer["transform"];
      }
      return cc as Layer;
    });
    const layers = [...composition.layers];
    layers.splice(i, 1, ...children);
    apply({ ...composition, layers });
    select(children.length ? [i] : []);
    const lossy = Array.isArray(gt.x) || Array.isArray(gt.y) || (typeof gt.scale === "number" && gt.scale !== 1) || Array.isArray(gt.scale) || gt.rotate || gt.opacity !== undefined || g.reveal || g.clip;
    setStatus(lossy ? tr("已解组 — 组上的缩放/旋转/透明度/动画/裁剪未合并到子图层，请检查") : tr("已解组为 {n} 个图层", { n: children.length }));
  }

  const canGroup = multiSel.length >= 2;
  const canUngroup = selection.length === 1 && selLayer?.type === "group";

  // ---- gesture recording (drag a path → baked keyframes) ----------------------
  function onRecorded(index: number, samples: PathSample[]): void {
    setRecording(false);
    if (samples.length < 3) { setStatus(tr("录制太短，未生成关键帧")); return; }
    let simplified = simplifyPath(samples, composition.width * 0.008);
    if (simplified.length > 16) {
      const step = (simplified.length - 1) / 15;
      simplified = Array.from({ length: 16 }, (_, i) => simplified[Math.round(i * step)]!);
    }
    const startAt = Math.round(timeMs);
    const dur = Math.round(Math.max(240, simplified[simplified.length - 1]!.t));
    const end = startAt + dur;
    const x: Kf[] = simplified.map((s) => ({ timeMs: Math.round(startAt + s.t), value: Math.round(s.x * 100) / 100 }));
    const y: Kf[] = simplified.map((s) => ({ timeMs: Math.round(startAt + s.t), value: Math.round(s.y * 100) / 100 }));
    applyLive(updateLayerAtPath(composition, [index], (l) => ({
      ...l,
      transform: { ...(((l as AnyLayer).transform as Record<string, unknown>) ?? {}), x, y }
    } as Layer)));
    setStatus(tr("已录制运动路径：{n} 个关键帧（{from}→{to}ms）", { n: simplified.length, from: startAt, to: end }));
  }

  // ---- AI assistant applies a full composition (undoable) ----------------------
  function applyAiComposition(raw: unknown): string | null {
    try {
      const v = defineComposition(raw as Composition);
      expandComposition(v); // surface plugin/param errors before committing
      history.set(v);
      if (showJson) syncJson(v);
      setSelection([]); setMultiSel([]); setSelKf(null);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

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
        view={view} onView={setView}
        canUndo={history.canUndo} canRedo={history.canRedo}
        onUndo={history.undo} onRedo={history.redo}
        onNew={newProject} onOpen={openProject} onSave={saveProject}
        onQuickStart={() => setQuickOpen(true)}
        showJson={showJson}
        onToggleJson={() => { if (!showJson) syncJson(composition); setShowJson((s) => !s); }}
        canGroup={canGroup} canUngroup={canUngroup}
        onGroup={groupSelected} onUngroup={ungroupSelected}
        aiOpen={aiOpen} onToggleAi={() => setAiOpen((s) => !s)}
        theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onToggleLang={toggleLang}
        onExport={() => setRenderOpen(true)}
        status={status}
      />

      {/* The editor stays mounted while the gallery is open — the preview
          renderer is bound to the live <canvas> element. */}
      <div style={{ display: view === "editor" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="body">
        <LibraryPanel
          projectName={projectName} onProjectName={setProjectName}
          composition={composition} selection={selection} assets={assets} plugins={PLUGINS}
          onImportFiles={(files) => void importFiles(files)}
          onAddAssetLayer={(a) => addAssetLayer(a)}
          onAddFactory={(kind) => addFactory(kind)}
          onAddPlugin={addPlugin}
          multiSel={multiSel}
          onSelect={select}
          onMove={moveLayer} onDuplicate={duplicateLayer} onRemove={removeLayer}
        />

        <StagePanel
          canvasRef={canvasRef}
          composition={composition} expanded={expansion.comp} timeMs={timeMs}
          selection={selection} multiSel={multiSel} error={expansion.error}
          recording={recording} onRecorded={onRecorded}
          mediaSize={(src) => rendererRef.current?.mediaSize(src)}
          onSelect={select}
          animMode={animMode}
          onToggleAnimMode={() => setAnimMode((m) => { if (m) setAbBubble(null); return !m; })}
          onAnimateMove={animateMove}
          abBubble={abBubble}
          onAbDur={abRetime} onAbEase={abSetEase}
          onAbReplay={() => { if (abBubble) abPlay(abBubble); }}
          onAbRemove={abRemove}
          onAbDone={() => { setAbBubble(null); setAnimMode(false); }}
          onGestureStart={history.begin}
          onLivePatchTransform={(patches) => {
            let next = composition;
            for (const { index, patch } of patches) {
              next = updateLayerAtPath(next, [index], (l) => ({
                ...l,
                transform: { ...(((l as AnyLayer).transform as Record<string, unknown>) ?? {}), ...patch }
              } as Layer));
            }
            applyLive(next);
          }}
          onDropAsset={(id, x, y) => { const a = assets.find((x2) => x2.id === id); if (a) addAssetLayer(a, [x, y]); }}
          onDropFiles={(files, x, y) => void importFiles(files, [x, y])}
        />

        <Inspector
          composition={composition}
          layer={selLayer}
          selection={selection}
          onSelect={(p) => select(p)}
          timeMs={timeMs}
          resolved={resolvedSel}
          plugins={PLUGINS}
          assets={assets}
          selKf={selKf}
          showJson={showJson} jsonText={jsonText} jsonError={jsonError}
          recording={recording}
          onToggleRecord={() => setRecording((r) => !r)}
          patchLayer={(patch, tag) => patchLayer(selection, patch, tag)}
          editTransform={editTransform}
          toggleKey={toggleKey}
          setKfEasing={setKfEasing}
          applyAnim={applyAnim}
          previewAnim={previewAnim}
          endPreviewAnim={endPreviewAnim}
          patchComposition={patchComposition}
          onJsonEdit={onJsonEdit}
        />
      </div>

      <TimelinePanel
        composition={composition} timeMs={timeMs} playing={playing} loop={loop}
        selection={selection} multiSel={multiSel} selKf={selKf}
        onSeek={(t) => setTimeMs(clamp(0, composition.durationMs, t))}
        onSelect={select}
        onTogglePlay={() => setPlaying((p) => !p)}
        onToggleLoop={() => setLoop((l) => !l)}
        onStepFrame={(dir) => setTimeMs((t) => clamp(0, composition.durationMs, t + dir * frameMs))}
        onGestureStart={history.begin}
        onLiveLayerPatch={(index, patch) => patchLayerLive([index], patch)}
        onSelectKf={setSelKf}
        onKfRetime={kfRetime}
        onKfDelete={deleteKey}
      />
      </div>

      {view === "plugins" ? (
        <PluginGallery
          plugins={PLUGINS}
          assets={assets}
          onAddToTimeline={(def, params) => {
            addPlugin(def, params);
            setView("editor");
            setStatus(tr("已添加插件「{name}」到时间线", { name: def.displayName ?? def.name }));
          }}
        />
      ) : null}

      {quickOpen ? (
        <QuickStart
          plugins={PLUGINS}
          onClose={() => setQuickOpen(false)}
          onCreate={(comp, name, asset) => {
            history.reset(defineComposition(comp));
            setProjectName(name);
            if (asset) setAssets((a) => [asset, ...a]);
            setSelection([]); setMultiSel([]); setSelKf(null);
            setQuickOpen(false);
            setTimeMs(0);
            setPlaying(true);
            setStatus(tr("已生成你的视频 — 空格暂停，点击画布上的物体继续编辑"));
          }}
        />
      ) : null}
      {renderOpen ? <RenderDialog composition={composition} projectName={projectName} onClose={() => setRenderOpen(false)} /> : null}
      <AssistantPanel open={aiOpen} onClose={() => setAiOpen(false)} composition={composition} plugins={PLUGINS} onApply={applyAiComposition} />
    </div>
  );
}
