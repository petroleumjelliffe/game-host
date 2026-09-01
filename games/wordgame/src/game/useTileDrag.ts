// The drag lifecycle: a press becomes a drag only after DRAG_THRESHOLD px,
// so every existing tap stays a tap. Listeners live on window — jsdom has
// no setPointerCapture, and on touch the events land there anyway once the
// source element sets touch-action: none. The pointerId guard tolerates
// undefined because jsdom's synthetic events may omit it.

import { useEffect, useRef, useState } from 'react';
import type { Point } from './boardTransform';
import type { DragSource } from './dragPlan';

const DRAG_THRESHOLD = 8;

export interface DragState {
  source: DragSource;
  x: number;
  y: number;
  /** Where the press began — consumers read the drag direction off x − ox. */
  ox: number;
  oy: number;
  active: boolean;
}

interface InternalDrag extends DragState { pointerId: number | undefined }

export function useTileDrag(onDrop: (source: DragSource, p: Point) => void) {
  const [drag, setDrag] = useState<InternalDrag | null>(null);
  const dragRef = useRef<InternalDrag | null>(null);
  dragRef.current = drag;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const swallowClick = useRef(false);

  const start = (source: DragSource, e: { clientX: number; clientY: number; pointerId?: number }) => {
    setDrag({ source, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, pointerId: e.pointerId, active: false });
  };

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const samePointer = (e: PointerEvent) => {
      const id = dragRef.current?.pointerId;
      return id === undefined || e.pointerId === undefined || e.pointerId === id;
    };
    const move = (e: PointerEvent) => {
      if (!samePointer(e)) return;
      setDrag((d) => d === null ? null : {
        ...d,
        x: e.clientX,
        y: e.clientY,
        active: d.active || Math.hypot(e.clientX - d.ox, e.clientY - d.oy) >= DRAG_THRESHOLD,
      });
    };
    const up = (e: PointerEvent) => {
      if (!samePointer(e)) return;
      const d = dragRef.current;
      setDrag(null);
      if (d !== null && d.active) {
        swallowClick.current = true;
        onDropRef.current(d.source, { x: e.clientX, y: e.clientY });
      }
    };
    // A second finger mid-drag means a pinch is starting — abort, drop nothing.
    const down = (e: PointerEvent) => { if (!samePointer(e)) setDrag(null); };
    const cancel = () => { setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [dragging]);

  /** True exactly once after a completed drag — tap handlers call this
   * first to swallow the click the browser fires on the source element. */
  const consumeDragClick = () => {
    const v = swallowClick.current;
    swallowClick.current = false;
    return v;
  };

  return { drag: drag as DragState | null, start, consumeDragClick };
}
