import { useCallback, useEffect, useState } from 'react';
import {
  arrived as hasArrived, back, complete, extend, here, isRejection, movement,
  nodeForCity, path as pathOf, remaining as leftOf, startDraft, tappable,
  type Draft, type NodeId, type Rejection
} from '../../engine';
import type { SeatId } from '../state/events';
import type { GameState } from '../state/game';
import { destinationOf } from '../state/turns';

export interface RouteApi {
  draft: Draft | null;
  /** Nodes a tap would accept right now. */
  legal: ReadonlySet<NodeId>;
  at: NodeId | null;
  remaining: number;
  tap: (id: NodeId) => void;
  undo: () => void;
  canCommit: boolean;
  commit: () => void;
  /** Why the last tap was refused, or null. Cleared by the next accepted tap. */
  refused: Rejection | null;
}

const NOTHING: ReadonlySet<NodeId> = new Set();

/**
 * The route a player is tapping out, held here and nowhere else.
 *
 * It never touches the log, so undo is free and a reload loses it — an
 * annoyance on one tablet, not a lost game. It also does not cross tabs, which
 * is the right split: route-building happens in the tab that is playing, and
 * the other watches the committed move play back like any other spectator.
 */
export function useRoute(
  state: GameState,
  onMove: (seat: SeatId, path: readonly NodeId[], arrived: boolean) => void
): RouteApi {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refused, setRefused] = useState<Rejection | null>(null);

  const seat = state.turn === null ? null : state.seats[state.turn];
  const destination = seat === null ? null : destinationOf(seat);
  const roll = state.rolled;

  /**
   * How much this leg may spend. The first leg has the white dice — the bonus
   * die is not in hand while it is walked, so `movement` sums a roll whose
   * bonus is null and gives exactly the white pair. The second leg has only
   * the bonus face, and has nothing at all until it is thrown, which is the
   * state `GameState.bonusOwed` names and the map's HUD explains.
   */
  const legMovement = roll === null
    ? 0
    : state.leg === 0 ? movement(roll) : (roll.bonus ?? 0);

  // Rebuild whenever the turn, the leg or the destination changes — a draft
  // outliving the turn that started it would let a player spend last turn's
  // dice on this one.
  const key = `${state.turn ?? ''}|${state.leg}|${destination ?? ''}|${legMovement}`;
  useEffect(() => {
    if (seat === null || seat.at === null || destination === null || roll === null) {
      setDraft(null);
      setRefused(null);
      return;
    }
    setDraft(startDraft(seat.at, nodeForCity(destination), legMovement, seat.used));
    setRefused(null);
    // `key` is the whole dependency: seat and roll are rebuilt every render,
    // and depending on them would reset the draft on every tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /**
   * One tap moves the pawn from where it stands to the place tapped, however
   * many junctions lie between. The player taps dots, which is what the
   * printed board is made of, and never learns that the graph carries extra
   * nodes — so the pawn is never left at rest on one.
   *
   * The whole walk happens here in the handler body, reading this render's
   * `draft`, and only finished values are handed to the setters. Nothing is
   * computed inside a state updater: React invokes those twice under
   * StrictMode to catch impure ones, and this repo has already been bitten
   * once by that — see the note above `roll` in `src/state/useGame.ts`.
   */
  const tap = useCallback((id: NodeId) => {
    if (draft === null) return;
    const reach = tappable(draft).find(one => one.to === id);
    if (reach === undefined) {
      // A junction is a legal step and still not a place, so `extend` would
      // accept one — there is simply nothing to report and nothing to do.
      const refusal = extend(draft, id);
      if (isRejection(refusal)) setRefused(refusal);
      return;
    }
    let walked = draft;
    for (const step of reach.via) {
      const next = extend(walked, step.to);
      // Unreachable: every step in `via` was built by extending this draft.
      if (isRejection(next)) return;
      walked = next;
    }
    setRefused(null);
    setDraft(walked);
  }, [draft]);

  const undo = useCallback(() => {
    setRefused(null);
    setDraft(current => (current === null ? current : back(current)));
  }, []);

  const canCommit = draft !== null && complete(draft) && draft.steps.length > 0;

  const commit = useCallback(() => {
    if (draft === null || state.turn === null) return;
    if (!complete(draft) || draft.steps.length === 0) return;
    onMove(state.turn, pathOf(draft), hasArrived(draft));
    setDraft(null);
  }, [draft, state.turn, onMove]);

  return {
    draft,
    // Places, not steps: a junction is never in here, so no lamp lights for
    // one and no tap can be aimed at one.
    legal: draft === null ? NOTHING : new Set(tappable(draft).map(one => one.to)),
    at: draft === null ? (seat?.at ?? null) : here(draft),
    remaining: draft === null ? 0 : leftOf(draft),
    tap, undo, canCommit, commit, refused
  };
}
