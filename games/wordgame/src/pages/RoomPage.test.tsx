import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { RoomPage } from './RoomPage';
import type { Connection, ConnectionStatus } from '../net/connection';
import type { StateMessage, WireMove } from '../../session/protocol';
import type {
  JoinedMessage,
  RejectedMessage,
  RosterMessage,
} from '@game-host/lobby/protocol/protocol';
import { makeView } from '../test/fixtures';
import { CENTER } from '../../engine/constants';

function fakeConnection() {
  // Sets, not single slots: useLobbyRoom and useRoom both subscribe to the
  // same channels (the lobby to seat itself, the wrapper to build the game),
  // and a one-slot fake would silently drop whichever registered first.
  const joinedHandlers = new Set<(m: JoinedMessage) => void>();
  const rosterHandlers = new Set<(m: RosterMessage) => void>();
  const stateHandlers = new Set<(m: StateMessage) => void>();
  const rejectedHandlers = new Set<(m: RejectedMessage) => void>();
  const statusListeners = new Set<() => void>();
  const moves: WireMove[] = [];
  let status: ConnectionStatus = 'open';

  const connection: Connection = {
    socket: {} as unknown as Socket,
    transport: {
      sendMove: (m) => { moves.push(m); },
      onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
      onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
      isOpen: () => status === 'open',
    },
    status: () => status,
    subscribe: (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; },
    createRoom: () => {},
    joinRoom: () => {},
    beginGame: () => {},
    renamePlayer: () => {},
    leaveSeat: () => {},
    onJoined: (h) => { joinedHandlers.add(h); return () => { joinedHandlers.delete(h); }; },
    onRoster: (h) => { rosterHandlers.add(h); return () => { rosterHandlers.delete(h); }; },
    onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
    close: () => {},
  };

  return {
    connection,
    moves,
    sendJoined: (m: JoinedMessage) => act(() => { for (const h of [...joinedHandlers]) h(m); }),
    sendRoster: (m: RosterMessage) => act(() => { for (const h of [...rosterHandlers]) h(m); }),
    sendState: (m: StateMessage) => act(() => { for (const h of [...stateHandlers]) h(m); }),
    sendRejected: (m: RejectedMessage) => act(() => { for (const h of [...rejectedHandlers]) h(m); }),
  };
}

function renderRoom(connection: Connection) {
  return render(
    <MemoryRouter initialEntries={['/room/ABC123']}>
      <Routes>
        <Route path="/room/:roomId" element={<RoomPage connect={() => connection} />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const lobbyRoster = (): RosterMessage => ({
  roomId: 'ABC123',
  lifecycle: 'lobby',
  players: [
    { id: 'me', name: 'Alice', isHost: true, connected: true },
    { id: 'opp', name: 'Bob', isHost: false, connected: true },
  ],
});

function seatAndStart(fake: ReturnType<typeof fakeConnection>) {
  fake.sendJoined({ roomId: 'ABC123', playerId: 'me', token: 'tok' });
  fake.sendRoster({ ...lobbyRoster(), lifecycle: 'playing' });
  fake.sendState({ view: makeView(), reason: 'resume' });
}

// Two occupied seats out of the game's real capacity (6) — the seat note is
// derived from `view.seats.length`, never a hardcoded 4, so this fixture
// deliberately does not fill the room.
function seatTwoOfSix(fake: ReturnType<typeof fakeConnection>) {
  fake.sendJoined({ roomId: 'ABC123', playerId: 'me', token: 'tok' });
  fake.sendRoster(lobbyRoster());
}

// Seated as the non-host: the guest sees the amber "waiting for the host"
// banner rather than a Start button.
function seatAsGuest(fake: ReturnType<typeof fakeConnection>) {
  fake.sendJoined({ roomId: 'ABC123', playerId: 'me', token: 'tok' });
  fake.sendRoster({
    roomId: 'ABC123',
    lifecycle: 'lobby',
    players: [
      { id: 'host', name: 'Pete', isHost: true, connected: true },
      { id: 'me', name: 'Alice', isHost: false, connected: true },
    ],
  });
}

afterEach(() => {
  localStorage.clear();
});

describe('RoomPage', () => {
  it('renders the lobby seats from the roster, with Start for the host', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    fake.sendJoined({ roomId: 'ABC123', playerId: 'me', token: 'tok' });
    fake.sendRoster(lobbyRoster());

    expect(screen.getByTestId('room-code')).toHaveTextContent('ABC123');
    // Your own row is the rename field; the other seat is plain text.
    expect(screen.getByLabelText('Your name')).toHaveValue('Alice');
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start game' })).toBeInTheDocument();
  });

  it('counts seats under the list', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatTwoOfSix(fake);

    expect(screen.getByText('2 of 6 seats — waiting for 4 more')).toBeInTheDocument();
  });

  it('tells a guest they will be nudged when the game starts', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAsGuest(fake);

    expect(screen.getByText('Waiting for Pete to start')).toBeInTheDocument();
    expect(screen.getByText(/You’ll get a nudge when the first turn is yours/)).toBeInTheDocument();
  });

  it('a state message turns the lobby into the game', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAndStart(fake);

    expect(screen.getByTestId('game-screen')).toBeInTheDocument();
    expect(screen.getByTestId('board')).toBeInTheDocument();
    // The viewer's own rack arrived in the view.
    expect(screen.getByTestId('rack')).toBeInTheDocument();
    // Turn shows on the highlighted chip now — the turn-text line is gone.
    expect(screen.getByTestId('game-screen').querySelector('[data-current]')).not.toBeNull();
  });

  it('a played move goes out over the transport', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAndStart(fake);

    fireEvent.click(screen.getByTestId('rack-tile-0')); // C
    fireEvent.click(screen.getByTestId(`cell-${CENTER}`));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(fake.moves).toEqual([{ type: 'play', placements: [{ pos: CENTER, tile: 'C' }] }]);
  });

  it('an invalidWord rejection surfaces on the game screen with its words', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAndStart(fake);

    fake.sendRejected({
      code: 'invalidWord',
      message: 'QIZX is not a word.',
      words: ['QIZX'],
    } as RejectedMessage);
    // invalidWord surfaces as the board's own overlay card, not the
    // top-of-screen strip (Task 8: docs/plans/2026-08-31-wordgame-redesign).
    const card = screen.getByTestId('invalid-card');
    expect(card).toHaveTextContent('QIZX');
    // Still on the board — a refused move never tears the game down.
    expect(screen.getByTestId('game-screen')).toBeInTheDocument();
  });

  it('noSuchRoom is terminal: the room-gone screen replaces everything', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAndStart(fake);

    fake.sendRejected({ code: 'noSuchRoom', message: 'No room ABC123.' });
    expect(screen.getByTestId('room-gone')).toBeInTheDocument();
    expect(screen.queryByTestId('game-screen')).not.toBeInTheDocument();
  });

  it('versionMismatch outranks playing: the stale-client screen shows', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAndStart(fake);

    fake.sendRejected({ code: 'versionMismatch', message: 'Protocol skew.' });
    expect(screen.getByTestId('stale-client')).toBeInTheDocument();
  });
});
