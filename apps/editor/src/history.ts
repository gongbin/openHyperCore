import { useCallback, useRef, useState } from "react";
import type { Composition } from "openhypercore";

const MAX_DEPTH = 120;
const COALESCE_MS = 900;

export type History = {
  comp: Composition;
  /** Discrete edit — pushes an undo snapshot. Same-tag edits within ~1s coalesce. */
  set: (next: Composition, tag?: string) => void;
  /** Start a drag gesture: snapshot once, then feed updates through live(). */
  begin: () => void;
  /** Update the present without pushing history (used during drags). */
  live: (next: Composition) => void;
  /** Replace everything (open project / new project) and clear history. */
  reset: (next: Composition) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useHistory(initial: Composition): History {
  const [state, setState] = useState({ present: initial, past: [] as Composition[], future: [] as Composition[] });
  const lastTag = useRef<{ tag: string; at: number } | null>(null);

  const set = useCallback((next: Composition, tag?: string) => {
    const now = Date.now();
    const coalesce = tag !== undefined && lastTag.current?.tag === tag && now - lastTag.current.at < COALESCE_MS;
    lastTag.current = tag !== undefined ? { tag, at: now } : null;
    setState((s) => ({
      present: next,
      past: coalesce ? s.past : [...s.past.slice(-MAX_DEPTH + 1), s.present],
      future: []
    }));
  }, []);

  const begin = useCallback(() => {
    lastTag.current = null;
    setState((s) => ({ ...s, past: [...s.past.slice(-MAX_DEPTH + 1), s.present], future: [] }));
  }, []);

  const live = useCallback((next: Composition) => {
    setState((s) => ({ ...s, present: next, future: [] }));
  }, []);

  const reset = useCallback((next: Composition) => {
    lastTag.current = null;
    setState({ present: next, past: [], future: [] });
  }, []);

  const undo = useCallback(() => {
    lastTag.current = null;
    setState((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { present: prev, past: s.past.slice(0, -1), future: [s.present, ...s.future] };
    });
  }, []);

  const redo = useCallback(() => {
    lastTag.current = null;
    setState((s) => {
      const next = s.future[0];
      if (!next) return s;
      return { present: next, past: [...s.past, s.present], future: s.future.slice(1) };
    });
  }, []);

  return {
    comp: state.present,
    set, begin, live, reset, undo, redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0
  };
}
