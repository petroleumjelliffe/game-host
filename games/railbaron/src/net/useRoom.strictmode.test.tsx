import { renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { useRoom } from './useRoom';

/**
 * The room screen must survive StrictMode's double-invoked effects.
 *
 * `main.tsx` renders the whole app inside `<StrictMode>`, which mounts,
 * unmounts and remounts every effect in development. A connection built during
 * render but torn down in an effect cleanup is destroyed by that second pass
 * and never rebuilt — the create and the destroy live in different lifecycles,
 * so the cleanup can outlive what would rebuild it.
 *
 * The symptom is not an error anywhere: the socket is simply closed, the
 * roster never arrives, and the board sits on "Reconnecting" with no seats.
 * No server is needed to show it, because nothing here is about the network.
 */
describe('useRoom under StrictMode', () => {
  it('does not leave its connection closed', () => {
    const { result } = renderHook(() => useRoom('GSKF56'), { wrapper: StrictMode });
    // 'connecting' (no server here) is fine; 'closed' means the double-invoked
    // cleanup killed the only socket and nothing reopened it.
    expect(result.current.lobby.status).not.toBe('closed');
  });
});
