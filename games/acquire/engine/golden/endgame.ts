import type { GoldenGame } from './types';
import type { Coord, Row } from '../gameHelpers';

const row = (letter: Row, n: number): Coord[] =>
  Array.from({ length: n }, (_, i) => `${letter}${i + 1}` as Coord);

const G8: GoldenGame = {
  id: 'G8',
  title: 'safe chains cannot merge, and the tile between them is dead',
  setup: {
    players: [
      { name: 'Alex', cash: 4200, hand: ['C6', 'G6'], shares: { Messla: 4, ZuckFace: 2 } },
      { name: 'Sam',  cash: 5800 },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 11) },
      { id: 'ZuckFace', coords: row('D', 11) },
    ],
    bag: ['I12'],
  },
  steps: [
    {
      name: 'C6 sits between two safe chains and is refused',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C6' },
      expectError: 'illegalPlacement',
    },
    {
      name: 'trading it in draws a replacement and the turn continues',
      intent: { type: 'tradeInDeadTiles', playerId: 'p1', coords: ['C6'] },
      then: { stage: 'play', hand: { p1: ['G6', 'I12'] }, logPhases: ['Traded a tile'] },
    },
    {
      // G6 is genuinely placeable (confirmed by the very next step), so
      // trading it in as though it were dead must be refused rather than
      // silently accepted.
      name: 'G6 is merely awkward, not dead, so trading it in is refused',
      intent: { type: 'tradeInDeadTiles', playerId: 'p1', coords: ['G6'] },
      expectError: 'notADeadTile',
    },
    {
      name: 'the turn really does continue — G6 is still placeable',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'G6' },
      then: { stage: 'buy', boardOwner: { G6: null } },
    },
  ],
  final: { chainSize: { Messla: 11, ZuckFace: 11 } },
};

// Gobble is tier 2 (AVAILABLE_STARTUPS in engine/startups.ts). At size 41,
// getSharePriceAtSize walks SIZE_THRESHOLDS = [2,3,4,5,6,11,21,31,41] and lands
// on the last band (index 8): TIER0_PRICES[8] = 1000, plus tier * 100 = 200,
// giving a share price of $1200 — NOT the brief's $1000. (Task 6's ledger hit
// this exact trap: "fixture prices recomputed from engine: Gobble $1200 (doc
// said 1000)".) Re-derived from computeChainBonuses (engine/bonuses.ts):
// holders sorted by shares desc are Alex(6), Sam(3), Jordan(1). Alex is the
// sole top holder → majorityPot = price * 10 = $12,000. Sam is the sole
// runner-up → minorityPot = price * 5 = $6,000. Jordan holds neither the top
// nor the runner-up share count, so gets no bonus.
//   p1 (Alex):   cash 8600  + stock 6 * 1200 = 7200  + majority 12000 = 27800
//   p2 (Sam):    cash 12000 + stock 3 * 1200 = 3600  + minority 6000  = 21600
//   p3 (Jordan): cash 3100  + stock 1 * 1200 = 1200  + none           = 4300
const G9: GoldenGame = {
  id: 'G9',
  title: 'end by 41 tiles, declared',
  setup: {
    players: [
      { name: 'Alex',   cash: 8600, hand: ['D5'], shares: { Gobble: 6 } },
      { name: 'Sam',    cash: 12000, shares: { Gobble: 3 } },
      { name: 'Jordan', cash: 3100,  shares: { Gobble: 1 } },
    ],
    // rows A, B, C full (12 each) + D1..D4 = 40; D5 makes 41
    chains: [{ id: 'Gobble', coords: [...row('A', 12), ...row('B', 12), ...row('C', 12), ...row('D', 4)] }],
  },
  steps: [
    {
      name: 'Alex places the 41st tile',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'D5' },
      then: { stage: 'buy', chainSize: { Gobble: 41 } },
    },
    {
      name: 'Alex declares the end',
      intent: { type: 'declareEnd', playerId: 'p1' },
      then: { stage: 'end', logPhases: ['Game over'] },
    },
  ],
  final: {
    stage: 'end',
    finalScoreTotals: {
      p1: 8600 + 6 * 1200 + 12000,  // cash + stock (6 × $1200) + majority bonus
      p2: 12000 + 3 * 1200 + 6000,  // cash + stock (3 × $1200) + minority bonus
      p3: 3100 + 1 * 1200,          // cash + stock (1 × $1200), no bonus
    },
    // Confirmed by calling finalScore(state).bonuses directly at this exact
    // state: Gobble is still founded (it's the survivor, never absorbed),
    // so — unlike a merged-away chain — its bonus report is actually
    // observable here. Jordan holds neither top nor runner-up share count,
    // so gets no entry at all (an absent key, not a zero-amount one).
    finalScoreBonuses: {
      p1: [{ chainId: 'Gobble', type: 'majority', amount: 12000 }],
      p2: [{ chainId: 'Gobble', type: 'minority', amount: 6000 }],
      p3: [],
    },
  },
};

const G10: GoldenGame = {
  id: 'G10',
  title: 'end because every founded chain is safe, declared',
  setup: {
    players: [
      { name: 'Alex', cash: 1000, hand: ['H8'], shares: { Messla: 5 } },
      { name: 'Sam',  cash: 2000, shares: { ZuckFace: 4 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 12) },
      { id: 'ZuckFace', coords: row('D', 11) },
    ],
    stage: 'buy',
  },
  steps: [
    {
      name: 'the end is available with both chains safe',
      intent: { type: 'declareEnd', playerId: 'p1' },
      then: { stage: 'end', logPhases: ['Game over'] },
    },
  ],
};

const G11: GoldenGame = {
  id: 'G11',
  title: 'end condition met but declined — play continues',
  setup: {
    players: [
      { name: 'Alex', cash: 1000, hand: ['H8'], shares: { Messla: 5 } },
      { name: 'Sam',  cash: 2000, hand: ['H10'] },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 12) },
      { id: 'ZuckFace', coords: row('D', 11) },
    ],
    stage: 'buy',
    bag: ['I12'],
  },
  steps: [
    {
      name: 'Alex declines and simply ends the turn instead',
      intent: { type: 'endTurn', playerId: 'p1' },
      then: { stage: 'play', currentPlayer: 'p2' },
    },
    {
      name: 'Sam takes a normal turn — the game is still running',
      intent: { type: 'placeTile', playerId: 'p2', coord: 'H10' },
      then: { stage: 'buy', currentPlayer: 'p2', boardOwner: { H10: null } },
    },
    {
      name: 'Sam can still declare the end later',
      intent: { type: 'declareEnd', playerId: 'p2' },
      then: { stage: 'end' },
    },
  ],
};

/**
 * G14: the game can always be ended — declaring from `play` when there is
 * nothing to place.
 *
 * `declareEnd` used to require `stage: 'buy'`, and the only route to `buy`
 * is placing a tile. Once the bag and every hand were empty, nobody could
 * reach `buy` again: `endTurn` succeeded forever and `declareEnd` was
 * rejected forever, so a game that had met its end condition could never
 * terminate. G11 above makes declining explicitly legal, which is exactly
 * how play arrives here.
 *
 * The fix is gated, and steps 1–2 pin the gate: while Alex still holds a
 * playable tile he must play it, so `declareEnd` from `play` is refused.
 * An ungated version would let a player skip a placement to freeze the
 * board, which is a strategic change rather than a bug fix.
 */
const G14: GoldenGame = {
  id: 'G14',
  title: 'declaring the end from play when no tile can be placed',
  setup: {
    players: [
      { name: 'Alex', cash: 1000, hand: ['H8'], shares: { Messla: 5 } },
      { name: 'Sam',  cash: 2000, hand: [],     shares: { ZuckFace: 4 } },
    ],
    // Both chains safe, so the end condition is met throughout.
    chains: [
      { id: 'Messla',   coords: row('B', 12) },
      { id: 'ZuckFace', coords: row('D', 11) },
    ],
    stage: 'play',
    bag: [],
  },
  steps: [
    {
      name: 'Alex still has a playable tile, so he cannot declare instead of placing',
      intent: { type: 'declareEnd', playerId: 'p1' },
      expectError: 'wrongStage',
    },
    {
      name: 'he places it, which puts him in buy where declaring already worked',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'H8' },
      then: { stage: 'buy', hand: { p1: [] }, boardOwner: { H8: null } },
    },
    {
      name: 'he declines to end; the empty bag leaves him with no tiles at all',
      intent: { type: 'endTurn', playerId: 'p1' },
      then: { stage: 'play', currentPlayer: 'p2', hand: { p1: [] } },
    },
    {
      name: 'Sam has an empty hand and can never reach buy — he declares from play',
      intent: { type: 'declareEnd', playerId: 'p2' },
      then: { stage: 'end', logPhases: ['Game over'] },
    },
  ],
  final: { stage: 'end' },
};

/**
 * G15: pins the `declareEnd` guard itself — without it, this game would pass
 * unchanged (G10 alone doesn't prove the guard exists, since it only ever
 * exercises the condition-met branch). Messla stands at size 5, well below
 * `SAFE_SIZE` (11), and no chain has reached `END_SIZE` (41), so the end
 * condition is unmet and `declareEnd` must be refused.
 *
 * Verified experimentally per the task brief: with `doDeclareEnd`'s
 * `if (!condition.met) reject('endNotAvailable')` line commented out, this
 * game fails — `condition.reasons[0]` is then `undefined` and the very next
 * line (`reason.kind`) throws a bare `TypeError`, which the runner's
 * `toBeInstanceOf(IllegalIntentError)` check correctly rejects as not the
 * expected `endNotAvailable` rejection. Restoring the line makes it pass
 * again. See task-6-report.md for the full transcript.
 */
const G15: GoldenGame = {
  id: 'G15',
  title: 'declareEnd is refused when the end condition is unmet',
  setup: {
    players: [
      { name: 'Alex', cash: 1000, hand: ['H8'], shares: { Messla: 5 } },
      { name: 'Sam',  cash: 2000 },
    ],
    chains: [{ id: 'Messla', coords: row('B', 5) }],   // size 5 — not safe, not 41
    stage: 'buy',
  },
  steps: [
    {
      name: 'no chain is safe and none has reached 41 — the end is not available',
      intent: { type: 'declareEnd', playerId: 'p1' },
      expectError: 'endNotAvailable',
    },
  ],
};

export const ENDGAME_GAMES: GoldenGame[] = [G8, G9, G10, G11, G14, G15];
