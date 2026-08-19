import type { Coord } from '../../../engine/gameHelpers';
import type { GameState, StartupId } from '../../../engine/gameTypes';
import { isStartupId } from '../../../engine/startups';

/** The log phase a tile placement is filed under. */
const PLACED = 'Placed a tile';
/** …and a founding. */
const FOUNDED = 'Founded a startup';

/**
 * Where each player last played, badged with their emoji.
 *
 * Derived from the log rather than read off `Player.lastPlacedTile`, which
 * looks like the right field and is not: it means "the tile placed this turn,
 * still undoable" and is cleared the moment it stops being either
 * (`engine/gameLogic.ts`). A board marker has to outlive the turn that made
 * it, or the board forgets who played what the moment play moves on.
 *
 * Deriving it also makes undo correct for free: rewinding restores the log
 * with the rest of the state, so a taken-back placement takes its badge with
 * it. Nothing here has to know that undo exists.
 *
 * The turn-order draw is deliberately not a placement — its entries are filed
 * under a different phase and carry every player's tile under the single
 * playerId of whoever pressed the button, which would badge the whole opening
 * board with seat one's emoji.
 */
export function ownerBadges(state: GameState): Partial<Record<Coord, string>> {
  const lastPlayed: Record<string, Coord> = {};

  for (const entry of state.log) {
    if (entry.playerId === undefined || entry.phase !== PLACED) continue;
    const tile = entry.detail.find((token) => token.kind === 'tile');
    if (tile?.kind === 'tile') lastPlayed[entry.playerId] = tile.coord;
  }

  const badges: Record<string, string> = {};
  for (const [playerId, coord] of Object.entries(lastPlayed)) {
    const emoji = state.players.find((p) => p.id === playerId)?.emoji;
    if (emoji) badges[coord] = emoji;
  }
  return badges;
}

/**
 * The tile most recently put on the board, by anyone.
 *
 * Not `Player.lastPlacedTile`, which is per player and means "still undoable";
 * this is the single newest placement in the game, which is the one thing a
 * board arriving from someone else's turn should draw the eye to. Read from
 * the log for the same reason `ownerBadges` is: the log is the only record
 * that survives a commit.
 *
 * A whole turn can arrive in one message online — a placement, a founding,
 * three purchases — and only the placement moved a tile, so animating "what
 * changed" means animating this one cell and nothing else.
 */
export function lastPlacedTile(state: GameState): Coord | null {
  for (let i = state.log.length - 1; i >= 0; i -= 1) {
    const entry = state.log[i]!;
    if (entry.phase !== PLACED) continue;
    const tile = entry.detail.find((token) => token.kind === 'tile');
    if (tile?.kind === 'tile') return tile.coord;
  }
  return null;
}

/**
 * The tile each founded chain grew from — the one cell per chain the board
 * labels with its ticker.
 *
 * The engine has tracked this all along (`Startup.foundingTile`); the board
 * has had a prop for it all along (`hqTiles`); nothing ever connected the two,
 * so every chain rendered as an undifferentiated block of colour and there was
 * no way to see where one began.
 */
export function foundingTiles(state: GameState): Coord[] {
  return Object.values(state.startups)
    .map((startup) => startup.foundingTile)
    .filter((coord): coord is Coord => coord != null);
}

/**
 * The brand founded during the open segment, if any — the one whose shares are
 * on sale for the first time this turn.
 *
 * The prototype badged it and the port lost it, which matters most in the buy
 * step: a chain founded moments ago looks exactly like one that has been on
 * the board for ten turns, and the price difference between them is the whole
 * game.
 *
 * Bounded to the open segment, so it is "new" for the turn that founded it and
 * ordinary from the next turn on. Derived from the log for the same reason
 * `ownerBadges` is: undo rewinds the log, so taking the founding back takes
 * the badge with it.
 */
export function foundedThisTurn(state: GameState, segmentStart: number): StartupId | null {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const entry = state.log[i]!;
    if (entry.stepId < segmentStart) break;
    if (entry.phase !== FOUNDED) continue;
    // From the payload, which is where the founding step keeps its startup now
    // that the row renders a share certificate rather than a sentence. Reading
    // a brand token here worked until that changed, and the tests said so.
    const { payload } = entry;
    if (payload?.kind === 'founding' && isStartupId(payload.startupId)) return payload.startupId;
  }
  return null;
}
