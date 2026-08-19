import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayersStrip } from './PlayersStrip';
import { PLAYER_EMOJI } from '../../../engine/startups';

const NAMES = ['Ada', 'Blaise', 'Curie', 'Dijkstra', 'Euler', 'Fermat'];

function table(size: number, activeIndex: number | null = 0) {
  return Array.from({ length: size }, (_, i) => ({
    id: `p${i + 1}`,
    emoji: PLAYER_EMOJI[i]!,
    name: NAMES[i]!,
    cash: 6000,
    active: i === activeIndex,
  }));
}

const seatIds = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-seat]')].map((el) => el.getAttribute('data-seat'));

describe('PlayersStrip', () => {
  it('renders every seat at a full table', () => {
    render(<PlayersStrip players={table(6)} />);
    for (const name of NAMES) expect(screen.getByText(name)).toBeInTheDocument();
  });

  it('outlines the active seat and only that one', () => {
    const { container } = render(<PlayersStrip players={table(6, 2)} />);
    expect(container.querySelectorAll('.border-blue-600')).toHaveLength(1);
  });

  /**
   * The strip is one row that clips what does not fit, so which seat sits at
   * the front is the whole guarantee: the player whose turn it is must never
   * be the one clipped off the end. Rotating rather than sorting keeps turn
   * order intact — you still read round the table in play order, starting
   * from whoever is up.
   */
  it('rotates the active seat to the front, preserving turn order', () => {
    const { container } = render(<PlayersStrip players={table(6, 3)} />);
    expect(seatIds(container)).toEqual(['p4', 'p5', 'p6', 'p1', 'p2', 'p3']);
  });

  it('leaves the order alone when the front seat is already active', () => {
    const { container } = render(<PlayersStrip players={table(4, 0)} />);
    expect(seatIds(container)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('leaves the order alone when nobody is active', () => {
    const { container } = render(<PlayersStrip players={table(4, null)} />);
    expect(seatIds(container)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('keeps the seats on one row and clips the overflow', () => {
    const { container } = render(<PlayersStrip players={table(6)} />);
    const strip = container.querySelector('[data-zone="roster"]')!;
    expect(strip.className).toMatch(/overflow-hidden/);
    expect(strip.className).not.toMatch(/flex-wrap|grid-cols/);
  });

  /**
   * Rotating the active seat to the front only helps if it is legible once it
   * gets there. With every seat `flex-1` a six-handed table rendered six 33px
   * slivers — avatar only, active player included. The active seat therefore
   * refuses to shrink and the others absorb the loss.
   */
  it('holds the active seat at its natural width while the others give way', () => {
    const { container } = render(<PlayersStrip players={table(6, 2)} />);
    const seats = [...container.querySelectorAll('[data-seat]')];
    expect(seats[0]!.className).toMatch(/flex-none/);
    expect(seats[0]!.className).not.toMatch(/flex-1/);
    for (const other of seats.slice(1)) {
      expect(other.className).toMatch(/min-w-0/);
      expect(other.className).toMatch(/flex-1/);
    }
  });

  describe('presence', () => {
    it('marks a seat whose player is not connected', () => {
      render(
        <PlayersStrip
          players={[
            { id: 'p1', emoji: '🦊', name: 'Alex', cash: 6000, active: true },
            { id: 'p2', emoji: '🐸', name: 'Sam', cash: 6000, connected: false },
          ]}
        />,
      );

      const sam = document.querySelector('[data-seat="p2"]')!;
      expect(sam.querySelector('[data-presence="away"]')).not.toBeNull();
      // Scoped to the seat, not the document: an away marker rendered on the
      // wrong seat would otherwise pass.
      const alex = document.querySelector('[data-seat="p1"]')!;
      expect(alex.querySelector('[data-presence="away"]')).toBeNull();
    });

    it('leaves every seat unmarked when presence is not passed at all', () => {
      // Pass-and-play passes no presence: everyone is at the same device by
      // definition, and an away dot there would be a lie.
      render(
        <PlayersStrip
          players={[
            { id: 'p1', emoji: '🦊', name: 'Alex', cash: 6000, active: true },
            { id: 'p2', emoji: '🐸', name: 'Sam', cash: 6000 },
          ]}
        />,
      );

      expect(document.querySelectorAll('[data-presence="away"]')).toHaveLength(0);
    });
  });
});
