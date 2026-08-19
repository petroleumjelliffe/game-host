import { GameState, Player, Startup } from './gameTypes';
import { createInitialGame } from './gameInit';
import { Coord, generateAllCoords } from './gameHelpers';

/**
 * Creates a minimal game state for testing
 */
export function createTestGameState(overrides?: Partial<GameState>): GameState {
  const base = createInitialGame('test-seed', ['Alice', 'Bob']);
  return {
    ...base,
    ...overrides,
  };
}

/**
 * Creates a test player with default values
 */
export function createTestPlayer(overrides?: Partial<Player>): Player {
  return {
    id: 'test-player-1',
    name: 'Test Player',
    emoji: '🦊',
    cash: 6000,
    hand: [],
    portfolio: {},
    ...overrides,
  };
}

/**
 * Creates a test startup with default values
 */
export function createTestStartup(overrides?: Partial<Startup>): Startup {
  return {
    id: 'TestCo',
    tier: 1,
    ticker: '$X',
    tiles: [],
    isFounded: false,
    foundingTile: null,
    totalShares: 25,
    availableShares: 25,
    ...overrides,
  };
}

/**
 * Sets up a game state with founded startups on the board.
 * `tiles` may be an explicit list of coords, or a count — in which case
 * that many coords are auto-assigned from the board (useful when a test
 * only cares about chain size, not specific placement).
 */
export function setupGameWithStartups(
  startups: Array<{ id: string; tiles: Coord[] | number; tier?: 0 | 1 | 2 }>
): GameState {
  const state = createTestGameState();
  const autoCoords = generateAllCoords();
  let autoCursor = 0;

  // Found each startup and place tiles
  startups.forEach(({ id, tiles, tier = 1 }) => {
    const startup = state.startups[id];
    if (startup) {
      startup.isFounded = true;
      startup.tier = tier;

      const coords = Array.isArray(tiles)
        ? tiles
        : autoCoords.slice(autoCursor, (autoCursor += tiles));

      startup.foundingTile = coords[0] ?? null;

      // Place tiles on board
      coords.forEach((coord) => {
        state.board[coord] = {
          placed: true,
          startupId: id,
        };
      });
    }
  });

  return state;
}

/**
 * Gives shares to a player
 */
export function giveShares(
  state: GameState,
  playerId: string,
  shares: Record<string, number>
): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;

  Object.entries(shares).forEach(([startupId, count]) => {
    player.portfolio[startupId] = (player.portfolio[startupId] || 0) + count;
    const startup = state.startups[startupId];
    if (startup) {
      startup.availableShares -= count;
    }
  });
}

/**
 * Gets the size of a startup (number of tiles)
 */
export function getStartupSize(state: GameState, startupId: string): number {
  return Object.values(state.board).filter(
    (cell) => cell.startupId === startupId
  ).length;
}
