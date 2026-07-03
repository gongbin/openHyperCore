import { useEffect, useMemo, useRef, useState } from "react";
import type { Composition } from "openhypercore";
import {
  boxCorners, layerAtPath, localBox, localToParent, parentToLocal,
  pointInBox, resolveLayerAt, xfOf
} from "../helpers.ts";
import type { AnyLayer, Kf, SelPath } from "../helpers.ts";

type Gesture =
  | { kind: "move"; index: number; startX: number; startY: number; origX: unknown; origY: unknown }
  | { kind: "scale"; index: number; originX: number; originY: number; startDist: number; origScale: unknown }
  | { kind: "rotate"; index: number; originX: number; originY: number; startAngle: number; origRotate: unknown };

const shiftTrack = (v: unknown, d: number, dflt: number): unknown =>
  Array.isArray(v) ? (v as Kf[]).map((k) => ({ ...k, value: k.value + d })) : (typeof v === "number" ? v : dflt) + d;
const scaleTrack = (v: unknown, f: number, dflt: number): unknown =>
  Array.isArray(v) ? (v as Kf[]).map((k) => ({ ...k, value: k.value * f })) : (typeof v === "number" ? v : dflt) * f;

export function StagePanel({ canvasRef, composition, expanded, timeMs, selection, error, mediaSize, onSelect, onGestureStart, onLivePatchTransform, onDropAsset, onDropFiles }: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  composition: Composition;
  expanded: Composition | null;
  timeMs: number;
  selection: SelPath;
  error: string | null;
  mediaSize: (src: string) => { w: number; h: number } | undefined;
  onSelect: (path: SelPath) => void;
  onGestureStart: () => void;
  onLivePatchTransform: (index: number, patch: Record<string, unknown>) => void;
  onDropAsset: (assetId: string, x: number, y: number) => void;
  onDropFiles: (files: File[], x: number, y: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [displayW, setDisplayW] = useState(1);

  const { width: W, height: H } = composition;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDisplayW(el.clientWidth || 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // px scale: 1 screen px = k composition units (for constant-size handles)
  const k = W / Math.max(1, displayW);

  const selTop = selection[0];
  const selResolved = useMemo(
    () => (expanded && selTop !== undefined ? resolveLayerAt(expanded, [selTop], timeMs) : null),
    [expanded, selTop, timeMs]
  );
  const selBox = selResolved ? localBox(selResolved, mediaSize) : null;
  const selXf = selResolved ? xfOf(selResolved) : null;

  function toComp(e: { clientX: number; clientY: number }): [number, number] {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return [0, 0];
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  function hitTest(x: number, y: number): number | null {
    if (!expanded) return null;
    for (let i = expanded.layers.length - 1; i >= 0; i -= 1) {
      const rl = resolveLayerAt(expanded, [i], timeMs);
      if (!rl || rl.type === "audio") continue;
      const box = localBox(rl, mediaSize);
      if (!box) continue;
      const [lx, ly] = parentToLocal(xfOf(rl), x, y);
      if (pointInBox(box, lx, ly)) return i;
    }
    return null;
  }

  function beginMove(index: number, cx: number, cy: number): void {
    const raw = layerAtPath(composition, [index]);
    const tr = (raw?.transform as Record<string, unknown>) ?? {};
    onGestureStart();
    gestureRef.current = { kind: "move", index, startX: cx, startY: cy, origX: tr.x, origY: tr.y };
  }

  function onPointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const [cx, cy] = toComp(e);
    const handle = (e.target as Element).getAttribute?.("data-handle");

    if (handle && selTop !== undefined && selXf) {
      const raw = layerAtPath(composition, [selTop]);
      const tr = (raw?.transform as Record<string, unknown>) ?? {};
      onGestureStart();
      if (handle === "rotate") {
        gestureRef.current = {
          kind: "rotate", index: selTop, originX: selXf.x, originY: selXf.y,
          startAngle: Math.atan2(cy - selXf.y, cx - selXf.x), origRotate: tr.rotate
        };
      } else {
        gestureRef.current = {
          kind: "scale", index: selTop, originX: selXf.x, originY: selXf.y,
          startDist: Math.max(4, Math.hypot(cx - selXf.x, cy - selXf.y)), origScale: tr.scale
        };
      }
      return;
    }

    const hit = hitTest(cx, cy);
    if (hit === null) { onSelect([]); return; }
    if (selTop !== hit) onSelect([hit]);
    beginMove(hit, cx, cy);
  }

  function onPointerMove(e: React.PointerEvent): void {
    const g = gestureRef.current;
    if (!g || !e.buttons) return;
    const [cx, cy] = toComp(e);
    if (g.kind === "move") {
      onLivePatchTransform(g.index, {
        x: shiftTrack(g.origX, cx - g.startX, 0),
        y: shiftTrack(g.origY, cy - g.startY, 0)
      });
    } else if (g.kind === "scale") {
      const f = Math.max(0.02, Math.hypot(cx - g.originX, cy - g.originY) / g.startDist);
      onLivePatchTransform(g.index, { scale: scaleTrack(g.origScale, f, 1) });
    } else {
      const delta = ((Math.atan2(cy - g.originY, cx - g.originX) - g.startAngle) * 180) / Math.PI;
      onLivePatchTransform(g.index, { rotate: shiftTrack(g.origRotate, delta, 0) });
    }
  }

  function onPointerUp(): void { gestureRef.current = null; }

  // selection outline geometry (comp coords)
  let outline: [number, number][] | null = null;
  let rotateHandle: [number, number] | null = null;
  if (selBox && selXf) {
    outline = boxCorners(selBox).map(([px, py]) => localToParent(selXf, px, py));
    const topMidLocal: [number, number] = [selBox.x + selBox.w / 2, selBox.y];
    const topMid = localToParent(selXf, topMidLocal[0], topMidLocal[1]);
    const c = Math.cos(selXf.rot - Math.PI / 2);
    const s = Math.sin(selXf.rot - Math.PI / 2);
    rotateHandle = [topMid[0] + c * 26 * k, topMid[1] + s * 26 * k];
  }

  const selLayer = selTop !== undefined ? (layerAtPath(composition, [selTop]) as AnyLayer | undefined) : undefined;
  const selIsAudio = selLayer?.type === "audio";

  return (
    <div className="stage">
      <div className="stage-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const [x, y] = toComp(e);
          const assetId = e.dataTransfer.getData("application/x-openhyper-asset");
          if (assetId) onDropAsset(assetId, x, y);
          else if (e.dataTransfer.files.length) onDropFiles([...e.dataTransfer.files], x, y);
        }}>
        {error ? <div className="error-banner">插件展开失败：{error}</div> : null}
        <div ref={wrapRef} className="canvas-wrap" style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc((100vh - 380px) * ${W / H}))` }}>
          <canvas ref={canvasRef} width={W} height={H} />
          <svg ref={svgRef} className="stage-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            {outline ? (
              <g>
                <polygon points={outline.map((p) => p.join(",")).join(" ")}
                  fill="none" stroke="var(--accent)" strokeWidth={1.6 * k} />
                {outline.map(([hx, hy], i) => (
                  <rect key={i} data-handle={`corner-${i}`} x={hx - 5 * k} y={hy - 5 * k} width={10 * k} height={10 * k}
                    fill="#fff" stroke="var(--accent)" strokeWidth={1.2 * k} style={{ cursor: "nwse-resize" }} />
                ))}
                {rotateHandle ? (
                  <>
                    <line x1={(outline[0]![0] + outline[1]![0]) / 2} y1={(outline[0]![1] + outline[1]![1]) / 2}
                      x2={rotateHandle[0]} y2={rotateHandle[1]} stroke="var(--accent)" strokeWidth={1 * k} />
                    <circle data-handle="rotate" cx={rotateHandle[0]} cy={rotateHandle[1]} r={6 * k}
                      fill="#fff" stroke="var(--accent)" strokeWidth={1.2 * k} style={{ cursor: "grab" }} />
                  </>
                ) : null}
              </g>
            ) : null}
          </svg>
        </div>
        <div className="stage-hint">
          {selIsAudio ? "音频图层没有画面 — 在时间轴/检查器中编辑"
            : selTop !== undefined ? "拖动移动 · 角点缩放 · 顶部圆点旋转 · 空白处取消选择"
              : "点击图层选中 · 拖入文件添加素材 · 空格播放"}
        </div>
      </div>
    </div>
  );
}
