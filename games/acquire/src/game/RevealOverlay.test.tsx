import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevealOverlay } from './RevealOverlay';

describe('RevealOverlay', () => {
  // The line names who the device is for; the button only begins the turn.
  // It used to say it twice — "Pass to Alex" over "I'm Alex — Reveal" — which
  // made a handoff read as an identity check.
  it('names the player who is about to take the device, once', () => {
    render(<RevealOverlay playerName="Alex" onReveal={() => {}} />);
    expect(screen.getByText('Pass to Alex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Start$/ })).toBeInTheDocument();
    expect(screen.getByRole('button')).not.toHaveTextContent(/alex/i);
  });

  it('clears on the start button', () => {
    const onReveal = vi.fn();
    render(<RevealOverlay playerName="Alex" onReveal={onReveal} />);
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  // The scrim is the whole point: it covers the board so the next player does
  // not see the previous player's hand on a shared device.
  it('covers its container with an opaque scrim', () => {
    const { container } = render(<RevealOverlay playerName="Alex" onReveal={() => {}} />);
    const scrim = container.firstElementChild!;
    expect(scrim.className).toMatch(/absolute/);
    expect(scrim.className).toMatch(/inset-0/);
  });

  it('shows the player emoji when there is one', () => {
    render(<RevealOverlay playerName="Alex" emoji="🦊" onReveal={() => {}} />);
    expect(screen.getByText('🦊')).toBeInTheDocument();
  });
});
