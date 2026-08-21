import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { FakeLobbyConnection } from '@game-host/lobby/client/fakeConnection';
import { HomeScreen } from './HomeScreen';

// One fake per test, reachable from the hoisted mock and from assertions.
const { state } = vi.hoisted(() => ({
  state: { fake: null as FakeLobbyConnection | null },
}));

vi.mock('../net/singletons', async () => {
  const { createFakeLobbyConnection } = await import(
    '@game-host/lobby/client/fakeConnection'
  );
  const { createIdentityStore } = await import(
    '@game-host/lobby/client/identity'
  );
  return {
    // The real store on jsdom's real localStorage: this is the first test in
    // this client to cross that path, and it doubles as the check that no
    // shim is needed for it (the flag in vitest.config.ts is).
    identity: createIdentityStore('marcopolo'),
    connection: () => {
      state.fake ??= createFakeLobbyConnection();
      return state.fake.connection;
    },
  };
});

function fake(): FakeLobbyConnection {
  // Rendering HomeScreen constructs it via the mock above.
  if (!state.fake) throw new Error('render first');
  return state.fake;
}

beforeEach(() => {
  state.fake = null;
  localStorage.clear();
});

describe('the host button and the connection', () => {
  // Shipped 2026-08-20 against "it hung the first time and I had to reload",
  // verified only by eye until now: socket.io buffers an emit made while
  // disconnected, so an ungated button swallows the tap and produces a room
  // much later, or never.
  it('is disabled and says CONNECTING… until the connection is open', () => {
    render(<HomeScreen />);

    const host = screen.getByRole('button', { name: /CONNECTING…/ });
    expect(host).toBeDisabled();
    expect(fake().calls.createRoom).toHaveLength(0);

    act(() => fake().setStatus('open'));

    expect(screen.getByRole('button', { name: /HOST A GAME/ })).toBeEnabled();
  });

  it('creates the room on click once open, with no name yet to offer', () => {
    render(<HomeScreen />);
    act(() => fake().setStatus('open'));

    fireEvent.click(screen.getByRole('button', { name: /HOST A GAME/ }));

    expect(fake().calls.createRoom).toEqual([undefined]);
  });

  it('offers the remembered name when there is one', () => {
    localStorage.setItem('marcopolo.name', 'Pete');
    render(<HomeScreen />);
    act(() => fake().setStatus('open'));

    fireEvent.click(screen.getByRole('button', { name: /HOST A GAME/ }));

    expect(fake().calls.createRoom).toEqual(['Pete']);
  });

  it('keeps JOIN A GAME live while disconnected — joining is a navigation, not an emit', () => {
    render(<HomeScreen />);

    expect(screen.getByRole('button', { name: /JOIN A GAME/ })).toBeEnabled();
  });
});

describe('the rejection note', () => {
  // The other half of the same day's fix: onRejected had no subscriber
  // anywhere in this client, so a tab left open across a deploy was refused
  // in silence.
  it('tells a stale tab to reload on versionMismatch', () => {
    render(<HomeScreen />);

    act(() =>
      fake().rejected({
        code: 'versionMismatch',
        message: 'protocol 3, server speaks 4',
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent(/out of date — reload/);
  });

  it('relays any other refusal verbatim', () => {
    render(<HomeScreen />);

    act(() =>
      fake().rejected({
        code: 'roomFull',
        message: 'That room is full',
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('That room is full');
  });
});
