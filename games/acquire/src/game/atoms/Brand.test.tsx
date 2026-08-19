import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Brand } from './Brand';

describe('Brand — the company, filled', () => {
  it('renders the full company name, not the ticker', () => {
    render(<Brand id="PaperfulPost" />);
    expect(screen.getByText('PaperfulPost')).toBeInTheDocument();
    expect(screen.queryByText('$PP')).not.toBeInTheDocument();
  });

  it('carries the brand tint and stroke', () => {
    const { container } = render(<Brand id="Messla" />);
    expect(container.firstElementChild?.className).toMatch(/bg-purple-100/);
    expect(container.firstElementChild?.className).toMatch(/border-purple-500/);
  });

  it('is a button when selectable and not otherwise', () => {
    const { container: sel } = render(<Brand id="Messla" mode="select" />);
    expect(sel.querySelector('button')).toBeTruthy();
    const { container: stat } = render(<Brand id="Messla" />);
    expect(stat.querySelector('button')).toBeFalsy();
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(<Brand id="Messla" mode="select" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
