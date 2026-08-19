import type { GameState, LogEntry, LogToken } from '../engine/gameTypes.js';

/**
 * Redacts a drawn tile's identity from the log for everyone but the player
 * who now holds it.
 *
 * `tradeInDeadTiles` (`engine/intents.ts:308-334`) logs two coordinates per
 * traded tile: the coord given up, which is public — it lands in
 * `state.discarded`, and `discarded` stays public per this file's own
 * docstring — and the coord drawn to replace it, which lands in the trading
 * player's hand. That second coord is exactly the secret this function's
 * caller redacts everywhere else: every other player's hand. The engine's
 * log is correct for the server's own copy, and `engine/` is read-only for
 * this phase, so the redaction happens here, at the same boundary as
 * everything else `project()` strips.
 *
 * Deliberately general rather than special-cased to `tradeInDeadTiles`: any
 * `tile` token naming a coordinate presently in another player's hand is
 * masked, whichever entry it came from. A future intent that logs a drawn
 * tile is covered without this file changing again.
 */
function projectLog(state: GameState, forPlayerId: string): LogEntry[] {
  const hiddenCoords = new Set(
    state.players.filter((p) => p.id !== forPlayerId).flatMap((p) => p.hand),
  );
  if (hiddenCoords.size === 0) return state.log;

  const hides = (t: LogToken): boolean => t.kind === 'tile' && hiddenCoords.has(t.coord);

  return state.log.map((entry) => {
    if (!entry.detail.some(hides)) return entry;
    return {
      ...entry,
      detail: entry.detail.map((t): LogToken => (hides(t) ? { kind: 'text', text: 'a tile' } : t)),
    };
  });
}

/**
 * The game as one player is allowed to see it.
 *
 * Three fields go and one deliberately stays. `seed` goes because the bag is
 * shuffled once at init and never re-seeded, so the seed alone reconstructs
 * the entire draw order for the rest of the game. `bag` goes for the same
 * reason, more directly. Every other player's `hand` goes because it is the
 * one secret this game actually has. `socketId` goes because it is transport
 * bookkeeping no client has a use for.
 *
 * `discarded` stays: traded-in dead tiles are shown at a real table, and the
 * deduction they permit is legitimate.
 *
 * `log` stays too, but redacted (`projectLog`, above): the narrative reads
 * for everyone, but no entry may name a tile presently sitting in a hand
 * this projection otherwise hides. Without that, the log is a second,
 * unguarded channel for the one secret above — as `tradeInDeadTiles` proved,
 * naming the coordinate it draws to replace a traded-in tile.
 *
 * The shape is unchanged, which is why the component layer renders a
 * projection without modification — the only private field it reads is the
 * viewer's own hand (`src/game/GameScreen.tsx`).
 *
 * Call this at the moment of sending, never earlier and never cached. A
 * projection computed correctly and then broadcast unprojected is the defect
 * this phase most needs to catch, and only the send site can tell them apart.
 */
export function project(state: GameState, forPlayerId: string): GameState {
  return {
    ...state,
    seed: '',
    bag: [],
    players: state.players.map(({ socketId, ...player }) =>
      player.id === forPlayerId ? player : { ...player, hand: [] },
    ),
    log: projectLog(state, forPlayerId),
  };
}
