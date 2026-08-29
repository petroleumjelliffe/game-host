// server/room.ts
// One room: the seats the lobby fills, and the game those seats play. The
// room decides what happened (commit or rejection); the transport decides
// who hears about it. Nothing here sends.

import type { SeatHolder } from '@game-host/lobby/server/rooms.js';
import type { Lifecycle } from '@game-host/lobby/protocol/protocol.js';
import { getCurrentActor } from '../engine/actor.js';
import type { Dictionary } from '../engine/dictionary.js';
import type { GameState } from '../engine/gameTypes.js';
import { applyIntent, IllegalIntentError, type Intent } from '../engine/intents.js';
import { createInitialGame } from '../engine/init.js';
import { MIN_PLAYERS } from '../engine/constants.js';
import type { WireMove } from '../session/protocol.js';

export type Delivery =
  | { kind: 'none' }
  | { kind: 'commit' }
  | { kind: 'rejected'; to: string; code: string; message: string; words?: string[] };

export interface GameRoom {
  id: string;
  players: SeatHolder[];
  lifecycle(): Lifecycle;
  /** The committed game, or null in the lobby. Never sent raw — see session/view.ts. */
  state(): GameState | null;
  actorId(): string | null;
  begin(seed: string): Delivery;
  dispatch(playerId: string, move: WireMove): Delivery;
}

export function createGameRoom(
  id: string,
  players: SeatHolder[],
  dictionary: Dictionary,
  initial: GameState | null = null,
): GameRoom {
  let state: GameState | null = initial;

  return {
    id,
    players,
    lifecycle(): Lifecycle {
      if (state === null) return 'lobby';
      return state.stage === 'over' ? 'over' : 'playing';
    },
    state: () => state,
    actorId: () => (state === null ? null : getCurrentActor(state)),

    begin(seed: string): Delivery {
      // The lobby's host-pressed-begin is the trigger; the game re-checks
      // what the client-side view also enforces, because a socket is not a
      // client.
      if (state !== null || players.length < MIN_PLAYERS) return { kind: 'none' };
      state = createInitialGame(
        seed,
        players.map((p) => ({ id: p.id, name: p.name })),
      );
      return { kind: 'commit' };
    },

    dispatch(playerId: string, move: WireMove): Delivery {
      if (state === null) {
        return { kind: 'rejected', to: playerId, code: 'notPlaying', message: 'The game has not started.' };
      }
      const intent: Intent = { ...move, playerId };
      try {
        state = applyIntent(state, intent, dictionary);
        return { kind: 'commit' };
      } catch (error) {
        if (error instanceof IllegalIntentError) {
          const delivery: Delivery = {
            kind: 'rejected',
            to: playerId,
            code: error.code,
            message: error.message,
          };
          if (error.words !== undefined) delivery.words = error.words;
          return delivery;
        }
        throw error;
      }
    },
  };
}
