// src/state/legal.ts
// What the server may append to a room's log. Pure — a function of the log and
// the sender — so the whole authority is testable without a socket.
//
// It is built from the same helpers useGame's own guards read (nextHomeSeat,
// needsDestination, replay), which is the point: the client's "may I?" and the
// server's "you may not" are made of one set of rules and cannot drift into
// disagreeing about the same board.
import { nodeForCity } from '../../engine';
import type { GameRejection, GameRejectionCode } from '../../session/protocol';
import type { GameEvent, SeatId } from './events';
import { replay } from './game';
import { homesDone, needsDestination, nextHomeSeat } from './turns';

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
    case 'arrived':
      // Either a region ballot is open and this is its answer, or the baron is
      // standing where it was last sent and may be given somewhere new.
      return seat.awaiting !== null || needsDestination(seat, nodeForCity)
        ? null : not('notNow', 'no destination is owed');

    case 'regionRequested':
      return seat.awaiting === null && needsDestination(seat, nodeForCity)
        ? null : not('notNow', 'no destination roll is owed');

    case 'turnRolled':
      if (state.phase !== 'playing') return not('notNow', 'the game has not begun');
      if (state.rolled !== null) return not('notNow', 'this turn already has its roll');
      if (needsDestination(seat, nodeForCity)) return not('notNow', 'roll a destination first');
      return null;

    case 'bonusRolled':
      // `bonusOwed` is replay's own derivation — entitled by the white pair,
      // white leg walked, die not yet thrown. Asking it here rather than
      // re-deriving entitlement is what stops the server accepting a roll
      // replay would then silently discard.
      return state.phase === 'playing' && state.bonusOwed
        && !needsDestination(seat, nodeForCity)
        ? null : not('notNow', 'no Bonus Roll is owed');

    case 'moved':
      if (state.phase !== 'playing' || state.rolled === null) {
        return not('notNow', 'no roll to move on');
      }
      return state.leg < 2 ? null : not('notNow', 'this turn has walked both its legs');
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
