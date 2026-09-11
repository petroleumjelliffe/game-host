// server/summaries.ts
// What the entry screen's game list is drawn from. Token-verified per row —
// the same seat check the notify service makes — and returning `known:false`
// for bad token and missing room alike, so the endpoint cannot be used to
// probe which codes exist. Built by hand rather than through viewFor: a
// summary has no field a rack could ride in.

import type { Request, Response } from 'express';
import { MAX_PLAYERS } from '../engine/constants.js';
import type { RoomSummary } from '../session/protocol.js';
import type { RoomRegistry } from './rooms.js';

/** The notify reporter's per-room read, or nothing when no service is mounted. */
export type NudgeStateReader = (roomId: string) => 'unreachable' | 'waiting' | 'ready' | 'reminded' | null;

// Cap the per-request workload: 20 covers any honest device's localStorage
// several times over, and extra entries are dropped rather than erroring so
// a wild client still gets its first 20 answered (documented 2026-08-31;
// the silent-drop shape was a review finding on the redesign branch).
const MAX_ROOMS = 20;

export function summariesHandler(
  rooms: Pick<RoomRegistry, 'get'>,
  nudgeState: NudgeStateReader = () => null,
) {
  return (req: Request, res: Response): void => {
    const body: unknown = req.body;
    const list = (typeof body === 'object' && body !== null && Array.isArray((body as Record<string, unknown>).rooms))
      ? ((body as Record<string, unknown>).rooms as unknown[]).slice(0, MAX_ROOMS)
      : null;
    if (list === null) { res.status(400).json({ error: 'rooms: [{roomId, playerId, token}] required' }); return; }

    const summaries: RoomSummary[] = list.map((entry): RoomSummary => {
      const row = (typeof entry === 'object' && entry !== null) ? entry as Record<string, unknown> : {};
      const roomId = typeof row.roomId === 'string' ? row.roomId : '';
      const notFound: RoomSummary = { roomId, known: false };

      const playerId = row.playerId;
      const token = row.token;
      if (typeof playerId !== 'string' || typeof token !== 'string') return notFound;

      const room = rooms.get(roomId);
      if (room === undefined) return notFound;
      const seat = room.players.find((p) => p.id === playerId);
      if (seat === undefined || seat.token !== token) return notFound;

      const state = room.state();
      const currentId = room.actorId();
      const lifecycle = room.lifecycle();
      const log = state?.log ?? [];
      const last = log[log.length - 1];
      const lastName = last === undefined ? null
        : state?.players.find((p) => p.id === last.playerId)?.name ?? null;

      return {
        roomId,
        known: true,
        lifecycle,
        capacity: MAX_PLAYERS,
        players: room.players.map((p) => ({
          name: p.name,
          score: state?.players.find((sp) => sp.id === p.id)?.score ?? null,
          isHost: p.isHost,
          isYou: p.id === playerId,
          isCurrent: currentId === p.id,
          isWinner: state?.final?.winnerIds.includes(p.id) ?? false,
        })),
        yourTurn: currentId === playerId,
        currentPlayerName: state?.players.find((p) => p.id === currentId)?.name ?? null,
        lastMove: last === undefined || lastName === null ? null : {
          name: lastName,
          kind: last.kind,
          word: last.words?.[0]?.word ?? null,
          score: last.score,
          at: last.at ?? null,
        },
        winnerNames: state?.final === undefined ? null
          : state.final.winnerIds.map((id) => state.players.find((p) => p.id === id)?.name ?? id),
        // Only a turn in progress has a reminder state; a finished game's
        // stale marker (cleared by the null turnChanged, but belt and
        // braces) must never put a Nudge on a FINISHED card.
        nudge: lifecycle === 'playing' ? nudgeState(roomId) : null,
      };
    });
    res.json({ summaries });
  };
}
