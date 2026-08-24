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
  walker: string | null = null,
  /**
   * Whether to walk it at all. The device that just tapped this path out and
   * committed it has already watched it happen — replaying it there doubles
   * the move. False lands the playback complete on the first render: the
   * whole path shown, `done` true, nothing gated on it ever closed.
   */
  animate: boolean = true
): { shown: readonly NodeId[]; done: boolean; skip: () => void } {
  const [at, setAt] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Identity changes every render for a derived array, so key on the content.
  const key = path === null ? '' : `${walker ?? ''}|${path.join('|')}`;

  useEffect(() => {
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    if (!animate) { setAt(path === null ? 0 : Math.max(0, path.length - 1)); return; }
    setAt(0);
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
    // `key` changes whenever `path` does, so it stands in for it here.
    // Depending on `path` directly would clear and restart the interval on
    // every render that rebuilt the array, and playback would never advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stepMs, animate]);

  const skip = useCallback(() => {
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    setAt(path === null ? 0 : Math.max(0, path.length - 1));
    // `key` changes whenever `path` does — it is the token this hook uses to
    // mean "a new path" — so depending on both would hand every caller a new
    // `skip` identity on each render for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Derived, not waited for: an unanimated playback is complete on the very
  // first render, so nothing gated on `done` ever closes for it — not even
  // for the one frame before the effect above has run.
  const shown = path === null ? [] : animate ? path.slice(0, at + 1) : path;
  return { shown, done: path === null || !animate || at >= path.length - 1, skip };
}
