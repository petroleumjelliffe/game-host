import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeLobbyConnection } from '@game-host/lobby/client/fakeConnection';
import App from './App';

// The same fake the lobby ships and connection.test.ts uses; `made` because
// net/connection.ts memoizes one connection per module, so the first test to
// touch it decides what every later test in this file sees.
const { made } = vi.hoisted(() => ({ made: [] as FakeLobbyConnection[] }));
vi.mock('@game-host/lobby/client/connection', async () => {
  const { createFakeLobbyConnection } = await import(
    '@game-host/lobby/client/fakeConnection'
  );
  return {
    createLobbyConnection: () => {
      const fake = createFakeLobbyConnection();
      made.push(fake);
      return fake.connection;
    },
  };
});

/** Transitions snap — same reasoning as App.test.tsx's copy. */
function snapTransitions() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  snapTransitions();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('opening a room against a server that never answers', () => {
  // Characterization: this timeout has worked since 2026-08-20 and was the
  // reference the other two games were fixed against — and it was verified
  // only by eye. Above the seam on purpose: it drives the screen and never
  // names the implementation, so task 3b's extraction must keep it green
  // unedited.
  it('recovers with a note instead of leaving the row tapped forever', () => {
    vi.useFakeTimers();
    render(<MemoryRouter initialEntries={['/online']}><App /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /new room/i }));
    expect(made[0]!.calls.createRoom).toHaveLength(1);

    // No `joined`, no `rejected` — nothing is listening at all.
    act(() => { vi.advanceTimersByTime(8000); });

    expect(screen.getByText(/no answer/i)).toBeInTheDocument();

    // A recovery, not a dead end: the row asks again.
    fireEvent.click(screen.getByRole('button', { name: /new room/i }));
    expect(made[0]!.calls.createRoom).toHaveLength(2);
  });
});
