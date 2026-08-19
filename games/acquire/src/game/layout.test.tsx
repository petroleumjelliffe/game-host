import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Board } from './Board';
import { createEmptyBoard } from '../../engine/gameInit';

describe('layout', () => {
  it('keeps the board on a fixed aspect ratio so it never needs to scroll', () => {
    const { container } = render(<Board board={createEmptyBoard()} />);
    const grid = container.querySelector('[data-board="grid"]')!;
    expect(grid.className).toMatch(/aspect-\[12\/9\]/);
    expect(grid.className).toMatch(/\[container-type:inline-size\]/);
  });

  it('never puts an overflow-x on the game surface', () => {
    const { container } = render(<Board board={createEmptyBoard()} />);
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/);
  });

  // The cqi label sizing is what makes one board work from tablet to desktop.
  // Breakpoint-specific text sizes on a cell would mean the container-query
  // setup is broken, and the fix belongs there rather than in a media query.
  it('sizes cell labels from the board container, not from a breakpoint', () => {
    const { container } = render(<Board board={createEmptyBoard()} />);
    const grid = container.querySelector('[data-board="grid"]') as HTMLElement;
    expect(grid.style.getPropertyValue('--tile-label')).toMatch(/cqi/);
    const cellLabel = container.querySelector('[title="A1"] span')!;
    expect(cellLabel.className).toMatch(/var\(--tile-label/);
    expect(cellLabel.className).not.toMatch(/(sm|md|lg|xl):text-/);
  });
});
