import { useEffect, useMemo, useRef, useState } from "react";
import type { Composition } from "openhypercore";
import {
  AB_EASE_LABEL, anchorsToD, boxCorners, clamp, layerAtPath, localBox, localToParent, parentToLocal,
  parsePathD, pointInBox, resolveLayerAt, sampleSegment, splitSegment, upsertKfArr, xfOf, xyKfTimes
} from "../helpers.ts";
import type { AbBubble, AbEase, AnyLayer, Kf, ParsedPath, PathAnchor, PathSample, SelPath } from "../helpers.ts";
import { t } from "../i18n.ts";

type Gesture =
  | { kind: "move"; startX: number; startY: number; targets: { index: number; origX: unknown; origY: unknown }[] }
  | { kind: "scale"; index: number; originX: number; originY: number; startDist: number; origScale: unknown }
  | { kind: "rotate"; index: number; originX: number; originY: number; startAngle: number; origRotate: unknown }
  // Dragging a keyframe dot on the motion path: reposition that keyframe in space.
  | { kind: "kfdot"; index: number; timeTrack: number; startX: number; startY: number; baseX: number; baseY: number; origX: unknown; origY: unknown }
  // Node editor: dragging an anchor / one of its bezier control handles.
  | { kind: "panchor"; index: number; ai: number; startX: number; startY: number; model: ParsedPath }
  | { kind: "phandle"; index: number; ai: number; which: "in" | "out"; model: ParsedPath };

// "动一动" drag in progress: object stays put, a ghost + arrow follow the cursor.
type AbDrag = { index: number; sx: number; sy: number; pcx: number; pcy: number; dx: number; dy: number; pts: [number, number][] | null };

// Serialize an edited path model back into a layer patch, growing the shape's
// box to whatever the anchors/handles now span.
function pathPatch(model: ParsedPath): Record<string, unknown> {
  let mx = 1, my = 1;
  for (const a of model.anchors) {
    mx = Math.max(mx, a.x, a.in?.[0] ?? 0, a.out?.[0] ?? 0);
    my = Math.max(my, a.y, a.in?.[1] ?? 0, a.out?.[1] ?? 0);
  }
  return { path: anchorsToD(model), width: Math.ceil(mx), height: Math.ceil(my) };
}

const shiftTrack = (v: unknown, d: number, dflt: number): unknown =>
  Array.isArray(v) ? (v as Kf[]).map((k) => ({ ...k, value: k.value + d })) : (typeof v === "number" ? v : dflt) + d;
const scaleTrack = (v: unknown, f: number, dflt: number): unknown =>
  Array.isArray(v) ? (v as Kf[]).map((k) => ({ ...k, value: k.value * f })) : (typeof v === "number" ? v : dflt) * f;

export function StagePanel({ canvasRef, composition, expanded, timeMs, selection, multiSel, error, recording, onRecorded, mediaSize, onSelect, animMode, onToggleAnimMode, onAnimateMove, abBubble, onAbDur, onAbEase, onAbReplay, onAbRemove, onAbDone, pathEdit, onTogglePathEdit, onLivePatchLayer, onCommitLayer, onGestureStart, onLivePatchTransform, onDropAsset, onDropFiles }: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  composition: Composition;
  expanded: Composition | null;
  timeMs: number;
  selection: SelPath;
  multiSel: number[];
  error: string | null;
  recording: boolean;
  onRecorded: (index: number, samples: PathSample[]) => void;
  mediaSize: (src: string) => { w: number; h: number } | undefined;
  onSelect: (path: SelPath, toggle?: boolean) => void;
  animMode: boolean;
  onToggleAnimMode: () => void;
  onAnimateMove: (index: number, dx: number, dy: number) => void;
  abBubble: AbBubble | null;
  onAbDur: (durMs: number) => void;
  onAbEase: (ease: AbEase) => void;
  onAbReplay: () => void;
  onAbRemove: () => void;
  onAbDone: () => void;
  pathEdit: boolean;
  onTogglePathEdit: () => void;
  onLivePatchLayer: (index: number, patch: Record<string, unknown>) => void;
  onCommitLayer: (index: number, patch: Record<string, unknown>, tag: string) => void;
  onGestureStart: () => void;
  onLivePatchTransform: (patches: { index: number; patch: Record<string, unknown> }[]) => void;
  onDropAsset: (assetId: string, x: number, y: number) => void;
  onDropFiles: (files: File[], x: number, y: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const recordRef = useRef<{ index: number; startCx: number; startCy: number; baseX: number; baseY: number; startedAt: number; samples: PathSample[] } | null>(null);
  const [abDrag, setAbDrag] = useState<AbDrag | null>(null);
  const [displayW, setDisplayW] = useState(1);
  const [safeGuides, setSafeGuides] = useState(() => localStorage.getItem("ohe.safeGuides") === "1");

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

  // ---- node editor model (path shapes) --------------------------------------
  const selLayerRaw = selTop !== undefined ? (layerAtPath(composition, [selTop]) as AnyLayer | undefined) : undefined;
  const selPathD = selLayerRaw?.type === "shape" && selLayerRaw.shape === "path" && typeof selLayerRaw.path === "string"
    ? (selLayerRaw.path as string) : null;
  const pathModel = useMemo(() => (pathEdit && selPathD ? parsePathD(selPathD) : null), [pathEdit, selPathD]);
  const [pathSel, setPathSel] = useState<number | null>(null);
  useEffect(() => { setPathSel(null); }, [pathEdit, selTop]);

  // per-segment polyline samples in comp coords (drawing + click-to-insert)
  const pathSegs = useMemo(() => {
    if (!pathEdit || !pathModel || !selResolved) return null;
    const xf = xfOf(selResolved);
    const A = pathModel.anchors;
    const n = pathModel.closed ? A.length : A.length - 1;
    const segs: { i: number; pts: [number, number][] }[] = [];
    for (let i = 0; i < n; i += 1) {
      const b = A[(i + 1) % A.length]!;
      segs.push({ i, pts: sampleSegment(A[i]!, b, 24).map(([px, py]) => localToParent(xf, px, py)) });
    }
    return segs;
  }, [pathEdit, pathModel, selResolved]);

  // ⌫ removes the selected node (line needs 2 anchors, closed shape 3)
  useEffect(() => {
    if (!pathEdit || pathSel === null || !pathModel || selTop === undefined) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (pathModel.anchors.length <= (pathModel.closed ? 3 : 2)) return;
      e.preventDefault();
      onCommitLayer(selTop, pathPatch({ ...pathModel, anchors: pathModel.anchors.filter((_, i) => i !== pathSel) }), "path-node-del");
      setPathSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathEdit, pathSel, pathModel, selTop, onCommitLayer]);

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

  // ---- motion path of the selected layer (visible + directly editable) ------
  // Any x/y keyframe animation shows as a golden trail with draggable keyframe
  // dots and dashed ghosts at the start/end poses — "从哪来、到哪去" at a glance.
  const motion = useMemo(() => {
    if (selTop === undefined || !expanded) return null;
    const raw = layerAtPath(composition, [selTop]);
    if (!raw) return null;
    const tr = (raw.transform as Record<string, unknown>) ?? {};
    const times = xyKfTimes(tr);
    if (times.length < 2) return null;
    const local = raw.type === "group" || raw.type === "plugin";
    const startMs = (raw.startMs as number) ?? 0;
    const g = (t: number): number => (local ? t + startMs : t);
    const centerAt = (t: number): [number, number] | null => {
      const rl = resolveLayerAt(expanded, [selTop], g(t));
      if (!rl) return null;
      const box = localBox(rl, mediaSize);
      const xf = xfOf(rl);
      return box ? localToParent(xf, box.x + box.w / 2, box.y + box.h / 2) : [xf.x, xf.y];
    };
    const ghostAt = (t: number): [number, number][] | null => {
      const rl = resolveLayerAt(expanded, [selTop], g(t));
      if (!rl) return null;
      const box = localBox(rl, mediaSize);
      if (!box) return null;
      const xf = xfOf(rl);
      return boxCorners(box).map(([px, py]) => localToParent(xf, px, py));
    };
    const t0 = times[0]!, t1 = times[times.length - 1]!;
    const pts: [number, number][] = [];
    const N = 48;
    for (let i = 0; i <= N; i += 1) {
      const c = centerAt(t0 + ((t1 - t0) * i) / N);
      if (c) pts.push(c);
    }
    if (pts.length < 2) return null;
    const dots = times
      .map((t) => ({ t, c: centerAt(t) }))
      .filter((d): d is { t: number; c: [number, number] } => d.c !== null);
    return { pts, dots, gA: ghostAt(t0), gB: ghostAt(t1) };
  }, [expanded, selTop, composition]); // eslint-disable-line react-hooks/exhaustive-deps

  function beginMove(indices: number[], cx: number, cy: number): void {
    const targets = indices.map((index) => {
      const tr = (layerAtPath(composition, [index])?.transform as Record<string, unknown>) ?? {};
      return { index, origX: tr.x, origY: tr.y };
    });
    onGestureStart();
    gestureRef.current = { kind: "move", startX: cx, startY: cy, targets };
  }

  function onPointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const [cx, cy] = toComp(e);

    // Node editor swallows all stage pointer input while active.
    if (pathEdit && pathModel && selTop !== undefined && selXf) {
      const tgt = e.target as Element;
      const aAttr = tgt.getAttribute?.("data-panchor");
      if (aAttr != null) {
        setPathSel(Number(aAttr));
        onGestureStart();
        gestureRef.current = { kind: "panchor", index: selTop, ai: Number(aAttr), startX: cx, startY: cy, model: pathModel };
        return;
      }
      const hAttr = tgt.getAttribute?.("data-phandle");
      if (hAttr) {
        const [aiS, which] = hAttr.split(":");
        onGestureStart();
        gestureRef.current = { kind: "phandle", index: selTop, ai: Number(aiS), which: which as "in" | "out", model: pathModel };
        return;
      }
      const segAttr = tgt.getAttribute?.("data-pseg");
      if (segAttr != null && pathSegs) {
        // Click on the path inserts a node there (de Casteljau split keeps the
        // shape) and starts dragging it right away.
        const seg = pathSegs[Number(segAttr)]!;
        let best = 0, bd = Infinity;
        seg.pts.forEach((p, si) => { const d = Math.hypot(p[0] - cx, p[1] - cy); if (d < bd) { bd = d; best = si; } });
        const u = clamp(0.04, 0.96, best / (seg.pts.length - 1));
        const A = pathModel.anchors;
        const j = (seg.i + 1) % A.length;
        const { a, mid, b } = splitSegment(A[seg.i]!, A[j]!, u);
        const anchors = [...A];
        anchors[seg.i] = a; anchors[j] = b;
        anchors.splice(seg.i + 1, 0, mid);
        const model = { ...pathModel, anchors };
        onGestureStart();
        onLivePatchLayer(selTop, pathPatch(model));
        setPathSel(seg.i + 1);
        gestureRef.current = { kind: "panchor", index: selTop, ai: seg.i + 1, startX: cx, startY: cy, model };
        return;
      }
      setPathSel(null);
      return;
    }

    // Motion-path keyframe dot — drag it to reposition that keyframe in space.
    const dotAttr = (e.target as Element).getAttribute?.("data-kfdot");
    if (dotAttr != null && selTop !== undefined && expanded) {
      const t = Number(dotAttr);
      const raw = layerAtPath(composition, [selTop]);
      const tr = (raw?.transform as Record<string, unknown>) ?? {};
      const local = raw?.type === "group" || raw?.type === "plugin";
      const gT = local ? t + ((raw?.startMs as number) ?? 0) : t;
      const rl = resolveLayerAt(expanded, [selTop], gT);
      const rt = rl?.transform as unknown as Record<string, number> | undefined;
      onGestureStart();
      gestureRef.current = {
        kind: "kfdot", index: selTop, timeTrack: t, startX: cx, startY: cy,
        baseX: rt?.x ?? 0, baseY: rt?.y ?? 0, origX: tr.x, origY: tr.y
      };
      return;
    }

    const handle = !animMode && (e.target as Element).getAttribute?.("data-handle");
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
    if (recording && hit !== null && expanded) {
      // Gesture recording: follow the drag live, sample positions + timing.
      const rl = resolveLayerAt(expanded, [hit], timeMs);
      const t = rl?.transform as unknown as Record<string, number> | undefined;
      const baseX = t?.x ?? 0;
      const baseY = t?.y ?? 0;
      onSelect([hit]);
      onGestureStart();
      recordRef.current = { index: hit, startCx: cx, startCy: cy, baseX, baseY, startedAt: performance.now(), samples: [{ t: 0, x: baseX, y: baseY }] };
      return;
    }
    if (animMode) {
      // 动一动: the object stays at its start pose; a ghost + arrow follow the
      // cursor, and releasing turns the displacement into a two-keyframe move.
      if (hit === null) { onSelect([]); return; }
      onSelect([hit]);
      const rl = expanded ? resolveLayerAt(expanded, [hit], timeMs) : null;
      const box = rl ? localBox(rl, mediaSize) : null;
      const xf = rl ? xfOf(rl) : null;
      const c: [number, number] = box && xf ? localToParent(xf, box.x + box.w / 2, box.y + box.h / 2) : [cx, cy];
      const pts = box && xf ? boxCorners(box).map(([px, py]) => localToParent(xf, px, py)) : null;
      setAbDrag({ index: hit, sx: c[0], sy: c[1], pcx: cx, pcy: cy, dx: 0, dy: 0, pts });
      return;
    }
    if (e.shiftKey || e.metaKey) {
      if (hit !== null) onSelect([hit], true);
      return;
    }
    if (hit === null) { onSelect([]); return; }
    if (selTop !== hit && !multiSel.includes(hit)) onSelect([hit]);
    // Dragging any member of a multi-selection moves the whole set together.
    beginMove(multiSel.includes(hit) && multiSel.length > 1 ? multiSel : [hit], cx, cy);
  }

  function onPointerMove(e: React.PointerEvent): void {
    const rec = recordRef.current;
    if (rec && e.buttons) {
      const [cx, cy] = toComp(e);
      const nx = rec.baseX + (cx - rec.startCx);
      const ny = rec.baseY + (cy - rec.startCy);
      rec.samples.push({ t: performance.now() - rec.startedAt, x: nx, y: ny });
      onLivePatchTransform([{ index: rec.index, patch: { x: nx, y: ny } }]);
      return;
    }
    if (abDrag && e.buttons) {
      const [cx, cy] = toComp(e);
      setAbDrag({ ...abDrag, dx: cx - abDrag.pcx, dy: cy - abDrag.pcy });
      return;
    }
    const g = gestureRef.current;
    if (!g || !e.buttons) return;
    const [cx, cy] = toComp(e);
    if (g.kind === "move") {
      onLivePatchTransform(g.targets.map((t) => ({
        index: t.index,
        patch: {
          x: shiftTrack(t.origX, cx - g.startX, 0),
          y: shiftTrack(t.origY, cy - g.startY, 0)
        }
      })));
    } else if (g.kind === "kfdot") {
      onLivePatchTransform([{
        index: g.index,
        patch: {
          x: upsertKfArr(g.origX, g.timeTrack, g.baseX + (cx - g.startX)),
          y: upsertKfArr(g.origY, g.timeTrack, g.baseY + (cy - g.startY))
        }
      }]);
    } else if (g.kind === "panchor") {
      if (!selXf) return;
      const [lx, ly] = parentToLocal(selXf, cx, cy);
      const [sx0, sy0] = parentToLocal(selXf, g.startX, g.startY);
      const dx = lx - sx0, dy = ly - sy0;
      const src = g.model.anchors[g.ai]!;
      const moved: PathAnchor = {
        x: src.x + dx, y: src.y + dy,
        ...(src.in ? { in: [src.in[0] + dx, src.in[1] + dy] as [number, number] } : {}),
        ...(src.out ? { out: [src.out[0] + dx, src.out[1] + dy] as [number, number] } : {})
      };
      const anchors = [...g.model.anchors];
      anchors[g.ai] = moved;
      onLivePatchLayer(g.index, pathPatch({ ...g.model, anchors }));
    } else if (g.kind === "phandle") {
      if (!selXf) return;
      const [lx, ly] = parentToLocal(selXf, cx, cy);
      const anchors = [...g.model.anchors];
      anchors[g.ai] = { ...anchors[g.ai]!, [g.which]: [lx, ly] as [number, number] };
      onLivePatchLayer(g.index, pathPatch({ ...g.model, anchors }));
    } else if (g.kind === "scale") {
      const f = Math.max(0.02, Math.hypot(cx - g.originX, cy - g.originY) / g.startDist);
      onLivePatchTransform([{ index: g.index, patch: { scale: scaleTrack(g.origScale, f, 1) } }]);
    } else {
      const delta = ((Math.atan2(cy - g.originY, cx - g.originX) - g.startAngle) * 180) / Math.PI;
      onLivePatchTransform([{ index: g.index, patch: { rotate: shiftTrack(g.origRotate, delta, 0) } }]);
    }
  }

  function onPointerUp(): void {
    const rec = recordRef.current;
    if (rec) {
      recordRef.current = null;
      onRecorded(rec.index, rec.samples);
    }
    if (abDrag) {
      if (Math.hypot(abDrag.dx, abDrag.dy) > 6 * k) onAnimateMove(abDrag.index, abDrag.dx, abDrag.dy);
      setAbDrag(null);
    }
    gestureRef.current = null;
  }

  // Double-click drills into a group's child (e.g. to edit a card's gradient
  // rect directly) — hit test the resolved children in group-local space.
  function onDoubleClick(e: React.MouseEvent): void {
    if (pathEdit) {
      // Double-click a node: corner (straight neighbours) ⇄ smooth (tangent
      // handles at 1/3 of the neighbour distances).
      const aAttr = (e.target as Element).getAttribute?.("data-panchor");
      if (aAttr != null && pathModel && selTop !== undefined) {
        const ai = Number(aAttr);
        const A = pathModel.anchors;
        const a = A[ai]!;
        const anchors = [...A];
        if (a.in || a.out) {
          anchors[ai] = { x: a.x, y: a.y };
        } else {
          const prev = A[(ai - 1 + A.length) % A.length]!;
          const next = A[(ai + 1) % A.length]!;
          let tx = next.x - prev.x, ty = next.y - prev.y;
          const len = Math.hypot(tx, ty) || 1;
          tx /= len; ty /= len;
          const r = Math.max(8, Math.min(Math.hypot(next.x - a.x, next.y - a.y), Math.hypot(a.x - prev.x, a.y - prev.y)) / 3);
          anchors[ai] = { ...a, in: [a.x - tx * r, a.y - ty * r], out: [a.x + tx * r, a.y + ty * r] };
        }
        onCommitLayer(selTop, pathPatch({ ...pathModel, anchors }), "path-node-kind");
        setPathSel(ai);
      }
      return; // never drill into groups while editing nodes
    }
    const [cx, cy] = toComp(e);
    const hit = hitTest(cx, cy);
    if (hit === null || !expanded) return;
    const rl = resolveLayerAt(expanded, [hit], timeMs);
    if (!rl || rl.type !== "group") return;
    const children = (rl as unknown as { layers?: unknown }).layers as import("openhypercore").ResolvedLayer[] | undefined;
    if (!children?.length) return;
    const [lx, ly] = parentToLocal(xfOf(rl), cx, cy);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i]!;
      if (child.type === "audio") continue;
      const box = localBox(child, mediaSize);
      if (!box) continue;
      const [px, py] = parentToLocal(xfOf(child), lx, ly);
      if (pointInBox(box, px, py)) { onSelect([hit, i]); return; }
    }
  }

  // secondary outlines for the other members of a multi-selection
  const extraOutlines = multiSel
    .filter((i) => i !== selTop)
    .map((i) => {
      const rl = expanded ? resolveLayerAt(expanded, [i], timeMs) : null;
      const box = rl ? localBox(rl, mediaSize) : null;
      if (!rl || !box) return null;
      const xf = xfOf(rl);
      return { i, pts: boxCorners(box).map(([px, py]) => localToParent(xf, px, py)) };
    })
    .filter((o): o is { i: number; pts: [number, number][] } => o !== null);

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

  // ---- 动一动 quick-config bubble position (over the end pose) ---------------
  const bubblePos = useMemo(() => {
    if (!abBubble || !expanded) return null;
    const raw = layerAtPath(composition, [abBubble.index]);
    if (!raw) return null;
    const local = raw.type === "group" || raw.type === "plugin";
    const gT = local ? abBubble.t1 + ((raw.startMs as number) ?? 0) : abBubble.t1;
    const rl = resolveLayerAt(expanded, [abBubble.index], gT);
    if (!rl) return null;
    const box = localBox(rl, mediaSize);
    const xf = xfOf(rl);
    const [bx, by] = box ? localToParent(xf, box.x + box.w / 2, box.y) : [xf.x, xf.y];
    return { left: clamp(9, 91, (bx / W) * 100), top: clamp(6, 88, (by / H) * 100) };
  }, [abBubble, expanded, composition]); // eslint-disable-line react-hooks/exhaustive-deps

  // arrowhead for the live A→B drag
  const abArrow = abDrag && Math.hypot(abDrag.dx, abDrag.dy) > 2 * k ? (() => {
    const ex = abDrag.sx + abDrag.dx, ey = abDrag.sy + abDrag.dy;
    const ang = Math.atan2(abDrag.dy, abDrag.dx);
    const L = 15 * k;
    return {
      ex, ey,
      a1: [ex - L * Math.cos(ang - 0.42), ey - L * Math.sin(ang - 0.42)] as [number, number],
      a2: [ex - L * Math.cos(ang + 0.42), ey - L * Math.sin(ang + 0.42)] as [number, number]
    };
  })() : null;

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
        {error ? <div className="error-banner">{t("插件展开失败：")}{error}</div> : null}
        <div ref={wrapRef} className="canvas-wrap" style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc((100vh - 380px) * ${W / H}))` }}>
          <canvas ref={canvasRef} width={W} height={H} />
          <div className="hud-badge" style={{ top: 12, left: 12 }}><span className="hud-dot" />PREVIEW</div>
          <div className="hud-badge square" style={{ top: 12, right: 12 }}>{W}×{H} · {composition.fps}fps</div>
          {safeGuides ? <div className="safe-guides"><i /><i /></div> : null}
          <button className="hud-badge square" title={t("安全区参考线（5% / 10%）")}
            style={{ bottom: 12, right: 12, pointerEvents: "auto", cursor: "pointer", background: safeGuides ? "var(--accent-soft)" : "rgba(6,10,16,.66)", color: safeGuides ? "var(--accent)" : undefined }}
            onClick={() => setSafeGuides((s) => { localStorage.setItem("ohe.safeGuides", s ? "0" : "1"); return !s; })}>▦ {t("安全区")}</button>
          <svg ref={svgRef} className="stage-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
            style={animMode ? { cursor: "crosshair" } : undefined}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick}>
            {extraOutlines.map((o) => (
              <polygon key={o.i} points={o.pts.map((p) => p.join(",")).join(" ")}
                fill="none" stroke="var(--accent)" strokeWidth={1.2 * k} strokeDasharray={`${5 * k} ${4 * k}`} />
            ))}

            {/* motion path: golden trail + start/end ghosts + draggable keyframe dots */}
            {motion && !pathEdit ? (
              <g>
                {motion.gA ? (
                  <polygon points={motion.gA.map((p) => p.join(",")).join(" ")} pointerEvents="none"
                    fill="none" stroke="#8a93a6" strokeOpacity={0.55} strokeWidth={1.2 * k} strokeDasharray={`${4 * k} ${4 * k}`} />
                ) : null}
                {motion.gB ? (
                  <polygon points={motion.gB.map((p) => p.join(",")).join(" ")} pointerEvents="none"
                    fill="none" stroke="var(--gold)" strokeOpacity={0.5} strokeWidth={1.2 * k} strokeDasharray={`${4 * k} ${4 * k}`} />
                ) : null}
                <polyline points={motion.pts.map((p) => p.join(",")).join(" ")} pointerEvents="none"
                  fill="none" stroke="var(--gold)" strokeWidth={1.8 * k} strokeLinecap="round"
                  strokeDasharray={`${2.5 * k} ${6 * k}`} opacity={0.95} />
                {motion.dots.length ? (
                  <>
                    <text x={motion.dots[0]!.c[0]} y={motion.dots[0]!.c[1] - 12 * k} pointerEvents="none"
                      fontSize={12 * k} fill="#8a93a6" textAnchor="middle">{t("起点")}</text>
                    <text x={motion.dots[motion.dots.length - 1]!.c[0]} y={motion.dots[motion.dots.length - 1]!.c[1] - 12 * k} pointerEvents="none"
                      fontSize={12 * k} fill="var(--gold)" textAnchor="middle">{t("终点")}</text>
                  </>
                ) : null}
                {motion.dots.map((d) => (
                  <circle key={d.t} data-kfdot={d.t} cx={d.c[0]} cy={d.c[1]} r={5.5 * k}
                    fill="var(--gold)" stroke="#141821" strokeWidth={1.4 * k} style={{ cursor: "grab" }}>
                    <title>{t("关键帧 @ {ms}ms — 拖动改变位置", { ms: Math.round(d.t) })}</title>
                  </circle>
                ))}
              </g>
            ) : null}

            {outline && !pathEdit ? (
              <g>
                <polygon points={outline.map((p) => p.join(",")).join(" ")}
                  fill="none" stroke="var(--accent)" strokeWidth={1.6 * k} />
                {!animMode ? outline.map(([hx, hy], i) => (
                  <rect key={i} data-handle={`corner-${i}`} x={hx - 5 * k} y={hy - 5 * k} width={10 * k} height={10 * k}
                    fill="#fff" stroke="var(--accent)" strokeWidth={1.2 * k} style={{ cursor: "nwse-resize" }} />
                )) : null}
                {!animMode && rotateHandle ? (
                  <>
                    <line x1={(outline[0]![0] + outline[1]![0]) / 2} y1={(outline[0]![1] + outline[1]![1]) / 2}
                      x2={rotateHandle[0]} y2={rotateHandle[1]} stroke="var(--accent)" strokeWidth={1 * k} />
                    <circle data-handle="rotate" cx={rotateHandle[0]} cy={rotateHandle[1]} r={6 * k}
                      fill="#fff" stroke="var(--accent)" strokeWidth={1.2 * k} style={{ cursor: "grab" }} />
                  </>
                ) : null}
              </g>
            ) : null}

            {/* node editor: path outline with clickable segments, anchors, handles */}
            {pathEdit && pathModel && pathSegs && selXf ? (
              <g>
                {pathSegs.map((s) => (
                  <g key={s.i}>
                    <polyline points={s.pts.map((p) => p.join(",")).join(" ")} pointerEvents="none"
                      fill="none" stroke="var(--accent)" strokeWidth={1.5 * k} opacity={0.95} />
                    <polyline data-pseg={s.i} points={s.pts.map((p) => p.join(",")).join(" ")}
                      fill="none" stroke="transparent" strokeWidth={13 * k} pointerEvents="stroke" style={{ cursor: "copy" }}>
                      <title>{t("点击线段插入节点")}</title>
                    </polyline>
                  </g>
                ))}
                {pathSel !== null && pathModel.anchors[pathSel] ? (() => {
                  const a = pathModel.anchors[pathSel]!;
                  const ap = localToParent(selXf, a.x, a.y);
                  return (["in", "out"] as const).filter((w) => a[w]).map((w) => {
                    const hp = localToParent(selXf, a[w]![0], a[w]![1]);
                    return (
                      <g key={w}>
                        <line x1={ap[0]} y1={ap[1]} x2={hp[0]} y2={hp[1]} pointerEvents="none"
                          stroke="#3dd6c7" strokeWidth={1.1 * k} />
                        <circle data-phandle={`${pathSel}:${w}`} cx={hp[0]} cy={hp[1]} r={4.6 * k}
                          fill="#3dd6c7" stroke="#10141c" strokeWidth={1.3 * k} style={{ cursor: "grab" }}>
                          <title>{t("拖动调整曲线弯度")}</title>
                        </circle>
                      </g>
                    );
                  });
                })() : null}
                {pathModel.anchors.map((a, i) => {
                  const p = localToParent(selXf, a.x, a.y);
                  const curved = Boolean(a.in ?? a.out);
                  return (
                    <rect key={i} data-panchor={i} x={p[0] - 5.2 * k} y={p[1] - 5.2 * k}
                      width={10.4 * k} height={10.4 * k} rx={curved ? 5.2 * k : 1.6 * k}
                      fill={i === pathSel ? "var(--gold)" : "#fff"} stroke="#10141c" strokeWidth={1.4 * k}
                      style={{ cursor: "grab" }}>
                      <title>{t("拖动移动 · 双击 直线⇄曲线 · ⌫ 删除节点")}</title>
                    </rect>
                  );
                })}
              </g>
            ) : null}

            {/* 动一动 live drag: ghost of the target pose + A→B arrow */}
            {abDrag && abArrow ? (
              <g pointerEvents="none">
                {abDrag.pts ? (
                  <polygon points={abDrag.pts.map(([px, py]) => `${px + abDrag.dx},${py + abDrag.dy}`).join(" ")}
                    fill="var(--accent)" fillOpacity={0.13} stroke="var(--accent)" strokeWidth={1.4 * k}
                    strokeDasharray={`${6 * k} ${4 * k}`} />
                ) : null}
                <line x1={abDrag.sx} y1={abDrag.sy} x2={abArrow.ex} y2={abArrow.ey}
                  stroke="var(--gold)" strokeWidth={2.4 * k} strokeDasharray={`${9 * k} ${6 * k}`} strokeLinecap="round" />
                <circle cx={abDrag.sx} cy={abDrag.sy} r={5 * k} fill="var(--gold)" />
                <polygon points={`${abArrow.ex},${abArrow.ey} ${abArrow.a1.join(",")} ${abArrow.a2.join(",")}`} fill="var(--gold)" />
              </g>
            ) : null}
          </svg>

          {/* 动一动 quick-config bubble — every change replays instantly */}
          {abBubble && bubblePos ? (
            <div className="ab-bubble" style={{ left: `${bubblePos.left}%`, top: `${bubblePos.top}%` }}
              onPointerDown={(e) => e.stopPropagation()}>
              <div className="ab-title">{t("移动动画已生成")}<span>{t("调节即回放")}</span></div>
              <label className="ab-row">
                <span>{t("时长")}</span>
                <input type="range" min={200} max={3000} step={100}
                  value={abBubble.t1 - abBubble.t0} onChange={(e) => onAbDur(Number(e.target.value))} />
                <b>{((abBubble.t1 - abBubble.t0) / 1000).toFixed(1)}s</b>
              </label>
              <div className="ab-row">
                <span>{t("节奏")}</span>
                {(["linear", "emph", "back"] as AbEase[]).map((ez) => (
                  <button key={ez} className={`ab-chip${abBubble.ease === ez ? " active" : ""}`}
                    onClick={() => onAbEase(ez)}>{t(AB_EASE_LABEL[ez])}</button>
                ))}
              </div>
              <div className="ab-row">
                <button className="ab-chip" onClick={onAbReplay}>↺ {t("重播")}</button>
                <button className="ab-chip danger" onClick={onAbRemove}>{t("删除")}</button>
                <span style={{ flex: 1 }} />
                <button className="ab-done" onClick={onAbDone}>{t("完成 ✓")}</button>
              </div>
            </div>
          ) : null}

          <div className="stage-fabs">
            {selTop !== undefined && !selIsAudio && !pathEdit ? (
              <button className={`stage-fab${animMode ? " active" : ""}`} onClick={onToggleAnimMode}
                title={t("动一动：把选中的物体拖到它要去的位置，松手即生成移动动画")}>
                {animMode ? t("✕ 退出动一动") : t("✦ 动一动")}
              </button>
            ) : null}
            {selTop !== undefined && selPathD && !animMode && (pathEdit || parsePathD(selPathD) !== null) ? (
              <button className={`stage-fab${pathEdit ? " active" : ""}`} onClick={onTogglePathEdit}
                title={t("节点编辑：拖动节点改形状，点击线段插入节点，双击节点切换直线/曲线")}>
                {pathEdit ? t("✓ 完成节点编辑") : t("✎ 编辑节点")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="stage-hint" style={recording ? { color: "var(--danger)" } : animMode ? { color: "var(--gold)" } : undefined}>
          {recording ? t("● 录制中：按住图层拖出运动轨迹，松开生成关键帧")
            : pathEdit ? t("✎ 节点编辑：拖动节点 · 拖动青色圆点调曲线 · 点击线段插入节点 · 双击节点 直线⇄曲线 · ⌫ 删除")
            : animMode ? t("✦ 动一动：把物体拖到它要去的位置，松手即生成动画（当前位置 = 起点）")
              : selIsAudio ? t("音频图层没有画面 — 在时间轴/检查器中编辑")
                : selTop !== undefined ? t("拖动移动 · 角点缩放 · 顶部圆点旋转 · 金色圆点 = 可拖的动画关键帧 · 双击进组")
                  : t("点击图层选中 · 拖入文件添加素材 · 空格播放")}
        </div>
      </div>
    </div>
  );
}
