import { useEffect, useState } from 'react';
import {
  REGIONS,
  type Arrival, type NodeId, type RailroadId, type RegionId, type RollOutcome, type TurnRoll,
} from '../engine';
import { diceFor, play } from './board/screens/play';
import { homes } from './board/screens/homes';
import { liquidation } from './board/screens/liquidation';
import { office } from './board/screens/office';
import { regionBallot } from './board/screens/regionBallot';
import type { Row, ScreenDef } from './board/types';
import { SEATS, type SeatId } from './state/events';
import type { GameState } from './state/game';
import { shortSeat } from './state/turns';

/**
 * The board-driving glue: the announcement holds, the screens record, and the
 * row actions that play the game. It lives here because online needs exactly
 * this behaviour over a different hook, and two copies of it are two places
 * for the roll→announce→commit gates to drift apart.
 *
 * It is a hook rather than a component, deliberately. `App` mounts exactly one
 * `Board` above the routing — a Board per route means navigation unmounts one
 * and mounts another, `useFlap` sees a first render and declines to animate,
 * and the flap that is the entire point of the design never plays on the
 * transition it exists for. A `<GameShell>` rendering its own Board would
 * reintroduce that at the `/pass-and-play` → `/pass-and-play/game` boundary.
 * So this hands `App` what its single Board needs, and `App` renders it. Task
 * 10's online screens plug in the same way.
 */

/** What `useGame` and `useOnlineGame` both satisfy. */
export interface GameSurface {
  state: GameState;
  roll(seat: SeatId): RollOutcome | null;
  commitRoll(seat: SeatId, outcome: RollOutcome): void;
  chooseRegion(seat: SeatId, region: RegionId): void;
  rollDice(seat: SeatId): TurnRoll | null;
  commitDice(seat: SeatId, roll: TurnRoll): void;
  rollBonus(seat: SeatId): number | null;
  commitBonus(seat: SeatId, face: number): void;
  commitMove(seat: SeatId, path: readonly NodeId[], arrived: boolean): void;
  rollOrder(): void;
  undoLast(): void;
  buy(seat: SeatId, railroad: RailroadId): void;
  rollDeclare(seat: SeatId): RollOutcome | null;
  commitDeclare(seat: SeatId, alternate: Arrival): void;
  declareChooseRegion(seat: SeatId, region: RegionId): void;
  sell(seat: SeatId, railroad: RailroadId): void;
}

/**
 * `'all'` is pass-and-play: one device speaking for every baron. A `SeatId` is
 * online — this device holds one colour, and rows belonging to others render
 * but do not act. The hooks gate too; this stops the board *offering*.
 */
export type ActAs = SeatId | 'all';

export interface GameShell {
  /** The board screen for the game route. */
  gameScreen: ScreenDef;
  awaitRegion: { row: number; onLanded: () => void } | null;
  awaitDice: { onLanded: () => void } | null;
  onRollDice(): void;
  onDiceLanded(): void;
  /** The readout the map's HUD shows. */
  dice: ReturnType<typeof diceFor>;
  onMove(seat: SeatId, path: readonly NodeId[], arrived: boolean): void;
  /**
   * Handles the rows that play the game — `act`, `order`, `undo`. Returns
   * whether it consumed the row, so the caller keeps `edit` and `navigate`,
   * which differ between pass-and-play and online.
   */
  actOnRow(row: Row, index: number): boolean;
}

/** Every outcome names a region — it is the one thing a roll always produces. */
const regionOf = (outcome: RollOutcome): RegionId =>
  outcome.kind === 'chooseRegion' ? outcome.rolled : outcome.region;

export function useGameShell(game: GameSurface, actAs: ActAs): GameShell {
  const { state } = game;

  /**
   * A roll that has been made but not yet told. Held out of the log until the
   * board's region panel finishes turning — see `roll` in useGame for why that
   * is the gate rather than a rule to remember.
   */
  const [rolling, setRolling] = useState<{ seat: SeatId; outcome: RollOutcome } | null>(null);
  /** Dice rolled but not yet told. Same gate, same reason. */
  const [rollingDice, setRollingDice] = useState<{ seat: SeatId; roll: TurnRoll } | null>(null);
  /**
   * A Bonus Roll thrown but not yet told. Its own hold rather than a field on
   * `rollingDice`: the two are separate rolls made at different moments of the
   * turn, and the white pair it belongs to is already in the log by the time
   * this one is thrown.
   */
  const [rollingBonus, setRollingBonus] = useState<{ seat: SeatId; face: number } | null>(null);
  /**
   * How many rolls each seat has had told. Kept across the commit, so the
   * board sees one announcement per roll rather than a second one when the
   * roll finally reaches the log.
   */
  const [turns, setTurns] = useState<Partial<Record<SeatId, number>>>({});
  /**
   * A declare's alternate roll, made but not yet told — the same hold and
   * the same reason as `rolling`. An 'arrived' outcome announces through
   * the region panel and commits on landing; a 'chooseRegion' outcome
   * hands the board to the ballot instead, and the choice commits at once,
   * exactly as chooseRegion does for an ordinary roll.
   */
  const [declaring, setDeclaring] = useState<{ seat: SeatId; outcome: RollOutcome } | null>(null);
  /** The railroad office, open at a page — or closed. */
  const [officePage, setOfficePage] = useState<number | null>(null);

  // The office is the actor's window; it must not survive into the next
  // baron's turn, or a stale page would offer someone else's purchases.
  useEffect(() => { setOfficePage(null); }, [state.turn]);

  // One tap, two rolls: which one the readout is offering depends on where the
  // turn stands. Before the whites it is the white pair; once they have been
  // walked and a Bonus Roll is owed, the same drums throw the red die alone.
  const onRollDice = (): void => {
    if (state.turn === null || rollingDice !== null || rollingBonus !== null) return;
    if (state.bonusOwed) {
      const face = game.rollBonus(state.turn);
      if (face === null) return;
      setRollingBonus({ seat: state.turn, face });
      return;
    }
    const rolled = game.rollDice(state.turn);
    if (rolled === null) return;
    setRollingDice({ seat: state.turn, roll: rolled });
  };

  const onDiceLanded = (): void => {
    if (rollingBonus !== null) {
      game.commitBonus(rollingBonus.seat, rollingBonus.face);
      setRollingBonus(null);
      return;
    }
    if (rollingDice === null) return;
    game.commitDice(rollingDice.seat, rollingDice.roll);
    setRollingDice(null);
  };

  // Only one seat can be owed a region at a time. It takes over the whole
  // board rather than opening a dialog over it.
  const awaiting = SEATS.map(id => state.seats[id]).find(seat => seat.awaiting !== null);

  // The ballot cannot appear early: `awaiting` comes from the log, and a roll
  // only reaches the log once its region has landed. The forced sale
  // outranks everything below it, exactly as legal.ts's gate does.
  const short = shortSeat(state);
  const announcing = rolling ?? declaring;
  const gameScreen: ScreenDef = state.phase === 'homes'
    ? homes(state, rolling && { seat: rolling.seat, region: regionOf(rolling.outcome) })
    : short !== null
      ? liquidation(state, state.seats[short])
      : awaiting
        ? regionBallot(awaiting)
        : declaring?.outcome.kind === 'chooseRegion'
          ? regionBallot({ ...state.seats[declaring.seat], awaiting: declaring.outcome.rolled })
          : officePage !== null
            ? office(state, officePage)
            : play(state, turns,
                   announcing && { seat: announcing.seat, region: regionOf(announcing.outcome) },
                   rollingDice?.roll ?? null,
                   rollingBonus?.face ?? null,
                   actAs);

  const actOnRow = (row: Row, index: number): boolean => {
    if (row.action === null) return false;

    if (row.action.kind === 'office') {
      // A paged action turns the page; a bare one toggles the office.
      const { page } = row.action;
      setOfficePage(page !== undefined ? page : officePage === null ? 0 : null);
      return true;
    }
    if (row.action.kind === 'buy') {
      if (state.turn !== null && (actAs === 'all' || state.turn === actAs)) {
        game.buy(state.turn, row.action.railroad);
      }
      return true;
    }
    if (row.action.kind === 'declare') {
      const seat = row.action.seat;
      if (actAs !== 'all' && seat !== actAs) return true;
      if (rolling !== null || declaring !== null) return true;
      const outcome = game.rollDeclare(seat);
      if (outcome === null) return true;
      setTurns(counted => ({ ...counted, [seat]: (counted[seat] ?? 0) + 1 }));
      setDeclaring({ seat, outcome });
      return true;
    }
    if (row.action.kind === 'sell') {
      const seller = shortSeat(state);
      if (seller !== null && (actAs === 'all' || seller === actAs)) {
        game.sell(seller, row.action.railroad);
      }
      return true;
    }

    if (row.action.kind === 'act') {
      // The ballot's choice is its row position: RowAction carries no region,
      // and widening it for one screen would cost every other screen a field
      // it never sets.
      if (declaring?.outcome.kind === 'chooseRegion') {
        if (actAs !== 'all' && declaring.seat !== actAs) return true;
        game.declareChooseRegion(declaring.seat, REGIONS[index]!.id);
        setDeclaring(null);
        return true;
      }
      if (awaiting) {
        if (actAs !== 'all' && awaiting.id !== actAs) return true;
        game.chooseRegion(awaiting.id, REGIONS[index]!.id);
        return true;
      }
      if (rolling !== null) return true;      // one roll is already being told
      const seat = row.action.seat;
      // Online: this device speaks for one baron, and the others' rows are
      // there to be read, not tapped.
      if (actAs !== 'all' && seat !== actAs) return true;
      const outcome = game.roll(seat);
      if (outcome === null) return true;
      setTurns(counted => ({ ...counted, [seat]: (counted[seat] ?? 0) + 1 }));
      setRolling({ seat, outcome });
      return true;
    }

    // The roll for first player is a shared ceremony, so it is offered to any
    // seated baron rather than to the actor; and undo is always sent, because
    // who may take one back is the server's answer online and useGame's
    // locally. Both hooks already hold their own gate.
    if (row.action.kind === 'order') { game.rollOrder(); return true; }
    if (row.action.kind === 'undo') { game.undoLast(); return true; }

    return false;
  };

  const seatedIndexOf = (seat: SeatId): number =>
    SEATS.filter(id => state.seats[id].name !== null).indexOf(seat);

  return {
    gameScreen,
    awaitRegion: rolling
      ? {
          row: seatedIndexOf(rolling.seat),
          onLanded: () => { game.commitRoll(rolling.seat, rolling.outcome); setRolling(null); },
        }
      : declaring !== null && declaring.outcome.kind === 'arrived'
        ? {
            row: seatedIndexOf(declaring.seat),
            onLanded: () => {
              // The narrowing above makes this an Arrival in all but name.
              game.commitDeclare(declaring.seat, declaring.outcome as Arrival);
              setDeclaring(null);
            },
          }
        : null,
    awaitDice: (rollingDice || rollingBonus) && { onLanded: onDiceLanded },
    onRollDice,
    onDiceLanded,
    dice: diceFor(state, rollingDice?.roll ?? null, rollingBonus?.face ?? null, actAs),
    onMove: game.commitMove,
    actOnRow,
  };
}
