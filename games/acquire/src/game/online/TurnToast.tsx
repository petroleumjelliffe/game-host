import { useEffect, useState } from 'react';

/**
 * Whose turn it is, said so you cannot miss it.
 *
 * Pass-and-play never needs this: the curtain between turns *is* the
 * announcement, and it covers the whole screen with the next player's name on
 * it. Online there is no curtain — everyone watches the same board the whole
 * time — and the first by-hand session found the gap immediately: the only
 * signal that it was someone else's turn was one line of grey text in the
 * panel, and the report was "I can't see whose turn it is."
 *
 * Two forms, and the difference between them is not cosmetic. **Someone else
 * being up is a standing fact**, true until it stops being true, so that form
 * persists. **Your turn arriving is an event**, and an event left on screen
 * for the rest of the turn becomes a banner competing with the panel that
 * already says what to do — so that form announces itself and goes.
 *
 * Deliberately no "…is placing a tile": a watcher's state only advances when a
 * segment commits, so a stage label here would be frozen at whatever the last
 * commit said, claiming to be live while being stale. Who is up *is* live — it
 * changes on exactly the commits this client receives.
 *
 * It sits at the top centre, clear of both columns: the board is centred in
 * the left column and its top row must stay readable, and the panel's own
 * controls run down the right. `pointer-events-none` so it can never eat a
 * click meant for the tile underneath it.
 */
export interface TurnToastProps {
  /** The player being waited on. */
  name: string;
  emoji?: string;
  /** True when that player is the one at this device. */
  mine?: boolean;
  /**
   * True when the player being waited on has no live socket.
   *
   * The unexplained stall is the actual complaint: the game waits
   * indefinitely by design (no turn timeouts), so the only thing missing is
   * saying why nothing is happening.
   */
  disconnected?: boolean;
}

/**
 * How long the your-turn announcement stays: long enough to catch out of the
 * corner of an eye, short enough not to become furniture. Under
 * `prefers-reduced-motion` it still appears and still goes — the timing is the
 * message, not the motion — while `.step-enter`'s own media rule drops the
 * animation.
 */
const ANNOUNCEMENT_MS = 2600;

export function TurnToast({ name, emoji, mine = false, disconnected = false }: TurnToastProps) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!mine) return;
    const timer = setTimeout(() => setDone(true), ANNOUNCEMENT_MS);
    return () => clearTimeout(timer);
  }, [mine]);

  // The caller remounts this whenever the turn changes hands, so `done` is
  // per-turn rather than once per game.
  if (mine && done) return null;

  return (
    <div
      data-testid="turn-toast"
      data-turn={mine ? 'mine' : 'theirs'}
      role="status"
      aria-live="polite"
      className={
        'step-enter pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 ' +
        'items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg ' +
        (mine ? 'bg-blue-600' : 'bg-slate-900/90')
      }
    >
      <span aria-hidden className="text-base leading-none">{emoji || '•'}</span>
      <span>{mine ? 'Your turn' : `${name} is up${disconnected ? ' — disconnected' : ''}`}</span>
    </div>
  );
}
