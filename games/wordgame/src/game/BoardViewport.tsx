// The zoomable window onto the board. Two fingers pinch AND pan (the point
// under the fingers stays put); one finger is deliberately inert here — it
// belongs to tap and drag. Double-tap resets. touch-action is none: the
// app-shell layout doesn't scroll, so the browser gets no gestures at all.

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { IDENTITY, pinch, type BoardTransform, type Point } from './boardTransform';

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;

export function BoardViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<BoardTransform>(IDENTITY);
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  const local = (e: ReactPointerEvent): Point => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const down = (e: ReactPointerEvent) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size !== 1) return;
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
    if (before === undefined || pointers.current.size !== 2) return;
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId);
    if (other === undefined) return;
    const after = local(e);
    const r = ref.current?.getBoundingClientRect();
    setT((prev) => pinch(prev, before, other[1], after, other[1], r?.width ?? 0, r?.height ?? 0));
    pointers.current.set(e.pointerId, after);
  };

  const up = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

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
