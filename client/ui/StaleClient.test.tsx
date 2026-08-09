import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StaleClient } from './StaleClient';

describe('StaleClient', () => {
  it('says what is wrong without blaming the player', () => {
    render(<StaleClient onReload={() => {}} onExit={() => {}} />);

    expect(screen.getByTestId('stale-client')).toBeInTheDocument();
    // Not `can't`: the heading uses a typographic apostrophe, and matching the
    // straight one silently fails on copy that is correct.
    expect(screen.getByRole('heading')).toHaveTextContent(/talk to the server/i);
  });

  /**
   * Either side can be the newer one — the client ships to GitHub Pages and
   * the server to Render, independently — so the copy must not name a culprit
   * it cannot identify. "Your app is out of date" is wrong half the time, and
   * wrong in a way that sends the player to reload something already current.
   */
  it('blames neither side, because it cannot know which is behind', () => {
    render(<StaleClient onReload={() => {}} onExit={() => {}} />);

    const text = screen.getByTestId('stale-client').textContent ?? '';
    expect(text).not.toMatch(/out of date/i);
    expect(text).not.toMatch(/update your browser/i);
  });

  it('offers a reload, which is the whole remedy', () => {
    const onReload = vi.fn();
    render(<StaleClient onReload={onReload} onExit={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('offers a way out for the case a reload does not fix', () => {
    // A reload cannot help when the *server* is the stale one, and a screen
    // whose only action is a button that changes nothing is a dead end.
    const onExit = vi.fn();
    render(<StaleClient onReload={() => {}} onExit={onExit} />);

    fireEvent.click(screen.getByRole('button', { name: /lobby/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
