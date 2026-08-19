import type { GameState } from '../engine/gameTypes';
import type { Intent, IllegalIntentCode } from '../engine/intents';
import type { LobbyRejectionCode } from '../vendor/lobby/protocol/protocol';

/**
 * `Omit` does not distribute over a union: `Omit<Intent, 'playerId'>` collapses
 * nine members into one object carrying only their common keys, and
 * `placeTile`'s `coord` disappears. This preserves the union, so a
 * `WireIntent` narrows on `type` exactly as an `Intent` does.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * An intent as it travels: no `playerId`.
 *
 * The server fills that in from the socket binding, which makes claiming to be
 * another player unrepresentable rather than merely rejected — and that is what
 * makes projection a boundary rather than a decoration.
 *
 * Derived from `Intent` rather than restated, so a new engine intent cannot
 * silently fail to reach the wire.
 */
export type WireIntent = DistributiveOmit<Intent, 'playerId'>;

/**
 * Narrows an arbitrary wire payload to `WireIntent` before it ever reaches
 * `room.dispatch`.
 *
 * A missing or wholly malformed payload is not the hazard: `{...undefined}`
 * is `{}`, and the engine's own `applyIntent` default branch rejects an
 * object with no recognised `type`. The hazard is a payload with a *valid*
 * `type` and a malformed field — `{ type: 'buyShares' }` with no `picks`,
 * or `{ type: 'tradeInDeadTiles', coords: 5 }` — because every variant's
 * handler in `engine/intents.ts` dereferences that field (`.length`, a
 * `for...of`, a spread into `Set`) before any validation runs. That throws
 * synchronously inside a socket.io listener, which socket.io does not catch,
 * which takes the whole process down for every room on it, not just the
 * sender's. This function is what stands between an arbitrary payload and
 * that dereference: array fields must actually be arrays, numeric fields
 * actually numbers, string fields actually strings, before `withPlayer`
 * ever hands the result to the engine as a trusted `Intent`.
 *
 * Field-level only — it does not check that `coord` names a real board
 * square or `startupId` a real startup. Those stay the engine's job
 * (`tileNotInHand`, `brandUnavailable`, …), which already rejects them
 * cleanly; nothing downstream dereferences an unvalidated *value*, only an
 * unvalidated *shape*.
 */
export function isWireIntent(wire: unknown): wire is WireIntent {
  if (typeof wire !== 'object' || wire === null) return false;
  const w = wire as Record<string, unknown>;

  switch (w.type) {
    case 'drawTurnOrderTile':
    case 'declareEnd':
    case 'endTurn':
      return true;
    case 'placeTile':
      return typeof w.coord === 'string';
    case 'chooseFoundingBrand':
    case 'chooseSurvivor':
      return typeof w.startupId === 'string';
    case 'liquidate':
      return (
        typeof w.startupId === 'string' &&
        typeof w.sell === 'number' &&
        typeof w.trade === 'number' &&
        typeof w.keep === 'number'
      );
    case 'buyShares':
      return Array.isArray(w.picks) && w.picks.every((p) => typeof p === 'string');
    case 'tradeInDeadTiles':
      return Array.isArray(w.coords) && w.coords.every((c) => typeof c === 'string');
    default:
      return false;
  }
}

/**
 * The intent types that draw from the bag, and therefore the only ones whose
 * result a projected client cannot compute for itself.
 *
 * One definition, three consumers: `server/room.ts` decides which accepted
 * mid-segment intents still owe their author a `correction`;
 * `server/projection.test.ts` decides which steps the projection-equivalence
 * proof must skip; and `src/net/NetworkSession.ts` decides which intents it
 * may apply optimistically. Phase 3a shipped the first two as independent
 * copies and its carry-forward flagged the third as the moment that breaks:
 * a new bag-drawing intent added to only one of them would stop producing
 * its correction, silently narrow the equivalence proof to cover less than
 * it claims, and mispredict on the client — with no test failing either way.
 */
export const DRAWS = new Set<WireIntent['type']>(['endTurn', 'tradeInDeadTiles', 'drawTurnOrderTile']);

/**
 * Strips identity for the wire — the exact inverse of `server/room.ts`'s
 * `withPlayer`.
 *
 * Same cast, same reason: spreading a discriminated union produces a type
 * TypeScript will not narrow back to that union, even though every `Intent`
 * minus its `playerId` is by construction a `WireIntent`. Confined to this
 * one line so no caller ever needs one.
 */
export function toWire(intent: Intent): WireIntent {
  const { playerId: _identity, ...wire } = intent;
  return wire as WireIntent;
}

/**
 * Everything the engine can refuse, plus the refusals the engine knows nothing
 * about.
 *
 * Undo is not an intent — it never reaches `applyIntent` — so
 * `IllegalIntentCode` has no word for "that step belongs to a segment you no
 * longer own".
 *
 * The rest of what this file adds is `LobbyRejectionCode` — `notConnected`,
 * `noSuchRoom`, `seatRefused`, `versionMismatch` — documented in
 * `lobby/protocol.ts`, where those refusals live now that the lobby is
 * game-agnostic.
 *
 * Adding these here keeps `engine/` untouched.
 */
export type RejectionCode =
  | IllegalIntentCode
  | 'undoOutOfSegment'
  | LobbyRejectionCode;

/**
 * Why a state arrived.
 *
 * `commit` went to the whole table; `correction`, `reset` and `resume` went to
 * one player. Tests assert on this: "a non-actor never receives a correction"
 * is the draft-privacy guarantee, stated directly.
 *
 * `resume` is what a rejoining socket gets. It is deliberately not `commit`:
 * `sendState`'s draft rule keys off "is this a commit", so sending `commit`
 * here handed a reconnecting actor the state at the *start* of their turn
 * while the server still held their open draft — and their next intent then
 * landed on a state they could not see. `resume` is also not `reset`, because
 * a reset is the rollback half of a rejection and deliberately preserves the
 * error explaining it; a resume has nothing to explain and should clear one.
 */
export type StateReason = 'commit' | 'correction' | 'reset' | 'resume';

export interface StateMessage {
  /** Projected for this recipient: no seed, no bag, no other player's hand. */
  state: GameState;
  reason: StateReason;
  segmentStart: number;
  /**
   * Where the segment before the open one began, when there is one.
   *
   * The client can derive this by watching `segmentStart` change across
   * messages, and does — but a client rebuilt from a single message after a
   * refresh has no earlier message to have watched. Sending it is what lets
   * the step stack show the previous turn immediately rather than after the
   * next commit.
   */
  previousSegmentStart?: number;
}

/**
 * What "the wire" currently is.
 *
 * Bump this when the shape of anything on either half of the wire changes:
 * `WireIntent`, `StateMessage`, `RejectionCode`, `UndoMessage`,
 * `GAME_CLIENT_EVENTS` or `GAME_SERVER_EVENTS` here, or `JoinedMessage`,
 * `RosterMessage`, `CreateRoomMessage`, `JoinRoomMessage`,
 * `RenamePlayerMessage`, `LOBBY_CLIENT_EVENTS` or `LOBBY_SERVER_EVENTS` in
 * `lobby/protocol.ts`. This constant is the one thing both files share, which
 * is why it lives here rather than in either half alone — it is the only
 * place that knows what "changed" means for the wire as a whole.
 *
 * Skew runs in **both** directions in this deployment. The client ships to
 * GitHub Pages and the server to Render, independently, so either can be the
 * newer one. Anything checking this must compare for equality, not for "at
 * least".
 *
 * Today a stale client fixes itself on the next reload. That stops being true
 * the moment a service worker makes an old client durable, which is the reason
 * this landed before the PWA rather than inside it.
 *
 * 2 (2026-08-07): `renamePlayer` and `leaveSeat` — the lobby's own-row edit,
 * and giving your seat up, from the Lobby Flow design. The first bump this
 * constant ever took, hours after it landed. Its shape was corrected once more
 * before deploying (`name` became optional) *without* a further bump, because
 * v2 was not live yet and no client spoke it.
 *
 * 3 (2026-08-08): `startGame` out, `drawTurnOrderTile` in. The opening draw is
 * now one player's own move rather than one intent that drew for the whole
 * table. Unlike the v2 correction above this is a true cutover — v2 *is*
 * deployed — so every open client takes the stale-client screen once.
 */
export const PROTOCOL_VERSION = 3;

export interface UndoMessage { stepId: number }

export const GAME_CLIENT_EVENTS = {
  intent: 'intent',
  undo: 'undo',
} as const;

export const GAME_SERVER_EVENTS = {
  state: 'state',
} as const;
