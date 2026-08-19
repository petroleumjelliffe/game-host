import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FinalScoring } from './FinalScoring';
import type { FinalScoreReport } from '../../engine/endGame';

/**
 * Shaped exactly like `finalScore(state)`, so the catalog can hand this
 * component real engine output without a translation layer.
 *
 * Sam wins on bonuses despite Alex holding more of the bigger chain:
 *   Alex   6×$1200 + $12000 majority + $8600  = $27,800
 *   Sam    3×$1200 + 4×$500 + $6000 + $7500 + $12000 = $31,100
 *   Jordan 1×$1200 + $3100                    = $4,300
 */
const REPORT: FinalScoreReport = {
  reason: { kind: 'size41', startupId: 'Gobble', size: 41 },
  players: [
    { id: 'p1', name: 'Alex', emoji: '🦊', cash: 8600 },
    { id: 'p2', name: 'Sam', emoji: '🐢', cash: 12000 },
    { id: 'p3', name: 'Jordan', emoji: '🦁', cash: 3100 },
  ],
  chains: [
    { id: 'Gobble', size: 41, price: 1200 },
    { id: 'Messla', size: 5, price: 500 },
  ],
  holdings: {
    p1: { Gobble: 6 },
    p2: { Gobble: 3, Messla: 4 },
    p3: { Gobble: 1 },
  },
  bonuses: [
    { chainId: 'Gobble', playerId: 'p1', type: 'majority', amount: 12000 },
    { chainId: 'Gobble', playerId: 'p2', type: 'minority', amount: 6000 },
    { chainId: 'Messla', playerId: 'p2', type: 'both', amount: 7500 },
  ],
};

const cell = (container: HTMLElement, row: string, playerId: string) =>
  container.querySelector(`[data-fs-row="${row}"][data-fs-col="${playerId}"]`) as HTMLElement;

describe('FinalScoring', () => {
  it('sorts the columns by total, winner leftmost', () => {
    const { container } = render(<FinalScoring {...REPORT} />);
    const names = Array.from(container.querySelectorAll('[data-fs-player]')).map((el) =>
      el.getAttribute('data-fs-player'),
    );
    expect(names).toEqual(['p2', 'p1', 'p3']);
  });

  it('names the winner and their total in the banner', () => {
    const { container } = render(<FinalScoring {...REPORT} />);
    const banner = container.querySelector('[data-fs-banner]') as HTMLElement;
    expect(within(banner).getByText(/Sam/)).toBeInTheDocument();
    expect(within(banner).getByText('$31,100')).toBeInTheDocument();
  });

  it('totals each column as stock + bonus + cash', () => {
    const { container } = render(<FinalScoring {...REPORT} />);
    expect(cell(container, 'total', 'p1').textContent).toContain('$27,800');
    expect(cell(container, 'total', 'p2').textContent).toContain('$31,100');
    expect(cell(container, 'total', 'p3').textContent).toContain('$4,300');
  });

  // An em-dash, not ×0: a player who holds nothing in a chain has no line in
  // that chain, and a column of zeroes reads like a column of holdings.
  it('places an em-dash where a player holds nothing, never a zero count', () => {
    const { container } = render(<FinalScoring {...REPORT} />);
    const empty = cell(container, 'stock-Messla', 'p1');
    expect(empty.textContent).toContain('—');
    expect(empty.textContent).not.toContain('×0');
    expect(cell(container, 'stock-Messla', 'p2').textContent).toContain('×4');
  });

  // M and m differ only in case, so the title carries the word.
  it('marks a sole holder Mm and says what that means', () => {
    const { container } = render(<FinalScoring {...REPORT} />);
    const mark = within(cell(container, 'bonus-Messla', 'p2')).getByText('Mm');
    expect(mark).toHaveAttribute('title', expect.stringMatching(/sole holder/i));
  });

  it('marks majority M and minority m', () => {
    const { container } = render(<FinalScoring {...REPORT} />);
    expect(within(cell(container, 'bonus-Gobble', 'p1')).getByText('M')).toBeInTheDocument();
    expect(within(cell(container, 'bonus-Gobble', 'p2')).getByText('m')).toBeInTheDocument();
  });

  // Scoped to the banner: the Gobble chain header also reads "41 tiles", and
  // the assertion is about the end *reason*, not the chain's size.
  it('says why the game ended', () => {
    const { container } = render(<FinalScoring {...REPORT} />);
    const banner = container.querySelector('[data-fs-banner]') as HTMLElement;
    expect(within(banner).getByText(/Gobble reached 41 tiles/)).toBeInTheDocument();
  });

  // Found by hand at 768px (Phase 2b Task 8): the card is centred by its own
  // `absolute inset-0 flex items-center justify-center` root, which takes it
  // out of normal flow. A caller-supplied action row rendered as a *sibling*
  // of that root therefore does not sit "below" the card at all — it sits at
  // the scrim's own top edge, which coincides with wherever the vertically
  // centred card's top happens to land. At 1440px that overlapped the winner
  // banner's cash figure by a few dozen pixels; at 768px, with less width to
  // spread the banner across, it fully covered it. Rendering `actions` inside
  // the card puts it in the same normal-flow column as the table, so it is
  // never at the mercy of where the centred card lands.
  it('renders supplied actions inside its own card, not as a loose sibling of the scrim', () => {
    const { container } = render(
      <FinalScoring {...REPORT} actions={<button type="button">New game</button>} />,
    );
    const card = container.querySelector('.rounded-2xl') as HTMLElement;
    expect(card).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /new game/i })).toBeInTheDocument();
  });

  it('renders no action row when none is supplied', () => {
    const { container } = render(<FinalScoring {...REPORT} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
