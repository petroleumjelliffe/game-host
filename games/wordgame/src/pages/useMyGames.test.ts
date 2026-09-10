// @vitest-environment jsdom
// Restore before list (spec 2026-09-09 §Client): the person's seats are
// written into the identity store first, so the summaries call that
// follows sees them — and the whole thing re-runs when the page comes
// back into view, which is the come-back-from-Mail moment on iOS.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const listRoomsMock = vi.fn();
const saveIdentityMock = vi.fn();
const clearIdentityMock = vi.fn();
vi.mock('../net/identity', () => ({
  listRooms: (...a: unknown[]) => listRoomsMock(...a),
  saveIdentity: (...a: unknown[]) => saveIdentityMock(...a),
  clearIdentity: (...a: unknown[]) => clearIdentityMock(...a),
}));
vi.mock('../notify/playerKey', () => ({ getPlayerKey: () => 'k'.repeat(24) }));

import { useMyGames } from './useMyGames';

const fetchMock = vi.fn();

function answer(url: string, body: unknown) {
  fetchMock.mockImplementation((input: string) =>
    Promise.resolve(input === url
      ? ({ ok: true, json: async () => body } as Response)
      : ({ ok: true, json: async () => ({ summaries: [] }) } as Response)),
  );
}

function meCalls(): number {
  return fetchMock.mock.calls.filter((c) => c[0] === '/notify/me').length;
}

beforeEach(() => {
  listRoomsMock.mockReset().mockReturnValue([]);
  saveIdentityMock.mockReset();
  clearIdentityMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMyGames restores before it lists', () => {
  it('writes every restored word-game seat to the store, ignores other games, then lists', async () => {
    answer('/notify/me', {
      address: 'pete@example.com',
      seats: [
        { game: 'wordgame', roomId: 'ABC123', playerId: 'p2', token: 't2', name: 'Pete' },
        { game: 'acquire', roomId: 'ZZZ999', playerId: 'p1', token: 't1', name: 'Pete' },
      ],
      invites: [
        { game: 'wordgame', roomId: 'INV111', playerId: 'p3', inviterName: 'Alice', gameTitle: 'Word Game' },
        { game: 'acquire', roomId: 'INV222', playerId: 'p3', inviterName: 'Bob', gameTitle: 'Acquire' },
      ],
    });
    // The store reflects the write, as the real one would.
    saveIdentityMock.mockImplementation((roomId: string, identity: unknown) => {
      listRoomsMock.mockReturnValue([{ roomId, identity }]);
    });
    const { result } = renderHook(() => useMyGames());
    await waitFor(() => { expect(result.current.signedInKnown).toBe(true); });
    expect(saveIdentityMock).toHaveBeenCalledTimes(1);
    expect(saveIdentityMock).toHaveBeenCalledWith('ABC123', { playerId: 'p2', token: 't2', name: 'Pete' });
    expect(result.current.address).toBe('pete@example.com');
    expect(result.current.invites.map((i) => i.roomId)).toEqual(['INV111']);
    // The summaries call ran after the restore, so listRooms saw the write.
    await waitFor(() => {
      const order = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(order.indexOf('/wordgame/api/summaries')).toBeGreaterThan(order.indexOf('/notify/me'));
    });
  });

  it('with no service, lists from the store and reports sign-in as unknown', async () => {
    fetchMock.mockImplementation((input: string) =>
      Promise.resolve(input === '/notify/me'
        ? ({ ok: false, json: async () => ({}) } as Response)
        : ({ ok: true, json: async () => ({ summaries: [] }) } as Response)));
    const { result } = renderHook(() => useMyGames());
    await waitFor(() => { expect(result.current.games).toEqual([]); });
    expect(result.current.signedInKnown).toBe(false);
    expect(result.current.address).toBeNull();
  });

  it('restores again when the page becomes visible — the come-back-from-Mail moment', async () => {
    answer('/notify/me', { address: null, seats: [], invites: [] });
    const { result } = renderHook(() => useMyGames());
    await waitFor(() => { expect(result.current.signedInKnown).toBe(true); });
    const before = meCalls();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => { expect(meCalls()).toBe(before + 1); });
  });
});
