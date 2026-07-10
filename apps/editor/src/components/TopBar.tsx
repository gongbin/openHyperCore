import { Icon } from "../icons.tsx";

export type EditorView = "editor" | "plugins";

export function TopBar({ view, onView, projectName, onProjectName, canUndo, canRedo, onUndo, onRedo, onNew, onOpen, onSave, showJson, onToggleJson, canGroup, canUngroup, onGroup, onUngroup, aiOpen, onToggleAi, theme, onToggleTheme, onExport, status }: {
  view: EditorView;
  onView: (v: EditorView) => void;
  projectName: string;
  onProjectName: (v: string) => void;
  canUndo: boolean; canRedo: boolean;
  onUndo: () => void; onRedo: () => void;
  onNew: () => void; onOpen: () => void; onSave: () => void;
  showJson: boolean; onToggleJson: () => void;
  canGroup: boolean; canUngroup: boolean;
  onGroup: () => void; onUngroup: () => void;
  aiOpen: boolean; onToggleAi: () => void;
  theme: "dark" | "light"; onToggleTheme: () => void;
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
        <button className={`nav-pill${inEditor ? " active" : ""}`} onClick={() => onView("editor")}><em>01</em>编辑器</button>
        <button className={`nav-pill${view === "plugins" ? " active" : ""}`} onClick={() => onView("plugins")}><em>02</em>插件库</button>
      </nav>

      <div className="divider" />
      <input className="project-name" value={projectName} onChange={(e) => onProjectName(e.target.value)} placeholder="未命名项目" spellCheck={false} />

      {inEditor ? (
        <>
          <div className="divider" />
          <button className="icon-btn" title="撤销 (⌘Z)" disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></button>
          <button className="icon-btn" title="重做 (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></button>

          <div className="divider" />
          <button className="btn btn-ghost" onClick={onNew}><Icon name="file" size={14} />新建</button>
          <button className="btn btn-ghost" onClick={onOpen}><Icon name="open" size={14} />打开</button>
          <button className="btn btn-ghost" title="保存工程 JSON (⌘S)" onClick={onSave}><Icon name="save" size={14} />保存</button>

          <div className="divider" />
          <button className="btn btn-ghost" title="把多选图层合并为组 (⌘G)，⇧/⌘ 点选多个图层" disabled={!canGroup} onClick={onGroup}><Icon name="group" size={14} />成组</button>
          <button className="btn btn-ghost" title="把选中的组拆回独立图层 (⇧⌘G)" disabled={!canUngroup} onClick={onUngroup}><Icon name="close" size={13} />解组</button>
        </>
      ) : null}

      <div className="spacer" />
      <span style={{ color: "var(--muted)", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
      <button className={`btn${aiOpen ? "" : " btn-ghost"}`} style={aiOpen ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
        title="AI 动画助手：多轮对话创建/编辑动画" onClick={onToggleAi}><Icon name="sparkle" size={14} />AI 助手</button>
      <button className="icon-btn" title={theme === "dark" ? "切换浅色主题" : "切换深色主题"} onClick={onToggleTheme}><Icon name={theme === "dark" ? "sun" : "moon"} size={16} /></button>
      <button className={`icon-btn${showJson ? " active" : ""}`} title="IR JSON" onClick={onToggleJson}><Icon name="json" size={17} /></button>
      <button className="btn btn-primary" onClick={onExport}><Icon name="export" size={15} />渲染 MP4</button>
    </header>
  );
}
