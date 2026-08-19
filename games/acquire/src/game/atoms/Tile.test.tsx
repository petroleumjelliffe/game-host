import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tile } from './Tile';

describe('Tile', () => {
  it.each(['empty', 'filled', 'hand', 'placed', 'blocked', 'chain'] as const)(
    'renders the coordinate in state %s',
    (state) => {
      render(<Tile coord="E6" state={state} brand="Messla" />);
      expect(screen.getByText('E6')).toBeInTheDocument();
    },
  );

  it('shows the ticker instead of the coordinate when founded', () => {
    render(<Tile coord="E6" state="founded" brand="Messla" />);
    expect(screen.getByText('$M')).toBeInTheDocument();
    expect(screen.queryByText('E6')).not.toBeInTheDocument();
  });

  it('always exposes the coordinate as a title, even when the label is a ticker', () => {
    const { container } = render(<Tile coord="E6" state="founded" brand="Messla" />);
    expect(container.firstElementChild).toHaveAttribute('title', 'E6');
  });

  it('marks a blocked tile as not interactive and borrows no brand hue', () => {
    const { container } = render(<Tile coord="D4" state="blocked" />);
    const el = container.firstElementChild!;
    expect(el.className).toMatch(/cursor-not-allowed/);
    expect(el.className).not.toMatch(/red|orange|amber|lime|teal|purple|pink/);
  });

  it('renders a hand tile as a button and a settled tile as not', () => {
    const { container: hand } = render(<Tile coord="E6" state="hand" onClick={() => {}} />);
    expect(hand.querySelector('button')).toBeTruthy();
    const { container: chain } = render(<Tile coord="E6" state="chain" brand="Messla" />);
    expect(chain.querySelector('button')).toBeFalsy();
  });
});
