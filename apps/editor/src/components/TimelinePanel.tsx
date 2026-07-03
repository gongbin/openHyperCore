import { useEffect, useRef, useState } from "react";
import type { Composition } from "openhypercore";
import { Icon } from "../icons.tsx";
import { TRANSFORM_KEYS, clamp, fmtTime, layerLabel, typeColor } from "../helpers.ts";
import type { AnyLayer, Kf, SelPath, TKey } from "../helpers.ts";
import type { KfSel } from "./Inspector.tsx";

type ClipDrag = {
  index: number;
  mode: "move" | "trim-l" | "trim-r";
  grabX: number;           // pointer x in ms at grab time
  origStart: number;
  origEnd: number;
  origTransform: Record<string, unknown>;
  shiftKeyframes: boolean; // non-group layers keep their own kf on the parent timeline
};

type KfDrag = { path: SelPath; key: TKey; items: { id: number; timeMs: number; value: number; easing?: unknown }[]; dragId: number };

const SNAP_PX = 7;

export function TimelinePanel({ composition, timeMs, playing, loop, selection, multiSel, selKf, onSeek, onSelect, onTogglePlay, onToggleLoop, onStepFrame, onGestureStart, onLiveLayerPatch, onSelectKf, onKfRetime, onKfDelete }: {
  composition: Composition;
  timeMs: number;
  playing: boolean;
  loop: boolean;
  selection: SelPath;
  multiSel: number[];
  selKf: KfSel;
  onSeek: (t: number) => void;
  onSelect: (path: SelPath, toggle?: boolean) => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onStepFrame: (dir: -1 | 1) => void;
  onGestureStart: () => void;
  onLiveLayerPatch: (index: number, patch: Record<string, unknown>) => void;
  onSelectKf: (sel: KfSel) => void;
  onKfRetime: (path: SelPath, key: TKey, items: Kf[], newSelIdx: number) => void;
  onKfDelete: (path: SelPath, key: TKey, kfIdx: number) => void;
}) {
  const dur = composition.durationMs || 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const clipDrag = useRef<ClipDrag | null>(null);
  const kfDrag = useRef<KfDrag | null>(null);
  const [pxPerSec, setPxPerSec] = useState(0); // 0 = fit
  const [viewW, setViewW] = useState(800);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const GUTTER = 140;
  const laneW = pxPerSec > 0 ? (dur / 1000) * pxPerSec : Math.max(120, viewW - GUTTER - 12);
  const msToPx = (ms: number) => (ms / dur) * laneW;
  const pxToMs = (px: number) => (px / laneW) * dur;

  function laneX(e: { clientX: number }): number {
    const el = scrollRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return e.clientX - r.left - GUTTER + el.scrollLeft;
  }

  function snapMs(ms: number, exclude?: number): number {
    const candidates: number[] = [0, dur, timeMs];
    composition.layers.forEach((l, i) => {
      if (i === exclude) return;
      const al = l as AnyLayer;
      candidates.push((al.startMs as number) ?? 0, (al.endMs as number) ?? dur);
    });
    const tol = pxToMs(SNAP_PX);
    let best = ms, bestD = tol;
    for (const c of candidates) {
      const d = Math.abs(c - ms);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  // ---- ruler ticks -----------------------------------------------------
  const stepMsChoices = [100, 250, 500, 1000, 2000, 5000, 10000];
  const stepMs = stepMsChoices.find((s) => msToPx(s) >= 64) ?? 10000;
  const ticks: number[] = [];
  for (let t = 0; t <= dur; t += stepMs) ticks.push(t);

  // ---- clip drag -------------------------------------------------------
  function onClipPointerDown(e: React.PointerEvent, index: number, mode: ClipDrag["mode"]): void {
    e.stopPropagation();
    if (e.shiftKey || e.metaKey) { onSelect([index], true); return; }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const al = composition.layers[index] as AnyLayer | undefined;
    if (!al) return;
    onSelect([index]);
    onGestureStart();
    clipDrag.current = {
      index, mode,
      grabX: pxToMs(laneX(e)),
      origStart: (al.startMs as number) ?? 0,
      origEnd: (al.endMs as number) ?? dur,
      origTransform: (al.transform as Record<string, unknown>) ?? {},
      shiftKeyframes: al.type !== "group" && al.type !== "plugin"
    };
  }

  function onClipPointerMove(e: React.PointerEvent): void {
    const d = clipDrag.current;
    if (!d || !e.buttons) return;
    const delta = pxToMs(laneX(e)) - d.grabX;
    const len = d.origEnd - d.origStart;
    if (d.mode === "move") {
      let start = snapMs(clamp(0, dur - len, d.origStart + delta), d.index);
      if (snapMs(start + len, d.index) !== start + len) start = snapMs(start + len, d.index) - len;
      start = clamp(0, Math.max(0, dur - len), start);
      const patch: Record<string, unknown> = { startMs: start || undefined, endMs: start + len };
      if (d.shiftKeyframes) {
        // Non-group layers animate on the composition clock — carry their
        // keyframes along so the motion stays glued to the clip.
        const shifted: Record<string, unknown> = {};
        let touched = false;
        for (const k of TRANSFORM_KEYS) {
          const v = d.origTransform[k];
          if (Array.isArray(v)) {
            shifted[k] = (v as Kf[]).map((kf) => ({ ...kf, timeMs: kf.timeMs + (start - d.origStart) }));
            touched = true;
          }
        }
        if (touched) patch.transform = { ...d.origTransform, ...shifted };
      }
      onLiveLayerPatch(d.index, patch);
    } else if (d.mode === "trim-l") {
      const start = clamp(0, d.origEnd - 30, snapMs(d.origStart + delta, d.index));
      onLiveLayerPatch(d.index, { startMs: start || undefined });
    } else {
      const end = clamp(d.origStart + 30, dur, snapMs(d.origEnd + delta, d.index));
      onLiveLayerPatch(d.index, { endMs: end });
    }
  }

  // ---- keyframe drag ---------------------------------------------------
  function onKfPointerDown(e: React.PointerEvent, index: number, key: TKey, kfIdx: number): void {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const al = composition.layers[index] as AnyLayer | undefined;
    const track = (al?.transform as Record<string, unknown>)?.[key];
    if (!Array.isArray(track)) return;
    onSelect([index]);
    onGestureStart();
    const items = (track as Kf[]).map((k, idx) => ({ id: idx, timeMs: k.timeMs, value: k.value, easing: k.easing }));
    kfDrag.current = { path: [index], key, items, dragId: items[kfIdx]!.id };
    onSelectKf({ path: [index], key, kfIdx });
  }

  function onKfPointerMove(e: React.PointerEvent): void {
    const d = kfDrag.current;
    if (!d || !e.buttons) return;
    const t = Math.round(clamp(0, dur, pxToMs(laneX(e))));
    d.items = d.items.map((it) => (it.id === d.dragId ? { ...it, timeMs: t } : it));
    const sorted = [...d.items].sort((a, b) => a.timeMs - b.timeMs);
    const newIdx = sorted.findIndex((it) => it.id === d.dragId);
    onKfRetime(d.path, d.key, sorted.map(({ id: _id, ...rest }) => rest), newIdx);
  }

  function endDrags(): void { clipDrag.current = null; kfDrag.current = null; }

  const seekFromEvent = (e: { clientX: number }) => onSeek(clamp(0, dur, pxToMs(laneX(e))));
  const fps = composition.fps || 30;

  return (
    <div className="timeline">
      <div className="transport">
        <button className="icon-btn" title="回到开头" onClick={() => onSeek(0)}><Icon name="skipStart" size={15} /></button>
        <button className="icon-btn" title="上一帧 ←" onClick={() => onStepFrame(-1)}><Icon name="prevFrame" size={15} /></button>
        <button className="icon-btn active" style={{ width: 34, height: 34 }} title="播放/暂停 (空格)" onClick={onTogglePlay}>
          <Icon name={playing ? "pause" : "play"} size={19} />
        </button>
        <button className="icon-btn" title="下一帧 →" onClick={() => onStepFrame(1)}><Icon name="nextFrame" size={15} /></button>
        <button className={`icon-btn${loop ? " active" : ""}`} title="循环播放" onClick={onToggleLoop}><Icon name="loop" size={15} /></button>
        <span className="timecode">{fmtTime(timeMs)} <span>/ {fmtTime(dur)}</span></span>
        <span style={{ color: "var(--faint)", fontSize: 11 }}>{Math.round(timeMs / (1000 / fps))} f</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--faint)", fontSize: 11 }}>拖动片段移动 · 拖两端裁剪 · ◆ 拖动改时刻 / 双击删除</span>
        <button className="icon-btn" title="适配窗口" onClick={() => setPxPerSec(0)}><Icon name="fit" size={14} /></button>
        <input type="range" min={20} max={600} value={pxPerSec > 0 ? pxPerSec : Math.round((laneW * 1000) / dur)}
          onChange={(e) => setPxPerSec(Number(e.target.value))} style={{ width: 110 }} title="时间轴缩放" />
      </div>

      <div ref={scrollRef} className="tl-scroll" onPointerUp={endDrags}>
        <div className="tl-canvas" style={{ width: GUTTER + laneW + 20, minHeight: "100%" }}>
          <div className="tl-ruler"
            onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); seekFromEvent(e); }}
            onPointerMove={(e) => { if (e.buttons) seekFromEvent(e); }}>
            {ticks.map((t) => (
              <div key={t} className="tl-tick" style={{ left: GUTTER + msToPx(t) }}>{(t / 1000).toFixed(t % 1000 ? 1 : 0)}s</div>
            ))}
          </div>

          {composition.layers.map((l, i) => {
            const al = l as AnyLayer;
            const start = (al.startMs as number) ?? 0;
            const end = (al.endMs as number) ?? dur;
            const isSel = (selection[0] === i && selection.length === 1) || (multiSel.length > 1 && multiSel.includes(i));
            const tr = (al.transform as Record<string, unknown>) ?? {};
            const color = typeColor(al.type);
            return (
              <div key={i} className={`tl-row${isSel ? " selected" : ""}`}>
                <div className="tl-label" onClick={(e) => onSelect([i], e.shiftKey || e.metaKey)}>
                  <span className="type-dot" style={{ background: color }} />
                  {layerLabel(al)}
                </div>
                <div className="clip"
                  style={{
                    left: GUTTER + msToPx(start), width: Math.max(10, msToPx(end - start)),
                    background: `linear-gradient(180deg, ${color}cc, ${color}88)`,
                    outlineColor: isSel ? "var(--accent)" : undefined
                  }}
                  onPointerDown={(e) => onClipPointerDown(e, i, "move")}
                  onPointerMove={onClipPointerMove}
                  onPointerUp={endDrags}>
                  <span style={{ pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>{layerLabel(al)}</span>
                  <span className="clip-edge l" onPointerDown={(e) => onClipPointerDown(e, i, "trim-l")} onPointerMove={onClipPointerMove} onPointerUp={endDrags} />
                  <span className="clip-edge r" onPointerDown={(e) => onClipPointerDown(e, i, "trim-r")} onPointerMove={onClipPointerMove} onPointerUp={endDrags} />
                </div>
                {TRANSFORM_KEYS.flatMap((key) =>
                  Array.isArray(tr[key])
                    ? (tr[key] as Kf[]).map((kf, j) => {
                        const isKfSel = selKf?.path[0] === i && selKf.key === key && selKf.kfIdx === j;
                        return (
                          <div key={`${key}-${j}`} title={`${key} @ ${Math.round(kf.timeMs)}ms`}
                            className={`kf-diamond${isKfSel ? " selected" : ""}`}
                            style={{ left: GUTTER + msToPx(kf.timeMs), top: 12 }}
                            onPointerDown={(e) => onKfPointerDown(e, i, key, j)}
                            onPointerMove={onKfPointerMove}
                            onPointerUp={endDrags}
                            onDoubleClick={(e) => { e.stopPropagation(); onKfDelete([i], key, j); }} />
                        );
                      })
                    : []
                )}
              </div>
            );
          })}

          <div className="playhead" style={{ left: GUTTER + msToPx(timeMs) }}>
            <div className="playhead-cap"
              onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => { if (e.buttons) seekFromEvent(e); }} />
          </div>
        </div>
      </div>
    </div>
  );
}
