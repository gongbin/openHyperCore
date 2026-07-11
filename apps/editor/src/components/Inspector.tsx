import { useState } from "react";
import type { Composition, ResolvedLayer } from "openhypercore";
import type { ParamSpec, PluginDefinition } from "openhypercore/plugins";
import { BezierEditor, Col, ColorField, KfNum, KfRange, Num, Row, Sel, Section, Toggle } from "../fields.tsx";
import { EASINGS, KEY_EPS, TRANSFORM_KEYS, dfltVal, easingTuple, layerLabel, presetName, r2, typeColor } from "../helpers.ts";
import type { AnyLayer, Bezier, Kf, SelPath, TKey } from "../helpers.ts";
import type { EditorAsset } from "./LibraryPanel.tsx";

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "color-dodge", "color-burn", "soft-light", "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];

export type KfSel = { path: SelPath; key: TKey; kfIdx: number } | null;

export function Inspector({ composition, layer, selection, onSelect, timeMs, resolved, plugins, assets, selKf, recording, onToggleRecord, showJson, jsonText, jsonError, patchLayer, editTransform, toggleKey, setKfEasing, applyAnim, previewAnim, endPreviewAnim, patchComposition, onJsonEdit }: {
  composition: Composition;
  layer: AnyLayer | undefined;
  selection: SelPath;
  onSelect: (path: SelPath) => void;
  timeMs: number;
  resolved: ResolvedLayer | null;
  plugins: PluginDefinition[];
  assets: EditorAsset[];
  selKf: KfSel;
  recording: boolean;
  onToggleRecord: () => void;
  showJson: boolean;
  jsonText: string;
  jsonError: string | null;
  patchLayer: (patch: Record<string, unknown>, tag?: string) => void;
  editTransform: (key: TKey, v: number) => void;
  toggleKey: (key: TKey) => void;
  setKfEasing: (sel: NonNullable<KfSel>, easing: Bezier) => void;
  applyAnim: (name: string) => void;
  previewAnim: (name: string) => void;
  endPreviewAnim: () => void;
  patchComposition: (patch: Partial<Composition>) => void;
  onJsonEdit: (text: string) => void;
}) {
  if (showJson) {
    return (
      <aside className="inspector">
        <div className="inspector-scroll">
          <div className="section-title" style={{ marginTop: 4 }}>场景 IR JSON</div>
          <textarea className="input" value={jsonText} onChange={(e) => onJsonEdit(e.target.value)} spellCheck={false}
            style={{ flex: 1, minHeight: 300, resize: "none", fontFamily: "ui-monospace, monospace", fontSize: 11, borderColor: jsonError ? "var(--danger)" : undefined }} />
          {jsonError ? <div style={{ color: "var(--danger)", fontSize: 11 }}>{jsonError}</div> : null}
          <div style={{ color: "var(--faint)", fontSize: 11 }}>这就是渲染服务收到的完整场景描述 —— 编辑会实时生效。</div>
        </div>
      </aside>
    );
  }

  const trRaw = (layer?.transform as Record<string, unknown>) ?? {};
  const animOf = (k: TKey) => Array.isArray(trRaw[k]);
  const keyOf = (k: TKey) => Array.isArray(trRaw[k]) && (trRaw[k] as Kf[]).some((kf) => Math.abs(kf.timeMs - timeMs) <= KEY_EPS);
  const rt = resolved?.transform as Record<string, number> | undefined;
  const rVal = (k: TKey): number => {
    const v = rt?.[k];
    if (typeof v === "number") return v;
    const raw = trRaw[k];
    if (typeof raw === "number") return raw;
    if (Array.isArray(raw) && raw.length) return (raw[0] as Kf).value;
    return dfltVal(k);
  };

  const selKfData = selKf && layer && Array.isArray(trRaw[selKf.key]) && selKf.kfIdx < (trRaw[selKf.key] as Kf[]).length
    ? (trRaw[selKf.key] as Kf[])[selKf.kfIdx]! : null;
  const selTuple = selKfData ? easingTuple(selKfData.easing) : null;

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        {layer ? (
          <>
            {selection.length > 1 ? (
              <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "3px 8px", fontSize: 11.5 }}
                onClick={() => onSelect(selection.slice(0, -1))}>← 返回上级（组）</button>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="type-dot" style={{ background: typeColor(layer.type), width: 11, height: 11 }} />
              <b style={{ fontSize: 13.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{layerLabel(layer)}</b>
              <input className="input" style={{ width: 110 }} placeholder="图层 id" value={(layer.id as string) ?? ""}
                onChange={(e) => patchLayer({ id: e.target.value || undefined }, "id")} />
            </div>

            <Section title="入场 / 出场动画">
              <div style={{ color: "var(--faint)", fontSize: 10.5 }}>鼠标划过 = 在画布上试播 · 点击 = 应用</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {([["从左入", "→"], ["从右入", "←"], ["从上入", "↓"], ["从下入", "↑"], ["淡入", "◐"],
                  ["弹出", "✺"], ["缩放入", "⤢"], ["左弧入", "⤾"], ["右弧入", "⤿"], ["淡出", "◑"]] as [string, string][]).map(([a, g]) => (
                  <button key={a} className="chip chip-anim" title="划过试看 · 点击应用"
                    onMouseEnter={() => previewAnim(a)} onMouseLeave={endPreviewAnim}
                    onClick={() => applyAnim(a)}><em>{g}</em>{a}</button>
                ))}
                <button className="chip" style={{ color: "var(--danger)" }} onClick={() => applyAnim("清除")}>清除</button>
              </div>
              <button className="chip" style={recording ? { borderColor: "var(--danger)", color: "var(--danger)", alignSelf: "flex-start" } : { alignSelf: "flex-start" }}
                title="在画布上按住拖动该图层画出运动轨迹，松开自动生成关键帧（从当前播放头开始，按真实拖动节奏）"
                onClick={onToggleRecord}>
                {recording ? "● 录制中 — 去画布拖动图层，点此取消" : "◉ 录制移动路径"}
              </button>
              {(() => {
                const KEY_NAMES: Record<string, string> = { x: "x 位移", y: "y 位移", scale: "缩放", rotate: "旋转", opacity: "不透明度" };
                const tracks = TRANSFORM_KEYS.filter((k) => Array.isArray(trRaw[k]) && (trRaw[k] as Kf[]).length > 0);
                if (!tracks.length) {
                  return <div style={{ color: "var(--faint)", fontSize: 11 }}>此图层还没有动画 — 划过上方按钮试看效果，或点画布上的「✦ 动一动」把它拖到想去的位置。</div>;
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {tracks.map((k) => {
                      const arr = trRaw[k] as Kf[];
                      const first = arr[0]!, last = arr[arr.length - 1]!;
                      return (
                        <div key={k} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 7, padding: "4px 8px" }}>
                          <span style={{ color: "var(--gold)", fontSize: 10 }}>◆</span>
                          <b style={{ width: 58, color: "var(--text)" }}>{KEY_NAMES[k] ?? k}</b>
                          <span style={{ color: "var(--muted)", flex: 1 }}>
                            {arr.length} 帧 · {Math.round(first.timeMs)}→{Math.round(last.timeMs)}ms · 值 {r2(first.value)}→{r2(last.value)}
                          </span>
                          <button className="kf-btn" style={{ width: 20, height: 20, fontSize: 10 }} title="清除该属性的动画（保留末值）"
                            onClick={() => patchLayer({ transform: { ...trRaw, [k]: last.value } })}>✕</button>
                        </div>
                      );
                    })}
                    <div style={{ color: "var(--faint)", fontSize: 10.5 }}>时间为{layer.type === "group" || layer.type === "plugin" ? "组内本地时间（0 = 图层开始）" : "合成全局时间"} · 点时间轴 ◆ 可改时刻与缓动</div>
                  </div>
                );
              })()}
            </Section>

            <Section title="变换">
              <Row>
                <KfNum label="x" value={rVal("x")} animated={animOf("x")} hasKey={keyOf("x")} onChange={(v) => editTransform("x", v)} onToggle={() => toggleKey("x")} />
                <KfNum label="y" value={rVal("y")} animated={animOf("y")} hasKey={keyOf("y")} onChange={(v) => editTransform("y", v)} onToggle={() => toggleKey("y")} />
              </Row>
              <Row>
                <KfNum label="缩放" step={0.05} value={rVal("scale")} animated={animOf("scale")} hasKey={keyOf("scale")} onChange={(v) => editTransform("scale", v)} onToggle={() => toggleKey("scale")} />
                <KfNum label="旋转°" value={rVal("rotate")} animated={animOf("rotate")} hasKey={keyOf("rotate")} onChange={(v) => editTransform("rotate", v)} onToggle={() => toggleKey("rotate")} />
              </Row>
              <KfRange label="不透明度" value={rVal("opacity")} animated={animOf("opacity")} hasKey={keyOf("opacity")} onChange={(v) => editTransform("opacity", v)} onToggle={() => toggleKey("opacity")} />
            </Section>

            {selKfData && selTuple && selKf ? (
              <Section title={`缓动 — ${selKf.key} @ ${Math.round(selKfData.timeMs)}ms`}>
                <Sel label="预设" value={presetName(selTuple)} options={["custom", ...Object.keys(EASINGS)]}
                  onChange={(n) => { if (EASINGS[n]) setKfEasing(selKf, EASINGS[n]!); }} />
                <BezierEditor value={selTuple} onChange={(v) => setKfEasing(selKf, v)} />
                <div style={{ color: "var(--faint)", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>cubic-bezier({selTuple.map(r2).join(", ")})</div>
              </Section>
            ) : (
              <div style={{ color: "var(--faint)", fontSize: 11 }}>点击时间轴上的 ◆ 关键帧可编辑缓动曲线。</div>
            )}

            <Section title="时间">
              <Row>
                <Num label="开始 ms" value={(layer.startMs as number) ?? 0} onChange={(v) => patchLayer({ startMs: v || undefined }, "startMs")} />
                <Num label="结束 ms" value={(layer.endMs as number) ?? composition.durationMs} onChange={(v) => patchLayer({ endMs: v }, "endMs")} />
              </Row>
            </Section>

            <Section title="效果">
              <Sel label="混合模式" value={(layer.blendMode as string) ?? "normal"} options={BLEND_MODES}
                onChange={(v) => patchLayer({ blendMode: v === "normal" ? undefined : v })} />
              <Num label="模糊" value={(layer.blur as number) ?? 0} onChange={(v) => patchLayer({ blur: v || undefined }, "blur")} />
            </Section>

            {layer.type === "shape" ? <ShapeProps layer={layer} set={patchLayer} /> : null}
            {layer.type === "text" || layer.type === "caption" ? <TextProps layer={layer} caption={layer.type === "caption"} set={patchLayer} /> : null}
            {layer.type === "image" ? <MediaProps layer={layer} kind="image" assets={assets} set={patchLayer} /> : null}
            {layer.type === "video" ? <VideoProps layer={layer} assets={assets} set={patchLayer} /> : null}
            {layer.type === "audio" ? <AudioProps layer={layer} assets={assets} set={patchLayer} /> : null}
            {layer.type === "group" ? <GroupProps layer={layer} selection={selection} onSelect={onSelect} set={patchLayer} /> : null}
            {layer.type === "plugin" ? <PluginProps layer={layer} plugins={plugins} assets={assets} set={patchLayer} /> : null}
            <IrPanel layer={layer} />
          </>
        ) : (
          <div className="empty-hint">未选中图层。<br />点击画布或时间轴选中后在此调节。</div>
        )}

        <div style={{ flex: 1 }} />
        <Section title="合成设置">
          <Row>
            <Num label="fps" value={composition.fps} onChange={(v) => patchComposition({ fps: v })} />
            <Num label="时长 ms" value={composition.durationMs} onChange={(v) => patchComposition({ durationMs: v })} />
          </Row>
          <Row>
            <Num label="宽" value={composition.width} onChange={(v) => patchComposition({ width: v })} />
            <Num label="高" value={composition.height} onChange={(v) => patchComposition({ height: v })} />
          </Row>
        </Section>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Collapsible per-layer Scene Graph IR — the exact JSON node the renderer
// receives for the selected layer (Studio-style inspector footer).
function IrPanel({ layer }: { layer: AnyLayer }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(layer, (_k, v: unknown) => (typeof v === "string" && v.startsWith("data:") ? `${v.slice(0, 48)}…(内嵌)` : v), 2);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button className="ir-toggle" onClick={() => setOpen((o) => !o)}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="brace">{"{ }"}</span> Scene Graph IR</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <>
          <pre className="ir-pre">{json}</pre>
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "4px 10px", fontSize: 11.5 }}
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(layer, null, 2)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}>{copied ? "✓ 已复制" : "复制 JSON"}</button>
        </>
      ) : null}
    </div>
  );
}

function AssetPicker({ assets, kind, onPick }: { assets: EditorAsset[]; kind: EditorAsset["kind"]; onPick: (url: string) => void }) {
  const list = assets.filter((a) => a.kind === kind);
  if (!list.length) return null;
  return (
    <Sel label="使用已导入素材" value="" options={["", ...list.map((a) => a.id)]}
      labels={Object.fromEntries([["", "选择素材…"], ...list.map((a) => [a.id, a.name] as [string, string])])}
      onChange={(id) => { const a = list.find((x) => x.id === id); if (a) onPick(a.url); }} />
  );
}

function srcLabel(src: unknown): string {
  const s = String(src ?? "");
  if (s.startsWith("data:")) return `内嵌素材（${Math.round(s.length * 0.75 / 1024)} KB）`;
  if (s.startsWith("blob:")) return "本地素材（仅预览）";
  return s;
}

function SrcField({ layer, assets, kind, set }: { layer: AnyLayer; assets: EditorAsset[]; kind: EditorAsset["kind"]; set: (p: Record<string, unknown>) => void }) {
  const src = String(layer.src ?? "");
  const embedded = src.startsWith("data:") || src.startsWith("blob:");
  return (
    <>
      <Col label="来源 src">
        <input className="input" value={embedded ? srcLabel(src) : src} readOnly={embedded} placeholder="https://… 或从素材库选择"
          onChange={(e) => set({ src: e.target.value })} />
      </Col>
      <AssetPicker assets={assets} kind={kind} onPick={(url) => set({ src: url })} />
    </>
  );
}

type GradientStop = { offset: number; color: string };
type FillObj = { type: "linear" | "radial"; from?: [number, number]; to?: [number, number]; center?: [number, number]; radius?: number; stops: GradientStop[] };

function shapeExtent(layer: AnyLayer): [number, number] {
  if (layer.shape === "circle") { const r = (layer.radius as number) ?? 50; return [r * 2, r * 2]; }
  return [(layer.width as number) || 200, (layer.height as number) || 200];
}

function makeGradient(layer: AnyLayer, type: "linear" | "radial", stops: GradientStop[], dir: string): FillObj {
  const [w, h] = shapeExtent(layer);
  if (type === "radial") return { type, center: [w / 2, h / 2], radius: Math.max(w, h) / 2, stops };
  const to: [number, number] = dir === "vertical" ? [0, h] : dir === "diagonal" ? [w, h] : [w, 0];
  return { type, from: [0, 0], to, stops };
}

function gradientDir(f: FillObj): string {
  if (!f.to || !f.from) return "horizontal";
  const dx = f.to[0] - f.from[0], dy = f.to[1] - f.from[1];
  if (dx && dy) return "diagonal";
  return dy ? "vertical" : "horizontal";
}

function FillEditor({ layer, set }: { layer: AnyLayer; set: (p: Record<string, unknown>, tag?: string) => void }) {
  const fill = layer.fill;
  const isSolid = typeof fill === "string" || fill === undefined;
  const isGradient = !!fill && typeof fill === "object" && !Array.isArray(fill);
  const g = isGradient ? (fill as FillObj) : null;
  const mode = isSolid ? "solid" : g ? g.type : "keyframes";
  const stops: GradientStop[] = g?.stops?.length ? g.stops : [{ offset: 0, color: "#4d8dff" }, { offset: 1, color: "#22d3ee" }];
  const solid = typeof fill === "string" ? fill : "#4d8dff";

  if (mode === "keyframes") return <div style={{ color: "var(--faint)", fontSize: 11 }}>填充带颜色关键帧 — 在 JSON 中编辑</div>;

  return (
    <>
      <Sel label="填充" value={mode} options={["solid", "linear", "radial"]} labels={{ solid: "纯色", linear: "线性渐变", radial: "径向渐变" }}
        onChange={(v) => {
          if (v === "solid") set({ fill: stops[0]?.color ?? solid }, "fill");
          else set({ fill: makeGradient(layer, v as "linear" | "radial", isSolid ? [{ offset: 0, color: solid }, { offset: 1, color: "#22d3ee" }] : stops, "horizontal") }, "fill");
        }} />
      {mode === "solid" ? (
        <ColorField label="颜色" value={solid} onChange={(v) => set({ fill: v }, "fill")} />
      ) : (
        <>
          <Row>
            <ColorField label="起始色" value={stops[0]?.color ?? "#4d8dff"}
              onChange={(v) => set({ fill: { ...g!, stops: [{ offset: 0, color: v }, stops[1] ?? { offset: 1, color: "#22d3ee" }] } }, "fill")} />
            <ColorField label="结束色" value={stops[stops.length - 1]?.color ?? "#22d3ee"}
              onChange={(v) => set({ fill: { ...g!, stops: [stops[0] ?? { offset: 0, color: "#4d8dff" }, { offset: 1, color: v }] } }, "fill")} />
          </Row>
          {mode === "linear" ? (
            <Sel label="方向" value={gradientDir(g!)} options={["horizontal", "vertical", "diagonal"]} labels={{ horizontal: "水平", vertical: "垂直", diagonal: "对角" }}
              onChange={(v) => set({ fill: makeGradient(layer, "linear", stops, v) }, "fill")} />
          ) : null}
        </>
      )}
    </>
  );
}

function ShapeProps({ layer, set }: { layer: AnyLayer; set: (p: Record<string, unknown>, tag?: string) => void }) {
  const isPath = layer.shape === "path";
  const trimAnimated = Array.isArray(layer.trimEnd);
  return (
    <Section title="形状">
      <Sel label="类型" value={(layer.shape as string) ?? "rect"} options={["rect", "circle", "path"]} labels={{ rect: "矩形", circle: "圆形", path: "SVG 路径" }} onChange={(v) => set({ shape: v })} />
      {layer.shape === "circle"
        ? <Num label="半径" value={(layer.radius as number) ?? 0} onChange={(v) => set({ radius: v }, "radius")} />
        : <Row>
            <Num label="宽" value={(layer.width as number) ?? 0} onChange={(v) => set({ width: v }, "w")} />
            <Num label="高" value={(layer.height as number) ?? 0} onChange={(v) => set({ height: v }, "h")} />
          </Row>}
      {isPath ? (
        <Col label="路径 d（SVG path 语法）">
          <textarea className="input" value={(layer.path as string) ?? ""} rows={3} style={{ resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 10.5 }}
            onChange={(e) => set({ path: e.target.value }, "path")} />
        </Col>
      ) : null}
      <FillEditor layer={layer} set={set} />
      <Row>
        <ColorField label="描边" value={typeof layer.stroke === "string" ? layer.stroke : "#000000"} onChange={(v) => set({ stroke: v }, "stroke")} />
        <Num label="描边宽" value={typeof layer.strokeWidth === "number" ? layer.strokeWidth : 0}
          onChange={(v) => set(v ? { strokeWidth: v } : { strokeWidth: undefined, stroke: undefined }, "strokeW")} />
      </Row>
      {isPath ? (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="chip" title="路径从头到尾描画出现（需要描边）"
              onClick={() => set({ trimEnd: [{ timeMs: 0, value: 0 }, { timeMs: 1200, value: 1, easing: [0.2, 0, 0, 1] }] })}>✏️ 描画动画</button>
            {trimAnimated ? <button className="chip" style={{ color: "var(--danger)" }} onClick={() => set({ trimStart: undefined, trimEnd: undefined })}>清除描画</button> : null}
          </div>
          {trimAnimated ? <div style={{ color: "var(--faint)", fontSize: 11 }}>trimEnd 0→1 关键帧已添加（1.2s 描画）。更细的控制在 JSON 中调。</div> : null}
        </>
      ) : null}
    </Section>
  );
}

function TextProps({ layer, caption, set }: { layer: AnyLayer; caption: boolean; set: (p: Record<string, unknown>, tag?: string) => void }) {
  const color = typeof layer.color === "string" ? layer.color : "#ffffff";
  return (
    <Section title={caption ? "字幕" : "文字"}>
      <Col label="内容">
        <textarea className="input" value={(layer.text as string) ?? ""} rows={2} style={{ resize: "vertical" }}
          onChange={(e) => set({ text: e.target.value }, "text")} />
      </Col>
      <Row>
        <Num label="字号" value={(layer.size as number) ?? 16} onChange={(v) => set({ size: v }, "size")} />
        <Sel label="对齐" value={(layer.align as string) ?? "left"} options={["left", "center", "right"]} labels={{ left: "左", center: "中", right: "右" }} onChange={(v) => set({ align: v })} />
      </Row>
      <Row>
        <Num label="行高" step={0.1} value={(layer.lineHeight as number) ?? 1.3} onChange={(v) => set({ lineHeight: v }, "lh")} />
        <ColorField label="颜色" value={color} onChange={(v) => set({ color: v }, "color")} />
      </Row>
      <Num label="字距 letterSpacing（px）" value={(layer.letterSpacing as number) ?? 0} onChange={(v) => set({ letterSpacing: v || undefined }, "lsp")} />
      {caption ? (
        <Row>
          <ColorField label="底色" value={typeof layer.backgroundColor === "string" ? layer.backgroundColor : "#000000"} onChange={(v) => set({ backgroundColor: v }, "bg")} />
          <Num label="内边距" value={(layer.padding as number) ?? 8} onChange={(v) => set({ padding: v }, "pad")} />
        </Row>
      ) : (
        <>
          <Row>
            <ColorField label="描边" value={typeof layer.stroke === "string" ? layer.stroke : "#000000"} onChange={(v) => set({ stroke: v }, "tstroke")} />
            <Num label="描边宽" value={(layer.strokeWidth as number) ?? 0} onChange={(v) => set({ strokeWidth: v || undefined }, "tstrokeW")} />
          </Row>
          <Row>
            <ColorField label="阴影色" value={typeof layer.shadowColor === "string" ? layer.shadowColor : "#000000"} onChange={(v) => set({ shadowColor: v }, "shc")} />
            <Num label="阴影模糊" value={(layer.shadowBlur as number) ?? 0} onChange={(v) => set({ shadowBlur: v || undefined }, "shb")} />
          </Row>
        </>
      )}
      <Num label="最大宽度（自动换行，0 = 不限制）" value={(layer.maxWidth as number) ?? 0} onChange={(v) => set({ maxWidth: v || undefined }, "maxw")} />
      <Col label="字体 URL（可选 ttf/otf）">
        <input className="input" value={(layer.font as string) ?? ""} placeholder="https://…/Font.ttf" onChange={(e) => set({ font: e.target.value || undefined })} />
      </Col>
    </Section>
  );
}

function MediaProps({ layer, kind, assets, set }: { layer: AnyLayer; kind: "image"; assets: EditorAsset[]; set: (p: Record<string, unknown>, tag?: string) => void }) {
  return (
    <Section title="图片">
      <SrcField layer={layer} assets={assets} kind={kind} set={set} />
      <Sel label="适配" value={(layer.fit as string) ?? "cover"} options={["cover", "contain", "fill"]} labels={{ cover: "裁切填满", contain: "完整显示", fill: "拉伸" }} onChange={(v) => set({ fit: v })} />
      <Row>
        <Num label="宽（0=原始）" value={(layer.width as number) ?? 0} onChange={(v) => set({ width: v || undefined }, "w")} />
        <Num label="高（0=原始）" value={(layer.height as number) ?? 0} onChange={(v) => set({ height: v || undefined }, "h")} />
      </Row>
    </Section>
  );
}

function VideoProps({ layer, assets, set }: { layer: AnyLayer; assets: EditorAsset[]; set: (p: Record<string, unknown>, tag?: string) => void }) {
  return (
    <Section title="视频">
      <SrcField layer={layer} assets={assets} kind="video" set={set} />
      <Sel label="适配" value={(layer.fit as string) ?? "cover"} options={["cover", "contain", "fill"]} labels={{ cover: "裁切填满", contain: "完整显示", fill: "拉伸" }} onChange={(v) => set({ fit: v })} />
      <Row>
        <Num label="宽" value={(layer.width as number) ?? 0} onChange={(v) => set({ width: v || undefined }, "w")} />
        <Num label="高" value={(layer.height as number) ?? 0} onChange={(v) => set({ height: v || undefined }, "h")} />
      </Row>
      <Row>
        <Num label="裁入 ms" value={(layer.trimStartMs as number) ?? 0} onChange={(v) => set({ trimStartMs: v || undefined }, "trimS")} />
        <Num label="裁出 ms" value={(layer.trimEndMs as number) ?? 0} onChange={(v) => set({ trimEndMs: v || undefined }, "trimE")} />
      </Row>
      <Row>
        <Num label="倍速" step={0.1} value={(layer.playbackRate as number) ?? 1} onChange={(v) => set({ playbackRate: v === 1 ? undefined : v }, "rate")} />
        <Num label="音量" step={0.1} value={typeof layer.volume === "number" ? layer.volume : 1} onChange={(v) => set({ volume: v === 1 ? undefined : v }, "vol")} />
      </Row>
      <Toggle label="循环播放（需设置裁出）" checked={Boolean(layer.loop)} onChange={(v) => set({ loop: v || undefined })} />
      <div style={{ color: "var(--faint)", fontSize: 11 }}>视频自带音轨会按上面的裁剪/倍速/音量混入导出的 MP4（音量 0 = 静音）；预览为逐帧抓取，播放可能低于全速。</div>
    </Section>
  );
}

function AudioProps({ layer, assets, set }: { layer: AnyLayer; assets: EditorAsset[]; set: (p: Record<string, unknown>, tag?: string) => void }) {
  return (
    <Section title="音频">
      <SrcField layer={layer} assets={assets} kind="audio" set={set} />
      <Num label="音量" step={0.1} value={typeof layer.volume === "number" ? layer.volume : 1} onChange={(v) => set({ volume: v === 1 ? undefined : v }, "vol")} />
      <Row>
        <Num label="淡入 ms" value={(layer.fadeInMs as number) ?? 0} onChange={(v) => set({ fadeInMs: v || undefined }, "fi")} />
        <Num label="淡出 ms" value={(layer.fadeOutMs as number) ?? 0} onChange={(v) => set({ fadeOutMs: v || undefined }, "fo")} />
      </Row>
      <div style={{ color: "var(--faint)", fontSize: 11 }}>音频在导出 MP4 时混入；编辑器预览暂不出声。</div>
    </Section>
  );
}

function GroupProps({ layer, selection, onSelect, set }: { layer: AnyLayer; selection: SelPath; onSelect: (p: SelPath) => void; set: (p: Record<string, unknown>, tag?: string) => void }) {
  const reveal = (layer.reveal as Record<string, unknown> | undefined);
  const clip = layer.clip as Record<string, unknown> | undefined;
  const children = Array.isArray(layer.layers) ? (layer.layers as AnyLayer[]) : [];
  return (
    <Section title="组">
      {children.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="field-label">子图层（点击编辑其填充/属性，画布双击也可直达）</span>
          {children.map((c, i) => (
            <button key={i} className="layer-row" style={{ width: "100%", textAlign: "left", background: "var(--panel-2)", border: "1px solid var(--border)" }}
              onClick={() => onSelect([...selection, i])}>
              <span className="type-dot" style={{ background: typeColor(c.type) }} />
              <span className="layer-name">{layerLabel(c)}</span>
              <span style={{ color: "var(--faint)", fontSize: 10.5 }}>{c.type === "shape" && c.fill && typeof c.fill === "object" && !Array.isArray(c.fill) ? "渐变" : ""}</span>
            </button>
          ))}
        </div>
      ) : null}
      {clip ? (
        <div style={{ color: "var(--muted)", fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
          裁剪：{String(clip.type)} {clip.width ? `${String(clip.width)}×${String(clip.height)}` : ""}{clip.radius ? ` · 圆角 ${String(clip.radius)}` : ""}
          <button className="kf-btn" style={{ width: 20, height: 20, fontSize: 10 }} title="移除裁剪" onClick={() => set({ clip: undefined })}>✕</button>
        </div>
      ) : null}
      <Toggle label="静态内容栅格缓存（内容逐帧变化时关闭）" checked={Boolean(layer.cache)} onChange={(v) => set({ cache: v || undefined })} />
      <Sel label="揭示动画 reveal" value={(reveal?.type as string) ?? "none"} options={["none", "wipe", "clock"]} labels={{ none: "无", wipe: "扫掠", clock: "时钟" }}
        onChange={(v) => {
          if (v === "none") { set({ reveal: undefined }); return; }
          set({
            reveal: {
              type: v, width: (reveal?.width as number) ?? 1280, height: (reveal?.height as number) ?? 720,
              direction: (reveal?.direction as string) ?? "from-left",
              progress: reveal?.progress ?? [{ timeMs: 0, value: 0 }, { timeMs: 800, value: 1, easing: [0.2, 0, 0, 1] }]
            }
          });
        }} />
      {reveal ? (
        <>
          <Row>
            <Num label="宽" value={(reveal.width as number) ?? 0} onChange={(v) => set({ reveal: { ...reveal, width: v } }, "rvw")} />
            <Num label="高" value={(reveal.height as number) ?? 0} onChange={(v) => set({ reveal: { ...reveal, height: v } }, "rvh")} />
          </Row>
          {reveal.type === "wipe" ? (
            <Sel label="方向" value={(reveal.direction as string) ?? "from-left"} options={["from-left", "from-right", "from-top", "from-bottom"]}
              labels={{ "from-left": "从左", "from-right": "从右", "from-top": "从上", "from-bottom": "从下" }}
              onChange={(v) => set({ reveal: { ...reveal, direction: v } })} />
          ) : null}
        </>
      ) : null}
      <div style={{ color: "var(--faint)", fontSize: 11 }}>子图层在图层树中选择编辑；组内时间从组的开始时刻起算。</div>
    </Section>
  );
}

function PluginProps({ layer, plugins, assets, set }: { layer: AnyLayer; plugins: PluginDefinition[]; assets: EditorAsset[]; set: (p: Record<string, unknown>, tag?: string) => void }) {
  const def = plugins.find((p) => p.name === layer.plugin);
  if (!def) return <div style={{ color: "var(--danger)", fontSize: 11 }}>未知插件: {String(layer.plugin)}</div>;
  const params = (layer.params as Record<string, unknown>) ?? {};
  const put = (key: string, v: unknown, tag?: string) => set({ params: { ...params, [key]: v } }, tag);
  return (
    <Section title={`特效 — ${def.displayName ?? def.name}`}>
      {def.description ? <div style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.4 }}>{def.description}</div> : null}
      {Object.entries(def.params).map(([key, spec]) => (
        <ParamField key={key} name={key} spec={spec} value={params[key]} assets={assets} onChange={(v, tag) => put(key, v, tag)} />
      ))}
    </Section>
  );
}

export function ParamField({ name, spec, value, assets, onChange }: { name: string; spec: ParamSpec; value: unknown; assets: EditorAsset[]; onChange: (v: unknown, tag?: string) => void }) {
  const label = spec.label ?? name;
  switch (spec.type) {
    case "number":
      return <Num label={label} step={spec.step ?? 1} value={typeof value === "number" ? value : spec.default ?? 0} onChange={(v) => onChange(v, `p-${name}`)} />;
    case "color":
      return <ColorField label={label} value={typeof value === "string" ? value : spec.default ?? "#ffffff"} onChange={(v) => onChange(v, `p-${name}`)} />;
    case "boolean":
      return <Toggle label={label} checked={value === undefined ? spec.default ?? false : Boolean(value)} onChange={(v) => onChange(v)} />;
    case "select":
      return <Sel label={label} value={typeof value === "string" ? value : spec.default ?? spec.options[0] ?? ""} options={[...spec.options]} onChange={(v) => onChange(v)} />;
    case "latlng": {
      const [lat, lng] = Array.isArray(value) && value.length === 2 ? (value as [number, number]) : spec.default ?? [0, 0];
      return (
        <Row>
          <Num label={`${label} · 纬度`} step={0.01} value={lat} onChange={(v) => onChange([v, lng], `p-${name}`)} />
          <Num label="经度" step={0.01} value={lng} onChange={(v) => onChange([lat, v], `p-${name}`)} />
        </Row>
      );
    }
    case "string":
      if (spec.multiline) {
        return (
          <Col label={label}>
            <textarea className="input" value={typeof value === "string" ? value : ""} rows={2} style={{ resize: "vertical" }} onChange={(e) => onChange(e.target.value, `p-${name}`)} />
          </Col>
        );
      }
      return (
        <Col label={label}>
          <input className="input" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value, `p-${name}`)} />
        </Col>
      );
    default: {
      const kind = (((spec as { kind?: string }).kind ?? "image")) as EditorAsset["kind"];
      const s = typeof value === "string" ? value : "";
      const embedded = s.startsWith("data:") || s.startsWith("blob:");
      return (
        <>
          <Col label={`${label}（URL）`}>
            <input className="input" value={embedded ? srcLabel(s) : s} readOnly={embedded} placeholder="https://…" onChange={(e) => onChange(e.target.value, `p-${name}`)} />
          </Col>
          <AssetPicker assets={assets} kind={kind} onPick={(url) => onChange(url)} />
        </>
      );
    }
  }
}
