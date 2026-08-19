import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { OnlineLobbyPage } from './OnlineLobbyPage';
import type { Connection } from '../net/connection';
import type { JoinedMessage, RejectedMessage } from '../../vendor/lobby/protocol/protocol';

// `CreateRoomPage.test.tsx`'s coverage, carried here when that page was
// deleted: the Lobby Flow design has no name form in front of a room, so
// Create Room seats you immediately and the room's own-row edit is where a
// name gets chosen.

function fakeConnection() {
  let joined: ((m: JoinedMessage) => void) | null = null;
  const rejectedHandlers = new Set<(m: RejectedMessage) => void>();
  const created: (string | undefined)[] = [];

  const connection: Connection = {
    // Unused by this fake: `transport` is provided directly below, so nothing
    // here ever reads the socket. It exists only to satisfy `Connection`.
    socket: {} as unknown as Socket,
    transport: {
      sendIntent: () => {}, sendUndo: () => {},
      onState: () => () => {},
      onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
      isOpen: () => true,
    },
    status: () => 'open',
    subscribe: () => () => {},
    createRoom: (name) => { created.push(name); },
    joinRoom: () => {},
    beginGame: () => {},
    renamePlayer: () => {},
    leaveSeat: () => {},
    onJoined: (h) => { joined = h; return () => { joined = null; }; },
    onRoster: () => () => {},
    onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
    close: () => {},
  };

  return {
    connection,
    created,
    sendJoined: (m: JoinedMessage) => act(() => { joined?.(m); }),
    sendRejected: (m: RejectedMessage) => act(() => { for (const h of rejectedHandlers) h(m); }),
  };
}

function renderLobby(connection: Connection) {
  return render(
    <MemoryRouter initialEntries={['/online']}>
      <Routes>
        <Route path="/online" element={<OnlineLobbyPage connect={() => connection} />} />
        <Route path="/room/:roomId" element={<div>room page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); });

describe('creating a room, with no name form in the way', () => {
  it('sends no name at all, and lets the server seat and name you', () => {
    const f = fakeConnection();
    renderLobby(f.connection);

    fireEvent.click(screen.getByRole('button', { name: /create room/i }));

    // Nothing is invented here. The default is made of the seat number, and
    // this client does not know its seat until it has been given one — so the
    // name is the server's to choose, and the absent field is how it is asked.
    expect(f.created).toEqual([undefined]);
    // And a name nobody chose is not remembered: carrying `Player 1` forward
    // would name you after a seat you no longer sit in.
    expect(localStorage.getItem('acquire.name')).toBeNull();

    f.sendJoined({ roomId: 'ABC123', playerId: 'p1', token: 'tok' });

    expect(screen.getByText('room page')).toBeInTheDocument();
    // The seat the server issued is stored under the room's key, so the room
    // screen rejoins rather than taking a second seat.
    const stored = JSON.parse(localStorage.getItem('acquire.room.ABC123')!);
    expect(stored.playerId).toBe('p1');
    expect(stored.token).toBe('tok');
  });

  it('creates under the remembered name when there is one', () => {
    localStorage.setItem('acquire.name', 'Alex');
    const f = fakeConnection();
    renderLobby(f.connection);

    fireEvent.click(screen.getByRole('button', { name: /create room/i }));

    expect(f.created).toEqual(['Alex']);
  });

  it('recovers from a rejection instead of hanging on "Creating…" forever', () => {
    const f = fakeConnection();
    renderLobby(f.connection);

    fireEvent.click(screen.getByRole('button', { name: /create room/i }));
    expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();

    f.sendRejected({ code: 'unknownIntent', message: 'createRoom requires a name' });

    // Not stuck: the button is live again and reads its idle label.
    const button = screen.getByRole('button', { name: /create room/i });
    expect(button).not.toBeDisabled();
    expect(screen.getByText(/createRoom requires a name/i)).toBeInTheDocument();

    fireEvent.click(button);
    expect(f.created).toHaveLength(2);
  });
});
