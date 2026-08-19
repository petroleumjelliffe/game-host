import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ScenarioPage from './ScenarioPage';
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';

/**
 * A dev surface, but not an unguarded one: its whole value is that the state it
 * drops you into is real and the game plays on from there. Both halves are
 * worth a test, because a picker that renders a dead board would look fine.
 */
describe('ScenarioPage', () => {
  it('offers every golden game', () => {
    render(<ScenarioPage />);
    for (const game of ALL_GOLDEN_GAMES) {
      expect(screen.getByRole('button', { name: game.id })).toBeInTheDocument();
    }
  });

  it('lists one entry per state, including the opening position', () => {
    render(<ScenarioPage />);
    const first = ALL_GOLDEN_GAMES[0];
    // States, not steps: the replay yields the fixture plus one state per step.
    expect(screen.getByText(/0\. opening position/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${first!.steps.length}\\.`))).toBeInTheDocument();
  });

  it('drops into a playable game at the chosen state', () => {
    render(<ScenarioPage />);
    fireEvent.click(screen.getByText(/0\. opening position/));

    // The real screen, not a preview of one.
    expect(screen.getByTestId('game-surface')).toBeInTheDocument();
    expect(screen.getByText(/step 0/)).toBeInTheDocument();
  });

  it('can show the game as one seat sees it, which is the online view', () => {
    // Reachable otherwise only by opening two browsers and taking a turn.
    render(<ScenarioPage />);
    const seats = screen.getByRole('group', { name: /whose screen/i });
    const asPlayer = within(seats).getAllByRole('radio')[1];
    fireEvent.click(asPlayer!);
    fireEvent.click(screen.getByText(/0\. opening position/));

    expect(screen.getByText(/as p1/)).toBeInTheDocument();
  });

  it('goes back to the picker rather than stranding you in a scenario', () => {
    render(<ScenarioPage />);
    fireEvent.click(screen.getByText(/0\. opening position/));
    fireEvent.click(screen.getByRole('button', { name: /← scenarios/ }));
    expect(screen.getByRole('heading', { name: /scenarios/i })).toBeInTheDocument();
  });
});
