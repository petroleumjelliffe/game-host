import type { Coord } from "./gameHelpers";
import type { BonusResult } from "./bonuses";
export type { BonusResult, Coord };
export type Stage =
  | "setup"
  | "draw"
  | "dealHands"
  | "play"
  | "foundStartup"
  | "chooseSurvivor"
  | "buy"
  | "mergerPayout"
  | "mergerLiquidation"
  | "liquidation"
  | "liquidationPrompt"
  | "end";

  export interface TileCell {
  placed: boolean;
  startupId?: string;
}

export type StartupId =
  | "Gobble"
  | "Scrapple"
  | "PaperfulPost"
  | "CamCrooned"
  | "Messla"
  | "ZuckFace"
  | "WrecksonMobil";

export type LogToken =
  | { kind: 'text';  text: string }
  | { kind: 'tile';  coord: Coord }
  // `startupId` here is `string`, not `StartupId`: this token exists only
  // to render a brand name in the log, and its callers (gameLogic.ts) carry
  // startup ids as plain `string` throughout their board/portfolio
  // bookkeeping (see `Startup.id` and `TileCell.startupId` below). Nothing
  // reads `LogToken.startupId` back out as a `StartupId` — narrowing it here
  // would only relocate the mismatch, not fix it.
  | { kind: 'brand'; startupId: string }
  | { kind: 'cash';  amount: number; delta?: boolean }
  | { kind: 'stack'; startupId: string; count: number };

/**
 * Structured data a log entry carries alongside its display tokens, for steps
 * whose detail is a component rather than a sentence.
 *
 * A discriminated union so more step kinds can join without any consumer
 * having to guess: the alternative Phase 1b had to use was a regex over
 * rendered text, which is correct until someone rewords a log string.
 */
export type LogPayload =
  | { kind: 'payout'; bonuses: BonusResult[] }
  /**
   * The founder's share. A payload rather than tokens because the thing to
   * show is a share *certificate* — the same card the staging pile and the
   * hand zone render — and the token vocabulary is text, tiles, brands and
   * cash. Same reasoning as `payout`: a step whose content is richer than a
   * sentence carries the data and lets the panel render the component.
   */
  | { kind: 'founding'; startupId: string; shares: number };

export interface LogEntry {
  stepId: number;
  phase: string;
  detail: LogToken[];
  playerId?: string;
  payload?: LogPayload;
}

export interface MergerContext {
  survivorId: string;
  absorbedIds: string[];
  resolved?: boolean;

  payoutQueue: string[]; //player ids in order
  currentChoiceIndex: number; //index in payoutQueue
  absorbedPrices: Record<string, number>; // Pre-merger prices for each absorbed startup

  currentLiquidationIndex: number;
  shareholderQueue: string[]; // ordered player IDs
  currentShareholderIndex: number;
  activePlayerId?: string;
}

export interface Player {
  id: string;
  name: string;
  emoji: string;
  cash: number;
  hand: Coord[];
  portfolio: Record<string, number>; //startupId -> shares owned
  isConnected?: boolean; // Multiplayer: is player currently online
  socketId?: string; // Multiplayer: current socket connection ID
  lastPlacedTile?: Coord; // Track most recent tile placement for UI
}
export interface Startup {
  id: string; //todo: replace with StartupId type
  ticker: string;
  tiles: Coord[]; //TODO: deprecate in favor of getStartupTiles from Board
  foundingTile: Coord | null;
  tier: 0 | 1 | 2;
  totalShares: number; //usually 25
  availableShares: number; //starts at totalShares
  isFounded: boolean;
}

export interface GameState {
  // color?: string;
  seed: string;
  stage: Stage;
  players: Player[];
  turnIndex: number;
  /**
   * The opening turn-order draw, filled in seat order during `stage: 'draw'`.
   *
   * Its **length is the cursor** — seat N+1 draws next — which is what makes
   * `getCurrentActor` move through the draw, and therefore what gives the draw
   * a curtain, a hand-off and a per-draw server commit for free.
   *
   * Kept rather than cleared once play begins: it is the record of who drew
   * what, which a recap would read, and it costs nothing.
   *
   * Deliberately not `player.lastPlacedTile` — that field means "placed this
   * turn, still undoable", and the board gives it a selection ring and keeps it
   * clickable. Phase 2 shipped that bug once; see the comment in
   * `doDrawTurnOrderTile`.
   *
   * Public information: the tiles land on the board as unclaimed starting
   * tiles anyway, so no projection has to strip this.
   */
  turnOrderDraws?: { playerId: string; tile: Coord }[];
  board: Record<Coord, TileCell>;
  bag: Coord[];
  /** dead tiles traded in and permanently out of play; `placed + hands + bag + discarded` is always 108 */
  discarded: Coord[];
  log: LogEntry[];
  nextStepId: number;
  //   startups: Record<string, Startup>;
  startups: Record<string, Startup>; //all
  // availableStartups: string[]; //available ids
  currentBuyCount?: number; //how many shares bought this turn
  mergerContext?: MergerContext;
  pendingFoundTile?: Coord; //when in foundStartup stage, which tile is being used to found
  pendingMergerTile?: Coord; //when in chooseSurvivor stage, which tile triggered the merger
  pendingTiedStartups?: string[]; //when in chooseSurvivor stage, which startups are tied
  pendingMergerStartups?: string[]; //when in chooseSurvivor stage, all touching startup IDs
  pendingTileToRemove?: Coord; //tile that was placed but not yet removed from hand/drawn
  lastAction?: string; //for UI hints
  pendingLiquidations?: string[]; //playerId -> shares to liquidate
  currentLiquidation?: string | null; //index in liquidation order
  pendingBonuses?: BonusResult[]; //computed majority/minority bonuses, awaiting finalizeMergerPayout
  gameId?: string; // Multiplayer: unique game instance ID
  createdAt?: number; // Multiplayer: timestamp when game was created
  lastUpdated?: number; // Multiplayer: timestamp of last state update
}
