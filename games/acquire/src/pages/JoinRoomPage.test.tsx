import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { JoinRoomPage } from './JoinRoomPage';
import type { Connection } from '../net/connection';
import { PROTOCOL_VERSION } from '../../session/protocol';
import {
  type JoinedMessage,
  type JoinRoomMessage,
  type RejectedMessage,
} from '../../vendor/lobby/protocol/protocol';

function fakeConnection() {
  let joined: ((m: JoinedMessage) => void) | null = null;
  // A Set, not a single slot — matches `RoomPage.test.tsx`'s fake: production
  // is `socket.on`/`socket.off`, and a single overwritten slot would hide a
  // regression in multiple listeners coexisting on the same transport.
  const rejectedHandlers = new Set<(m: RejectedMessage) => void>();
  const joins: JoinRoomMessage[] = [];

  const connection: Connection = {
    // Unused by this fake: `transport` is provided directly below, so nothing
    // here ever reads the socket. It exists only to satisfy `Connection`.
    socket: {} as unknown as Socket,
    transport: {
      sendIntent: () => {},
      sendUndo: () => {},
      onState: () => () => {},
      onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
      isOpen: () => true,
    },
    status: () => 'open',
    subscribe: () => () => {},
    createRoom: () => {},
    // The real connection injects `protocolVersion` when it builds the wire
    // message; this fake stands in for that whole layer, so it injects the
    // same field the same way, rather than making every call site's
    // assertion carry the connection's own concern.
    joinRoom: (m) => { joins.push({ ...m, protocolVersion: PROTOCOL_VERSION }); },
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
    joins,
    sendJoined: (m: JoinedMessage) => act(() => { joined?.(m); }),
    sendRejected: (m: RejectedMessage) => act(() => { for (const h of rejectedHandlers) h(m); }),
  };
}

function renderJoin(connection: Connection) {
  return render(
    <MemoryRouter initialEntries={['/online/join']}>
      <Routes>
        <Route path="/online/join" element={<JoinRoomPage connect={() => connection} />} />
        <Route path="/room/:roomId" element={<div>room page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); });

describe('joining a room', () => {
  it('stores the seat under that room\'s key and lands on the room page', () => {
    const f = fakeConnection();
    renderJoin(f.connection);

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByRole('button', { name: /join game/i }));

    expect(f.joins).toEqual([{ roomId: 'ABC123', name: 'Sam', protocolVersion: PROTOCOL_VERSION }]);

    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    expect(screen.getByText('room page')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('acquire.room.ABC123')!)).toEqual({
      playerId: 'p2', token: 'tok', name: 'Sam',
    });
  });

  it('shows a rejection and leaves the form usable', () => {
    const f = fakeConnection();
    renderJoin(f.connection);

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'WRONG1' } });
    fireEvent.click(screen.getByRole('button', { name: /join game/i }));

    f.sendRejected({ code: 'unknownIntent', message: 'cannot join WRONG1' });

    expect(screen.getByText(/cannot join wrong1/i)).toBeInTheDocument();

    // Not stuck: correcting the code and submitting again actually sends.
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByRole('button', { name: /join game/i }));

    expect(f.joins).toEqual([
      { roomId: 'WRONG1', name: 'Sam', protocolVersion: PROTOCOL_VERSION },
      { roomId: 'ABC123', name: 'Sam', protocolVersion: PROTOCOL_VERSION },
    ]);
  });

  /**
   * The owner's own bug: browser-back out of a game, then join by code —
   * refused, because the card sent a tokenless stranger's join for a room
   * whose seat this device still holds. The stored identity is the seamless
   * path: skip the join entirely and go to the room, where `useRoom` presents
   * the token.
   */
  it('goes straight to the room when this device already holds a seat there', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p2', token: 'tok', name: 'Sam' }),
    );
    const f = fakeConnection();
    renderJoin(f.connection);

    fireEvent.change(screen.getByTestId('room-code'), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByRole('button', { name: /join game/i }));

    expect(screen.getByText('room page')).toBeInTheDocument();
    // Not one tokenless join on this connection — the room page's own hook
    // owns the rejoin, token in hand.
    expect(f.joins).toEqual([]);
    // And the seat is still stored for it to present.
    expect(JSON.parse(localStorage.getItem('acquire.room.ABC123')!).token).toBe('tok');
  });

  it('sends only one joinRoom when submitted twice before a reply arrives', () => {
    const f = fakeConnection();
    const { container } = renderJoin(f.connection);

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'ABC123' } });

    // Submit the form directly, twice, rather than clicking the button twice:
    // the button's `disabled` attribute would itself suppress a second click
    // in a real browser, which would prove nothing about the page's own
    // guard. Dispatching `submit` on the form bypasses that and exercises the
    // guard in the card's own submit handler on its own merits.
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(f.joins).toEqual([{ roomId: 'ABC123', name: 'Sam', protocolVersion: PROTOCOL_VERSION }]);
  });
});

/**
 * The design's own words: "with a code present the field shows it in the same
 * letter-spaced style as New Room". Join Room and New Room are one card in two
 * states, and this is the state you type into — which is what the branch
 * originally missed, shipping two labelled inputs instead.
 */
describe('the Join Room card', () => {
  it('takes the code in the same block New Room reads it from', () => {
    const f = fakeConnection();
    renderJoin(f.connection);

    // Same hook the New Room card hangs its read-only block on, so the two
    // states cannot drift into different elements again without this failing.
    const box = screen.getByTestId('room-code');
    expect(box.tagName).toBe('INPUT');
    expect(box).toHaveClass('tracking-[0.3em]');
  });

  it('says Join and refuses to submit until a code is entered', () => {
    const f = fakeConnection();
    renderJoin(f.connection);

    expect(screen.getByRole('button', { name: /^join$/i })).toBeDisabled();

    fireEvent.change(screen.getByTestId('room-code'), { target: { value: 'ABC123' } });

    // The label changes with the state, per the mockup: the shorter word sits
    // on the button that cannot be pressed yet.
    expect(screen.queryByRole('button', { name: /^join$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /join game/i })).not.toBeDisabled();
    expect(f.joins).toEqual([]);
  });

  it('joins with no name at all, leaving the seat for the server to name', () => {
    const f = fakeConnection();
    renderJoin(f.connection);

    fireEvent.change(screen.getByTestId('room-code'), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByRole('button', { name: /join game/i }));

    // No `name` key on the wire at all — absence is what asks to be named, and
    // a blank string would only mean the same by the server's leniency.
    expect(f.joins).toEqual([{ roomId: 'ABC123', protocolVersion: PROTOCOL_VERSION }]);
    expect(localStorage.getItem('acquire.name')).toBeNull();
  });

  it('shows your own row before you are seated, with no seat emoji on it', () => {
    const f = fakeConnection();
    renderJoin(f.connection);

    // One row, and it is yours: the list fills with the others once the join
    // lands. The chip is blank because the emoji belongs to a seat and there
    // is no seat yet — seat one's face would be wrong for anyone not first.
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    for (const face of ['🦊', '🐢', '🦁', '🐙', '🦉', '🐝']) {
      expect(rows[0]!.textContent).not.toContain(face);
    }
    // And no presence dot either, for the same reason: presence belongs to a
    // socket bound to a seat, and this row has neither. Seen in a browser —
    // it rendered green, reporting a connection that did not exist.
    expect(screen.queryByTestId('presence-dot')).toBeNull();
  });
});
