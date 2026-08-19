import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createGameSession, type GameSession } from '../../../session/GameSession';
import { useGameSession } from './useGameSession';
import { buildFixture } from '../../../engine/golden/fixtures';

function Probe({ session }: { session: GameSession }) {
  const view = useGameSession(session);
  return (
    <div>
      <span data-testid="stage">{view.state.stage}</span>
      <span data-testid="actor">{view.actorId ?? 'none'}</span>
      <button onClick={() => session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' })}>
        place
      </button>
    </div>
  );
}

describe('useGameSession', () => {
  it('renders the current view and re-renders when the session changes', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [{ name: 'Alex', hand: ['E6'] }, { name: 'Sam' }],
        loners: ['E5'],
      }),
    });

    render(<Probe session={session} />);
    expect(screen.getByTestId('stage')).toHaveTextContent('play');
    expect(screen.getByTestId('actor')).toHaveTextContent('p1');

    fireEvent.click(screen.getByText('place'));
    expect(screen.getByTestId('stage')).toHaveTextContent('foundStartup');
  });
});
