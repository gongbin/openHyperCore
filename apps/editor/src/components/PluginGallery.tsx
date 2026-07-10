import { useEffect, useMemo, useRef, useState } from "react";
import { defineComposition } from "openhypercore";
import type { Composition, Layer } from "openhypercore";
import { expandComposition } from "openhypercore/plugins";
import type { PluginDefinition } from "openhypercore/plugins";
import { PreviewRenderer } from "../preview.ts";
import { pluginDefaults } from "../helpers.ts";
import { ParamField } from "./Inspector.tsx";
import type { EditorAsset } from "./LibraryPanel.tsx";

// The plugin gallery ("插件库") — a Studio-style full-page browser over the
// plugin registry: poster-frame cards for every plugin, a live looping hero
// preview of the selected one, the schema-driven param form, the Scene Graph
// IR it produces, and one-click insertion into the timeline.

const PREVIEW_W = 1280;
const PREVIEW_H = 720;

// One shared offscreen renderer: every poster/hero frame is drawn on this
// surface, then blitted onto the visible card canvas with 2D drawImage —
// avoids one CanvasKit surface (and font parse) per card.
let shared: Promise<{ renderer: PreviewRenderer; canvas: HTMLCanvasElement }> | null = null;
function sharedRenderer(): Promise<{ renderer: PreviewRenderer; canvas: HTMLCanvasElement }> {
  shared ??= (async () => {
    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    const renderer = await PreviewRenderer.create(canvas);
    return { renderer, canvas };
  })();
  return shared;
}

function previewComposition(def: PluginDefinition, params: Record<string, unknown>): { comp: Composition | null; dur: number; error: string | null } {
  const dur = def.defaultDurationMs ?? 3000;
  try {
    const comp = defineComposition({
      type: "composition", fps: 30, width: PREVIEW_W, height: PREVIEW_H, durationMs: dur,
      layers: [{ type: "plugin", plugin: def.name, params, endMs: dur } as Layer]
    });
    return { comp: expandComposition(comp), dur, error: null };
  } catch (e) {
    return { comp: null, dur, error: e instanceof Error ? e.message : String(e) };
  }
}

// Serialize poster rendering: cards enqueue, one frame renders at a time.
// Plugins that need remote assets (globe textures, photos) can stall for the
// network — they queue LAST and each render is raced against a timeout so one
// slow download never blocks the rest; a late render still blits its own
// poster when the asset finally arrives.
let posterQueue: Promise<void> = Promise.resolve();
const needsAssets = (def: PluginDefinition): boolean => Object.values(def.params).some((p) => p.type === "asset");
function renderPoster(def: PluginDefinition, target: HTMLCanvasElement): Promise<void> {
  const run = async (): Promise<void> => {
    if (!target.isConnected) return;
    const { renderer, canvas } = await sharedRenderer();
    const { comp, dur } = previewComposition(def, pluginDefaults(def));
    if (!comp) return;
    const render = renderer.renderFrame(comp, dur * 0.62).then(() => {
      target.getContext("2d")?.drawImage(canvas, 0, 0, target.width, target.height);
    });
    await Promise.race([render, new Promise((r) => setTimeout(r, 8000))]);
  };
  const enqueue = (): Promise<void> => (posterQueue = posterQueue.then(run).catch(() => { /* keep the chain alive */ }));
  if (!needsAssets(def)) return enqueue();
  // Asset-dependent posters enqueue on a macrotask, i.e. after every
  // asset-free card mounted in the same commit has already queued.
  return new Promise((resolve) => { setTimeout(() => { void enqueue().then(resolve); }, 0); });
}

function PluginCard({ def, active, tick, onSelect }: { def: PluginDefinition; active: boolean; tick: number; onSelect: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void renderPoster(def, ref.current);
  }, [def, tick]);
  return (
    <div className={`plugin-card${active ? " active" : ""}`} onClick={onSelect}>
      <div className="thumb">
        <canvas ref={ref} width={440} height={248} />
        <span className="pid">{def.name}</span>
      </div>
      <div className="meta">
        <b>{def.displayName ?? def.name}</b>
        {def.category === "tiktok" ? <span className="tag-tiktok">TIKTOK</span> : null}
        <p>{def.description ?? ""}</p>
      </div>
    </div>
  );
}

const CATEGORIES: [string, string][] = [["all", "全部"], ["opener", "开场"], ["tiktok", "TikTok"], ["title", "标题"], ["map", "地图"]];

export function PluginGallery({ plugins, assets, onAddToTimeline }: {
  plugins: PluginDefinition[];
  assets: EditorAsset[];
  onAddToTimeline: (def: PluginDefinition, params: Record<string, unknown>) => void;
}) {
  const [selectedName, setSelectedName] = useState(plugins[0]?.name ?? "");
  const [cat, setCat] = useState("all");
  const [params, setParams] = useState<Record<string, unknown>>(() => (plugins[0] ? pluginDefaults(plugins[0]) : {}));
  const [showIr, setShowIr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fontTick, setFontTick] = useState(0);
  const heroRef = useRef<HTMLCanvasElement>(null);

  // Re-render posters once the full CJK font lands (they render only once,
  // possibly with the latin fallback face).
  useEffect(() => {
    let alive = true;
    void sharedRenderer().then(({ renderer }) => {
      if (alive) renderer.onFontUpgrade = () => setFontTick((t) => t + 1);
    });
    return () => { alive = false; };
  }, []);

  const def = plugins.find((p) => p.name === selectedName) ?? plugins[0];
  const filtered = cat === "all" ? plugins : plugins.filter((p) => (p.category ?? "opener") === cat);

  function select(p: PluginDefinition): void {
    setSelectedName(p.name);
    setParams(pluginDefaults(p));
  }

  const preview = useMemo(() => (def ? previewComposition(def, params) : null), [def, params]);

  // Hero loop: render the selected plugin's expanded comp on the shared
  // offscreen surface (~30fps) and blit into the hero canvas.
  useEffect(() => {
    if (!preview?.comp || !heroRef.current) return;
    let alive = true;
    let raf = 0;
    let busy = false;
    const started = performance.now();
    const target = heroRef.current;
    const tick = () => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      if (busy) return;
      busy = true;
      void (async () => {
        try {
          const { renderer, canvas } = await sharedRenderer();
          if (!alive || !preview.comp) return;
          const render = renderer.renderFrame(preview.comp, (performance.now() - started) % preview.dur).then(() => true);
          // A frame stuck on a slow remote asset must not freeze the loop —
          // skip it and retry; the pending asset fetch resolves eventually.
          const done = await Promise.race([render, new Promise<boolean>((r) => setTimeout(() => r(false), 2500))]);
          if (!alive || !done) return;
          const ctx = target.getContext("2d");
          if (ctx) {
            ctx.drawImage(canvas, 0, 0, target.width, target.height);
            // progress bar along the bottom, like the demo hero
            const p = ((performance.now() - started) % preview.dur) / preview.dur;
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fillRect(0, target.height - 4, target.width, 4);
            ctx.fillStyle = "#4f8cff";
            ctx.fillRect(0, target.height - 4, target.width * p, 4);
          }
        } finally {
          busy = false;
        }
      })();
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [preview]);

  if (!def) return <div className="gallery"><div className="gallery-main"><h1>插件库</h1><p className="gallery-sub">没有已注册的插件。</p></div></div>;

  const irNode = { type: "plugin", plugin: def.name, startMs: 0, endMs: def.defaultDurationMs ?? 3000, params };

  return (
    <div className="gallery">
      <div className="gallery-main">
        <h1>从插件生成</h1>
        <p className="gallery-sub">往时间线放一个 <code>{"{ type: \"plugin\" }"}</code> 节点 — 参数保持可编辑、非破坏性。点击卡片选择，右侧实时预览。</p>
        <div className="cat-chips">
          {CATEGORIES.filter(([k]) => k === "all" || plugins.some((p) => (p.category ?? "opener") === k)).map(([k, label]) => (
            <button key={k} className="chip" style={cat === k ? { color: "var(--accent)", borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
              onClick={() => setCat(k)}>{label}</button>
          ))}
        </div>
        <div className="gallery-grid">
          {filtered.map((p) => (
            <PluginCard key={p.name} def={p} active={p.name === def.name} tick={fontTick} onSelect={() => select(p)} />
          ))}
        </div>
      </div>

      <aside className="gallery-side">
        <div className="gallery-hero">
          <canvas ref={heroRef} width={640} height={360} />
          {preview?.error ? (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(6,10,16,.8)", color: "var(--danger)", fontSize: 12, padding: 16, textAlign: "center" }}>
              {preview.error}
            </div>
          ) : null}
          <div className="hud-badge" style={{ top: 10, left: 10 }}><span className="hud-dot" />PREVIEW</div>
          <div className="hud-badge square" style={{ top: 10, right: 10 }}>{((def.defaultDurationMs ?? 3000) / 1000).toFixed(1)}s loop</div>
        </div>
        <div className="gallery-side-head">
          <div className="pid">plugin · {def.name}</div>
          <b>{def.displayName ?? def.name}</b>
          {def.category === "tiktok" ? <span className="tag-tiktok">TIKTOK</span> : null}
          <p>{def.description ?? ""}</p>
        </div>
        <div className="gallery-side-scroll">
          <div className="section-title" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>参数</span>
            <span style={{ fontFamily: "var(--mono)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>auto-form</span>
          </div>
          {Object.entries(def.params).map(([key, spec]) => (
            <ParamField key={`${def.name}.${key}`} name={key} spec={spec} value={params[key]} assets={assets}
              onChange={(v) => setParams((prev) => ({ ...prev, [key]: v }))} />
          ))}
          <button className="ir-toggle" style={{ marginTop: 6 }} onClick={() => setShowIr((s) => !s)}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="brace">{"{ }"}</span> Scene Graph IR</span>
            <span className="chev">{showIr ? "▾" : "▸"}</span>
          </button>
          {showIr ? <pre className="ir-pre">{JSON.stringify(irNode, null, 2)}</pre> : null}
        </div>
        <div className="gallery-side-foot">
          <button className="btn btn-primary" style={{ justifyContent: "center", width: "100%" }} onClick={() => onAddToTimeline(def, params)}>添加到时间线</button>
          <button className="btn" style={{ justifyContent: "center", width: "100%" }}
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(irNode, null, 2)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}>{copied ? "✓ 已复制" : "复制插件 JSON"}</button>
        </div>
      </aside>
    </div>
  );
}
