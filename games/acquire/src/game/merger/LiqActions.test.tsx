import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LiqActions } from './LiqActions';
import { TRADE_RATIO } from '../../../engine/startups';

const props = {
  absorbedId: 'Messla' as const,
  survivorId: 'ZuckFace' as const,
  unitPrice: 400,
};

describe('LiqActions', () => {
  it('offers a sell for cash and a trade for a survivor share', () => {
    render(<LiqActions {...props} canSell canTrade />);
    expect(screen.getByRole('button', { name: /sell/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /trade/i })).toBeEnabled();
  });

  it('disables sell when the caller says it is unavailable', () => {
    const onSell = vi.fn();
    render(<LiqActions {...props} canSell={false} canTrade onSell={onSell} />);
    const sell = screen.getByRole('button', { name: /sell/i });
    expect(sell).toBeDisabled();
    fireEvent.click(sell);
    expect(onSell).not.toHaveBeenCalled();
  });

  it('disables trade when the caller says it is unavailable', () => {
    const onTrade = vi.fn();
    render(<LiqActions {...props} canSell canTrade={false} onTrade={onTrade} />);
    const trade = screen.getByRole('button', { name: /trade/i });
    expect(trade).toBeDisabled();
    fireEvent.click(trade);
    expect(onTrade).not.toHaveBeenCalled();
  });

  it('fires the handlers when enabled', () => {
    const onSell = vi.fn();
    const onTrade = vi.fn();
    render(<LiqActions {...props} canSell canTrade onSell={onSell} onTrade={onTrade} />);
    fireEvent.click(screen.getByRole('button', { name: /sell/i }));
    fireEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(onSell).toHaveBeenCalledTimes(1);
    expect(onTrade).toHaveBeenCalledTimes(1);
  });

  // The exchange rate is a rule, not a layout constant: it comes from the
  // engine so a rules change moves the UI with it.
  it('hands in TRADE_RATIO absorbed shares per survivor share', () => {
    render(<LiqActions {...props} canSell canTrade />);
    const trade = screen.getByRole('button', { name: /trade/i });
    expect(within(trade).getByText(`×${TRADE_RATIO}`)).toBeInTheDocument();
  });

  // Twice on purpose: the card carries the share's price, and the right-hand
  // side carries the cash it converts to. One share at unit price, both sides.
  it('shows what the sell is worth', () => {
    render(<LiqActions {...props} canSell canTrade />);
    const sell = screen.getByRole('button', { name: /sell/i });
    expect(within(sell).getAllByText('$400')).toHaveLength(2);
  });

  /**
   * A disabled trade button and an exhausted survivor pool looked identical:
   * the button greyed out and nothing said why, so the player had no way to
   * learn the pool was empty. Found by hand, 2026-08-07, driving G2 in two
   * browsers — the first time this panel had been used by a person.
   *
   * The vocabulary is the buy step's, deliberately. That row already says
   * `sold` on a muted badge for exactly this fact, and one fact should not
   * have two names.
   */
  it('says the survivor is sold out rather than just going inert', () => {
    render(<LiqActions {...props} canSell canTrade={false} survivorSoldOut />);

    const trade = screen.getByRole('button', { name: /sold out/i });
    expect(trade).toBeDisabled();
    expect(within(trade).getByText('sold')).toBeInTheDocument();
  });

  it('says nothing about sold out while the pool still has shares', () => {
    render(<LiqActions {...props} canSell canTrade />);

    expect(screen.queryByText('sold')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trade/i })).toBeEnabled();
  });
});
