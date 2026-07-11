import { useRef, useState } from "react";
import type { Composition, Layer } from "openhypercore";
import type { PluginDefinition } from "openhypercore/plugins";
import { Icon, pluginIcon } from "../icons.tsx";
import { EMPH, pluginDefaults } from "../helpers.ts";
import { importFile } from "./LibraryPanel.tsx";
import type { EditorAsset } from "./LibraryPanel.tsx";

// Text-driven intro plugins that work out of the box (no required remote assets).
const INTRO_NAMES = [
  "neon-trace-title", "light-sweep-title", "glitch-title", "aperture-reveal",
  "kinetic-bars", "particle-assemble", "hyperspace-warp", "radar-sweep",
  "countdown", "curtain-open"
];
const TITLE_KEYS = ["title", "text", "label", "word"];

/**
 * 三步快速开始：选片头 → 写标题 → 放入自己的视频 → 生成整个合成。
 * 面向第一次打开编辑器的人 — 不需要理解图层/关键帧就能得到一支成片。
 */
export function QuickStart({ plugins, onClose, onCreate }: {
  plugins: PluginDefinition[];
  onClose: () => void;
  onCreate: (comp: Composition, name: string, asset: EditorAsset | null) => void;
}) {
  const openers = INTRO_NAMES
    .map((n) => plugins.find((p) => p.name === n))
    .filter((p): p is PluginDefinition => Boolean(p));
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState<string | null>(openers[0]?.name ?? null);
  const [title, setTitle] = useState("");
  const [asset, setAsset] = useState<EditorAsset | null>(null);
  const [videoDurMs, setVideoDurMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: File[]): Promise<void> {
    const f = files.find((x) => x.type.startsWith("video/") || x.type.startsWith("image/"));
    if (!f) return;
    setBusy(true);
    const a = await importFile(f);
    setBusy(false);
    if (!a) return;
    setAsset(a);
    setVideoDurMs(null);
    if (a.kind === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => { if (Number.isFinite(v.duration)) setVideoDurMs(Math.round(v.duration * 1000)); };
      v.src = a.url;
    }
  }

  function build(): { comp: Composition; name: string } {
    const W = 1280, H = 720;
    const layers: Layer[] = [];
    const def = pick ? openers.find((p) => p.name === pick) : undefined;
    const introDur = def ? Math.min(def.defaultDurationMs ?? 3000, 6000) : 0;
    if (def) {
      const params = pluginDefaults(def);
      const key = TITLE_KEYS.find((k) => def.params[k]?.type === "string");
      if (key && title.trim()) params[key] = title.trim();
      layers.push({ type: "plugin", plugin: def.name, params, endMs: introDur } as Layer);
    }
    let total = Math.max(introDur, 3000);
    if (asset && asset.kind !== "audio") {
      // Your footage fades in under the intro's last beat, then carries the video.
      const vStart = Math.max(0, introDur - 350);
      const fade = introDur
        ? { opacity: [{ timeMs: vStart, value: 0 }, { timeMs: vStart + 500, value: 1, easing: EMPH }] }
        : {};
      if (asset.kind === "video") {
        layers.push({
          type: "video", src: asset.url, fit: "cover", width: W, height: H,
          ...(vStart ? { startMs: vStart } : {}),
          ...(introDur ? { transform: fade } : {})
        } as Layer);
        total = vStart + (videoDurMs ?? 8000);
      } else {
        // Photos get a gentle Ken Burns push so the result never feels static.
        const holdMs = 5000;
        layers.push({
          type: "image", src: asset.url, fit: "cover", width: W, height: H,
          ...(vStart ? { startMs: vStart } : {}),
          transform: {
            ...fade,
            scale: [{ timeMs: vStart, value: 1 }, { timeMs: vStart + holdMs, value: 1.08 }]
          }
        } as Layer);
        total = vStart + holdMs;
      }
    }
    return {
      comp: { width: W, height: H, fps: 30, durationMs: Math.round(total), layers } as Composition,
      name: title.trim() || "我的视频"
    };
  }

  const canCreate = pick !== null || asset !== null;
  const steps = ["选一个片头", "写下标题", "放入你的素材"];

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal qs-modal">
        <h2><Icon name="sparkle" size={17} />快速开始 — 三步做出你的视频
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={15} /></button>
        </h2>

        <div className="qs-steps">
          {steps.map((s, i) => (
            <button key={s} className={`qs-step${i === step ? " active" : ""}${i < step ? " done" : ""}`} onClick={() => setStep(i)}>
              <em>{i < step ? "✓" : i + 1}</em>{s}
            </button>
          ))}
        </div>

        {step === 0 ? (
          <>
            <div className="qs-hint">片头会自动带上你的标题，全部都能之后再改。</div>
            <div className="qs-grid">
              <button className={`qs-tile${pick === null ? " active" : ""}`} onClick={() => setPick(null)}>
                <div className="qs-tile-icon" style={{ background: "var(--panel-2)", color: "var(--muted)" }}><Icon name="close" size={18} /></div>
                <b>不要片头</b>
                <p>直接从你的素材开始</p>
              </button>
              {openers.map((p) => {
                const { icon, tint } = pluginIcon(p.name);
                return (
                  <button key={p.name} className={`qs-tile${pick === p.name ? " active" : ""}`} onClick={() => setPick(p.name)}>
                    <div className="qs-tile-icon" style={{ background: tint }}><Icon name={icon} size={18} /></div>
                    <b>{p.displayName ?? p.name}</b>
                    <p>{p.description ?? ""}</p>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div className="qs-hint">这行字会出现在片头里，也会成为项目名。</div>
            <input className="input qs-title" autoFocus placeholder="比如：周末去海边"
              value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setStep(2); }} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="qs-hint">你拍的视频或照片会接在片头后面，自动淡入。也可以先跳过，之后从素材面板加入。</div>
            <input ref={fileRef} type="file" accept="video/*,image/*" style={{ display: "none" }}
              onChange={(e) => { void onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
            <div className={`qs-drop${dragOver ? " over" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFiles([...e.dataTransfer.files]); }}>
              {asset ? (
                <div className="qs-asset">
                  {asset.kind === "video"
                    ? <video src={asset.url} muted preload="metadata" />
                    : <img src={asset.url} alt="" />}
                  <div>
                    <b>{asset.name}</b>
                    <p>{asset.kind === "video" ? (videoDurMs ? `${(videoDurMs / 1000).toFixed(1)} 秒` : "读取时长中…") : "照片（自动缓推运镜）"} · 点击可更换</p>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ color: "var(--accent)" }}><Icon name="video" size={26} /></div>
                  {busy ? "导入中…" : "点击选择 或 拖入 视频 / 照片"}
                </>
              )}
            </div>
          </>
        ) : null}

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost" onClick={onClose}>跳过，直接进编辑器</button>
          <span style={{ flex: 1 }} />
          {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}>上一步</button> : null}
          {step < 2 ? (
            <button className="btn btn-primary" onClick={() => setStep(step + 1)}>下一步 →</button>
          ) : (
            <button className="btn btn-primary" disabled={!canCreate || busy}
              onClick={() => { const { comp, name } = build(); onCreate(comp, name, asset); }}>
              <Icon name="sparkle" size={14} />生成我的视频
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
