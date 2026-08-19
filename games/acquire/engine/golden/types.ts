import type { Coord, GameState, Stage, StartupId } from '../gameTypes';
import type { Intent, IllegalIntentCode } from '../intents';

export interface FixtureSpec {
  players: { name: string; cash?: number; hand?: Coord[]; shares?: Record<string, number> }[];
  chains?: { id: StartupId; coords: Coord[] }[];
  loners?: Coord[];
  bag?: Coord[];
  stage?: Stage;
  currentPlayerIndex?: number;
}

export interface StateAssertion {
  stage?: Stage;
  /** `players[turnIndex]` — whose *turn* it is. Meaningless before turn order exists. */
  currentPlayer?: string;
  /**
   * `getCurrentActor` — whose input the rules are waiting on, which is not
   * always whose turn it is: a liquidating shareholder, or a seat part-way
   * through the opening turn-order draw. It is also the segment seam, so this
   * is the field that pins the curtain, the undo range and the server's commit
   * boundary to the rules rather than to an implementation.
   */
  actor?: string;
  cash?: Record<string, number>;
  shares?: Record<string, Record<string, number>>;
  chainSize?: Record<string, number>;
  founded?: Record<string, boolean>;
  availableShares?: Record<string, number>;
  hand?: Record<string, Coord[]>;
  boardOwner?: Record<string, StartupId | null>;
  /** phases of the log entries this step appended, in order */
  logPhases?: string[];
  /** playerId → stock + bonus + cash, from finalScore() */
  finalScoreTotals?: Record<string, number>;
  /** playerId → the bonus entries finalScore() reports for them, order-insensitive */
  finalScoreBonuses?: Record<string, { chainId: string; type: string; amount: number }[]>;
}

export interface GoldenStep {
  name: string;
  intent: Intent;
  /** when set, the step must be REJECTED with this code and the state must not change */
  expectError?: IllegalIntentCode;
  then?: StateAssertion;
}

export interface GoldenGame {
  id: string;
  title: string;
  setup: FixtureSpec;
  steps: GoldenStep[];
  final?: StateAssertion;
}

export type { GameState };
