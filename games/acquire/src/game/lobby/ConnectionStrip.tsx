import { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../../../vendor/lobby/client/connection';

/**
 * How long a connect may take before it is worth explaining.
 *
 * Short enough that nobody watches an unexplained pill for long; long enough
 * that an ordinary blip — a laptop lid, a tunnel — never triggers the longer
 * copy and makes a two-second reconnect sound like a thirty-second one.
 */
const EXPLAIN_AFTER_MS = 3000;

/**
 * Whether this device has a network at all.
 *
 * `navigator.onLine` is a one-way signal and is used as one: **false is
 * definitive** — there is no network, so nothing about the server can be
 * true yet — while **true only means an interface is up**, not that the
 * server is reachable. That asymmetry is exactly what is wanted here. The
 * pill may only blame the server when the device is at least on a network.
 */
function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    // Read again here, not just in the `useState` initializer above: the
    // initializer runs at render time, and this effect attaches its
    // listeners strictly later — render, then commit, then effects. An
    // `offline` event landing in that gap is missed by the listeners (they
    // do not exist yet) and never seen by the initializer (it already ran).
    // This line is what still catches it. No test exercises this gap today
    // — reproducing "the event lands between render and effect attachment"
    // needs control over React's own commit timing that this suite does not
    // have — so it stays covered by inspection, not by a red/green test.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

/**
 * Connection state, and only inside the room.
 *
 * Its predecessor was fixed across every route, which put a bar over the top
 * of pass-and-play and the catalog — neither of which has a server to be
 * disconnected from. A centred pill rather than a full-width bar, because the
 * board underneath it is the thing the player is trying to read.
 *
 * Three things it can say:
 *
 * - **No network.** `navigator.onLine` is `false`. Nothing else can be said
 *   honestly, because no claim about the server has been tested.
 * - **A long wait, cause unstated.** We are on a network and the connect is
 *   taking longer than an ordinary blip. The copy deliberately asserts no
 *   cause (ruled 2026-08-07, closing Phase 4's Finding 2): from here, a
 *   sleeping Render instance, a phone on cellular holding a LAN address, a
 *   captive portal and a wrong `VITE_SERVER_URL` are all indistinguishable —
 *   and the previous copy, "Waking the server — this can take up to 30
 *   seconds", named the first for all four. It was found doing exactly that
 *   by hand, on a phone whose wifi was off but whose cellular was on:
 *   `navigator.onLine` correctly read `true`, and the pill blamed a server
 *   the network could not even route to. What the change costs is the
 *   30-second reassurance, which was genuinely true and useful in the one
 *   case (Render free's cold start) out of the four.
 * - **Connecting / reconnecting.** The ordinary short wait.
 *
 * Saying "waking the server" while the device has no network *at all* was
 * the original bug this file fixed: it asserted a cause that had not been
 * established, about a server the device had not even tried to reach.
 */
export function ConnectionStrip({ status }: { status: ConnectionStatus }) {
  const [slow, setSlow] = useState(false);
  const online = useOnline();

  // Declared above the early return, because hooks cannot run conditionally.
  useEffect(() => {
    if (status === 'open') {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), EXPLAIN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === 'open') return null;

  // Offline outranks the timer. A device with no network has not been waiting
  // on the server at all, however long it has been waiting.
  const message = !online
    ? 'No network — waiting for this device to reconnect'
    : slow
      ? 'Can’t reach the server — retrying'
      : status === 'connecting' ? 'Connecting…' : 'Disconnected — reconnecting…';

  return (
    <div
      data-testid="connection-strip"
      role="status"
      className="fixed left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white shadow-lg"
    >
      {message}
    </div>
  );
}
