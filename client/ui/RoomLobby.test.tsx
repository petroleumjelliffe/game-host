import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomLobby } from './RoomLobby';

const noop = () => {};
const players = [
  { id: 'p1', name: 'Ada', isHost: true, connected: true },
  { id: 'p2', name: 'Bee', isHost: false, connected: true },
];

function renderLobby(extra: Partial<Parameters<typeof RoomLobby>[0]> = {}) {
  return render(
    <RoomLobby
      roomId="ABC123"
      players={players}
      myPlayerId="p1"
      isHost
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
