// packages/notify/records.ts
// What the notification service persists, and the guards that let it trust
// what it reads back. Two record kinds, two directories: profiles (one per
// player key, cross-game — an email address is not any one game's) and room
// bindings (one per game+room — which seat notifies which profile, and the
// last turn each seat was notified for).

/** How a player proves a profile is theirs: a client-minted random secret. */
export const PLAYER_KEY = /^[A-Za-z0-9_-]{16,128}$/;

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: PushSubscriptionKeys;
  addedAt: number;
}

export type EmailStatus = 'pending' | 'confirmed' | 'disabled';

export interface EmailRecord {
  address: string;
  status: EmailStatus;
  /** Single-use confirmation token; present only while `pending`. */
  confirmToken?: string;
  confirmExpiry?: number;
  /** Minted at confirmation; the one-click unsubscribe link, no login required. */
  unsubscribeToken?: string;
  /** Confirmation-send rate limit: at most 3 per address per UTC day. */
  sendDay?: string;
  sendCount?: number;
}

export interface NotifyPrefs {
  push: boolean;
  email: boolean;
}

/**
 * One live value (`played`) and three reserved: the friends spec's
 * deliberately hollow accept/reject stub. The one enforcement point is
 * invite-by-contact refusing a `blocked` entry; nothing can *reach*
 * `blocked` yet, and when friend requests earn their keep they arrive as
 * status transitions over this record, not a schema change.
 */
export type ContactStatus = 'played' | 'pending' | 'accepted' | 'blocked';

/**
 * Someone the owner has played with: a seat's worth of profiles, not one
 * profile — every profile ever seen on that person's seats, so a second
 * device or a cleared browser reads as the same person by construction.
 */
export interface ContactRecord {
  /**
   * Random, minted per owner — deliberately not a profileId, which is
   * stable and global and would let two players correlate their lists
   * ("is your Alice my Alice?").
   */
  contactId: string;
  /** Internal; never leaves the server. */
  profileIds: string[];
  /** Their profile name as of the last shared bind. */
  name: string;
  /** Where we last played. */
  gameId: string;
  /** `${gameId}--${roomId}` of the last shared room — the re-bind no-op guard. */
  lastRoom: string;
  lastPlayedAt: number;
  status: ContactStatus;
}

/** The ledger is "people I might invite", not an archive. */
export const MAX_CONTACTS = 100;
export const MAX_PROFILE_NAME_LENGTH = 40;

export interface ProfileRecord {
  /** sha256 hex of the player key — the key itself never touches disk. */
  profileId: string;
  savedAt: number;
  prefs: NotifyPrefs;
  push: PushSubscriptionRecord[];
  email?: EmailRecord;
  /**
   * Display name, stamped by the client onto every bind from the room
   * identity it already holds. Last-writer-wins, trimmed, length-capped —
   * exactly as public as sitting down at the table was.
   */
  name?: string;
  /** The co-player ledger. Capped at MAX_CONTACTS, oldest-played evicted. */
  contacts?: ContactRecord[];
}

/**
 * The reminder bookkeeping: who the last turn notification went to, when,
 * and whether the 24h reminder has fired. Written under the same
 * marker-before-send discipline as `lastNotified`; cleared or replaced by
 * every `turnChanged` that supersedes it, so a reminder can never fire for
 * a turn already taken.
 */
export interface TurnMarker {
  playerId: string;
  turnKey: string;
  notifiedAt: number;
  remindedAt?: number;
}

export interface RoomRecord {
  /** `${gameId}--${roomId}` — the store key, kept on the record for loadAll. */
  key: string;
  gameId: string;
  roomId: string;
  savedAt: number;
  /**
   * playerId (seat) → every profile bound there. A set, because two devices
   * on one seat are two profiles and one person; the send loop fans out
   * across all of them, deduping email by address. On-disk records from
   * before the set may hold a bare string — the guard accepts it and the
   * load site normalizes, because a type predicate has no return channel.
   */
  bindings: Record<string, string[]>;
  /**
   * playerId → the turnKey last notified (marked before sending, so a crash
   * mid-send skips a notification rather than ever duplicating one).
   */
  lastNotified: Record<string, string>;
  /**
   * The seat key itself is stored nowhere: it is derived per send —
   * HMAC(server secret, game/room/seat/current seat token) — so every email
   * about a seat carries the same key for as long as the seat token stands,
   * and an honor-system reclaim rotates it automatically with no
   * bookkeeping. Strictly stronger than the spec's "stored hashed", and
   * recorded as an As-built delta.
   */
  currentTurn?: TurnMarker;
}

/** Who an invite is for: an address the system has never met, or a person. */
export type InviteTarget =
  | { kind: 'email'; address: string }
  | { kind: 'profile'; profileIds: string[] };

export interface InviteRecord {
  /** sha256 hex of the invite token — the store key, and what the lobby's pending seat holds. */
  tokenHash: string;
  /**
   * The invite token itself, plaintext — a deliberate delta from the seat
   * key's hashed-at-rest discipline, recorded in the plan's As-built. A
   * resend (the Remind button) must reproduce the *same* link: the spec's
   * own "at most one outstanding invite per (room, target)" rule forbids a
   * second live link to one seat, and a hash cannot rebuild the first. The
   * exposure is bounded: single-claim, dead on revoke, and the same
   * directory already holds email addresses in plaintext.
   */
  token: string;
  target: InviteTarget;
  gameId: string;
  roomId: string;
  /** The pending seat this invite reserved. */
  playerId: string;
  inviterProfileId: string;
  createdAt: number;
  claimedAt?: number;
  /** Stamped by seatVacated: a revoked invite refuses claims and never resends. */
  revokedAt?: number;
  /** Send counting (creation + resends), same UTC-day shape as email confirms. */
  sendDay?: string;
  sendCount?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((v) => typeof v === 'string');
}

function isPushSubscriptionRecord(value: unknown): value is PushSubscriptionRecord {
  if (!isObject(value)) return false;
  const keys = value.keys;
  return (
    typeof value.endpoint === 'string' &&
    typeof value.addedAt === 'number' &&
    isObject(keys) &&
    typeof keys.p256dh === 'string' &&
    typeof keys.auth === 'string'
  );
}

function isEmailRecord(value: unknown): value is EmailRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.address === 'string' &&
    (value.status === 'pending' || value.status === 'confirmed' || value.status === 'disabled')
  );
}

function isContactRecord(value: unknown): value is ContactRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.contactId === 'string' &&
    Array.isArray(value.profileIds) &&
    value.profileIds.every((p) => typeof p === 'string') &&
    typeof value.name === 'string' &&
    typeof value.gameId === 'string' &&
    typeof value.lastRoom === 'string' &&
    typeof value.lastPlayedAt === 'number' &&
    (value.status === 'played' ||
      value.status === 'pending' ||
      value.status === 'accepted' ||
      value.status === 'blocked')
  );
}

export function isProfileRecord(value: unknown): value is ProfileRecord {
  if (!isObject(value)) return false;
  const prefs = value.prefs;
  return (
    typeof value.profileId === 'string' &&
    typeof value.savedAt === 'number' &&
    isObject(prefs) &&
    typeof prefs.push === 'boolean' &&
    typeof prefs.email === 'boolean' &&
    Array.isArray(value.push) &&
    value.push.every(isPushSubscriptionRecord) &&
    (value.email === undefined || isEmailRecord(value.email)) &&
    (value.name === undefined || typeof value.name === 'string') &&
    (value.contacts === undefined ||
      (Array.isArray(value.contacts) && value.contacts.every(isContactRecord)))
  );
}

function isTurnMarker(value: unknown): value is TurnMarker {
  if (!isObject(value)) return false;
  return (
    typeof value.playerId === 'string' &&
    typeof value.turnKey === 'string' &&
    typeof value.notifiedAt === 'number' &&
    (value.remindedAt === undefined || typeof value.remindedAt === 'number')
  );
}

/**
 * Accepts the pre-set scalar shape as well as the array — a guard can only
 * widen what is *accepted*; it has no return channel to rewrite anything.
 * The normalization lives at the load site (`service.ts`), and skipping it
 * there is the silent production-only failure: a bare string put through
 * the fan-out loop iterates as 64 one-character "profileIds" and drops
 * every notification for every pre-migration room.
 */
function isBindings(value: unknown): value is Record<string, string | string[]> {
  return (
    isObject(value) &&
    Object.values(value).every(
      (v) => typeof v === 'string' || (Array.isArray(v) && v.every((p) => typeof p === 'string')),
    )
  );
}

export function isRoomRecord(value: unknown): value is RoomRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.key === 'string' &&
    typeof value.gameId === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.savedAt === 'number' &&
    isBindings(value.bindings) &&
    isStringRecord(value.lastNotified) &&
    (value.currentTurn === undefined || isTurnMarker(value.currentTurn))
  );
}

/** Rewrites legacy scalar bindings to one-element arrays, in place. */
export function normalizeBindings(record: RoomRecord): RoomRecord {
  for (const [playerId, bound] of Object.entries(record.bindings)) {
    if (typeof bound === 'string') record.bindings[playerId] = [bound];
  }
  return record;
}

function isInviteTarget(value: unknown): value is InviteTarget {
  if (!isObject(value)) return false;
  if (value.kind === 'email') return typeof value.address === 'string';
  if (value.kind === 'profile') {
    return (
      Array.isArray(value.profileIds) && value.profileIds.every((p) => typeof p === 'string')
    );
  }
  return false;
}

export function isInviteRecord(value: unknown): value is InviteRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.tokenHash === 'string' &&
    typeof value.token === 'string' &&
    isInviteTarget(value.target) &&
    typeof value.gameId === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.playerId === 'string' &&
    typeof value.inviterProfileId === 'string' &&
    typeof value.createdAt === 'number' &&
    (value.claimedAt === undefined || typeof value.claimedAt === 'number') &&
    (value.revokedAt === undefined || typeof value.revokedAt === 'number')
  );
}
