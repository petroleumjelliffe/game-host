// One derivation for two callers: the client hooks *generate* the nth roll
// with nextRng(), and appendLegality *verifies* an incoming roll by
// regenerating it. They agree because they are the same function — a seeded
// game's honor system becomes a checked system at the cost of an equality
// test. Unseeded games (rules.seed absent) touch none of this. The
// recomputation calls exactly the functions the hooks call — rollTurn, d6,
// rollDestination, destinationInRegion — or generation and verification
// would drift.
import {
  d6, destinationInRegion, rollDestination, rollTurn, type Rng,
} from '../../engine/index.js';
import { rollRng } from '../../engine/seed.js';
import type { GameRejection } from '../../session/protocol.js';
import type { GameEvent } from './events.js';
import { currentCity, type GameState } from './game.js';
import { homesTaken } from './turns.js';

const ROLL_TYPES: ReadonlySet<GameEvent['type']> =
  new Set(['turnRolled', 'bonusRolled', 'regionRequested', 'arrived']);

export const countRollEvents = (log: readonly GameEvent[]): number =>
  log.reduce((n, e) => n + (ROLL_TYPES.has(e.type) ? 1 : 0), 0);

export const nextRng = (log: readonly GameEvent[], seed: string): Rng =>
  rollRng(seed, countRollEvents(log));

const refused: GameRejection =
  { code: 'notNow', message: 'this is a seeded game, and those are not its dice' };

/**
 * Regenerate what the seed prescribes for this position and compare. Returns
 * null for unseeded games, for non-roll events, and for conforming rolls.
 */
export function seedConformance(
  log: readonly GameEvent[], event: GameEvent, state: GameState,
): GameRejection | null {
  const seed = state.rules.seed;
  if (seed === undefined || !ROLL_TYPES.has(event.type)) return null;
  const rng = nextRng(log, seed);

  switch (event.type) {
    case 'turnRolled': {
      const roll = rollTurn(state.rules.startingTrain, rng);
      return event.white[0] === roll.white[0] && event.white[1] === roll.white[1]
        && event.bonus === roll.bonus ? null : refused;
    }
    case 'bonusRolled':
      return event.face === d6(rng) ? null : refused;
    case 'regionRequested': {
      const seat = state.seats[event.seat];
      const outcome = rollDestination(currentCity(seat), rng, homesTaken(state));
      return outcome.kind === 'chooseRegion' && outcome.rolled === event.rolled
        ? null : refused;
    }
    case 'arrived': {
      const seat = state.seats[event.seat];
      const from = currentCity(seat);
      if (seat.awaiting !== null) {
        if (from === null) return refused;
        const arrival = destinationInRegion(from, seat.awaiting, rng);
        return arrival.city === event.city ? null : refused;
      }
      const outcome = rollDestination(from, rng, homesTaken(state));
      return (outcome.kind === 'home' || outcome.kind === 'arrived')
        && outcome.city === event.city ? null : refused;
    }
    default:
      return null;
  }
}
