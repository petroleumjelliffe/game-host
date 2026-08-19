import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FoundGroups } from './FoundGroups';
import { AVAILABLE_STARTUPS, getSharePriceAtSize } from '../../engine/startups';
import type { StartupId } from '../../engine/gameTypes';

const ALL = AVAILABLE_STARTUPS.map((s) => s.id);
const FOUND_SIZE = 2;

/** Derived, never quoted: the prices are a function of tier at the founding size. */
const expectedPrices = (ids: StartupId[], size: number) =>
  [
    ...new Set(
      ids.map((id) => {
        const config = AVAILABLE_STARTUPS.find((s) => s.id === id)!;
        return getSharePriceAtSize(config.tier, size);
      }),
    ),
  ].sort((a, b) => a - b);

describe('FoundGroups', () => {
  it('buckets every brand under a starting price, ascending', () => {
    const { container } = render(<FoundGroups available={ALL} taken={[]} foundSize={FOUND_SIZE} />);
    const headers = Array.from(container.querySelectorAll('[data-group-price]')).map((el) =>
      Number(el.getAttribute('data-group-price')),
    );
    expect(headers).toEqual(expectedPrices(ALL, FOUND_SIZE));
  });

  it('shows the price derived from the engine in each group header', () => {
    const { container } = render(<FoundGroups available={ALL} taken={[]} foundSize={FOUND_SIZE} />);
    for (const price of expectedPrices(ALL, FOUND_SIZE)) {
      const group = container.querySelector(`[data-group-price="${price}"]`)!;
      expect(within(group as HTMLElement).getByText(`$${price}`)).toBeInTheDocument();
    }
  });

  /**
   * Nothing asserted this label before, which is why it sat as the fragment
   * "to start" through two by-hand passes: copy nothing protects is copy
   * nobody notices.
   */
  it('names what the price is', () => {
    const { container } = render(<FoundGroups available={ALL} taken={[]} foundSize={FOUND_SIZE} />);
    const group = container.querySelector('[data-group-price]')!;
    expect(within(group as HTMLElement).getByText(/initial share price/i)).toBeInTheDocument();
  });

  it('lists every brand exactly once across the groups', () => {
    render(<FoundGroups available={ALL} taken={[]} foundSize={FOUND_SIZE} />);
    for (const id of ALL) {
      expect(screen.getAllByText(id)).toHaveLength(1);
    }
  });

  // A brand already on the board is shown disabled rather than hidden: someone
  // learning the game should be able to see the whole field.
  it('renders taken brands disabled instead of dropping them', () => {
    const onSelect = vi.fn();
    render(
      <FoundGroups available={ALL} taken={['Messla']} foundSize={FOUND_SIZE} onSelect={onSelect} />,
    );
    const taken = screen.getByText('Messla');
    expect(screen.getByRole('button', { name: 'Messla' })).toBeDisabled();
    fireEvent.click(taken);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects an available brand by id', () => {
    const onSelect = vi.fn();
    render(<FoundGroups available={ALL} taken={['Messla']} foundSize={FOUND_SIZE} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gobble' }));
    expect(onSelect).toHaveBeenCalledWith('Gobble');
  });
});
