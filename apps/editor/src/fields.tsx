import { useRef, useState } from "react";
import { clamp, composeCssColor, parseCssColor, r2, toHexColor } from "./helpers.ts";
import type { Bezier } from "./helpers.ts";

export function Col({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
export function Row({ children }: { children: React.ReactNode }) {
  return <div className="row">{children}</div>;
}

export function Num({ label, value, step, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <Col label={label}>
      <input className="input" type="number" value={r2(value)} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value))} />
    </Col>
  );
}

export function KfNum({ label, value, step, animated, hasKey, onChange, onToggle }: {
  label: string; value: number; step?: number; animated: boolean; hasKey: boolean;
  onChange: (v: number) => void; onToggle: () => void;
}) {
  return (
    <Col label={label}>
      <div style={{ display: "flex", gap: 4 }}>
        <input className="input" type="number" value={r2(value)} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value))} />
        <button className={`kf-btn${animated ? " animated" : ""}${hasKey ? " has-key" : ""}`} title="在播放头处打关键帧" onClick={onToggle}>◆</button>
      </div>
    </Col>
  );
}

export function KfRange({ label, value, animated, hasKey, onChange, onToggle }: {
  label: string; value: number; animated: boolean; hasKey: boolean;
  onChange: (v: number) => void; onToggle: () => void;
}) {
  return (
    <Col label={`${label} · ${r2(value)}`}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} />
        <button className={`kf-btn${animated ? " animated" : ""}${hasKey ? " has-key" : ""}`} title="在播放头处打关键帧" onClick={onToggle}>◆</button>
      </div>
    </Col>
  );
}

export function Sel({ label, value, options, labels, onChange }: {
  label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void;
}) {
  return (
    <Col label={label}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      </select>
    </Col>
  );
}

// Alpha-aware color field: parses hex/rgb()/rgba() IR colors, edits the RGB
// part with the native picker and the alpha with a slider, and writes back
// rgba(...) when translucent / #rrggbb when opaque.
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const parsed = parseCssColor(value) ?? { r: 255, g: 255, b: 255, a: 1 };
  const hex = toHexColor(parsed.r, parsed.g, parsed.b);
  return (
    <Col label={parsed.a < 1 ? `${label} · α ${r2(parsed.a)}` : label}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="color" value={hex} style={{ width: 46, flexShrink: 0 }}
          onChange={(e) => onChange(composeCssColor(e.target.value, parsed.a))} />
        <input type="range" min={0} max={1} step={0.01} value={parsed.a} title="不透明度"
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => onChange(composeCssColor(hex, Number(e.target.value)))} />
      </div>
    </Col>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}<span style={{ flex: 1 }} />{right}</div>
      <div className="section-body">{children}</div>
    </div>
  );
}

// Draggable cubic-bezier curve editor. Y may overshoot (-0.5..1.5) so
// "back"/spring-like eases are authorable. Emits a [x1,y1,x2,y2] tuple.
export function BezierEditor({ value, onChange }: { value: Bezier; onChange: (v: Bezier) => void }) {
  const S = 168, pad = 20, span = S - pad * 2;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const toPx = (x: number, y: number): [number, number] => [pad + x * span, pad + (1 - y) * span];
  const onMove = (e: React.PointerEvent) => {
    if (drag === null || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = clamp(0, 1, (e.clientX - r.left - pad) / span);
    const y = clamp(-0.5, 1.5, 1 - (e.clientY - r.top - pad) / span);
    const v: Bezier = [...value];
    if (drag === 0) { v[0] = r2(x); v[1] = r2(y); } else { v[2] = r2(x); v[3] = r2(y); }
    onChange(v);
  };
  const [x1, y1, x2, y2] = value;
  const p0 = toPx(0, 0), p1 = toPx(x1, y1), p2 = toPx(x2, y2), p3 = toPx(1, 1);
  return (
    <svg ref={ref} width={S} height={S} onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}
      style={{ background: "#0d1017", border: "1px solid var(--border)", borderRadius: 8, touchAction: "none", alignSelf: "center" }}>
      <rect x={pad} y={pad} width={span} height={span} fill="none" stroke="var(--border)" />
      <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke="var(--border-2)" />
      <line x1={p3[0]} y1={p3[1]} x2={p2[0]} y2={p2[1]} stroke="var(--border-2)" />
      <path d={`M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${p3[0]} ${p3[1]}`} fill="none" stroke="var(--accent)" strokeWidth={2} />
      <circle cx={p1[0]} cy={p1[1]} r={6} fill="var(--gold)" style={{ cursor: "grab" }} onPointerDown={(e) => { ref.current?.setPointerCapture(e.pointerId); setDrag(0); }} />
      <circle cx={p2[0]} cy={p2[1]} r={6} fill="var(--gold)" style={{ cursor: "grab" }} onPointerDown={(e) => { ref.current?.setPointerCapture(e.pointerId); setDrag(1); }} />
    </svg>
  );
}
