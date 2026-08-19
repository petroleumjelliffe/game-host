import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StockStack, stackDepth } from './StockStack';

describe('stackDepth — physical layers behind the front card', () => {
  it.each([
    [0, 0], [1, 0], [2, 1], [5, 1], [6, 2], [25, 2],
  ])('count %i yields %i extra layers', (count, expected) => {
    expect(stackDepth(count)).toBe(expected);
  });

  // A leaving stack layers like its positive twin — magnitude, not sign.
  it.each([[-2, 1], [-6, 2]])('count %i yields %i extra layers', (count, expected) => {
    expect(stackDepth(count)).toBe(expected);
  });
});

describe('StockStack — the primary interactive share entity', () => {
  it('labels a share stack with a multiplier', () => {
    render(<StockStack id="Messla" count={3} price={300} />);
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  // Cash is money: the label under the bills is total dollars, not ×N.
  it('labels a cash stack with the total dollars', () => {
    render(<StockStack id="Cash" count={3} price={400} />);
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.queryByText('×3')).not.toBeInTheDocument();
  });

  it('shows a leaving stack as a negative count', () => {
    render(<StockStack id="ZuckFace" count={3} price={400} leaving />);
    expect(screen.getByText('−3')).toBeInTheDocument();
  });

  it('renders the remove control only when there is something to remove', () => {
    const { container: withStock } = render(
      <StockStack id="Messla" count={2} price={300} onRemove={() => {}} />,
    );
    expect(withStock.querySelector('[aria-label="Remove one"]')).toBeTruthy();

    const { container: empty } = render(
      <StockStack id="Messla" count={0} price={300} onRemove={() => {}} />,
    );
    expect(empty.querySelector('[aria-label="Remove one"]')).toBeFalsy();

    const { container: noHandler } = render(<StockStack id="Messla" count={2} price={300} />);
    expect(noHandler.querySelector('[aria-label="Remove one"]')).toBeFalsy();
  });

  it('increments on the body and decrements on the remove control', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<StockStack id="Messla" count={2} price={300} onClick={onClick} onRemove={onRemove} />);

    fireEvent.click(screen.getByText('×2'));
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Remove one'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('mutes a zero count', () => {
    const { container } = render(<StockStack id="Messla" count={0} price={300} />);
    expect(container.querySelector('[data-qty]')?.className).toMatch(/gray/);
  });
});
