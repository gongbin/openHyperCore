import { useEffect, useRef, useState } from "react";
import type { Composition } from "openhypercore";
import type { PluginDefinition } from "openhypercore/plugins";
import { Icon } from "../icons.tsx";
import { Col, Row, Sel } from "../fields.tsx";
import { t } from "../i18n.ts";

// LLM copilot: multi-turn chat that reads the current composition IR and
// returns a full updated composition as a ```json block, which the editor
// validates and applies (undoable). API config lives ONLY in localStorage —
// nothing is written into project files or code.

const CONFIG_KEY = "ohe.ai.config";

type AiConfig = { provider: "openai" | "anthropic"; baseUrl: string; apiKey: string; model: string };
type Msg = { role: "user" | "assistant"; content: string; applied?: boolean; error?: string };

const DEFAULTS: Record<AiConfig["provider"], { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" }
};

function loadConfig(): AiConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "");
    return { provider: raw.provider === "anthropic" ? "anthropic" : "openai", baseUrl: raw.baseUrl ?? DEFAULTS.openai.baseUrl, apiKey: raw.apiKey ?? "", model: raw.model ?? DEFAULTS.openai.model };
  } catch {
    return { provider: "openai", ...DEFAULTS.openai, apiKey: "" };
  }
}

// Strip huge data:/blob: asset payloads before sending the IR to the LLM and
// restore them from the reply's placeholders.
function stripAssets(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:") || value.startsWith("blob:")) {
      const key = `__ASSET_${map.size}__`;
      map.set(key, value);
      return key;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => stripAssets(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripAssets(v, map)]));
  }
  return value;
}
function restoreAssets(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => restoreAssets(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, restoreAssets(v, map)]));
  }
  return value;
}

function extractJson(text: string): string | null {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const last = blocks[blocks.length - 1]?.[1];
  if (last) return last.trim();
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed : null;
}

function systemPrompt(composition: Composition, plugins: PluginDefinition[]): string {
  const pluginList = plugins.map((p) => `- ${p.name}（${p.displayName ?? ""}）参数: ${Object.entries(p.params).map(([k, s]) => `${k}:${s.type}${s.required ? "*" : ""}`).join(", ")}`).join("\n");
  return `你是 openHyperEditor 的动画助手，帮用户创建/编辑视频合成。合成用 JSON 场景图 IR 描述：
- 根: { "type":"composition", fps, width, height, durationMs, layers:[] }。当前画布 ${composition.width}×${composition.height}、${composition.fps}fps、${composition.durationMs}ms。坐标原点在左上角。
- 图层类型: shape(rect/circle/path,fill/stroke/strokeWidth/trimStart/trimEnd), text(text/size/color/align/lineHeight/maxWidth/letterSpacing/stroke/shadowColor), caption(字幕,+backgroundColor/padding), image(src/fit/width/height), video(src/trimStartMs/trimEndMs/playbackRate/loop/volume), audio(src/volume/fadeInMs/fadeOutMs), group(layers,子层时间以组 startMs 为 0；可加 reveal wipe/clock 与 cache), plugin(见下), globe。
- 公共字段: id/startMs/endMs/transform/clip/blendMode/blur。
- 动画=关键帧数组: transform 的 x/y/scale/scaleX/scaleY/rotate/opacity 均可 [{"timeMs":0,"value":0},{"timeMs":600,"value":1,"easing":[0.2,0,0,1]}]，easing 是缓动到「该关键帧」的 cubic-bezier 四元组（只能用数组形式，不能用函数）。shape 的 fill/stroke 支持颜色关键帧 [{"timeMs":0,"color":"#f00"}]。
- fill 可为纯色 "#rrggbb"/"rgba(...)" 或渐变 {"type":"linear","from":[0,0],"to":[w,h],"stops":[{"offset":0,"color":..}]} / {"type":"radial","center":[x,y],"radius":r,"stops":[..]}。
- 动效插件节点: {"type":"plugin","plugin":"名字","params":{...}}，可用插件:
${pluginList}
规则：
1. 回复中先用一两句中文说明你做了什么，然后输出【恰好一个】\`\`\`json 代码块，内容是完整的 composition JSON（含所有未修改的图层，原样保留）。
2. 形如 __ASSET_0__ 的字符串是素材占位符，必须原样保留，不要改动或删除。
3. 不要发明不存在的字段或插件；时间单位毫秒；不要超出 durationMs（除非用户要求加长，那就同时改 durationMs）。`;
}

export function AssistantPanel({ open, onClose, composition, plugins, onApply }: {
  open: boolean;
  onClose: () => void;
  composition: Composition;
  plugins: PluginDefinition[];
  onApply: (raw: unknown) => string | null;
}) {
  const [config, setConfig] = useState<AiConfig>(loadConfig);
  const [showConfig, setShowConfig] = useState(() => !loadConfig().apiKey);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const assetMapRef = useRef(new Map<string, string>());

  useEffect(() => { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }, [config]);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9 }); }, [messages, busy]);

  if (!open) return null;

  function setProvider(p: AiConfig["provider"]): void {
    setConfig((c) => ({ provider: p, apiKey: c.apiKey, ...DEFAULTS[p] }));
  }

  async function callLlm(history: Msg[]): Promise<string> {
    const base = config.baseUrl.replace(/\/$/, "");
    const sys = systemPrompt(composition, plugins);
    // Older assistant JSON blocks are elided to keep the context small — the
    // fresh IR snapshot in the newest user message is the source of truth.
    const turns = history.map((m, i) => ({
      role: m.role,
      content: i < history.length - 1 && m.role === "assistant"
        ? m.content.replace(/```(?:json)?[\s\S]*?```/g, "[已输出并应用的合成 JSON，此处省略]")
        : m.content
    }));
    if (config.provider === "anthropic") {
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({ model: config.model, max_tokens: 8192, system: sys, messages: turns })
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 260)}`);
      const data = await res.json() as { content?: { text?: string }[] };
      return data.content?.map((c) => c.text ?? "").join("") ?? "";
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: sys }, ...turns] })
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 260)}`);
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }

  function tryApply(reply: string): { applied: boolean; error?: string } {
    const json = extractJson(reply);
    if (!json) return { applied: false };
    try {
      const parsed = restoreAssets(JSON.parse(json), assetMapRef.current);
      const error = onApply(parsed);
      return error ? { applied: false, error } : { applied: true };
    } catch (e) {
      return { applied: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function send(text?: string): Promise<void> {
    const ask = (text ?? input).trim();
    if (!ask || busy) return;
    if (!config.apiKey) { setShowConfig(true); return; }
    setInput("");
    assetMapRef.current = new Map();
    const compJson = JSON.stringify(stripAssets(composition, assetMapRef.current));
    const userMsg: Msg = { role: "user", content: `当前合成 IR：\n\`\`\`json\n${compJson}\n\`\`\`\n\n需求：${ask}` };
    const history = [...messages, userMsg];
    setMessages([...messages, { role: "user", content: `需求：${ask}` }]);
    setBusy(true);
    try {
      const reply = await callLlm(history);
      const { applied, error } = tryApply(reply);
      setMessages((m) => [...m, { role: "assistant", content: reply, applied, ...(error ? { error } : {}) }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "", error: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: "fixed", right: 312, top: 56, bottom: 248, width: 380, zIndex: 30,
      background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 14,
      boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", overflow: "hidden"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <Icon name="sparkle" size={16} />
        <b style={{ fontSize: 13 }}>{t("AI 动画助手")}</b>
        <span style={{ color: "var(--faint)", fontSize: 10.5 }}>{t("密钥仅存本机浏览器")}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title={t("清空对话")} onClick={() => setMessages([])}><Icon name="trash" size={13} /></button>
        <button className={`icon-btn${showConfig ? " active" : ""}`} title={t("模型设置")} onClick={() => setShowConfig((s) => !s)}><Icon name="sweep" size={14} /></button>
        <button className="icon-btn" onClick={onClose}><Icon name="close" size={13} /></button>
      </div>

      {showConfig ? (
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
          <Row>
            <Sel label={t("接口类型")} value={config.provider} options={["openai", "anthropic"]}
              labels={{ openai: t("OpenAI 兼容（含 DeepSeek/中转）"), anthropic: "Anthropic Claude" }}
              onChange={(v) => setProvider(v as AiConfig["provider"])} />
          </Row>
          <Col label="Base URL"><input className="input" value={config.baseUrl} onChange={(e) => setConfig((c) => ({ ...c, baseUrl: e.target.value }))} /></Col>
          <Row>
            <Col label={t("模型")}><input className="input" value={config.model} placeholder="gpt-4o / deepseek-chat / claude-sonnet-4-5" onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))} /></Col>
          </Row>
          <Col label={t("API Key（仅保存在浏览器 localStorage）")}>
            <input className="input" type="password" value={config.apiKey} placeholder="sk-…" onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))} />
          </Col>
          <div style={{ color: "var(--faint)", fontSize: 10.5 }}>{t("浏览器直连需要服务端允许 CORS；如被拦截可使用支持 CORS 的中转 Base URL。")}</div>
        </div>
      ) : null}

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 ? (
          <div className="empty-hint">
            {t("用自然语言描述想要的动画，AI 会直接修改画布（可 ⌘Z 撤销）。")}<br /><br />
            {t("试试：")}<br />
            {[t("加一个金色标题从下方弹入"), t("给所有图层加交错淡入"), t("做一个 3 秒倒计时开场"), t("把背景改成深蓝到紫的渐变")].map((s) => (
              <button key={s} className="chip" style={{ margin: 3 }} onClick={() => void send(s)}>{s}</button>
            ))}
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "92%", borderRadius: 10, padding: "8px 11px", fontSize: 12.5, lineHeight: 1.5,
            background: m.role === "user" ? "var(--accent-soft)" : "var(--panel)",
            border: `1px solid ${m.role === "user" ? "var(--accent)" : "var(--border)"}`,
            whiteSpace: "pre-wrap", wordBreak: "break-word"
          }}>
            {m.role === "assistant"
              ? m.content.replace(/```(?:json)?[\s\S]*?```/g, "").trim() || (m.error ? "" : t("（空回复）"))
              : m.content.replace(/^需求：/, "")}
            {m.applied ? <div style={{ color: "var(--ok)", fontSize: 11, marginTop: 5, display: "flex", gap: 5, alignItems: "center" }}><Icon name="check" size={12} />{t("已应用到画布（⌘Z 可撤销）")}</div> : null}
            {m.error ? (
              <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 5 }}>
                {m.applied === false && m.content ? t("应用失败：") : ""}{m.error}
                {m.content && extractJson(m.content) ? (
                  <button className="chip" style={{ marginLeft: 6 }} onClick={() => void send(`你上次输出的 JSON 应用失败：${m.error}。请修正后重新输出完整 JSON。`)}>{t("发回修正")}</button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--muted)", fontSize: 12 }}><span className="spinner" />{t("思考中…")}</div> : null}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <textarea className="input" rows={2} value={input} placeholder={t("描述想要的动画…（Enter 发送，⇧Enter 换行）")}
          style={{ resize: "none" }}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="btn btn-primary" style={{ alignSelf: "flex-end" }} disabled={busy || !input.trim()} onClick={() => void send()}>{t("发送")}</button>
      </div>
    </div>
  );
}
