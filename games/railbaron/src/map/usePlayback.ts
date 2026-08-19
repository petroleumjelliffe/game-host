import { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeId } from '../../engine';

/** A dot a second is too slow to watch and too fast to follow; this is the middle. */
export const PLAYBACK_MS = 100;

/**
 * Walks a committed path one node at a time.
 *
 * The path comes from the log, not from the draft, so the tab that played the
 * turn and the tab watching it walk the same pawn over the same dots. A tap
 * finishes it early — the same rule the board already applies to a flap.
 */
export function usePlayback(
  path: readonly NodeId[] | null,
  stepMs: number = PLAYBACK_MS,
  /**
   * Who walked it, or anything else that tells one committed leg from the
   * next. The dots alone do not: two barons may walk the same sequence
   * back-to-back — the second following the first onto the same line is
   * ordinary play — and keyed on the path alone the second walk never
   * animated at all. The caller knows which leg this is; the hook cannot.
   */
  walker: string | null = null
): { shown: readonly NodeId[]; done: boolean; skip: () => void } {
  const [at, setAt] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Identity changes every render for a derived array, so key on the content.
  const key = path === null ? '' : `${walker ?? ''}|${path.join('|')}`;

  useEffect(() => {
    setAt(0);
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    if (path === null || path.length === 0) return;
    timer.current = setInterval(() => {
      setAt(current => {
        const next = current + 1;
        if (next >= path.length - 1 && timer.current !== null) {
          clearInterval(timer.current);
          timer.current = null;
        }
        return Math.min(next, path.length - 1);
      });
    }, stepMs);
    return () => {
      if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stepMs]);

  const skip = useCallback(() => {
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    setAt(path === null ? 0 : Math.max(0, path.length - 1));
  }, [key]);

  const shown = path === null ? [] : path.slice(0, at + 1);
  return { shown, done: path === null || at >= path.length - 1, skip };
}
