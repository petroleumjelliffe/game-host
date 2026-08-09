import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ShareRoomButton } from './ShareRoomButton';

const URL = 'https://example.test/acquire/room/ABC123';

/**
 * jsdom ships neither API, which is exactly the fallback environment — so the
 * share-present cases install `navigator.share` themselves and every case
 * installs a clipboard. Deleted (not restored) afterwards, back to jsdom's
 * true shape.
 */
function installClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function installShare() {
  const share = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  return share;
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  vi.useRealTimers();
  delete (navigator as { clipboard?: unknown }).clipboard;
  delete (navigator as { share?: unknown }).share;
});

describe('ShareRoomButton', () => {
  it('copies the bare url and opens the sheet with the default text', async () => {
    const writeText = installClipboard();
    const share = installShare();
    render(<ShareRoomButton url={URL} />);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await act(async () => { await Promise.resolve(); });

    expect(writeText).toHaveBeenCalledWith(URL);
    expect(share).toHaveBeenCalledWith({ url: URL, text: 'Join my game room' });
  });

  it('a game overrides the share text without touching the kit', async () => {
    installClipboard();
    const share = installShare();
    render(<ShareRoomButton url={URL} text="Join my Acquire game!" />);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await act(async () => { await Promise.resolve(); });

    expect(share).toHaveBeenCalledWith({ url: URL, text: 'Join my Acquire game!' });
  });

  it('without a share sheet it copies and says so, then reverts', async () => {
    const writeText = installClipboard();
    render(<ShareRoomButton url={URL} />);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await act(async () => { await Promise.resolve(); });

    expect(writeText).toHaveBeenCalledWith(URL);
    expect(screen.getByRole('button')).toHaveTextContent(/copied/i);

    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.getByRole('button')).toHaveTextContent(/share/i);
  });

  /**
   * Safari's rule, pinned: `navigator.share` must be called inside the click's
   * user-activation window, so it cannot wait behind the clipboard write. A
   * never-settling clipboard is the sharpest form of "behind": the sheet must
   * open anyway. This is the bug found by hand on 2026-08-09 — Chrome's laxer
   * activation window hid it.
   */
  it('asks for the sheet in the same gesture tick, not after the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => new Promise(() => {})) },
      configurable: true,
    });
    const share = installShare();
    render(<ShareRoomButton url={URL} />);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));

    expect(share).toHaveBeenCalledWith({ url: URL, text: 'Join my game room' });
  });

  it('a sheet that refuses — not a dismissal — falls back to saying Copied', async () => {
    installClipboard();
    Object.defineProperty(navigator, 'share', {
      value: vi.fn(() => Promise.reject(new DOMException('activation gone', 'NotAllowedError'))),
      configurable: true,
    });
    render(<ShareRoomButton url={URL} />);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole('button')).toHaveTextContent(/copied/i);
  });

  it('a dismissed sheet is silence, and the link is already copied', async () => {
    const writeText = installClipboard();
    Object.defineProperty(navigator, 'share', {
      value: vi.fn(() => Promise.reject(new DOMException('cancelled', 'AbortError'))),
      configurable: true,
    });
    render(<ShareRoomButton url={URL} />);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await act(async () => { await Promise.resolve(); });

    // Copy happened before the sheet, so dismissal loses nothing.
    expect(writeText).toHaveBeenCalledWith(URL);
    // And no error surfaces anywhere: the button is simply itself again.
    expect(screen.getByRole('button')).toHaveTextContent(/share/i);
  });
});
