import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GameScreen } from './GameScreen';
import { makeView } from '../test/fixtures';
import { CENTER } from '../../engine/constants';
import type { GameView, MoveRejectedMessage, WireMove } from '../../session/protocol';
import type { NotifyStatus } from '../notify/useNotifyStatus';

// Real useNotifyStatus does a network + localStorage round trip; every
// GameScreen render would otherwise kick one off. Most tests don't care
// about notification state, so it's mocked to a fixed, controllable value —
// the couple of tests that DO care about 'on' set it before rendering.
let notifyStatusValue: NotifyStatus = 'off';
const refreshNotify = vi.fn();
vi.mock('../notify/useNotifyStatus', () => ({
  useNotifyStatus: () => ({ status: notifyStatusValue, refresh: refreshNotify }),
}));

beforeEach(() => {
  notifyStatusValue = 'off';
  refreshNotify.mockClear();
});

// The fixture most tests render against: two seats, "me" to move, and a
// committed play in the log so the last-move banner has something to say.
const view = makeView({
  log: [
    {
      playerId: 'opp',
      kind: 'play',
      words: [{ word: 'SQUID', score: 62 }],
      score: 62,
      tilesPlayed: 5,
      at: Date.now() - 3 * 60 * 60 * 1000,
      positions: [112, 113, 114, 115, 116],
    },
  ],
});

function renderScreen(overrides: {
  view?: GameView;
  roomId?: string;
  sendMove?: (m: WireMove) => void;
  rejection?: MoveRejectedMessage | null;
  onDismissRejection?: () => void;
  connected?: boolean;
  presence?: Record<string, boolean>;
} = {}) {
  const sendMove = overrides.sendMove ?? vi.fn();
  render(
    <GameScreen
      view={overrides.view ?? view}
      viewerId="me"
      roomId={overrides.roomId ?? 'ABCD'}
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

/** Stages the rack's first two tiles onto CENTER and CENTER+1 — against the
 * fixture's empty board that's a geometrically valid first move (two tiles,
 * in line, through center), which is what previewPlay needs to price it. */
function stageFirstTwoTiles() {
  fireEvent.click(screen.getByTestId('rack-tile-0'));
  fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
  fireEvent.click(screen.getByTestId('rack-tile-0')); // rack shifted after the first placement
  fireEvent.click(screen.getByTestId(`cell-${CENTER + 1}`));
}

describe('GameScreen tap-to-place', () => {
  it('stages a rack tile on an empty square and shrinks the rack', () => {
    renderScreen({ view: makeView() });
    expect(rackTiles()).toHaveLength(7);
    fireEvent.click(screen.getByTestId('rack-tile-0')); // C
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    expect(rackTiles()).toHaveLength(6);
    const cell = screen.getByTestId(`cell-${CENTER}`);
    expect(cell).toHaveAttribute('data-staged');
    expect(cell).toHaveTextContent('C');
  });

  it('returns a staged tile to the rack when its square is tapped', () => {
    renderScreen({ view: makeView() });
    fireEvent.click(screen.getByTestId('rack-tile-0'));
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    expect(rackTiles()).toHaveLength(6);
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    expect(rackTiles()).toHaveLength(7);
    expect(screen.getByTestId(`cell-${CENTER}`)).not.toHaveAttribute('data-staged');
  });

  it('sends the staged placements as an exact play move', () => {
    const sendMove = vi.fn();
    renderScreen({ view: makeView(), sendMove });
    fireEvent.click(screen.getByTestId('rack-tile-0')); // C
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    fireEvent.click(screen.getByTestId('rack-tile-0')); // A (rack shifted)
    fireEvent.click(screen.getByTestId(`cell-${CENTER + 1}`));
    // CA through center prices a preview, so the button reads "Play · +N"
    // rather than bare "Play" — match by prefix, not exact name.
    fireEvent.click(screen.getByRole('button', { name: /^Play/ }));
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
    renderScreen({ view: makeView(), sendMove });
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
    renderScreen({ view: makeView() });
    fireEvent.click(screen.getByTestId('rack-tile-0'));
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    fireEvent.click(screen.getByTestId('rack-tile-0'));
    fireEvent.click(screen.getByTestId(`cell-${CENTER + 1}`));
    expect(rackTiles()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Recall' }));
    expect(rackTiles()).toHaveLength(7);
  });

  it('disables Play when it is not your turn', () => {
    renderScreen({ view: makeView({ currentPlayerId: 'opp', turnIndex: 1 }) });
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByText('Bob’s turn')).toBeInTheDocument();
  });
});

describe('GameScreen staged preview', () => {
  it('prices the play button from the staged preview', () => {
    renderScreen();
    stageFirstTwoTiles();
    expect(screen.getByRole('button', { name: /^Play · \+\d+$/ })).toBeInTheDocument();
  });

  it('shows nothing staged yet as a bare Play label with no floating badge', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByTestId('stage-badge')).not.toBeInTheDocument();
  });

  it('floats a score badge over the board once a play prices', () => {
    renderScreen();
    stageFirstTwoTiles();
    expect(screen.getByTestId('stage-badge')).toHaveTextContent(/^\+\d+$/);
  });
});

describe('GameScreen exchange', () => {
  it('selecting tiles and confirming sends the exchange move', () => {
    const sendMove = vi.fn();
    renderScreen({ view: makeView(), sendMove });
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    fireEvent.click(screen.getByTestId('rack-tile-0')); // C
    fireEvent.click(screen.getByTestId('rack-tile-2')); // T
    fireEvent.click(screen.getByRole('button', { name: 'Confirm swap (2)' }));
    expect(sendMove).toHaveBeenCalledExactlyOnceWith({ type: 'exchange', tiles: ['C', 'T'] });
  });

  it('is disabled with a hint when the bag is under 7', () => {
    renderScreen({ view: makeView({ bagCount: 5 }) });
    expect(screen.getByRole('button', { name: 'Swap' })).toBeDisabled();
    expect(
      screen.getByText('Exchanging needs at least 7 tiles in the bag (5 left).'),
    ).toBeInTheDocument();
  });
});

describe('GameScreen pass', () => {
  it('asks for a confirming second tap before sending pass', () => {
    const sendMove = vi.fn();
    renderScreen({ view: makeView(), sendMove });
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(sendMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pass — sure?' }));
    expect(sendMove).toHaveBeenCalledExactlyOnceWith({ type: 'pass' });
  });
});

describe('GameScreen status and scores', () => {
  it('shows turn and the scoreless counter when nonzero', () => {
    renderScreen({ view: makeView({ bagCount: 12, scorelessTurns: 3 }) });
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByTestId('scoreless-counter')).toHaveTextContent('Scoreless turns: 3/6');
  });

  it('shows the bag tile with the bag count', () => {
    renderScreen({ view: makeView({ bagCount: 12 }) });
    expect(screen.getByTestId('bag-tile')).toHaveTextContent('12');
  });

  it('shows the opponent in a chip, never as letters', () => {
    const v = makeView({
      players: [
        { id: 'me', name: 'Alice', score: 30, rackCount: 7, rack: ['C', 'A', 'T', 'S', 'D', 'O', '_'] },
        { id: 'opp', name: 'Bob', score: 45, rackCount: 5, rack: null },
      ],
    });
    renderScreen({ view: v });
    const chip = screen.getByTestId('player-chip-opp');
    expect(chip).toHaveTextContent('Bob');
    expect(chip).toHaveTextContent('45');
    // The opponent's rack is null in the view; nothing anywhere renders
    // opponent tiles — the only tile buttons on screen are the viewer's own.
    expect(rackTiles()).toHaveLength(7);
  });

  it('dims a disconnected player’s chip instead of drawing a presence dot', () => {
    renderScreen({ presence: { me: true, opp: false } });
    expect(screen.getByTestId('player-chip-me')).not.toHaveClass('opacity-60');
    expect(screen.getByTestId('player-chip-opp')).toHaveClass('opacity-60');
  });

  it('renders one chip per player with score, current turn highlighted', () => {
    renderScreen();
    const chips = screen.getAllByTestId(/player-chip-/);
    expect(chips).toHaveLength(view.players.length);
    expect(screen.getByTestId(`player-chip-${view.currentPlayerId}`)).toHaveAttribute('data-current');
  });
});

describe('GameScreen header', () => {
  it('shows the room code and a back-to-lobby control', () => {
    renderScreen({ roomId: 'KTWQ' });
    expect(screen.getByText('KTWQ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lobby/i })).toBeInTheDocument();
  });
});

describe('GameScreen last move', () => {
  it('describes the last committed play', () => {
    renderScreen();
    expect(screen.getByTestId('last-move')).toHaveTextContent(/played SQUID for 62/);
  });
});

describe('GameScreen notifications', () => {
  it('adds a nudge note and the profile badge when notifications are on', () => {
    notifyStatusValue = 'on';
    renderScreen({ view: makeView({ currentPlayerId: 'opp', turnIndex: 1 }) });
    expect(screen.getByText('Bob’s turn — you’ll get a nudge')).toBeInTheDocument();
    expect(screen.getByTestId('notify-badge')).toBeInTheDocument();
  });

  it('shows plain turn text and no badge when notifications are not on', () => {
    renderScreen({ view: makeView({ currentPlayerId: 'opp', turnIndex: 1 }) });
    expect(screen.getByText('Bob’s turn')).toBeInTheDocument();
    expect(screen.queryByTestId('notify-badge')).not.toBeInTheDocument();
  });

  it('opens notification settings from the profile chip, and refreshes on close', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByRole('dialog', { name: 'Notification settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close notification settings' }));
    expect(refreshNotify).toHaveBeenCalledOnce();
  });
});

describe('GameScreen move log', () => {
  it('describes plays, exchanges, passes and bingos, latest first', () => {
    const v = makeView({
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
    renderScreen({ view: v });
    const items = within(screen.getByTestId('move-log')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Bob: ZYMURGY (90) for 140 — bingo!');
    expect(items[1]).toHaveTextContent('Alice passed');
    expect(items[2]).toHaveTextContent('Bob exchanged 3 tiles');
    expect(items[3]).toHaveTextContent('Alice: CATS (12) for 12');
    // None of these carry `at` (old-save shape) — no age suffix to show.
    for (const item of items) expect(item).not.toHaveTextContent('ago');
  });

  it('appends the move\'s age when the record carries a timestamp', () => {
    const v = makeView({
      log: [
        {
          playerId: 'me',
          kind: 'play',
          words: [{ word: 'CATS', score: 12 }],
          score: 12,
          tilesPlayed: 4,
          at: Date.now() - 5 * 60 * 1000,
        },
      ],
    });
    renderScreen({ view: v });
    const items = within(screen.getByTestId('move-log')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Alice: CATS (12) for 12 · 5m ago');
  });
});

describe('GameScreen rejection', () => {
  it('draws the invalid-word card over the board and keeps tiles staged', () => {
    renderScreen({
      rejection: { code: 'invalidWord', message: 'not in the dictionary: DAX', words: ['DAX'] },
    });
    const card = screen.getByTestId('invalid-card');
    expect(card).toHaveTextContent(/DAX isn’t in the dictionary/);
    expect(card).toHaveTextContent(/rearrange or recall/i);
    // Dictionary rejections don't also show the top-of-screen strip.
    expect(screen.queryByTestId('rejection-note')).not.toBeInTheDocument();
  });

  it('dismisses the invalid-word card', () => {
    const onDismissRejection = vi.fn();
    renderScreen({
      rejection: { code: 'invalidWord', message: 'not in the dictionary: DAX', words: ['DAX'] },
      onDismissRejection,
    });
    fireEvent.click(within(screen.getByTestId('invalid-card')).getByRole('button', { name: 'OK' }));
    expect(onDismissRejection).toHaveBeenCalledOnce();
  });

  it('keeps other rejection codes in the dismissible strip', () => {
    const onDismissRejection = vi.fn();
    renderScreen({
      rejection: { code: 'notYourTurn', message: 'The game has not started.' },
      onDismissRejection,
    });
    const note = screen.getByTestId('rejection-note');
    expect(note).toHaveTextContent('The game has not started.');
    expect(screen.queryByTestId('invalid-card')).not.toBeInTheDocument();
    fireEvent.click(within(note).getByRole('button', { name: 'Dismiss' }));
    expect(onDismissRejection).toHaveBeenCalledOnce();
  });
});

describe('GameScreen game over', () => {
  it('shows final adjustments and the winner, and hides the action bar', () => {
    const v = makeView({
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
    renderScreen({ view: v });
    const over = screen.getByTestId('game-over');
    expect(over).toHaveTextContent('Alice wins!');
    expect(over).toHaveTextContent('−6 rack');
    expect(over).toHaveTextContent('+6 played out');
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('rack')).not.toBeInTheDocument();
  });
});
