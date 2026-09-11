/**
 * The /notify API, as the client speaks it. Host-level paths, deliberately
 * NOT under the game's base path — the notification service is the composed
 * host's, shared across games. The standalone dev server 404s these, which
 * is why every caller must survive a non-2xx or a network error.
 */

export interface NotifySettings {
  pushEnabled: boolean;
  emailEnabled: boolean;
  vapidPublicKey: string | null;
  prefs: { push: boolean; email: boolean };
  pushEndpoints: string[];
  email: { address: string; status: string } | null;
}

export async function notifyPost(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`/notify${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function isSettings(value: unknown): value is NotifySettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pushEnabled === 'boolean' &&
    typeof v.emailEnabled === 'boolean' &&
    Array.isArray(v.pushEndpoints)
  );
}

/** Null means "notifications unavailable" — a 404ing standalone dev server,
 * a network error, or a body that is not the settings shape. */
export async function fetchSettings(playerKey: string): Promise<NotifySettings | null> {
  try {
    const res = await notifyPost('/settings', { playerKey });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isSettings(body) ? body : null;
  } catch {
    return null;
  }
}

/** One seat the person holds; the caller writes it into its own identity store. */
export interface MineSeat {
  game: string;
  roomId: string;
  playerId: string;
  token: string;
  name: string;
}

/** One live invite addressed to the person, claimable without its token. */
export interface MineInvite {
  game: string;
  roomId: string;
  playerId: string;
  inviterName: string | null;
  gameTitle: string;
}

export interface Mine {
  /** This device's confirmed address, or null: not signed in. */
  address: string | null;
  seats: MineSeat[];
  invites: MineInvite[];
}

function isMineSeat(value: unknown): value is MineSeat {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.game === 'string' &&
    typeof v.roomId === 'string' &&
    typeof v.playerId === 'string' &&
    typeof v.token === 'string' &&
    typeof v.name === 'string'
  );
}

function isMineInvite(value: unknown): value is MineInvite {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.game === 'string' &&
    typeof v.roomId === 'string' &&
    typeof v.playerId === 'string' &&
    (v.inviterName === null || typeof v.inviterName === 'string') &&
    typeof v.gameTitle === 'string'
  );
}

function isMine(value: unknown): value is Mine {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.address === null || typeof v.address === 'string') &&
    Array.isArray(v.seats) &&
    v.seats.every(isMineSeat) &&
    Array.isArray(v.invites) &&
    v.invites.every(isMineInvite)
  );
}

/**
 * Restore (spec 2026-09-09 §Restore): the person's seats and invites. Null
 * means the service is absent or the answer was not the shape — the caller
 * keeps whatever its own store already holds.
 */
export async function fetchMine(playerKey: string): Promise<Mine | null> {
  try {
    const res = await notifyPost('/me', { playerKey });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isMine(body) ? body : null;
  } catch {
    return null;
  }
}

async function okPost(path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await notifyPost(path, body);
    return res.ok;
  } catch {
    return false;
  }
}

/** Sign out this device (spec §Sign out). The caller clears its own store afterwards. */
export function signOut(playerKey: string): Promise<boolean> {
  return okPost('/signout', { playerKey });
}

/** The "Email me when it's my turn" toggle: a preference, not a sign-out. */
export function setEmailPref(playerKey: string, email: boolean): Promise<boolean> {
  return okPost('/prefs', { playerKey, email });
}

/**
 * What the entry list shows after a Nudge: 'sent' or 'reminded' both flip
 * the button to "Reminded ✓" (a turn already reminded is the state the
 * button was trying to reach), and 'failed' leaves it standing for
 * whatever refused — a stale seat, an unreachable player, a network blip.
 */
export type NudgeOutcome = 'sent' | 'reminded' | 'failed';

/** Ask for the current turn's reminder now, from a seat in the room. */
export async function nudgeTurn(args: {
  game: string;
  roomId: string;
  playerId: string;
  token: string;
}): Promise<NudgeOutcome> {
  try {
    const res = await notifyPost('/nudge', { ...args });
    if (res.ok) return 'sent';
    const body: unknown = await res.json().catch(() => null);
    const reason = typeof body === 'object' && body !== null ? (body as { reason?: unknown }).reason : null;
    return reason === 'alreadyReminded' ? 'reminded' : 'failed';
  } catch {
    return 'failed';
  }
}
