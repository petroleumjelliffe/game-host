// @vitest-environment jsdom
// useUpdateReady against a mocked registration — the spec's named test for
// the update hooks. jsdom has no navigator.serviceWorker at all, so the mock
// is defined wholesale and removed after.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUpdateReady } from './update';

type Listener = () => void;

function mockServiceWorker(registration: {
  waiting: { postMessage: (msg: unknown) => void } | null;
  installing?: { addEventListener: (ev: string, fn: Listener) => void } | null;
}) {
  const container = {
    getRegistration: () => Promise.resolve(registration),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
  });
  return container;
}

afterEach(() => {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe('useUpdateReady', () => {
  it('is permanently not-ready with no serviceWorker at all (dev, jsdom)', () => {
    const { result } = renderHook(() => useUpdateReady());
    expect(result.current.ready).toBe(false);
    // apply on a not-ready hook is a no-op, not a crash.
    act(() => result.current.apply());
  });

  it('reports a worker already waiting from a previous visit', async () => {
    const reg = {
      waiting: { postMessage: vi.fn() },
      addEventListener: vi.fn(),
    };
    mockServiceWorker(reg);
    const { result } = renderHook(() => useUpdateReady());
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it('apply messages the waiting worker with SKIP_WAITING', async () => {
    const postMessage = vi.fn();
    const reg = { waiting: { postMessage }, addEventListener: vi.fn() };
    mockServiceWorker(reg);
    const { result } = renderHook(() => useUpdateReady());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.apply());
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('stays not-ready when nothing is waiting', async () => {
    const reg = { waiting: null, addEventListener: vi.fn() };
    mockServiceWorker(reg);
    const { result } = renderHook(() => useUpdateReady());
    // Let the getRegistration promise settle before asserting the negative.
    await act(() => Promise.resolve());
    expect(result.current.ready).toBe(false);
  });
});
