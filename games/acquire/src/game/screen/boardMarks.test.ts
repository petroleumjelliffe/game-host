import { describe, it, expect } from 'vitest';
import { ownerBadges, foundingTiles, foundedThisTurn, lastPlacedTile } from './boardMarks';
import { buildFixture } from '../../../engine/golden/fixtures';
import { applyIntent } from '../../../engine/intents';
import { createGameSession } from '../../../session/GameSession';
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';

function twoHands() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
      { name: 'Sam', cash: 6000, hand: ['A1', 'B2'] },
    ],
    bag: ['I11', 'I12'],
  });
}

describe('ownerBadges', () => {
  it('badges each player with their own emoji, at their own tile', () => {
    let state = twoHands();
    const [alex, sam] = state.players;

    state = applyIntent(state, { type: 'placeTile', playerId: alex!.id, coord: 'E6' });
    state = applyIntent(state, { type: 'endTurn', playerId: alex!.id });
    state = applyIntent(state, { type: 'placeTile', playerId: sam!.id, coord: 'A1' });

    expect(ownerBadges(state)).toEqual({ E6: alex!.emoji, A1: sam!.emoji });
  });

  it('follows a player forward rather than accumulating their whole history', () => {
    let state = twoHands();
    const [alex, sam] = state.players;

    state = applyIntent(state, { type: 'placeTile', playerId: alex!.id, coord: 'E6' });
    state = applyIntent(state, { type: 'endTurn', playerId: alex!.id });
    state = applyIntent(state, { type: 'placeTile', playerId: sam!.id, coord: 'A1' });
    state = applyIntent(state, { type: 'endTurn', playerId: sam!.id });
    state = applyIntent(state, { type: 'placeTile', playerId: alex!.id, coord: 'H8' });

    // One badge each: where they are now, not everywhere they have been.
    expect(ownerBadges(state)).toEqual({ H8: alex!.emoji, A1: sam!.emoji });
  });

  it('takes the badge back when the placement is taken back', () => {
    // Claimed in the docstring, so checked here rather than asserted: undo
    // rewinds the log with the rest of the state, and the badge is derived
    // from the log, so nothing about undo needs to know badges exist.
    const session = createGameSession({ state: twoHands() });
    const actor = session.getView().actorId!;
    const openedAt = session.getView().state.nextStepId;

    session.dispatch({ type: 'placeTile', playerId: actor, coord: 'E6' });
    expect(ownerBadges(session.getView().state)).toHaveProperty('E6');

    session.undoTo(openedAt);
    expect(ownerBadges(session.getView().state)).toEqual({});
  });

  it('badges nobody for the turn-order draw', () => {
    // The draw puts a tile on the board for every player and files the whole
    // thing under the single id of whoever pressed the button. Counting those
    // as placements badges the opening board with seat one's emoji, on tiles
    // nobody played. A fixture built by hand has no log at all and cannot
    // catch that, so this drives the real opening.
    const session = createGameSession({ seed: 'badge-draw', names: ['Alex', 'Sam'] });
    const opener = session.getView().actorId!;
    session.dispatch({ type: 'drawTurnOrderTile', playerId: opener });

    const state = session.getView().state;
    expect(state.log.length, 'the draw logged nothing to guard against').toBeGreaterThan(0);
    expect(state.log.some((e) => e.detail.some((t) => t.kind === 'tile')), 'the draw logged no tiles')
      .toBe(true);

    expect(ownerBadges(state)).toEqual({});
  });
});

describe('lastPlacedTile', () => {
  it('is the newest placement in the game, whoever made it', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: ['E6'] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        bag: ['I11', 'I12', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
      }),
    });

    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(lastPlacedTile(session.getView().state)).toBe('E6');

    session.dispatch({ type: 'endTurn', playerId: 'p1' });
    session.dispatch({ type: 'placeTile', playerId: 'p2', coord: 'A1' });
    // The other player's tile now, not the viewer's own — which is the case
    // this exists for: someone else's turn arriving on your screen.
    expect(lastPlacedTile(session.getView().state)).toBe('A1');
  });

  it('is null before anything has been placed', () => {
    const state = buildFixture({
      players: [{ name: 'Alex', cash: 6000, hand: ['E6'] }],
    });
    expect(lastPlacedTile(state)).toBeNull();
  });
});

describe('foundingTiles', () => {
  it('names the tile every founded chain grew from', () => {
    const g1 = ALL_GOLDEN_GAMES.find((game) => game.id === 'G1')!;
    const state = replayGoldenGame(g1).at(-1)!;

    const founded = Object.values(state.startups).filter((s) => s.isFounded);
    expect(founded.length, 'G1 no longer founds a chain').toBeGreaterThan(0);

    const tiles = foundingTiles(state);
    expect(tiles).toHaveLength(founded.length);
    // Every one names a tile that is actually on the board, and belongs to the
    // chain that claims it.
    for (const startup of founded) {
      expect(tiles).toContain(startup.foundingTile);
      expect(state.board[startup.foundingTile!].startupId).toBe(startup.id);
    }
  });

  it('names nothing before anything is founded', () => {
    expect(foundingTiles(twoHands())).toEqual([]);
  });
});

describe('foundedThisTurn', () => {
  /** A lone tile with a hand tile beside it: placing founds a chain. */
  function aboutToFound() {
    return buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
    });
  }

  it('names the brand founded in the open segment', () => {
    const session = createGameSession({ state: aboutToFound() });
    expect(foundedThisTurn(session.getView().state, session.getView().segmentStart)).toBeNull();

    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });

    const view = session.getView();
    expect(view.state.stage, 'the founding did not lead to the buy step').toBe('buy');
    expect(foundedThisTurn(view.state, view.segmentStart)).toBe('Messla');
  });

  it('stops calling it new once the turn is over', () => {
    const session = createGameSession({ state: aboutToFound() });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });
    session.dispatch({ type: 'endTurn', playerId: 'p1' });

    const view = session.getView();
    expect(view.actorId, 'the turn did not change hands').toBe('p2');
    // The chain is still on the board; it is simply no longer news.
    expect(foundedThisTurn(view.state, view.segmentStart)).toBeNull();
  });

  it('forgets it when the founding is undone', () => {
    const session = createGameSession({ state: aboutToFound() });
    const opened = session.getView().segmentStart;
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });
    expect(foundedThisTurn(session.getView().state, session.getView().segmentStart)).toBe('Messla');

    session.undoTo(opened);
    expect(foundedThisTurn(session.getView().state, session.getView().segmentStart)).toBeNull();
  });
});
