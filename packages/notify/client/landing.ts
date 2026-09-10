// Landing on a link: `?invite=` (a claim) and `?key=` (a seat-key
// redemption) resolve through one identical path — POST the credential,
// get back a whole identity, strip the param. The CALLER writes the
// identity: `createIdentityStore(appId)` is per-game and this shared
// package cannot know an appId.

import { notifyPost } from './api.js';
import { getPlayerKey } from './playerKey.js';

export type LandingParam =
  | { kind: 'invite'; token: string }
  | { kind: 'key'; key: string };

/** The landing credential in a URL, if any. `?invite=` wins over `?key=`. */
export function landingParam(search: string): LandingParam | null {
  const params = new URLSearchParams(search);
  const invite = params.get('invite');
  if (invite !== null && invite !== '') return { kind: 'invite', token: invite };
  const key = params.get('key');
  if (key !== null && key !== '') return { kind: 'key', key };
  return null;
}

export interface LandingCredentials {
  playerId: string;
  token: string;
  name: string;
  /** On invite claims: who saved the seat, for the greeting. */
  inviterName?: string | null;
}

function isCredentials(value: unknown): value is LandingCredentials {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.playerId === 'string' && typeof v.token === 'string' && typeof v.name === 'string'
  );
}

/**
 * Null is the one refusal shape: invalid, revoked, spent, and never-existed
 * are indistinguishable by design (the non-probe rule), and so is a network
 * failure — the landing screen offers "join as a new player" either way.
 */
export async function redeemLanding(param: LandingParam): Promise<LandingCredentials | null> {
  try {
    const playerKey = getPlayerKey();
    const res =
      param.kind === 'invite'
        ? await notifyPost('/invite/claim', {
            inviteToken: param.token,
            ...(playerKey === null ? {} : { playerKey }),
          })
        : await notifyPost('/redeem-key', { key: param.key });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isCredentials(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * The in-app accept (spec 2026-09-09 §Accept): claim one of the person's
 * invites without its token. Null for every refusal, including "already
 * claimed by a linked device" — re-run restore rather than showing an error.
 */
export async function acceptInvite(game: string, roomId: string): Promise<LandingCredentials | null> {
  try {
    const playerKey = getPlayerKey();
    if (playerKey === null) return null;
    const res = await notifyPost('/invite/accept', { playerKey, game, roomId });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isCredentials(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Remove the credential from the address bar — mail scanners already saw
 * it, but the person's history and shared screenshots need not.
 */
export function stripLandingParam(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    url.searchParams.delete('key');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // A browser that refuses replaceState leaves only cosmetics behind.
  }
}
