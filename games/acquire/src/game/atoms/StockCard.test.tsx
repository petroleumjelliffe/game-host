import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockCard } from './StockCard';

describe('StockCard — one share, outlined', () => {
  it('renders the ticker and the price', () => {
    render(<StockCard id="PaperfulPost" price={300} />);
    expect(screen.getByText('$PP')).toBeInTheDocument();
    expect(screen.getByText('$300')).toBeInTheDocument();
  });

  it('keeps the full company name reachable on hover', () => {
    const { container } = render(<StockCard id="PaperfulPost" price={300} />);
    expect(container.firstElementChild).toHaveAttribute('title', 'PaperfulPost');
  });

  // Money reads landscape, like a bill: $$ only, never a per-share price.
  it('renders Cash with no price at all', () => {
    render(<StockCard id="Cash" price={400} />);
    expect(screen.getByText('$$')).toBeInTheDocument();
    expect(screen.queryByText('$400')).not.toBeInTheDocument();
  });
});
