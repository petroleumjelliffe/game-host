// The entry list: every room this device holds a seat in, summarized by the
// server. One POST per mount — the list is a lobby, not a live view; the
// room page is where live state lives. A room the server disowns gets its
// identity cleared so it never haunts the list again.

import { useEffect, useState } from 'react';
import { listRooms, clearIdentity } from '../net/identity';
import type { RoomSummary } from '../../session/protocol';

/** The list only ever holds rooms the server still knows about — the
 * `known: false` half of the wire type is handled and discarded before it
 * reaches a consumer, so every card here can read `summary.lifecycle`
 * without renarrowing the union first. */
export interface MyGame {
  roomId: string;
  summary: Extract<RoomSummary, { known: true }>;
}

// The endpoint lives under the game's base path; the client stays
// origin-relative by addressing it through Vite's own base. BASE_URL arrives
// verbatim from the config — '/wordgame', no trailing slash — so it is
// normalized before joining, the same way connection.ts builds the socket
// path and register.ts the worker's. Trusting the slash is how the entry
// list shipped fetching '/wordgameapi/summaries' and came up empty on every
// deployment (2026-08-31). A function rather than a module constant so the
// regression test can pin the build's real, slashless value via stubEnv —
// under vitest BASE_URL is '/', which is exactly how the bug got past the
// suite the first time.
const summariesUrl = () =>
  `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}api/summaries`;

export function useMyGames(): { games: MyGame[] | null } {
  const [games, setGames] = useState<MyGame[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const rooms = listRooms();
    if (rooms.length === 0) { setGames([]); return; }
    void (async () => {
      try {
        const res = await fetch(summariesUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rooms: rooms.map((r) => ({
              roomId: r.roomId,
              playerId: r.identity.playerId,
              token: r.identity.token,
            })),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { summaries: RoomSummary[] };
        if (cancelled) return;
        const known: MyGame[] = [];
        for (const s of body.summaries) {
          if (s.known) known.push({ roomId: s.roomId, summary: s });
          else clearIdentity(s.roomId);
        }
        setGames(known);
      } catch {
        // Standalone dev server (404) or a blip: an empty list, not an error
        // page — the New room door still works.
        if (!cancelled) setGames([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { games };
}
