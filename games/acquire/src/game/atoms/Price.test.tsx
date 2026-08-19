import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Price } from './Price';

describe('Price', () => {
  it('renders a bare value with no arrow', () => {
    render(<Price value={300} />);
    expect(screen.getByText('$300')).toBeInTheDocument();
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
  });

  it('shows an up arrow and the next value when the price rises', () => {
    render(<Price value={300} next={600} />);
    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(screen.getByText('$600')).toBeInTheDocument();
  });

  it('shows a down arrow when the price falls', () => {
    render(<Price value={600} next={300} />);
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('omits the arrow when next equals value', () => {
    render(<Price value={300} next={300} />);
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
    expect(screen.queryByText('↓')).not.toBeInTheDocument();
  });
});
