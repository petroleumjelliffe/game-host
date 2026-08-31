import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchSettings = vi.fn();
vi.mock('./api', async (importActual) => ({
  ...(await importActual<typeof import('./api')>()),
  fetchSettings: (...args: unknown[]) => fetchSettings(...args),
}));
vi.mock('./playerKey', () => ({ getPlayerKey: () => 'k'.repeat(24) }));
// jsdom has no PushManager: pushSupported() is false, so `on` must be
// reachable through email alone in these tests.

import { useNotifyStatus } from './useNotifyStatus';

const settings = (email: { address: string; status: string } | null) => ({
  pushEnabled: true, emailEnabled: true, vapidPublicKey: null,
  prefs: { push: true, email: true }, pushEndpoints: [], email,
});

beforeEach(() => { fetchSettings.mockReset(); });

describe('useNotifyStatus', () => {
  it('unavailable when the service is absent', async () => {
    fetchSettings.mockResolvedValue(null);
    const { result } = renderHook(() => useNotifyStatus());
    await waitFor(() => { expect(result.current.status).toBe('unavailable'); });
  });

  it('off / pending / on from email status', async () => {
    fetchSettings.mockResolvedValue(settings(null));
    const { result, rerender } = renderHook(() => useNotifyStatus());
    await waitFor(() => { expect(result.current.status).toBe('off'); });

    fetchSettings.mockResolvedValue(settings({ address: 'a@b.c', status: 'pending' }));
    result.current.refresh(); rerender();
    await waitFor(() => { expect(result.current.status).toBe('pending'); });

    fetchSettings.mockResolvedValue(settings({ address: 'a@b.c', status: 'confirmed' }));
    result.current.refresh(); rerender();
    await waitFor(() => { expect(result.current.status).toBe('on'); });
  });
});
