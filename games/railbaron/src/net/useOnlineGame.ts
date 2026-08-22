import { useCallback } from 'react';
import {
  d6, destinationInRegion, nodeForCity, rollDestination, rollTurn,
  type NodeId, type RegionId, type Rng, type RollOutcome, type TrainType, type TurnRoll,
} from '../../engine';
import { SEATS, type GameEvent, type SeatId } from '../state/events';
import { currentCity, replay } from '../state/game';
import { nextRng } from '../state/seeded';
import { homesTaken, needsDestination, nextHomeSeat } from '../state/turns';
import type { GameTransport } from './transport';

/**
 * `useGame`'s surface over a server log.
 *
 * Three things differ from pass-and-play, and only three:
 *
 * - state is `replay(log)` where the log is a prop, not `useState` — the
 *   server owns it, and there is no local write path at all;
 * - every `commit*` reaches `transport.append` instead of `setEvents`;
 * - one extra gate everywhere, `mySeat`. This machine speaks for one baron.
 *   The server would refuse anything else (`notYourSeat`), so the local gate
 *   is not the security boundary — it exists so the board never *offers* an
 *   action the server would have to refuse.
 *
 * The roll→announce→commit gates survive untouched: `roll`, `rollDice` and
 * `rollBonus` return an outcome and append nothing, and only the matching
 * `commit*` reaches the wire. Between a commit and the `log` echo that
 * answers it, local state simply has not advanced — the announcement
 * animation covers that gap, and there is deliberately no optimistic apply to
 * roll back if the server refuses.
 *
 * `rename`, `start` and `reset` are absent: the lobby owns names and
 * beginning, and there is no online reset.
 */
export function useOnlineGame(
  log: readonly GameEvent[],
  transport: GameTransport,
  mySeat: SeatId | null,
  rng: Rng = Math.random,
) {
  const state = replay(log);

  // Seeded games roll the seed's dice: the stream for the next roll event is
  // derived from the log every render, so each append advances it — and the
  // same derivation is what appendLegality verifies against (seeded.ts).
  // The order-roll ceremony below stays on `rng`: its dice values are never
  // recorded in the log, so a seed could neither replay nor verify them.
  const liveRng: Rng = state.rules.seed === undefined
    ? rng : nextRng(log, state.rules.seed);

  /** Whose move it is, by the same derivation the server's legality uses. */
  const actor = state.phase === 'homes' ? nextHomeSeat(state) : state.turn;

  const roll = useCallback((seat: SeatId): RollOutcome | null => {
    if (seat !== mySeat) return null;
    const current = state.seats[seat];
    if (current.awaiting !== null || current.name === null) return null;
    // A homeward baron rolls no destinations — home is the destination.
    if (current.homeward) return null;
    if (!needsDestination(current, nodeForCity)) return null;
    if (actor !== seat) return null;
    return rollDestination(currentCity(current), liveRng, homesTaken(state));
  }, [state, actor, liveRng, mySeat]);

  const commitRoll = useCallback((seat: SeatId, outcome: RollOutcome) => {
    switch (outcome.kind) {
      case 'home':
        transport.append({
          type: 'arrived', seat, city: outcome.city, region: outcome.region, payout: null,
        });
        return;
      case 'arrived':
        transport.append({
          type: 'arrived', seat, city: outcome.city,
          region: outcome.region, payout: outcome.payout,
        });
        return;
      case 'chooseRegion':
        transport.append({ type: 'regionRequested', seat, rolled: outcome.rolled });
    }
  }, [transport]);

  const chooseRegion = useCallback((seat: SeatId, region: RegionId) => {
    if (seat !== mySeat) return;
    const current = state.seats[seat];
    const from = currentCity(current);
    if (from === null || current.awaiting === null) return;
    const arrival = destinationInRegion(from, region, liveRng);
    transport.append({
      type: 'arrived', seat, city: arrival.city,
      region: arrival.region, payout: arrival.payout,
    });
  }, [state, liveRng, transport, mySeat]);

  const rollDice = useCallback((seat: SeatId): TurnRoll | null => {
    if (seat !== mySeat) return null;
    if (state.phase !== 'playing' || state.turn !== seat) return null;
    if (state.rolled !== null) return null;
    const rollingSeat = state.seats[seat];
    if (!rollingSeat.homeward && needsDestination(rollingSeat, nodeForCity)) return null;
    // The money spec kept its promise: the train is the rules' to name.
    const train: TrainType = state.rules.startingTrain;
    return rollTurn(train, liveRng);
  }, [state, liveRng, mySeat]);

  const commitDice = useCallback((seat: SeatId, roll: TurnRoll) => {
    transport.append({
      type: 'turnRolled', seat,
      white: [roll.white[0], roll.white[1]], bonus: roll.bonus,
    });
  }, [transport]);

  const rollBonus = useCallback((seat: SeatId): number | null => {
    if (seat !== mySeat) return null;
    if (state.phase !== 'playing' || state.turn !== seat) return null;
    if (!state.bonusOwed) return null;
    const bonusSeat = state.seats[seat];
    if (!bonusSeat.homeward && needsDestination(bonusSeat, nodeForCity)) return null;
    return d6(liveRng);
  }, [state, liveRng, mySeat]);

  const commitBonus = useCallback((seat: SeatId, face: number) => {
    transport.append({ type: 'bonusRolled', seat, face });
  }, [transport]);

  const commitMove = useCallback(
    (seat: SeatId, path: readonly NodeId[], arrived: boolean) => {
      transport.append({ type: 'moved', seat, path: [...path], arrived });
    }, [transport]);

  /**
   * The roll for first player is a shared ceremony (owner ruling), so the gate
   * is being seated rather than being the actor — any baron at the table may
   * report it, and the server agrees.
   */
  const rollOrder = useCallback(() => {
    if (mySeat === null || state.seats[mySeat].name === null) return;
    const seated = SEATS.filter((id) => state.seats[id].name !== null);
    if (seated.length === 0) return;
    let best: SeatId[] = [];
    for (let attempt = 0; attempt < 100 && best.length !== 1; attempt++) {
      best = [];
      let high = 0;
      for (const id of seated) {
        const score = Math.floor(rng() * 6) + Math.floor(rng() * 6) + 2;
        if (score > high) { high = score; best = [id]; }
        else if (score === high) best.push(id);
      }
    }
    if (best.length > 1) throw new Error('turn order stayed tied after 100 rerolls');
    const first = best[0]!;
    transport.append({ type: 'orderRolled', seat: first, first });
  }, [state, rng, transport, mySeat]);

  /**
   * Always sent, never pre-judged. Who may undo is the server's to answer —
   * it grants it to the seat whose action would be popped — and a local guess
   * at that rule is a second copy of it waiting to disagree. A refusal comes
   * back on the rejected channel.
   */
  const undoLast = useCallback(() => { transport.undo(); }, [transport]);

  return {
    state, roll, commitRoll, chooseRegion,
    rollDice, commitDice, rollBonus, commitBonus, commitMove, rollOrder, undoLast,
  };
}
