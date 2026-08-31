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
