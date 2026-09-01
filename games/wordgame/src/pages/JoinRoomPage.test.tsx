import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { JoinRoomPage } from './JoinRoomPage';
import type { Connection, ConnectionStatus } from '../net/connection';
import type { JoinedMessage, RejectedMessage } from '@game-host/lobby/protocol/protocol';

// A minimal fake — JoinRoomPage only ever reads `onJoined` and
// `transport.onRejected`, and calls `joinRoom`. Modeled on RoomPage.test.tsx's
// fakeConnection, trimmed to what this page touches.
function fakeConnect(): Connection {
  const status: ConnectionStatus = 'open';
  return {
    socket: {} as unknown as Socket,
    transport: {
      sendMove: () => {},
      onState: () => () => {},
      onRejected: (_h: (m: RejectedMessage) => void) => () => {},
      isOpen: () => status === 'open',
    },
    status: () => status,
    subscribe: () => () => {},
    createRoom: () => {},
    joinRoom: () => {},
    beginGame: () => {},
    renamePlayer: () => {},
    leaveSeat: () => {},
    onJoined: (_h: (m: JoinedMessage) => void) => () => {},
    onRoster: () => () => {},
    onRejected: (_h: (m: RejectedMessage) => void) => () => {},
    close: () => {},
  };
}

afterEach(() => {
  localStorage.clear();
});

describe('JoinRoomPage', () => {
  it('prefills the code from the query string', () => {
    render(
      <MemoryRouter initialEntries={['/online/join?code=ktwq']}>
        <Routes>
          <Route path="/online/join" element={<JoinRoomPage connect={fakeConnect} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Room code')).toHaveValue('KTWQ');
  });

  it('leaves the code blank when the query string has none', () => {
    render(
      <MemoryRouter initialEntries={['/online/join']}>
        <Routes>
          <Route path="/online/join" element={<JoinRoomPage connect={fakeConnect} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Room code')).toHaveValue('');
  });
});
