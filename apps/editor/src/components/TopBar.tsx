import { Icon } from "../icons.tsx";
import { getLang, t } from "../i18n.ts";

export type EditorView = "editor" | "plugins";

export function TopBar({ view, onView, projectName, onProjectName, canUndo, canRedo, onUndo, onRedo, onNew, onOpen, onSave, onQuickStart, showJson, onToggleJson, canGroup, canUngroup, onGroup, onUngroup, aiOpen, onToggleAi, theme, onToggleTheme, onToggleLang, onExport, status }: {
  view: EditorView;
  onView: (v: EditorView) => void;
  projectName: string;
  onProjectName: (v: string) => void;
  canUndo: boolean; canRedo: boolean;
  onUndo: () => void; onRedo: () => void;
  onNew: () => void; onOpen: () => void; onSave: () => void;
  onQuickStart: () => void;
  showJson: boolean; onToggleJson: () => void;
  canGroup: boolean; canUngroup: boolean;
  onGroup: () => void; onUngroup: () => void;
  aiOpen: boolean; onToggleAi: () => void;
  theme: "dark" | "light"; onToggleTheme: () => void;
  onToggleLang: () => void;
  onExport: () => void;
  status: string;
}) {
  const inEditor = view === "editor";
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">
          <b>OpenHyperCore</b>
          <span>studio · editor</span>
        </div>
      </div>

      <nav className="nav-pills">
        <button className={`nav-pill${inEditor ? " active" : ""}`} onClick={() => onView("editor")}><em>01</em>{t("编辑器")}</button>
        <button className={`nav-pill${view === "plugins" ? " active" : ""}`} onClick={() => onView("plugins")}><em>02</em>{t("插件库")}</button>
      </nav>

      <div className="divider" />
      <input className="project-name" value={projectName} onChange={(e) => onProjectName(e.target.value)} placeholder={t("未命名项目")} spellCheck={false} />

      {inEditor ? (
        <>
          <div className="divider" />
          <button className="icon-btn" title={t("撤销 (⌘Z)")} disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></button>
          <button className="icon-btn" title={t("重做 (⇧⌘Z)")} disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></button>

          <div className="divider" />
          <button className="btn btn-ghost" title={t("三步做出你的视频：选片头 → 写标题 → 放入素材")} onClick={onQuickStart}><Icon name="sparkle" size={14} />{t("快速开始")}</button>
          <button className="btn btn-ghost" onClick={onNew}><Icon name="file" size={14} />{t("新建")}</button>
          <button className="btn btn-ghost" onClick={onOpen}><Icon name="open" size={14} />{t("打开")}</button>
          <button className="btn btn-ghost" title={t("保存工程 JSON (⌘S)")} onClick={onSave}><Icon name="save" size={14} />{t("保存")}</button>

          <div className="divider" />
          <button className="btn btn-ghost" title={t("把多选图层合并为组 (⌘G)，⇧/⌘ 点选多个图层")} disabled={!canGroup} onClick={onGroup}><Icon name="group" size={14} />{t("成组")}</button>
          <button className="btn btn-ghost" title={t("把选中的组拆回独立图层 (⇧⌘G)")} disabled={!canUngroup} onClick={onUngroup}><Icon name="close" size={13} />{t("解组")}</button>
        </>
      ) : null}

      <div className="spacer" />
      <span style={{ color: "var(--muted)", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
      <button className={`btn${aiOpen ? "" : " btn-ghost"}`} style={aiOpen ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
        title={t("AI 动画助手：多轮对话创建/编辑动画")} onClick={onToggleAi}><Icon name="sparkle" size={14} />{t("AI 助手")}</button>
      <button className="icon-btn" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}
        title={getLang() === "zh" ? "Switch to English" : "切换到中文"} onClick={onToggleLang}>{getLang() === "zh" ? "EN" : "中"}</button>
      <button className="icon-btn" title={theme === "dark" ? t("切换浅色主题") : t("切换深色主题")} onClick={onToggleTheme}><Icon name={theme === "dark" ? "sun" : "moon"} size={16} /></button>
      <button className={`icon-btn${showJson ? " active" : ""}`} title="IR JSON" onClick={onToggleJson}><Icon name="json" size={17} /></button>
      <button className="btn btn-primary" onClick={onExport}><Icon name="export" size={15} />{t("渲染 MP4")}</button>
    </header>
  );
}
