// The game half of the wire. Self-contained: imports nothing, like the
// lobby's protocol file. Both halves of the app read the same TUNING, so the
// client and server cannot drift on a number neither had to be told.

export const PROTOCOL_VERSION = 1;
export const APP_ID = 'marco-polo';
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const SEAT_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] as const;

/** Arena units: a circle of radius `arenaRadius` centered at the origin. */
export const TUNING = {
  arenaRadius: 1,
  avatarRadius: 0.045,
  baseSpeed: 0.22,
  turboMultiplier: 2,
  turboFullSeconds: 1.5,
  turboRechargeSeconds: 8,
  roundSeconds: 90,
  graceSeconds: 30,
  endRadiusFraction: 0.35,
  callCooldownSeconds: 5,
  replyDelaySeconds: 1,
  tickHz: 20,
} as const;

export type Role = 'marco' | 'polo';
export type GamePhase = 'grace' | 'shrinking' | 'betweenRounds';

/** Client → server. Both coords are numbers, or both null ("stop"). */
export interface InputMessage {
  tx: number | null;
  ty: number | null;
  turbo: boolean;
}

/**
 * One player in a snapshot. `x`/`y` are ABSENT (not null) when the viewer may
 * not know them: a Marco viewer receives Polo entries without coordinates.
 */
export interface SnapshotPlayer {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
  x?: number;
  y?: number;
}

export interface YouState {
  /** 0..1 */
  turbo: number;
  /** Seconds until MARCO is ready; null when the viewer is not Marco. */
  callCooldown: number | null;
}

export interface StateMessage {
  round: number;
  phase: GamePhase;
  /** Whole seconds remaining in the round (ceil). */
  timer: number;
  ringRadius: number;
  marcoId: string;
  you: YouState;
  players: SnapshotPlayer[];
  scores: Record<string, number>;
}

/**
 * One-shot occurrences. Positions are stamped at emission time — a ripple
 * marks where the sound happened, and does not track the player afterward.
 */
export type GameEvent =
  | { type: 'call'; x: number; y: number }
  | { type: 'reply'; playerId: string; x: number; y: number }
  | { type: 'roundStart'; round: number; marcoId: string }
  | {
      type: 'roundEnd';
      reason: 'catch' | 'timeout';
      caughtId: string | null;
      nextMarcoId: string;
      scores: Record<string, number>;
    };

/**
 * Wire wrapper for `gameEvent` broadcasts. Socket.io channels are per-room
 * for lobby purposes, but a socket that hops from room A to room B stays
 * subscribed to A's channel (the vendor lobby never leaves it) — so events
 * are tagged with the room they belong to, and receivers filter by roomId.
 */
export interface GameEventEnvelope {
  roomId: string;
  event: GameEvent;
}

export const GAME_CLIENT_EVENTS = {
  input: 'input',
  call: 'call',
  nextRound: 'nextRound',
} as const;

export const GAME_SERVER_EVENTS = {
  state: 'gameState',
  event: 'gameEvent',
} as const;
