// src/state/legal.ts
// What the server may append to a room's log. Pure — a function of the log and
// the sender — so the whole authority is testable without a socket.
//
// It is built from the same helpers useGame's own guards read (nextHomeSeat,
// needsDestination, replay), which is the point: the client's "may I?" and the
// server's "you may not" are made of one set of rules and cannot drift into
// disagreeing about the same board.
import { nodeForCity, payoutBetween } from '../../engine/index.js';
import type { GameRejection, GameRejectionCode } from '../../session/protocol.js';
import type { GameEvent, SeatId } from './events.js';
import { currentCity, replay } from './game.js';
import { seedConformance } from './seeded.js';
import { homesDone, needsDestination, nextHomeSeat } from './turns.js';

const not = (code: GameRejectionCode, message: string): GameRejection =>
  ({ code, message });

/**
 * `null` means the append is allowed. Anything else is the refusal to send
 * back, and the log is left exactly as it was.
 */
export function appendLegality(
  log: readonly GameEvent[], event: GameEvent, sender: SeatId,
): GameRejection | null {
  const state = replay(log);

  // A finished game accepts nothing. The winner derivation is replay's, so
  // this is one comparison — and it outranks even the server-only events:
  // a second `started` in a won room is as wrong as a move in one.
  if (state.winner !== null) return not('notNow', 'the game is over');

  // In a seeded game, the dice are the seed's — a nonconforming roll is
  // refused before any other question is asked of it.
  const nonconforming = seedConformance(log, event, state);
  if (nonconforming !== null) return nonconforming;

  // Seating and starting belong to the lobby and to Begin. A client that
  // sends one is either confused or hostile, and the answer is the same.
  if (event.type === 'joined' || event.type === 'renamed' || event.type === 'started') {
    return not('notNow', 'seating and starting are the server\'s to write');
  }

  if (event.type === 'orderRolled') {
    // The one exception to seat-matching. Rolling for first player is a shared
    // ceremony at the table (owner ruling), so any *seated* sender may report
    // it, whoever the event names as having rolled.
    if (state.seats[sender].name === null) return not('notYourSeat', 'take a seat first');
    if (state.phase !== 'homes' || !homesDone(state)) {
      return not('notNow', 'every baron needs a home before the order is rolled');
    }
    // A second one cannot reach here: the first moved the phase to `playing`.
    return null;
  }

  if (event.seat !== sender) return not('notYourSeat', `that seat is ${event.seat}'s`);

  // Who the log says is acting: during `homes` the barons take their home
  // cities in seat order, and after that it is simply whose turn it is.
  const actor = state.phase === 'homes' ? nextHomeSeat(state) : state.turn;
  if (actor !== sender) return not('notNow', 'not your turn');
  const seat = state.seats[sender];

  switch (event.type) {
    case 'arrived': {
      if (seat.run !== null) {
        return not('notNow', 'a declared baron rolls no destinations — the trip is already set');
      }
      // The payout is the table's, not the sender's. The first stop is the
      // home pick and pays null; every later one pays exactly payoutBetween —
      // which throws on a city-to-itself journey, so that is refused first.
      const from = currentCity(seat);
      if (from === event.city) return not('notNow', 'already there');
      const owed = from === null ? null : payoutBetween(from, event.city);
      if (event.payout !== owed) {
        return not('notNow', 'that is not what the payout table says');
      }
      // Either a region ballot is open and this is its answer, or the baron is
      // standing where it was last sent and may be given somewhere new.
      return seat.awaiting !== null || needsDestination(seat, nodeForCity)
        ? null : not('notNow', 'no destination is owed');
    }

    case 'regionRequested':
      if (seat.run !== null) {
        return not('notNow', 'a declared baron rolls no destinations — the trip is already set');
      }
      return seat.awaiting === null && needsDestination(seat, nodeForCity)
        ? null : not('notNow', 'no destination roll is owed');

    case 'turnRolled':
      if (state.phase !== 'playing') return not('notNow', 'the game has not begun');
      if (state.rolled !== null) return not('notNow', 'this turn already has its roll');
      if (seat.run === null && needsDestination(seat, nodeForCity)) {
        return not('notNow', 'roll a destination first');
      }
      return null;

    case 'bonusRolled':
      // `bonusOwed` is replay's own derivation — entitled by the white pair,
      // white leg walked, die not yet thrown. Asking it here rather than
      // re-deriving entitlement is what stops the server accepting a roll
      // replay would then silently discard.
      return state.phase === 'playing' && state.bonusOwed
        && (seat.run !== null || !needsDestination(seat, nodeForCity))
        ? null : not('notNow', 'no Bonus Roll is owed');

    case 'moved':
      if (state.phase !== 'playing' || state.rolled === null) {
        return not('notNow', 'no roll to move on');
      }
      return state.leg < 2 ? null : not('notNow', 'this turn has walked both its legs');

    case 'bought':
    case 'declared':
    case 'sold':
      // Placeholders until the phase-2 legality task lands; refusing is
      // the safe default for an event no rule yet admits.
      return not('notNow', 'not yet in play');
  }
}

/**
 * Undo is granted to the seat whose action `undo()` would pop — which is the
 * last event's seat, because `undo()` takes back one *player action* and every
 * event of one action belongs to one baron (owner ruling: a bystander must not
 * yank the actor's turn out from under them).
 *
 * The seeded prefix is not undoable: `joined` and `started` were never a
 * player's action, and `undo()` refuses to rewind across `started` anyway.
 */
export function undoLegality(
  log: readonly GameEvent[], sender: SeatId,
): GameRejection | null {
  const last = log[log.length - 1];
  if (last === undefined || last.type === 'started' || last.type === 'joined') {
    return not('nothingToUndo', 'nothing has happened yet');
  }
  // A `renamed` has no owner the game can defend — online, names are the
  // lobby's and never reach this log at all.
  if (last.type === 'renamed' || last.seat !== sender) {
    return not('notYourUndo', 'only the player who acted may take it back');
  }
  return null;
}
