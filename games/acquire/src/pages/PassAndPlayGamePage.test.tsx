import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PassAndPlayGamePage } from './PassAndPlayGamePage';
import { PassAndPlayPage } from './PassAndPlayPage';
import { buildFixture } from '../../engine/golden/fixtures';
import { save, load } from '../game/local/localSave';

/** A mid-game state where Alex can place A1 (isolated) and end the turn. */
function midGame() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['A1'] },
      { name: 'Sam', cash: 6000, hand: ['H8'] },
    ],
    bag: ['I11'],
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/pass-and-play" element={<PassAndPlayPage />} />
        <Route path="/pass-and-play/game" element={<PassAndPlayGamePage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function onBoard(coord: string) {
  const grid = screen.getByTestId('game-surface').querySelector('[data-board="grid"]')!;
  return within(grid as HTMLElement).getByTitle(coord);
}

beforeEach(() => { localStorage.clear(); });

describe('the game route, resumed from the save', () => {
  it('mounts the saved game behind the curtain', () => {
    save(midGame());

    renderAt('/pass-and-play/game');

    // The curtain first: a refresh is exactly the moment nobody is sure who
    // is holding the device, so no hand may show until the player says so.
    expect(screen.getByText(/pass to alex/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    // The board derives from the saved state, not from a fresh deal.
    expect(screen.getByTestId('game-surface')).toBeInTheDocument();
    expect(screen.getByText(/place a tile/i)).toBeInTheDocument();
  });

  it('redirects to the lobby when there is nothing to resume', () => {
    renderAt('/pass-and-play/game');

    // A deep link or refresh with no save must not render a dead board.
    expect(screen.queryByTestId('game-surface')).toBeNull();
    expect(screen.getByRole('button', { name: /start game/i })).toBeInTheDocument();
  });
});

describe('End game', () => {
  it('clears the save and returns to a lobby with nothing to continue', () => {
    save({ ...midGame(), stage: 'end' });
    renderAt('/pass-and-play/game');

    fireEvent.click(screen.getByRole('button', { name: /end game/i }));

    // The ruling: End game marks the game fully over, and the lobby then
    // offers a new game rather than a continue. Nothing else clears the save.
    expect(load()).toBeNull();
    expect(screen.queryByTestId('continue-card')).toBeNull();
    expect(screen.getByRole('button', { name: /start game/i })).toBeInTheDocument();
  });

  it('is not offered while the game is still going', () => {
    save(midGame());
    renderAt('/pass-and-play/game');
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    // Mid-game there is nothing to end: abandoning goes through the lobby's
    // New Game, which confirms. This button exists only on final scoring.
    expect(screen.queryByRole('button', { name: /end game/i })).toBeNull();
  });
});

describe('when a save is written', () => {
  it('writes on segment close, and not before', () => {
    const initial = midGame();
    save(initial);
    renderAt('/pass-and-play/game');
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    fireEvent.click(onBoard('A1'));

    // Staged, not committed: the placement is Alex's uncommitted work, and
    // the ruling is that a refresh mid-turn returns to the start of the turn.
    // The save on disk must still be the segment-start state.
    expect(load()!.state.board.A1.placed).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /end turn/i }));

    // The segment closed; now the tile is real and the save carries it.
    expect(load()!.state.board.A1.placed).toBe(true);
  });
});

describe('backgrounding the device raises the curtain', () => {
  /**
   * Found on the first real install: backgrounding the app mid-turn and
   * returning showed the hand sitting open. A fresh launch gets its curtain
   * from session construction; a living page never remounts, so the
   * visibility change is the moment the device left the player's hands.
   */
  it('shows the pass-to curtain after the page is hidden and shown again', () => {
    save(midGame());
    renderAt('/pass-and-play/game');
    // Mid-turn: session construction raised the curtain; lower it as the
    // player would.
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    expect(screen.queryByText(/pass to/i)).toBeNull();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    fireEvent(document, new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    fireEvent(document, new Event('visibilitychange'));

    expect(screen.getByText(/pass to/i)).toBeInTheDocument();
  });
});
