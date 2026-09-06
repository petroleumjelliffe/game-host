// packages/host/contract.ts
// What a host gives a game, and what a game must be able to say back.
//
// Three games implement this and one process composes them. Until now each
// game owned a process: it created its own Express app, its own HTTP server,
// its own port, and shut all three down when it stopped. A game that is one
// of three owns none of those things, and every interface below exists to
// draw that line somewhere a compiler can see it.

import type { Server as HttpServer } from 'node:http';
import type { Express } from 'express';
import type { Server as SocketServer } from 'socket.io';

/**
 * A game, as the turn-notification service sees it.
 *
 * The lobby is deliberately turn-agnostic, so "whose turn is it" can only
 * come from each game — and each game already has the three capabilities
 * below sitting on its registry and socket wiring. Registering hands the
 * service closures over them; nothing about rooms or game state crosses the
 * boundary.
 */
export interface NotifyGameRegistration {
  /** Stable id, filename-safe (`[a-z0-9-]+`) — keys persisted per-room notification state. */
  gameId: string;
  /** Display name, for the notification text ("Rail Baron — your turn"). */
  title: string;
  /** Path (origin-relative) that deep-links a player back into the room. */
  roomPath(roomId: string): string;
  /**
   * Whether this player has a live socket in this room *right now* — asked
   * when the debounce fires, not when the turn changed, so a player who
   * stepped away for less than the window is never notified.
   */
  isConnected(roomId: string, playerId: string): boolean;
  /**
   * Whether this token is the seat's rejoin token. Binding a notification
   * profile to a seat must prove the seat is yours, and the token the lobby
   * minted at seating is the only proof of identity that exists — with the
   * seat key (below, `getSeatCredentials`) as its emailed proxy: notify may
   * hand these credentials to whoever presents a valid emailed key.
   */
  verifySeat(roomId: string, playerId: string, token: string): boolean;
  /**
   * Allocate a pending seat for an invite, or refuse (room full, room gone,
   * game past its lobby). The hash is the invite token's — the lobby stores
   * only the hash, never the token and never an address. `name` is the
   * invited contact's display name for the roster, or null for an email
   * invite, where no name may appear. Optional: a game without it cannot
   * host invites, and notify refuses accordingly.
   */
  reserveSeat?(roomId: string, tokenHash: string, name: string | null): string | null;
  /**
   * Convert the pending seat matching this invite-token hash into a held
   * seat with a freshly minted token. One shaped `null` for every failure —
   * absent room, absent hash, already claimed — so the claim endpoint
   * cannot be a probe. The seat's name rides along because the claiming
   * client must write a whole identity record.
   */
  claimSeat?(roomId: string, tokenHash: string): { playerId: string; token: string; name: string } | null;
  /**
   * The seat's live credentials, for seat-key redemption: notify hands them
   * to whoever presents a valid emailed key. A pure read — no side effects,
   * it runs on every emailed-link click.
   */
  getSeatCredentials?(roomId: string, playerId: string): { playerId: string; token: string; name: string } | null;
}

/** What a registered game calls back into. */
export interface GameTurnReporter {
  /**
   * The current player changed. `turnKey` must be distinct per turn within a
   * room (a move counter serialises fine) — it is the once-per-turn dedupe
   * key, persisted so a restart cannot re-notify. `null` player clears any
   * pending notification (game over, room reset).
   */
  turnChanged(roomId: string, currentPlayerId: string | null, turnKey: string): void;
  /**
   * A seat emptied outside normal disconnect: a revoked invite, a pending
   * seat cleared when the game began, a lobby leaver. Notify drops the
   * seat's profile bindings (seat ids are reused, and a stale binding would
   * union strangers into one seat) and marks the seat's unclaimed invites
   * dead, so a re-invite reserves fresh instead of re-mailing a dead token.
   */
  seatVacated?(roomId: string, playerId: string): void;
  /** The room is gone; drop its bindings and markers. */
  roomRemoved(roomId: string): void;
}

/** The host-level turn-notification service, as lent to a game. */
export interface TurnNotifier {
  registerGame(registration: NotifyGameRegistration): GameTurnReporter;
}

/** What the host lends a game. Everything here belongs to the host. */
export interface HostContext {
  /**
   * The one Express app. A game adds routes under its own base path and
   * nowhere else: a root-mounted route in a composed process either shadows
   * another game's or is shadowed by it, and which one depends on mount
   * order, which is not a thing anyone should have to reason about.
   */
  app: Express;
  /**
   * The one HTTP server, for socket.io to attach to. A game never listens on
   * it and never closes it — see `MountedGame.close`.
   */
  httpServer: HttpServer;
  /**
   * Where this game may persist, already created by the host.
   *
   * Absent for a game that persists nothing (Marco Polo), rather than
   * present-and-unused: an empty directory nobody writes to is a question
   * somebody eventually has to answer.
   *
   * Absolute, always. A relative save path resolves against the working
   * directory, a service's working directory is wherever its plist says, and
   * the failure mode is every saved room appearing to vanish at once.
   */
  dataDir?: string;
  /**
   * The turn-notification service, when the host runs one. Absent in
   * standalone boots and in tests that don't care, rather than a null
   * object — a game guards one call site (`ctx.notify?.registerGame(…)`)
   * and everything downstream holds an optional reporter.
   */
  notify?: TurnNotifier;
}

/** What a game hands back, so the host can describe it and stop it. */
export interface MountedGame {
  /** The URL prefix this game answered on. Also its menu link. */
  basePath: string;
  /** Display name, for the generated menu. */
  title: string;
  /**
   * What this build speaks. The host aggregates all three into one
   * `/health`, so "what is deployed?" is one curl rather than a trip to a
   * hosting dashboard — which is what it took on 2026-08-07.
   */
  version(): { protocolVersion: number; saveVersion?: number };
  io: SocketServer;
  /**
   * Stops this game and nothing else.
   *
   * **Do not call `io.close()` here.** socket.io's `Server.close()` ends with
   * `this.httpServer.close()`, and `initEngine` sets `this.httpServer` to
   * whatever server it attached to — so in a composed process the first game
   * to close would take the listener down for the other two. (Verified in
   * `node_modules/socket.io/dist/index.js`: the assignment at the end of
   * `initEngine`, the close at the end of `close`.)
   *
   * The scoped equivalent is `io.disconnectSockets(true)` followed by
   * `io.engine.close()`: each attached engine owns its own `ws` server and
   * its own clients, so closing one leaves the others untouched.
   *
   * Exactly one thing closes the shared HTTP server, and it is whoever
   * created it — the host in composition, the standalone wrapper alone —
   * after every `close()` here has resolved.
   *
   * Asynchronous because stopping is not always instant: Rail Baron drains
   * in-flight saves first (`rooms.settled()`), or a room comes back a move
   * behind the last one played.
   */
  close(): Promise<void>;
}

/**
 * A game, as the host sees it.
 *
 * Asynchronous because a game with saves restores them here, before the host
 * listens — which is what makes "no socket can race the restore" true by
 * construction rather than by luck.
 */
export type Mount = (ctx: HostContext) => Promise<MountedGame>;
