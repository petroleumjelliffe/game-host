// The bind hook, shared: ties this device's notification profile to its
// seat so the server can reach the right person — and, since the invites
// work, stamps the profile's display name and reports *where* the binder
// is. Lobby binds feed the picker's "already in this room" and the invite
// fan-out; only playing binds write the co-player ledger (the server
// enforces that split — the phase is a hint about timing, not a privilege).
//
// Fire-and-forget on purpose: a standalone dev server 404s /notify and
// that costs nothing.

import { useEffect } from 'react';
import { getPlayerKey } from './playerKey.js';
import { notifyPost } from './api.js';

export interface BindIdentity {
  playerId: string;
  token: string;
  /** The name used in this room; stamps the profile, last-writer-wins. */
  name?: string | null;
}

export interface BindArgs {
  /** The game's notify id, e.g. 'wordgame'. */
  game: string;
  roomId: string;
  /** Null while not seated — nothing is sent. */
  phase: 'lobby' | 'playing' | null;
  /** Null while no identity exists — nothing is sent. */
  identity: BindIdentity | null;
}

export function useNotifyBind(args: BindArgs): void {
  const { game, roomId, phase } = args;
  const playerId = args.identity?.playerId;
  const token = args.identity?.token;
  const name = args.identity?.name ?? null;

  useEffect(() => {
    if (phase === null || roomId === '' || playerId === undefined || token === undefined) return;
    const playerKey = getPlayerKey();
    if (playerKey === null) return;
    void notifyPost('/bind', {
      playerKey,
      game,
      roomId,
      playerId,
      token,
      phase,
      ...(name === null || name === '' ? {} : { name }),
    }).catch(() => {});
    // `phase` in the deps is the point: the lobby→playing transition
    // re-binds, and that second bind is the one that writes the ledger.
  }, [game, roomId, phase, playerId, token, name]);
}
