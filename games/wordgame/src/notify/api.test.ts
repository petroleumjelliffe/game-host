// The /notify wire, pinned at the URL level. Every consumer of this module
// mocks it, so nothing else ever asserts what these functions actually
// fetch — and an unasserted URL is exactly how the entry list shipped
// fetching '/wordgameapi/summaries' (2026-08-31). These paths are
// deliberately host-level (no game base path): the notification service
// belongs to the composed host, shared across games.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSettings, notifyPost } from './api';

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
});
