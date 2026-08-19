import { describe, expect, it } from 'vitest';
import type { LobbyPhase } from '../../vendor/lobby/client/useLobbyRoom';
import { rankPhase, type RoomPhase } from './useRoom';

/**
 * The ranking is the one decision in `useRoom` that is a decision rather than
 * plumbing, so it is the part extracted and tested. The rest of the hook is a
 * connection it owns and cannot be handed a double for; a render test with a
 * stubbed socket would restate the hook rather than check it, which is the
 * lobby repo's own reasoning for leaving `connection.ts` untested in
 * isolation. The wire itself is covered by the server suites and the by-hand
 * pass.
 */
describe('rankPhase', () => {
  it('lets a started log carry the room to playing', () => {
    expect(rankPhase('lobby', true)).toBe('playing');
    expect(rankPhase('lobby', false)).toBe('lobby');
  });

  it('keeps terminal connection facts above the game', () => {
    // A client that cannot speak the server's protocol does not get to render
    // a board just because it once saw a `started`.
    expect(rankPhase('stale', true)).toBe('stale');
    expect(rankPhase('gone', true)).toBe('gone');
  });

  it('passes every other lobby phase straight through', () => {
    const cases: [LobbyPhase, RoomPhase][] = [
      ['connecting', 'connecting'],
      ['joining', 'joining'],
      ['error', 'error'],
    ];
    for (const [lobby, expected] of cases) {
      expect(rankPhase(lobby, false)).toBe(expected);
    }
  });
});
