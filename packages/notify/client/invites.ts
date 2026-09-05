// The invite half of the client: the contacts listing and the invite send,
// as data. Headless — each game supplies the picker surface; these carry
// the refusal reasons through as strings the UI turns into sentences.

import { notifyPost } from './api.js';
import { getPlayerKey } from './playerKey.js';

/** One row of "people you've played with" — never an address, never a profileId. */
export interface ContactRow {
  contactId: string;
  name: string;
  lastPlayedAt: number;
  gameTitle: string;
  reachable: boolean;
  /** Present when the listing was asked with room context. Advisory. */
  alreadySeated?: boolean;
}

function isContactRow(value: unknown): value is ContactRow {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.contactId === 'string' &&
    typeof v.name === 'string' &&
    typeof v.lastPlayedAt === 'number' &&
    typeof v.gameTitle === 'string' &&
    typeof v.reachable === 'boolean'
  );
}

/**
 * Null means "contacts unavailable" — no storage for a player key, a
 * standalone dev server 404ing /notify, a network error — which every
 * caller renders the same as empty (checklist P2).
 */
export async function fetchContacts(
  room?: { game: string; roomId: string },
): Promise<ContactRow[] | null> {
  const playerKey = getPlayerKey();
  if (playerKey === null) return null;
  try {
    const res = await notifyPost('/contacts', {
      playerKey,
      ...(room === undefined ? {} : { game: room.game, roomId: room.roomId }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const contacts = (body as { contacts?: unknown }).contacts;
    if (!Array.isArray(contacts) || !contacts.every(isContactRow)) return null;
    return contacts;
  } catch {
    return null;
  }
}

export type InviteOutcome =
  | { ok: true; playerId: string; resend: boolean }
  /** `reason` is the server's refusal, or 'failed' for transport trouble. */
  | { ok: false; reason: string };

export interface InviteArgs {
  game: string;
  roomId: string;
  /** The inviter's own seat and token — proof they are in the room. */
  playerId: string;
  token: string;
  /** Exactly one of these. */
  contactId?: string;
  email?: string;
}

export async function sendInvite(args: InviteArgs): Promise<InviteOutcome> {
  const playerKey = getPlayerKey();
  if (playerKey === null) return { ok: false, reason: 'failed' };
  try {
    const res = await notifyPost('/invite', { playerKey, ...args });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok && typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      if (b.ok === true && typeof b.playerId === 'string' && typeof b.resend === 'boolean') {
        return { ok: true, playerId: b.playerId, resend: b.resend };
      }
    }
    const reason =
      typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).reason === 'string'
        ? ((body as Record<string, unknown>).reason as string)
        : 'failed';
    return { ok: false, reason };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
