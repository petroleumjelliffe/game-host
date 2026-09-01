// The zoomable window onto the board. Two fingers pinch AND pan (the point
// under the fingers stays put); ONE finger pans too, but only while zoomed
// past 1× (feedback 2026-09-01) — at rest it stays inert so taps and drags
// keep the board. A press that starts on a staged tile never reaches this
// element (GameScreen stops its propagation), so dragging a tile and
// panning the board can't fight over the same finger. Double-tap resets.
// touch-action is none: the app-shell layout doesn't scroll, so the
// browser gets no gestures at all.

import {
  useEffect, useRef, useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { clampTransform, IDENTITY, pinch, type BoardTransform, type Point } from './boardTransform';

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;
// Under this, a moving finger is still a tap; past it, it's a pan and the
// trailing click gets swallowed so a pan can never stage or recall a tile.
const PAN_SLOP = 8;

export function BoardViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<BoardTransform>(IDENTITY);
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const panStart = useRef<Point | null>(null);
  const panned = useRef(false);

  const local = (e: ReactPointerEvent): Point => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const down = (e: ReactPointerEvent) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size !== 1) return;
    panStart.current = p;
    panned.current = false;
    const now = Date.now();
    const prev = lastTap.current;
    if (prev !== null && now - prev.at < DOUBLE_TAP_MS && Math.hypot(p.x - prev.x, p.y - prev.y) < DOUBLE_TAP_SLOP) {
      setT(IDENTITY);
      lastTap.current = null;
    } else {
      lastTap.current = { at: now, ...p };
    }
  };

  const move = (e: ReactPointerEvent) => {
    const before = pointers.current.get(e.pointerId);
    if (before === undefined) return;
    const after = local(e);
    const r = ref.current?.getBoundingClientRect();

    if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId);
      if (other === undefined) return;
      setT((prev) => pinch(prev, before, other[1], after, other[1], r?.width ?? 0, r?.height ?? 0));
      pointers.current.set(e.pointerId, after);
      return;
    }

    if (pointers.current.size !== 1) return;
    pointers.current.set(e.pointerId, after);
    if (t.scale <= 1) return; // at rest one finger belongs to tap and drag
    const start = panStart.current;
    if (start !== null && Math.hypot(after.x - start.x, after.y - start.y) >= PAN_SLOP) {
      panned.current = true;
      lastTap.current = null; // a pan is not the first half of a double-tap
    }
    setT((prev) => clampTransform({
      scale: prev.scale,
      tx: prev.tx + (after.x - before.x),
      ty: prev.ty + (after.y - before.y),
    }, r?.width ?? 0, r?.height ?? 0));
  };

  const up = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  /** The click that trails a pan lands on whatever cell the finger stopped
   * over — swallow it in the capture phase before any button sees it. */
  const clickCapture = (e: ReactMouseEvent) => {
    if (!panned.current) return;
    panned.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // A finger that goes down on the board can come UP anywhere — e.g. a tile
  // drag released over the rack. That up never bubbles through this element,
  // so without a window-level cleanup the pointer would leak in the map and
  // a later lone finger could read as the second half of a pinch.
  useEffect(() => {
    const drop = (e: PointerEvent) => { pointers.current.delete(e.pointerId); };
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
    return () => {
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-testid="board-viewport"
      className="h-full w-full overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClickCapture={clickCapture}
    >
      <div
        data-testid="board-transform"
        className="w-full"
        style={{ transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`, transformOrigin: '0 0' }}
      >
        {children}
      </div>
    </div>
  );
}
