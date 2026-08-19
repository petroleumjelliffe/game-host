import type { TrainType, TurnRoll } from '../dice';
import type { Rejection } from '../movement';
import type { NodeId, RailroadId } from '../network';

export interface FixtureSpec {
  at: NodeId;
  destination: NodeId;
  train?: TrainType;
  /** Sections already spent this trip, as node pairs. */
  used?: readonly (readonly [NodeId, NodeId])[];
}

export type GoldenIntent =
  /** Roll the turn's white dice, with the faces scripted so the game is a game. */
  | { kind: 'roll'; faces: readonly number[] }
  /**
   * Take the Bonus Roll. Its own intent because it is its own roll, thrown
   * after the white movement has been walked — the face is scripted for the
   * same reason the white faces are.
   */
  | { kind: 'bonusRoll'; face: number }
  | { kind: 'step'; to: NodeId }
  | { kind: 'back' }
  | { kind: 'commit' }
  /** A new destination, named after arriving — the bonus-leg case. */
  | { kind: 'destination'; to: NodeId };

export type GoldenRejection =
  | Rejection
  | 'route-incomplete'
  | 'no-roll'
  | 'nothing-to-undo'
  /** A Bonus Roll on a turn whose white pair earned none. */
  | 'no-bonus-entitlement'
  /** A Bonus Roll before the white movement has been walked. */
  | 'bonus-too-early'
  /** A second Bonus Roll in one turn — the face is already on the table. */
  | 'bonus-already-taken';

export interface StateAssertion {
  at?: NodeId;
  spent?: number;
  remaining?: number;
  arrived?: boolean;
  complete?: boolean;
  /** How many sections the trip has spent. 0 after an arrival releases them. */
  usedCount?: number;
  /** The face on the bonus die. null is "not thrown", earned or not. */
  bonus?: number | null;
  /**
   * Whether this turn's white pair earns a Bonus Roll — fixed the moment the
   * whites land, and the half of the rule `bonus` cannot state now that the
   * face arrives a leg later.
   */
  entitled?: boolean;
  legOwed?: boolean;
  companies?: readonly RailroadId[];
}

export interface GoldenStep {
  name: string;
  intent: GoldenIntent;
  /** When set, the step must be REJECTED with this code and change nothing. */
  expectError?: GoldenRejection;
  then?: StateAssertion;
}

export interface GoldenGame {
  id: string;
  title: string;
  setup: FixtureSpec;
  steps: GoldenStep[];
  final?: StateAssertion;
}

/**
 * One entry of a game's story, in the shape the app's event log carries. A
 * `roll` is a `turnRolled`, a `bonus` a `bonusRolled`, a `leg` a `moved` —
 * which is what lets `src/state/replay.golden.test.ts` build a real log from a
 * golden game and hold the runner and `replay` to the same rules.
 */
export type GoldenRecord =
  | { kind: 'roll'; white: readonly [number, number] }
  | { kind: 'bonus'; face: number }
  | { kind: 'leg'; path: readonly NodeId[]; arrived: boolean };

export interface GoldenState {
  at: NodeId;
  destination: NodeId;
  train: TrainType;
  used: ReadonlyMap<string, number>;
  roll: TurnRoll | null;
  leg: number;
  draft: import('../route').Draft | null;
  /**
   * Everything this game has written down, in order: the rolls it made and the
   * legs it committed. It is here so the same story can be replayed through
   * the app's event log and the two made to agree.
   */
  story: readonly GoldenRecord[];
}
