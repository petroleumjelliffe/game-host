// The match around the sim: rounds, scores, whose turn it is to be Marco.
// Still socket-free — `gameHandlers.ts` owns the wire.

import type { Lifecycle } from '@game-host/lobby/protocol/protocol.js';
import type { SeatHolder } from '@game-host/lobby/server/rooms.js';
import type { GameEvent } from '../protocol/game.js';
import { pickNextMarco, survivors } from './sim/rounds.js';
import { createRound, tick, type SimState } from './sim/sim.js';

export interface MarcoPoloRoom {
  id: string;
  players: SeatHolder[];
  begun: boolean;
  round: number;
  between: boolean;
  sim: SimState | null;
  nextMarcoId: string | null;
  scores: Record<string, number>;
  lastMarcoRound: Record<string, number>;
  lifecycle(): Lifecycle;
}

export function makeRoom(id: string, players: SeatHolder[]): MarcoPoloRoom {
  return {
    id,
    players,
    begun: false,
    round: 0,
    between: false,
    sim: null,
    nextMarcoId: null,
    scores: {},
    lastMarcoRound: {},
    lifecycle() {
      // No 'over': a match runs until the group walks away.
      return this.begun ? 'playing' : 'lobby';
    },
  };
}

function beginRound(room: MarcoPoloRoom, marcoId: string, rng: () => number): GameEvent {
  room.round += 1;
  room.between = false;
  room.nextMarcoId = null;
  room.lastMarcoRound[marcoId] = room.round;
  for (const p of room.players) room.scores[p.id] ??= 0;
  room.sim = createRound(room.players.map((p) => p.id), marcoId, rng);
  return { type: 'roundStart', round: room.round, marcoId };
}

export function startMatch(room: MarcoPoloRoom, rng: () => number = Math.random): GameEvent {
  const ids = room.players.map((p) => p.id);
  room.begun = true;
  return beginRound(room, ids[Math.floor(rng() * ids.length)]!, rng);
}

export function stepRound(
  room: MarcoPoloRoom,
  dt: number,
  rng: () => number = Math.random,
): GameEvent[] {
  if (!room.sim || room.between) return [];
  const events: GameEvent[] = [...tick(room.sim, dt)];
  const over = room.sim.over;
  if (over) {
    room.between = true;
    const poloIds = room.sim.players.filter((p) => p.role === 'polo').map((p) => p.id);
    for (const id of survivors(poloIds, over.caughtId)) {
      room.scores[id] = (room.scores[id] ?? 0) + 1;
    }
    room.nextMarcoId =
      over.caughtId ?? pickNextMarco(room.players.map((p) => p.id), room.lastMarcoRound, rng);
    events.push({
      type: 'roundEnd',
      reason: over.reason,
      caughtId: over.caughtId,
      nextMarcoId: room.nextMarcoId,
      scores: { ...room.scores },
    });
  }
  return events;
}

export function startNextRound(
  room: MarcoPoloRoom,
  rng: () => number = Math.random,
): GameEvent | null {
  if (!room.between || room.nextMarcoId === null) return null;
  return beginRound(room, room.nextMarcoId, rng);
}
