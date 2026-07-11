import { useRef, useState } from "react";
import type { Composition, Layer } from "openhypercore";
import type { PluginDefinition } from "openhypercore/plugins";
import { Icon, pluginIcon } from "../icons.tsx";
import { t } from "../i18n.ts";
import { layerLabel, typeColor } from "../helpers.ts";
import type { AnyLayer, SelPath } from "../helpers.ts";

export type EditorAsset = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  /** URL used in the IR: data: (embedded, renders anywhere) or blob:/https:. */
  url: string;
  /** blob: URLs only live in this browser session — MP4 render can't read them. */
  previewOnly: boolean;
};

export const ASSET_MIME: Record<EditorAsset["kind"], string> = {
  image: "image/*",
  video: "video/*",
  audio: "audio/*"
};

const EMBED_LIMIT = 8 * 1024 * 1024; // embed files ≤8MB as data: URLs (server body cap is 32MB)

export function fileKind(f: File): EditorAsset["kind"] | null {
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("video/")) return "video";
  if (f.type.startsWith("audio/")) return "audio";
  return null;
}

export async function importFile(f: File): Promise<EditorAsset | null> {
  const kind = fileKind(f);
  if (!kind) return null;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  if (kind === "image" && f.size <= EMBED_LIMIT) {
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    return { id, name: f.name, kind, url, previewOnly: false };
  }
  return { id, name: f.name, kind, url: URL.createObjectURL(f), previewOnly: true };
}

export function LibraryPanel({ composition, selection, multiSel, assets, plugins, onImportFiles, onAddAssetLayer, onAddFactory, onAddPlugin, onSelect, onMove, onDuplicate, onRemove }: {
  composition: Composition;
  selection: SelPath;
  multiSel: number[];
  assets: EditorAsset[];
  plugins: PluginDefinition[];
  onImportFiles: (files: File[]) => void;
  onAddAssetLayer: (asset: EditorAsset) => void;
  onAddFactory: (kind: string) => void;
  onAddPlugin: (def: PluginDefinition) => void;
  onSelect: (path: SelPath, toggle?: boolean) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onDuplicate: (index: number) => void;
  onRemove: (path: SelPath) => void;
}) {
  const [tab, setTab] = useState<"media" | "add" | "fx" | "layers">("media");
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <aside className="library">
      <div className="tabs">
        {([["media", "素材"], ["add", "组件"], ["fx", "特效"], ["layers", "图层"]] as const).map(([k, name]) => (
          <button key={k} className={`tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{t(name)}</button>
        ))}
      </div>

      <div className="library-scroll">
        {tab === "media" ? (
          <>
            <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" style={{ display: "none" }}
              onChange={(e) => { onImportFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onImportFiles([...e.dataTransfer.files]); }}
              style={{
                border: `1.5px dashed ${dragOver ? "var(--accent)" : "var(--border-2)"}`,
                background: dragOver ? "var(--accent-soft)" : "transparent",
                borderRadius: 10, padding: "18px 10px", textAlign: "center", cursor: "pointer",
                color: "var(--muted)", fontSize: 12, marginBottom: 10, transition: "all .13s"
              }}>
              <div style={{ color: "var(--accent)", marginBottom: 6 }}><Icon name="plus" size={20} /></div>
              {t("点击导入 或 拖入图片 / 视频 / 音频")}
            </div>
            {assets.length === 0 ? <div className="empty-hint">{t("还没有素材。")}<br />{t("导入后点击即可添加到画布，也可直接拖到画布上。")}</div> : null}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {assets.map((a) => (
                <div key={a.id} draggable
                  onDragStart={(e) => { e.dataTransfer.setData("application/x-openhyper-asset", a.id); e.dataTransfer.effectAllowed = "copy"; }}
                  onClick={() => onAddAssetLayer(a)}
                  title={a.previewOnly
                    ? t("{name}（blob 素材仅预览，导出请用 URL/内嵌） — 点击添加，或拖到画布", { name: a.name })
                    : t("{name} — 点击添加，或拖到画布", { name: a.name })}
                  style={{ borderRadius: 9, overflow: "hidden", border: "1px solid var(--border)", cursor: "grab", background: "var(--panel-2)" }}>
                  <div style={{ height: 64, display: "grid", placeItems: "center", background: "#0d1017", position: "relative" }}>
                    {a.kind === "image"
                      ? <img src={a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : a.kind === "video"
                        ? <video src={a.url} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ color: "var(--cyan)" }}><Icon name="audio" size={26} /></span>}
                    {a.previewOnly ? <span title={t("blob 素材：仅本地预览可见")} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,.6)", color: "var(--gold)", borderRadius: 4, fontSize: 9, padding: "1px 4px" }}>{t("预览")}</span> : null}
                  </div>
                  <div style={{ padding: "4px 7px", fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "add" ? (
          <div className="card-grid">
            {[["rect", "矩形", "rect"], ["circle", "圆形", "circle"], ["text", "文字", "text"],
              ["caption", "字幕", "caption"], ["image", "图片", "image"], ["video", "视频", "video"],
              ["audio", "音频", "audio"], ["svg", "SVG 图案", "svgFile"], ["group", "组", "group"]].map(([kind, name, icon]) => (
              <button key={kind} className="add-card" onClick={() => onAddFactory(kind!)}>
                <Icon name={icon!} size={22} />
                {t(name!)}
              </button>
            ))}
          </div>
        ) : null}

        {tab === "fx" ? (
          <>
            {plugins.map((p) => {
              const { icon, tint } = pluginIcon(p.name);
              return (
                <div key={p.name} className="fx-card" onClick={() => onAddPlugin(p)}>
                  <div className="fx-icon" style={{ background: tint }}><Icon name={icon} size={20} /></div>
                  <div style={{ minWidth: 0 }}>
                    <b>{p.displayName ?? p.name}{p.category === "tiktok" ? <span className="tag-tiktok">TIKTOK</span> : null}</b>
                    <p>{p.description ?? ""}</p>
                  </div>
                </div>
              );
            })}
          </>
        ) : null}

        {tab === "layers" ? (
          composition.layers.length === 0
            ? <div className="empty-hint">{t("还没有图层，从素材/组件/特效添加。")}</div>
            : <>
                <div style={{ color: "var(--faint)", fontSize: 10.5, marginBottom: 6 }}>{t("⇧/⌘ 点选多个 → 顶栏「成组」(⌘G)")}</div>
                <LayerTree layers={composition.layers} selection={selection} multiSel={multiSel} onSelect={onSelect} onMove={onMove} onDuplicate={onDuplicate} onRemove={onRemove} />
              </>
        ) : null}
      </div>
    </aside>
  );
}

function LayerTree({ layers, selection, multiSel, onSelect, onMove, onDuplicate, onRemove }: {
  layers: Layer[]; selection: SelPath; multiSel: number[];
  onSelect: (p: SelPath, toggle?: boolean) => void; onMove: (i: number, dir: -1 | 1) => void;
  onDuplicate: (i: number) => void; onRemove: (p: SelPath) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {layers.map((l, i) => (
        <LayerNode key={i} layer={l as AnyLayer} path={[i]} selection={selection} multiSel={multiSel}
          onSelect={onSelect} onMove={onMove} onDuplicate={onDuplicate} onRemove={onRemove} />
      ))}
    </div>
  );
}

function LayerNode({ layer, path, selection, multiSel, onSelect, onMove, onDuplicate, onRemove }: {
  layer: AnyLayer; path: SelPath; selection: SelPath; multiSel: number[];
  onSelect: (p: SelPath, toggle?: boolean) => void; onMove: (i: number, dir: -1 | 1) => void;
  onDuplicate: (i: number) => void; onRemove: (p: SelPath) => void;
}) {
  const [open, setOpen] = useState(true);
  const isSel = (selection.length === path.length && selection.every((v, i) => v === path[i]))
    || (path.length === 1 && multiSel.length > 1 && multiSel.includes(path[0]!));
  const children = layer.type === "group" && Array.isArray(layer.layers) ? (layer.layers as Layer[]) : [];
  const top = path.length === 1;
  return (
    <>
      <div className={`layer-row${isSel ? " selected" : ""}`} style={{ paddingLeft: 8 + (path.length - 1) * 16 }}
        onClick={(e) => onSelect(path, top && (e.shiftKey || e.metaKey))}>
        {children.length > 0
          ? <button className="icon-btn" style={{ width: 18, height: 18 }} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}><Icon name={open ? "chevD" : "chevR"} size={12} /></button>
          : <span style={{ width: 4 }} />}
        <span className="type-dot" style={{ background: typeColor(layer.type) }} />
        <span className="layer-name">{layerLabel(layer)}</span>
        <span className="actions">
          {top ? <>
            <button className="icon-btn" title={t("上移")} onClick={(e) => { e.stopPropagation(); onMove(path[0]!, -1); }}><Icon name="up" size={12} /></button>
            <button className="icon-btn" title={t("下移")} onClick={(e) => { e.stopPropagation(); onMove(path[0]!, 1); }}><Icon name="down" size={12} /></button>
            <button className="icon-btn" title={t("复制 (⌘D)")} onClick={(e) => { e.stopPropagation(); onDuplicate(path[0]!); }}><Icon name="dup" size={12} /></button>
          </> : null}
          <button className="icon-btn danger" title={t("删除")} onClick={(e) => { e.stopPropagation(); onRemove(path); }}><Icon name="trash" size={12} /></button>
        </span>
      </div>
      {open ? children.map((c, i) => (
        <LayerNode key={i} layer={c as AnyLayer} path={[...path, i]} selection={selection} multiSel={multiSel}
          onSelect={onSelect} onMove={onMove} onDuplicate={onDuplicate} onRemove={onRemove} />
      )) : null}
    </>
  );
}
