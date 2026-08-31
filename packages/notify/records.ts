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

export interface ProfileRecord {
  /** sha256 hex of the player key — the key itself never touches disk. */
  profileId: string;
  savedAt: number;
  prefs: NotifyPrefs;
  push: PushSubscriptionRecord[];
  email?: EmailRecord;
}

export interface RoomRecord {
  /** `${gameId}--${roomId}` — the store key, kept on the record for loadAll. */
  key: string;
  gameId: string;
  roomId: string;
  savedAt: number;
  /** playerId (seat) → profileId. */
  bindings: Record<string, string>;
  /**
   * playerId → the turnKey last notified (marked before sending, so a crash
   * mid-send skips a notification rather than ever duplicating one).
   */
  lastNotified: Record<string, string>;
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
    (value.email === undefined || isEmailRecord(value.email))
  );
}

export function isRoomRecord(value: unknown): value is RoomRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.key === 'string' &&
    typeof value.gameId === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.savedAt === 'number' &&
    isStringRecord(value.bindings) &&
    isStringRecord(value.lastNotified)
  );
}
