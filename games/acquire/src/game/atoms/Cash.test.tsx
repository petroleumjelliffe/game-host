import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Cash } from './Cash';

describe('Cash', () => {
  it('renders a plain positive amount with no plus sign', () => {
    render(<Cash amount={1200} />);
    expect(screen.getByText('$1,200')).toBeInTheDocument();
  });

  it('renders a delta with an explicit sign', () => {
    render(<Cash amount={1200} sign="delta" />);
    expect(screen.getByText('+$1,200')).toBeInTheDocument();
  });

  it('uses a minus sign, not a hyphen, for negatives', () => {
    render(<Cash amount={-1200} sign="delta" />);
    expect(screen.getByText('−$1,200')).toBeInTheDocument();
  });

  it('renders zero as a muted $0', () => {
    const { container } = render(<Cash amount={0} />);
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(container.firstElementChild?.className).toMatch(/gray/);
  });
});
