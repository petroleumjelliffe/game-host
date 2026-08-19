import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStrip } from './ConnectionStrip';

/**
 * `navigator.onLine` is a getter on the jsdom navigator, so it is replaced by
 * descriptor rather than assignment — the same reason `src/test/setup.ts`
 * installs `localStorage` with `defineProperty`.
 */
function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe('the connection strip', () => {
  it('says nothing at all while the socket is open', () => {
    render(<ConnectionStrip status="open" />);
    expect(screen.queryByTestId('connection-strip')).toBeNull();
  });

  it('starts with the short form', () => {
    render(<ConnectionStrip status="connecting" />);
    expect(screen.getByTestId('connection-strip')).toHaveTextContent('Connecting…');
  });

  it('explains the wait once it has gone on a while', () => {
    vi.useFakeTimers();
    render(<ConnectionStrip status="connecting" />);

    act(() => { vi.advanceTimersByTime(3000); });

    // A long outage and a two-second blip look identical for the first few
    // seconds. After that the pill owns up to the wait — but blames nothing:
    // this component cannot tell a sleeping server from a reachable network
    // that cannot reach it (a phone on cellular holding a LAN address, a
    // captive portal), and the old copy asserted 'waking' for all of them.
    expect(screen.getByTestId('connection-strip'))
      .toHaveTextContent('Can’t reach the server — retrying');
  });

  it('drops back to the short form when the connection recovers and drops again', () => {
    vi.useFakeTimers();
    const { rerender } = render(<ConnectionStrip status="connecting" />);
    act(() => { vi.advanceTimersByTime(3000); });

    rerender(<ConnectionStrip status="open" />);
    rerender(<ConnectionStrip status="closed" />);

    // A fresh drop is a fresh two-second blip until proven otherwise —
    // latching "waking" from a previous outage would claim a 30-second wait
    // that is not happening.
    expect(screen.getByTestId('connection-strip')).toHaveTextContent('Disconnected — reconnecting…');
  });
});

describe('a device with no network of its own', () => {
  it('does not blame the server, however long the wait has been', () => {
    vi.useFakeTimers();
    setOnline(false);
    render(<ConnectionStrip status="connecting" />);

    act(() => { vi.advanceTimersByTime(3000); });

    // The bug this guards: `navigator.onLine` false, `status` not `open` —
    // the device itself has no network, so nothing about the server can be
    // claimed. (The related case found by hand — a phone on cellular whose
    // `navigator.onLine` read `true` while the pill blamed a server its
    // network could not route to — is closed by the cause-free copy above.)
    const strip = screen.getByTestId('connection-strip');
    expect(strip).toHaveTextContent('No network — waiting for this device to reconnect');
    expect(strip).not.toHaveTextContent('reach the server');
  });

  it('goes back to blaming the server once the network returns', () => {
    vi.useFakeTimers();
    setOnline(false);
    render(<ConnectionStrip status="connecting" />);
    act(() => { vi.advanceTimersByTime(3000); });

    setOnline(true);
    act(() => { window.dispatchEvent(new Event('online')); });

    // The wait was already long, and the device is now on a network — but
    // which side is at fault is still unknowable, so the copy stays cause-free.
    expect(screen.getByTestId('connection-strip'))
      .toHaveTextContent('Can’t reach the server — retrying');
  });

  it('reads as offline on the very first render when it mounts that way', () => {
    // This only proves the `useState` initializer's own `navigator.onLine`
    // read — a room screen mounted while already offline, which is what a
    // reload in a dead spot is. It does NOT exercise the effect's later
    // re-read (`setOnline(navigator.onLine)` in `useOnline`): deleting that
    // line leaves this test green, because the initializer alone already
    // gets the right answer here. That line covers a narrower case — an
    // `offline` event landing between render and the listeners attaching —
    // that this test cannot reach; see its comment for why.
    setOnline(false);
    render(<ConnectionStrip status="closed" />);

    expect(screen.getByTestId('connection-strip'))
      .toHaveTextContent('No network — waiting for this device to reconnect');
  });
});
