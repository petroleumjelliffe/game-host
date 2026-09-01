import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchSettings = vi.fn();
vi.mock('./api', async (importActual) => ({
  ...(await importActual<typeof import('./api')>()),
  fetchSettings: (...args: unknown[]) => fetchSettings(...args),
}));
vi.mock('./playerKey', () => ({ getPlayerKey: () => 'k'.repeat(24) }));
// jsdom has no PushManager, so pushSupported() is false by default here —
// `on` is reached through email alone in most of these tests. One test below
// forces pushSupported() true to exercise the getRegistration() branch.
const pushSupportedMock = vi.fn(() => false);
vi.mock('./push', async (importActual) => ({
  ...(await importActual<typeof import('./push')>()),
  pushSupported: () => pushSupportedMock(),
}));

import { useNotifyStatus } from './useNotifyStatus';

const settings = (email: { address: string; status: string } | null) => ({
  pushEnabled: true, emailEnabled: true, vapidPublicKey: null,
  prefs: { push: true, email: true }, pushEndpoints: [], email,
});

beforeEach(() => {
  fetchSettings.mockReset();
  pushSupportedMock.mockReset();
  pushSupportedMock.mockReturnValue(false);
});

describe('useNotifyStatus', () => {
  it('unavailable when the service is absent', async () => {
    fetchSettings.mockResolvedValue(null);
    const { result } = renderHook(() => useNotifyStatus());
    await waitFor(() => { expect(result.current.status).toBe('unavailable'); });
    expect(result.current.emailAddress).toBeNull();
  });

  it('off / pending / on from email status, carrying the address along', async () => {
    fetchSettings.mockResolvedValue(settings(null));
    const { result, rerender } = renderHook(() => useNotifyStatus());
    await waitFor(() => { expect(result.current.status).toBe('off'); });
    expect(result.current.emailAddress).toBeNull();

    fetchSettings.mockResolvedValue(settings({ address: 'a@b.c', status: 'pending' }));
    result.current.refresh(); rerender();
    await waitFor(() => { expect(result.current.status).toBe('pending'); });
    expect(result.current.emailAddress).toBe('a@b.c');

    fetchSettings.mockResolvedValue(settings({ address: 'a@b.c', status: 'confirmed' }));
    result.current.refresh(); rerender();
    await waitFor(() => { expect(result.current.status).toBe('on'); });
    expect(result.current.emailAddress).toBe('a@b.c');
  });

  it('resolves to off (not hung) when push is supported but no service worker is registered', async () => {
    pushSupportedMock.mockReturnValue(true);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: () => Promise.resolve(null) },
      configurable: true,
    });
    try {
      fetchSettings.mockResolvedValue(settings(null));
      const { result } = renderHook(() => useNotifyStatus());
      await waitFor(() => { expect(result.current.status).toBe('off'); });
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });
});
