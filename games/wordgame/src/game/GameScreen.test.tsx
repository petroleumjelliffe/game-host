import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GameScreen } from './GameScreen';
import { makeView } from '../test/fixtures';
import { CENTER } from '../../engine/constants';
import type { GameView, MoveRejectedMessage, WireMove } from '../../session/protocol';

function renderScreen(view: GameView, overrides: {
  sendMove?: (m: WireMove) => void;
  rejection?: MoveRejectedMessage | null;
  onDismissRejection?: () => void;
  connected?: boolean;
  presence?: Record<string, boolean>;
} = {}) {
  const sendMove = overrides.sendMove ?? vi.fn();
  render(
    <GameScreen
      view={view}
      viewerId="me"
      connected={overrides.connected ?? true}
      {...(overrides.presence === undefined ? {} : { presence: overrides.presence })}
      sendMove={sendMove}
      rejection={overrides.rejection ?? null}
      onDismissRejection={overrides.onDismissRejection ?? (() => {})}
      onExit={() => {}}
    />,
  );
  return { sendMove };
}

const rackTiles = () => within(screen.getByTestId('rack')).getAllByRole('button');

describe('GameScreen tap-to-place', () => {
  it('stages a rack tile on an empty square and shrinks the rack', () => {
    renderScreen(makeView());
    expect(rackTiles()).toHaveLength(7);
    fireEvent.click(screen.getByTestId('rack-tile-0')); // C
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    expect(rackTiles()).toHaveLength(6);
    const cell = screen.getByTestId(`cell-${CENTER}`);
    expect(cell).toHaveAttribute('data-staged');
    expect(cell).toHaveTextContent('C');
  });

  it('returns a staged tile to the rack when its square is tapped', () => {
    renderScreen(makeView());
    fireEvent.click(screen.getByTestId('rack-tile-0'));
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    expect(rackTiles()).toHaveLength(6);
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    expect(rackTiles()).toHaveLength(7);
    expect(screen.getByTestId(`cell-${CENTER}`)).not.toHaveAttribute('data-staged');
  });

  it('sends the staged placements as an exact play move', () => {
    const sendMove = vi.fn();
    renderScreen(makeView(), { sendMove });
    fireEvent.click(screen.getByTestId('rack-tile-0')); // C
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    fireEvent.click(screen.getByTestId('rack-tile-0')); // A (rack shifted)
    fireEvent.click(screen.getByTestId(`cell-${CENTER + 1}`));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(sendMove).toHaveBeenCalledExactlyOnceWith({
      type: 'play',
      placements: [
        { pos: CENTER, tile: 'C' },
        { pos: CENTER + 1, tile: 'A' },
      ],
    });
  });

  it('opens the letter picker for a blank and stages the declared letter', () => {
    const sendMove = vi.fn();
    renderScreen(makeView(), { sendMove });
    fireEvent.click(screen.getByTestId('rack-tile-6')); // the blank
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    const picker = screen.getByRole('dialog', { name: 'Choose a letter for the blank' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Z' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const cell = screen.getByTestId(`cell-${CENTER}`);
    expect(cell).toHaveAttribute('data-staged');
    expect(cell).toHaveAttribute('data-blank');
    expect(cell).toHaveTextContent('z');
    expect(rackTiles()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(sendMove).toHaveBeenCalledExactlyOnceWith({
      type: 'play',
      placements: [{ pos: CENTER, tile: '_', as: 'Z' }],
    });
  });

  it('Recall returns every staged tile to the rack', () => {
    renderScreen(makeView());
    fireEvent.click(screen.getByTestId('rack-tile-0'));
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    fireEvent.click(screen.getByTestId('rack-tile-0'));
    fireEvent.click(screen.getByTestId(`cell-${CENTER + 1}`));
    expect(rackTiles()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Recall' }));
    expect(rackTiles()).toHaveLength(7);
  });

  it('disables Play when it is not your turn', () => {
    renderScreen(makeView({ currentPlayerId: 'opp', turnIndex: 1 }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByText('Bob’s turn')).toBeInTheDocument();
  });
});

describe('GameScreen exchange', () => {
  it('selecting tiles and confirming sends the exchange move', () => {
    const sendMove = vi.fn();
    renderScreen(makeView(), { sendMove });
    fireEvent.click(screen.getByRole('button', { name: 'Exchange' }));
    fireEvent.click(screen.getByTestId('rack-tile-0')); // C
    fireEvent.click(screen.getByTestId('rack-tile-2')); // T
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exchange (2)' }));
    expect(sendMove).toHaveBeenCalledExactlyOnceWith({ type: 'exchange', tiles: ['C', 'T'] });
  });

  it('is disabled with a hint when the bag is under 7', () => {
    renderScreen(makeView({ bagCount: 5 }));
    expect(screen.getByRole('button', { name: 'Exchange' })).toBeDisabled();
    expect(
      screen.getByText('Exchanging needs at least 7 tiles in the bag (5 left).'),
    ).toBeInTheDocument();
  });
});

describe('GameScreen pass', () => {
  it('asks for a confirming second tap before sending pass', () => {
    const sendMove = vi.fn();
    renderScreen(makeView(), { sendMove });
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(sendMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pass — sure?' }));
    expect(sendMove).toHaveBeenCalledExactlyOnceWith({ type: 'pass' });
  });
});

describe('GameScreen status and scores', () => {
  it('shows turn, bag count and the scoreless counter when nonzero', () => {
    renderScreen(makeView({ bagCount: 12, scorelessTurns: 3 }));
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText('Bag: 12')).toBeInTheDocument();
    expect(screen.getByTestId('scoreless-counter')).toHaveTextContent('Scoreless turns: 3/6');
  });

  it('shows the bag tile with the bag count', () => {
    renderScreen(makeView({ bagCount: 12 }));
    expect(screen.getByTestId('bag-tile')).toHaveTextContent('12');
  });

  it('shows the opponent as a tile count, never letters', () => {
    const view = makeView({
      players: [
        { id: 'me', name: 'Alice', score: 30, rackCount: 7, rack: ['C', 'A', 'T', 'S', 'D', 'O', '_'] },
        { id: 'opp', name: 'Bob', score: 45, rackCount: 5, rack: null },
      ],
    });
    renderScreen(view);
    const row = screen.getByTestId('score-row-opp');
    expect(row).toHaveTextContent('Bob');
    expect(row).toHaveTextContent('45');
    expect(row).toHaveTextContent('5');
    // The opponent's rack is null in the view; nothing anywhere renders
    // opponent tiles — the only tile buttons on screen are the viewer's own.
    expect(rackTiles()).toHaveLength(7);
  });

  it('shows presence dots from the roster', () => {
    renderScreen(makeView(), { presence: { me: true, opp: false } });
    const dots = screen.getAllByTestId('presence-dot');
    expect(dots[0]).toHaveClass('bg-green-500');
    expect(dots[1]).toHaveClass('bg-gray-300');
  });
});

describe('GameScreen move log', () => {
  it('describes plays, exchanges, passes and bingos, latest first', () => {
    const view = makeView({
      log: [
        { playerId: 'me', kind: 'play', words: [{ word: 'CATS', score: 12 }], score: 12, tilesPlayed: 4 },
        { playerId: 'opp', kind: 'exchange', score: 0, tilesPlayed: 3 },
        { playerId: 'me', kind: 'pass', score: 0 },
        {
          playerId: 'opp',
          kind: 'play',
          words: [{ word: 'ZYMURGY', score: 90 }],
          score: 140,
          tilesPlayed: 7,
          bingo: true,
        },
      ],
    });
    renderScreen(view);
    const items = within(screen.getByTestId('move-log')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Bob: ZYMURGY (90) for 140 — bingo!');
    expect(items[1]).toHaveTextContent('Alice passed');
    expect(items[2]).toHaveTextContent('Bob exchanged 3 tiles');
    expect(items[3]).toHaveTextContent('Alice: CATS (12) for 12');
  });
});

describe('GameScreen rejection', () => {
  it('renders the server message and the failing words, dismissibly', () => {
    const onDismissRejection = vi.fn();
    renderScreen(makeView(), {
      rejection: { code: 'invalidWord', message: 'Not a word.', words: ['QIZX', 'VLOP'] },
      onDismissRejection,
    });
    const note = screen.getByTestId('rejection-note');
    expect(note).toHaveTextContent('Not a word.');
    expect(note).toHaveTextContent('Not in the dictionary: QIZX, VLOP');
    fireEvent.click(within(note).getByRole('button', { name: 'Dismiss' }));
    expect(onDismissRejection).toHaveBeenCalledOnce();
  });
});

describe('GameScreen game over', () => {
  it('shows final adjustments and the winner, and hides the action bar', () => {
    const view = makeView({
      stage: 'over',
      currentPlayerId: null,
      players: [
        { id: 'me', name: 'Alice', score: 180, rackCount: 0, rack: [] },
        { id: 'opp', name: 'Bob', score: 140, rackCount: 3, rack: null },
      ],
      final: {
        adjustments: [
          { playerId: 'me', rackValue: 0, playedOutBonus: 6 },
          { playerId: 'opp', rackValue: 6, playedOutBonus: 0 },
        ],
        winnerIds: ['me'],
      },
    });
    renderScreen(view);
    const over = screen.getByTestId('game-over');
    expect(over).toHaveTextContent('Alice wins!');
    expect(over).toHaveTextContent('−6 rack');
    expect(over).toHaveTextContent('+6 played out');
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('rack')).not.toBeInTheDocument();
  });
});
