import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PayoutLines } from './PayoutLines';

describe('PayoutLines', () => {
  it('says so when there is nobody to pay, rather than rendering nothing', () => {
    render(<PayoutLines bonuses={[]} />);
    expect(screen.getByText('No shareholders to pay.')).toBeInTheDocument();
  });

  // The sole-holder case is one combined figure, and it must read as what it
  // is. The old MergerPayoutModal renders the bare word "Both", which reads as
  // a UI bug rather than as a rule.
  it('renders a sole holder as one "Majority + minority" line', () => {
    const { container } = render(
      <PayoutLines bonuses={[{ playerName: 'Alex', qty: 5, type: 'both', amount: 9000 }]} />,
    );
    expect(container.querySelectorAll('[data-bonus-line]')).toHaveLength(1);
    expect(screen.getByText(/Majority \+ minority/)).toBeInTheDocument();
    expect(screen.queryByText(/\bBoth\b/)).not.toBeInTheDocument();
  });

  it('names majority and minority holders separately', () => {
    render(
      <PayoutLines
        bonuses={[
          { playerName: 'Alex', qty: 6, type: 'majority', amount: 6000 },
          { playerName: 'Sam', qty: 3, type: 'minority', amount: 3000 },
        ]}
      />,
    );
    expect(screen.getByText(/Majority$/)).toBeInTheDocument();
    expect(screen.getByText(/Minority$/)).toBeInTheDocument();
  });

  // qty is the shares of the absorbed chain the player held — the reason they
  // earned the bonus at all — so it belongs on the line.
  it('shows each holder qty on their line', () => {
    render(
      <PayoutLines
        bonuses={[
          { playerName: 'Alex', qty: 6, type: 'majority', amount: 6000 },
          { playerName: 'Sam', qty: 3, type: 'minority', amount: 3000 },
        ]}
      />,
    );
    expect(screen.getByText('×6')).toBeInTheDocument();
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  it('renders each amount as an incoming delta', () => {
    render(<PayoutLines bonuses={[{ playerName: 'Alex', qty: 6, type: 'majority', amount: 6000 }]} />);
    expect(screen.getByText('+$6,000')).toBeInTheDocument();
  });
});
