// The entry list: restore first, then list. Restore (spec 2026-09-09
// §Restore) asks the notify service for every seat the person behind this
// device's key holds and writes each into the identity store — so a
// freshly installed app that has signed in lists the same games Safari
// does. Then the summaries call runs exactly as before over whatever the
// store holds. A room the server disowns gets its identity cleared so it
// never haunts the list again.
//
// Re-run on visibility, not on an interval: the iOS sign-in flow is "leave
// for Mail, tap the link, come back", and a backgrounded app runs no timers.

import { useCallback, useEffect, useState } from 'react';
import { fetchMine, type MineInvite } from '@game-host/notify/client/api';
import { listRooms, clearIdentity, saveIdentity } from '../net/identity';
import { getPlayerKey } from '../notify/playerKey';
import { GAME_ID } from '../notify/gameId';
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

export function useMyGames(): {
  games: MyGame[] | null;
  /** Live invites to this game addressed to the person. */
  invites: MineInvite[];
  /** The signed-in address, or null. */
  address: string | null;
  /** True once /notify/me answered at all; false on the standalone dev server. */
  signedInKnown: boolean;
  refresh(): void;
} {
  const [games, setGames] = useState<MyGame[] | null>(null);
  const [invites, setInvites] = useState<MineInvite[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [signedInKnown, setSignedInKnown] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const refresh = useCallback(() => { setEpoch((e) => e + 1); }, []);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const playerKey = getPlayerKey();
      const mine = playerKey === null ? null : await fetchMine(playerKey);
      if (cancelled) return;
      if (mine !== null) {
        for (const seat of mine.seats) {
          if (seat.game !== GAME_ID) continue;
          saveIdentity(seat.roomId, { playerId: seat.playerId, token: seat.token, name: seat.name });
        }
        setAddress(mine.address);
        setInvites(mine.invites.filter((i) => i.game === GAME_ID));
        setSignedInKnown(true);
      }

      const rooms = listRooms();
      if (rooms.length === 0) { setGames([]); return; }
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
      } catch (error) {
        // Standalone dev server (404) or a blip: an empty list, not an error
        // page — the New room door still works. But say what was swallowed:
        // this fallback once made a 100%-of-deployments 404 look like an
        // empty lobby (2026-08-31), and a named URL in the console is what
        // finally told it apart from "no games".
        console.warn(`[wordgame] game list unavailable (${summariesUrl()}):`, error);
        if (!cancelled) setGames([]);
      }
    })();
    return () => { cancelled = true; };
  }, [epoch]);

  return { games, invites, address, signedInKnown, refresh };
}
