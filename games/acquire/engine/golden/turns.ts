import type { GoldenGame } from './types';
import type { Intent } from '../intents';

/**
 * G1: the baseline turn — place, found, buy, end turn, and the next player
 * is up.
 */
const G1: GoldenGame = {
  id: 'G1',
  title: 'baseline turn cycle — place, found, buy, end turn',
  setup: {
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
      { name: 'Sam',  cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  },
  steps: [
    {
      name: 'Alex places E6 beside the lone tile, which opens the founding choice',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'E6' },
      then: {
        stage: 'foundStartup',
        hand: { p1: ['H8'] },
        boardOwner: { E6: null },
        // gameLogic's founding branch logs the placement itself before the
        // founding choice is made — see task-11-report.md for why this was
        // an engine fix, not a golden-game adjustment.
        logPhases: ['Placed a tile'],
      },
    },
    {
      name: 'Alex founds Messla and takes the founder share',
      intent: { type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' },
      then: {
        stage: 'buy',
        founded: { Messla: true },
        chainSize: { Messla: 2 },
        boardOwner: { E5: 'Messla', E6: 'Messla' },
        shares: { p1: { Messla: 1 } },
        availableShares: { Messla: 24 },
        // One action, one entry. `grantFoundingShare` used to log the free
        // share under this same phase, so founding wrote two identical-looking
        // steps; the share shows in the player's holdings instead.
        logPhases: ['Founded a startup'],
      },
    },
    {
      name: 'Alex buys two more Messla at $200 each',
      intent: { type: 'buyShares', playerId: 'p1', picks: ['Messla', 'Messla'] },
      then: {
        stage: 'buy',
        cash: { p1: 6000 - 400 },
        shares: { p1: { Messla: 3 } },
        availableShares: { Messla: 22 },
        logPhases: ['Bought shares'],
      },
    },
    {
      name: 'a fourth share this turn is refused',
      intent: { type: 'buyShares', playerId: 'p1', picks: ['Messla', 'Messla'] },
      expectError: 'tooManyPicks',
    },
    {
      name: 'Sam cannot act while it is Alex’s turn',
      intent: { type: 'endTurn', playerId: 'p2' },
      expectError: 'notYourTurn',
    },
    {
      name: 'Alex ends the turn, refills to two tiles, and Sam is up',
      intent: { type: 'endTurn', playerId: 'p1' },
      then: {
        stage: 'play',
        currentPlayer: 'p2',
        hand: { p1: ['H8', 'I11', 'I12'] },
        logPhases: ['Drew tiles', 'Ended turn'],
      },
    },
    {
      name: 'Sam cannot place a tile she does not hold',
      intent: { type: 'placeTile', playerId: 'p2', coord: 'H8' },
      expectError: 'tileNotInHand',
    },
    {
      // A rejected intent leaves state byte-identical (the runner asserts
      // this), so this can be dropped in anywhere without disturbing the
      // steps around it — `unknownIntent` is checked unconditionally, in
      // applyIntent's own switch default, before any stage/player/hand
      // validation runs at all.
      name: 'a genuinely unknown intent type is rejected',
      // Deliberately malformed: `Intent` is a closed union and no real
      // client can construct this. The cast is the point of the test — it
      // is the one place the catalogue needs a shape the type system would
      // otherwise forbid, to prove applyIntent's default branch works.
      intent: { type: 'bogus', playerId: 'p2' } as unknown as Intent,
      expectError: 'unknownIntent',
    },
    {
      name: 'Sam places an isolated tile and goes straight to buying',
      intent: { type: 'placeTile', playerId: 'p2', coord: 'A1' },
      then: { stage: 'buy', boardOwner: { A1: null }, logPhases: ['Placed a tile'] },
    },
  ],
  final: { stage: 'buy', currentPlayer: 'p2' },
};

/**
 * G12: the degenerate turn — nothing playable, nothing to draw, so the turn
 * simply passes.
 */
const G12: GoldenGame = {
  id: 'G12',
  title: 'bag exhaustion and no legal tile — the turn passes',
  setup: {
    players: [
      { name: 'Alex', cash: 6000, hand: ['C1'] },
      { name: 'Sam',  cash: 6000, hand: ['H8'] },
    ],
    chains: [
      { id: 'Messla',   coords: ['B1','B2','B3','B4','B5','B6','B7','B8','B9','B10','B11'] },
      { id: 'ZuckFace', coords: ['D1','D2','D3','D4','D5','D6','D7','D8','D9','D10','D11'] },
    ],
    bag: [],
  },
  steps: [
    {
      name: 'C1 would merge two safe chains, so it cannot be placed',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      expectError: 'illegalPlacement',
    },
    {
      name: 'the bag is empty, so trading it in leaves the hand a tile short',
      intent: { type: 'tradeInDeadTiles', playerId: 'p1', coords: ['C1'] },
      then: { stage: 'play', hand: { p1: [] }, logPhases: ['Traded a tile'] },
    },
    {
      name: 'with nothing playable the turn simply passes',
      intent: { type: 'endTurn', playerId: 'p1' },
      then: { stage: 'play', currentPlayer: 'p2', hand: { p1: [] } },
    },
  ],
  final: { currentPlayer: 'p2', chainSize: { Messla: 11, ZuckFace: 11 } },
};

/**
 * G16: founding a brand that is already on the board is refused.
 *
 * Fixture-authored directly at the `foundStartup` stage, the same technique
 * `fixtures.ts` documents for boards "that cannot be reached by running
 * intents in a test": within any single golden game, `foundStartup` is only
 * ever reached for the *first* founding — by the time a founded brand
 * exists to collide with, the game has already moved past that stage (see
 * G1 above, whose only `foundStartup` moment is the one where Messla itself
 * gets founded). `doChooseFoundingBrand` checks `startup.isFounded` before
 * it ever looks at `pendingFoundTile`, so no legitimate pending-founding
 * state is needed to reach this rejection.
 */
const G16: GoldenGame = {
  id: 'G16',
  title: 'founding a brand that already exists is refused',
  setup: {
    players: [{ name: 'Alex' }, { name: 'Sam' }],
    chains: [{ id: 'Messla', coords: ['B1', 'B2', 'B3'] }],
    stage: 'foundStartup',
  },
  steps: [
    {
      name: 'Messla is already founded, so choosing it again is refused',
      intent: { type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' },
      expectError: 'brandUnavailable',
    },
  ],
};

/**
 * G17: the opening. Authored bag, so the draw is deterministic without
 * depending on `shuffleSeeded`'s ordering.
 *
 * `hand` is authored here rather than dealt, because `buildFixture` does not
 * deal — the point of this game is the turn-order draw and the starting tiles,
 * not `createInitialGame`'s dealing loop (covered by invariants.test.ts).
 */
const G17: GoldenGame = {
  id: 'G17',
  title: 'the opening — turn order draw, starting tiles stay on the board',
  setup: {
    players: [
      { name: 'Alex', cash: 6000, hand: ['H8'] },
      { name: 'Sam',  cash: 6000, hand: ['C4'] },
    ],
    // Alex draws B4, Sam draws E5. The *highest* coordinate takes the first
    // turn, so Sam goes first. B4 stays on the board as a starting tile and
    // sits directly above C4 — diagonals do not connect, so B3 would found
    // nothing.
    bag: ['B4', 'E5', 'I12'],
    stage: 'draw',
  },
  steps: [
    {
      // Each seat draws its own tile, in order, and the draw passes the turn
      // like any other move — so after Alex draws, the game is still in the
      // draw and it is Sam's turn to act, not Sam's turn to *play*.
      name: 'seat one draws its own tile, and the draw passes to seat two',
      intent: { type: 'drawTurnOrderTile', playerId: 'p1' },
      then: {
        stage: 'draw',
        // `actor`, not `currentPlayer`: turn order does not exist yet, so
        // `turnIndex` is still its initial 0 and means nothing. What has moved
        // is who the rules are waiting on — which is the whole point of the
        // change, and the seam the curtain and the server's commit hang off.
        actor: 'p2',
        boardOwner: { B4: null },
        // Each draw narrates itself. No order is announced yet — that waits
        // for the last tile.
        logPhases: ['Drew for turn order'],
      },
    },
    {
      name: 'the last draw resolves the order; the higher tile takes the first turn',
      intent: { type: 'drawTurnOrderTile', playerId: 'p2' },
      then: {
        stage: 'play',
        currentPlayer: 'p2',
        actor: 'p2',
        boardOwner: { E5: null, B4: null },
        logPhases: ['Drew for turn order', 'Turn order'],
      },
    },
    {
      name: 'Sam builds on a starting tile and founds a chain of two',
      intent: { type: 'placeTile', playerId: 'p2', coord: 'C4' },
      then: { stage: 'foundStartup', logPhases: ['Placed a tile'] },
    },
    {
      name: 'the founded chain includes the starting tile',
      intent: { type: 'chooseFoundingBrand', playerId: 'p2', startupId: 'Messla' },
      then: {
        stage: 'buy',
        chainSize: { Messla: 2 },
        boardOwner: { B4: 'Messla', C4: 'Messla' },
      },
    },
  ],
};

export const TURN_GAMES: GoldenGame[] = [G1, G12, G16, G17];
