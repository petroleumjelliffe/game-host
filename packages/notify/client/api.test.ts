// @vitest-environment jsdom
// The /notify wire, pinned at the URL level. Every consumer of this module
// mocks it, so nothing else ever asserts what these functions actually
// fetch — and an unasserted URL is exactly how the entry list shipped
// fetching '/wordgameapi/summaries' (2026-08-31). These paths are
// deliberately host-level (no game base path): the notification service
// belongs to the composed host, shared across games.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMine, fetchSettings, notifyPost, setEmailPref, signOut } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe('the /notify API paths', () => {
  it('posts under /notify at the host level — no game base path', async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response);
    await notifyPost('/subscriptions', { playerKey: 'k' });
    expect(fetchMock).toHaveBeenCalledWith('/notify/subscriptions', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('fetchSettings asks /notify/settings and hands back the settings body', async () => {
    const settings = {
      pushEnabled: true, emailEnabled: true, vapidPublicKey: null,
      prefs: { push: true, email: true }, pushEndpoints: [], email: null,
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => settings } as Response);
    expect(await fetchSettings('k')).toEqual(settings);
    expect(fetchMock).toHaveBeenCalledWith('/notify/settings', expect.anything());
  });

  it('fetchSettings answers null for a 404 and for a network error alike', async () => {
    // The standalone dev server 404s /notify; a LAN blip throws. Both must
    // read as "notifications unavailable", never as a crash.
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);
    expect(await fetchSettings('k')).toBeNull();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchSettings('k')).toBeNull();
  });

  it('fetchMine posts the key to /notify/me and validates the shape', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { address: 'a@b.c', seats: [], invites: [] }));
    expect(await fetchMine('k'.repeat(24))).toEqual({ address: 'a@b.c', seats: [], invites: [] });
    expect(fetchMock).toHaveBeenCalledWith('/notify/me', expect.objectContaining({ method: 'POST' }));
    fetchMock.mockResolvedValueOnce(json(200, { nope: true }));
    expect(await fetchMine('k'.repeat(24))).toBeNull();
    fetchMock.mockResolvedValueOnce(json(404, { error: 'not here' }));
    expect(await fetchMine('k'.repeat(24))).toBeNull();
  });

  it('signOut and setEmailPref answer ok as a boolean', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await signOut('k'.repeat(24))).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/notify/signout', expect.anything());
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await setEmailPref('k'.repeat(24), false)).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith('/notify/prefs', expect.objectContaining({
      body: JSON.stringify({ playerKey: 'k'.repeat(24), email: false }),
    }));
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await signOut('k'.repeat(24))).toBe(false);
  });
});