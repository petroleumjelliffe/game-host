import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomLobby } from './RoomLobby';
import { lobbyView } from '../../../vendor/lobby/client/view';

const noop = () => {};

// Built through `lobbyView` rather than hand-assembled, so this test cannot
// drift from what a real page passes — and so a four-seat room with two
// players is exercised, empty seats included.
const view = lobbyView(
  {
    phase: 'lobby',
    status: 'open',
    playerId: 'p1',
    roster: {
      roomId: 'ABC123',
      lifecycle: 'lobby',
      players: [
        { id: 'p1', name: 'Ada', isHost: true, connected: true },
        { id: 'p2', name: 'Bee', isHost: false, connected: true },
      ],
    },
  },
  { capacity: 4, minPlayers: 2 },
);

function renderLobby(extra: Partial<Parameters<typeof RoomLobby>[0]> = {}) {
  return render(
    <RoomLobby
      view={view}
      onStart={noop}
      onRename={noop}
      onLeaveSeat={noop}
      seatEmoji={() => null}
      {...extra}
    />,
  );
}

describe('RoomLobby share affordance', () => {
  it('shows the share button when the game hands it a link', () => {
    renderLobby({ shareUrl: 'https://example.test/room/ABC123' });
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
  });

  it('shows nothing share-shaped without a link', () => {
    renderLobby();
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument();
  });
});

describe('RoomLobby seats', () => {
  it('draws every seat the room has, not only the occupied ones', () => {
    // The roster carries occupied seats alone, so before the view model this
    // screen could not show that a four-seat room had two seats free.
    const { container } = renderLobby();
    expect(container.querySelectorAll('li')).toHaveLength(4);
    expect(container.querySelectorAll('li[data-empty]')).toHaveLength(2);
    expect(screen.getAllByText('Empty seat')).toHaveLength(2);
  });

  it('gives the name field to your row and nowhere else', () => {
    renderLobby();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('Ada');
  });
});
