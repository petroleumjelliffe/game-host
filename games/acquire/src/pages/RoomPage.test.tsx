import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { RoomPage } from './RoomPage';
import type { Connection, ConnectionStatus } from '../net/connection';
import { PROTOCOL_VERSION, type StateMessage } from '../../session/protocol';
import {
  type JoinedMessage,
  type RejectedMessage,
  type RosterMessage,
} from '../../vendor/lobby/protocol/protocol';
import { buildFixture } from '../../engine/golden/fixtures';
import { loadIdentity } from '../net/identity';
import { useRoom, type RoomPhase } from '../net/useRoom';

function fakeConnection() {
  let roster: ((m: RosterMessage) => void) | null = null;
  // Sets, not a single slot: production is `socket.on`/`socket.off`, and more
  // than one caller registers its own listener on the same event —
  // `useLobbyRoom` and the game's `useRoom` both call `onJoined` (the lobby
  // to seat itself, the wrapper to track the id it needs to build a session
  // ahead of the next render); `useRoom` and `createNetworkSession` both
  // register `state` and `rejected` on the same transport. A single
  // overwritten slot would silently collapse two real listeners into one and
  // hide any regression in that coexistence.
  const joinedHandlers = new Set<(m: JoinedMessage) => void>();
  const stateHandlers = new Set<(m: StateMessage) => void>();
  const rejectedHandlers = new Set<(m: RejectedMessage) => void>();
  const statusListeners = new Set<() => void>();
  const joins: unknown[] = [];
  const begins: number[] = [];
  const renames: string[] = [];
  const seatLeaves: number[] = [];
  let status: ConnectionStatus = 'open';

  const connection: Connection = {
    // Unused by this fake: `transport` is provided directly below, so nothing
    // here ever reads the socket. It exists only to satisfy `Connection`.
    socket: {} as unknown as Socket,
    transport: {
      sendIntent: () => {},
      sendUndo: () => {},
      onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
      onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
      // Tied to the same `status` a real socket's `connected` flag tracks,
      // so driving `setStatus` below exercises `NetworkSession`'s own
      // `!transport.isOpen()` guard the same way a real drop would.
      isOpen: () => status === 'open',
    },
    status: () => status,
    subscribe: (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; },
    createRoom: () => {},
    // The real connection injects `protocolVersion` when it builds the wire
    // message; this fake stands in for that whole layer, so it injects the
    // same field the same way, rather than making every call site's
    // assertion carry the connection's own concern.
    joinRoom: (m) => { joins.push({ ...m, protocolVersion: PROTOCOL_VERSION }); },
    beginGame: () => { begins.push(1); },
    renamePlayer: (n) => { renames.push(n); },
    leaveSeat: () => { seatLeaves.push(1); },
    onJoined: (h) => { joinedHandlers.add(h); return () => { joinedHandlers.delete(h); }; },
    onRoster: (h) => { roster = h; return () => { roster = null; }; },
    onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
    close: () => {},
  };

  return {
    connection,
    joins,
    begins,
    renames,
    seatLeaves,
    sendJoined: (m: JoinedMessage) => act(() => { for (const h of joinedHandlers) h(m); }),
    sendRoster: (m: RosterMessage) => act(() => { roster?.(m); }),
    sendState: (m: StateMessage) => act(() => { for (const h of stateHandlers) h(m); }),
    sendRejected: (m: RejectedMessage) => act(() => { for (const h of rejectedHandlers) h(m); }),
    setStatus: (next: ConnectionStatus) => act(() => {
      status = next;
      for (const l of statusListeners) l();
    }),
  };
}

/**
 * The board's own cell for a coordinate. Scoped, because a coordinate can be
 * on screen three times at once — the board, the hand the placement step
 * shows, and a log token — all carrying `title={coord}`.
 */
function onBoard(coord: string) {
  const grid = screen.getByTestId('game-surface').querySelector('[data-board="grid"]')!;
  return within(grid as HTMLElement).getByTitle(coord);
}

function renderRoom(connection: Connection) {
  return render(
    <MemoryRouter initialEntries={['/room/ABC123']}>
      <Routes>
        <Route path="/room/:roomId" element={<RoomPage connect={() => connection} />} />
        {/* Leaving navigates home; without this stub the router warns on
            stderr, and a warning in the run regresses the clean baseline. */}
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Renders the current query string, so a test can assert what the URL still carries. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-search">{location.search}</span>;
}

/**
 * Renders the room as somebody who has called themselves `name` before.
 *
 * There is no form to fill in any more: arriving at a room joins it, under a
 * remembered name if there is one and under a name the server chooses if not.
 * So the name has to be in storage *before* the render that sends the join.
 */
function arriveAs(name: string) {
  localStorage.setItem('acquire.name', name);
  const f = fakeConnection();
  renderRoom(f.connection);
  return f;
}

/** Joins as `name`, gets seated, and lands in the lobby with a second player already in it. */
function seated(name: string, isHost: boolean) {
  const f = arriveAs(name);
  f.sendJoined({ roomId: 'ABC123', playerId: isHost ? 'p1' : 'p2', token: 'tok' });
  f.sendRoster({
    roomId: 'ABC123',
    lifecycle: 'lobby',
    players: [
      { id: 'p1', name: 'Alex', isHost: true, connected: true },
      { id: 'p2', name: 'Sam', isHost: false, connected: true },
    ],
  });
  return f;
}

beforeEach(() => { localStorage.clear(); });

describe('arriving at a room without a seat', () => {
  it('joins immediately and lets the server name the seat', () => {
    const f = fakeConnection();
    renderRoom(f.connection);

    // No form in the way — the same rule Create Room and Join Room follow.
    // A shared link now seats you rather than interviewing you first.
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
    expect(f.joins).toEqual([{ roomId: 'ABC123', protocolVersion: PROTOCOL_VERSION }]);
  });

  it('joins under the remembered name when there is one', () => {
    const f = arriveAs('Sam');

    expect(f.joins).toEqual([{ roomId: 'ABC123', name: 'Sam', protocolVersion: PROTOCOL_VERSION }]);
  });
});

/**
 * Every phase this hook passed through, in order, across every render.
 *
 * A settled-DOM assertion cannot see a one-frame flash: `render` wraps its
 * effects in `act`, so by the time any `expect` runs the effect has already
 * corrected the phase and the offending frame is gone from the DOM. What a
 * player sees, though, is frames. Recording them is the only way to assert
 * one never happened.
 */
function phasesSeen(connection: Connection, roomId = 'ABC123'): RoomPhase[] {
  const phases: RoomPhase[] = [];
  function Probe() {
    phases.push(useRoom(roomId, () => connection).phase);
    return null;
  }
  render(<Probe />);
  return phases;
}

describe('nobody is ever shown a form on the way into a room', () => {
  it('goes straight to joining when a seat is stored', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p2', token: 'tok', name: 'Sam' }),
    );
    const f = fakeConnection();

    const phases = phasesSeen(f.connection);

    expect(phases.at(-1)).toBe('joining');
  });

  /**
   * The case that used to be the exception. A stranger with nothing stored
   * and nothing remembered was the one player the name form existed for; now
   * they are joined like everyone else and named by the server.
   *
   * Asserted over every frame, not just the settled one, because the phase
   * this replaced was itself only ever visible for a frame.
   */
  it('joins a complete stranger too, with no intermediate frame of anything else', () => {
    const f = fakeConnection();

    const phases = phasesSeen(f.connection);

    expect(phases.at(-1)).toBe('joining');
    expect(new Set(phases)).toEqual(new Set(['joining']));
    // And `joining` has to be more than a label. The phase expression now
    // falls through to it whenever the socket is open and nothing else has
    // happened, so it reads identically whether or not the effect actually
    // sent anything — disabling the stranger path leaves every assertion
    // above this one green. Only the wire says a join really went out.
    expect(f.joins).toEqual([{ roomId: 'ABC123', protocolVersion: PROTOCOL_VERSION }]);
  });
});

describe('a refresh rejoins the same seat', () => {
  it('presents the stored token instead of taking a new seat', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p2', token: 'tok', name: 'Sam' }),
    );
    const f = fakeConnection();
    renderRoom(f.connection);

    expect(f.joins).toEqual([{ roomId: 'ABC123', name: 'Sam', playerId: 'p2', token: 'tok', protocolVersion: PROTOCOL_VERSION }]);
  });
});

describe('the lobby', () => {
  it('shows the code to read out and everyone in it', () => {
    seated('Alex', true);
    expect(screen.getByTestId('room-code')).toHaveTextContent('ABC123');
    // Your own name is the editable field; everyone else's is plain text.
    expect(screen.getByDisplayValue('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('lets the host start', () => {
    const f = seated('Alex', true);
    fireEvent.click(screen.getByRole('button', { name: /start game/i }));
    expect(f.begins).toHaveLength(1);
  });

  it('offers nobody else a start button', () => {
    seated('Alex', false);
    expect(screen.queryByRole('button', { name: /start game/i })).toBeNull();
    expect(screen.getByText(/waiting for the host/i)).toBeInTheDocument();
  });

  /**
   * The design's own-row actions: the field and the × belong to your seat
   * and nobody else's. Joined as p2 (Sam), so Alex's row must stay plain.
   */
  it('renames your own seat on blur, not per keystroke', () => {
    const f = seated('Sam', false);

    const field = screen.getByLabelText(/your name/i);
    fireEvent.change(field, { target: { value: 'Samantha' } });
    expect(f.renames).toEqual([]);

    fireEvent.blur(field);
    expect(f.renames).toEqual(['Samantha']);
    // Alex's row grew no field: one input on the page, and it is yours.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('carries a chosen name into the next room', () => {
    // "Names should persist on device, across games" (owner). Renaming your
    // seat is where an online name is chosen, so it is where the remembered
    // name gets written — the next Create or Join reads it back.
    const f = seated('Sam', false);

    const field = screen.getByLabelText(/your name/i);
    fireEvent.change(field, { target: { value: 'Samantha' } });
    fireEvent.blur(field);

    expect(f.renames).toEqual(['Samantha']);
    expect(localStorage.getItem('acquire.name')).toBe('Samantha');
  });

  it('does not broadcast a rename to the name you already have', () => {
    const f = seated('Sam', false);

    const field = screen.getByLabelText(/your name/i);
    fireEvent.blur(field);

    expect(f.renames).toEqual([]);
  });

  it('Leave gives up the seat and forgets it', () => {
    const f = seated('Sam', false);
    expect(loadIdentity('ABC123')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^leave$/i }));

    expect(f.seatLeaves).toHaveLength(1);
    // The token is dead with the seat — keeping it would make the next visit
    // attempt a rejoin the server must refuse.
    expect(loadIdentity('ABC123')).toBeNull();
  });

  /**
   * The mockup draws a × on your own row in both cards. It was dropped
   * (owner, 2026-08-07): `Leave` directly below the roster already vacates
   * your seat, so the × was a second control for one action — and on the
   * host's row it read as "boot yourself", which is not a thing anyone needs.
   * See ../../docs/superpowers/plans/2026-08-07-lobby-flow-corrections.md.
   */
  it('gives no row a × of its own — Leave is the only way out', () => {
    seated('Sam', false);

    expect(screen.queryByRole('button', { name: /leave your seat/i })).toBeNull();
    // Enumerated rather than counted, so the check cannot pass merely because
    // the × was relabelled. Sam is not the host, so the card's own controls —
    // Share (2026-08-09) and `Leave` — are the whole set; nothing row-scoped.
    expect(
      screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['Share link', 'Leave']);
  });
});

describe('a refusal that arrives after being seated', () => {
  it('shows inside the lobby rather than bouncing back to the join form', () => {
    const f = seated('Sam', false);

    // What the server actually sends a non-host who presses "start" — this
    // is the exact scenario `useRoom`'s phase ordering exists for.
    f.sendRejected({ code: 'notYourTurn', message: 'only the host may begin the game' });

    // Still in the lobby: the room code and the roster are still on screen.
    expect(screen.getByTestId('room-code')).toHaveTextContent('ABC123');
    expect(screen.getByText('Alex')).toBeInTheDocument();
    // The refusal is shown as a note, not swapped in for the lobby.
    expect(screen.getByText(/only the host may begin/i)).toBeInTheDocument();
    // Not bounced back to a join form. Keyed on the form's own submit button
    // rather than the "Your name" label, which the lobby's editable own-row
    // now legitimately carries.
    expect(screen.queryByRole('button', { name: /join room/i })).toBeNull();
  });
});

describe('the first state message starts the game', () => {
  it('swaps the lobby for the board, seen from my own seat', () => {
    const f = arriveAs('Sam');
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });

    expect(screen.getByTestId('game-surface')).toBeInTheDocument();
    // p2's own tile, and no curtain over it.
    expect(onBoard('A1')).toBeInTheDocument();
    expect(screen.queryByText(/pass to/i)).toBeNull();
    expect(screen.getByTestId('turn-toast')).toHaveTextContent(/alex/i);
  });

  it('keeps updating the board after the session is built, not just for the first message', () => {
    const f = arriveAs('Sam');
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const opening = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state: opening, reason: 'commit', segmentStart: opening.nextStepId });

    // A1 starts out in Sam's hand — badged as such, because online the
    // always-on badges stayed (the hover-only rule is pass-and-play's alone).
    expect(onBoard('A1')).toHaveAttribute('data-tile-state', 'hand');

    // A second state — the kind a real commit sends after a move — with A1
    // now placed on the board and a new tile, B2, drawn into the hand. This
    // only reaches the screen if `createNetworkSession`'s own `onState`
    // listener is still registered once `useRoom`'s has done its one job
    // (building the session) and become a no-op.
    const afterMove = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['B2'] },
      ],
      loners: ['E5', 'A1'],
      bag: ['I11'],
    });
    f.sendState({ state: afterMove, reason: 'commit', segmentStart: afterMove.nextStepId });

    // A1 is now a settled board tile, not a hand tile.
    expect(onBoard('A1')).toHaveAttribute('data-tile-state', 'filled');
    // B2 is the new hand tile.
    expect(onBoard('B2')).toHaveAttribute('data-tile-state', 'hand');
  });
});

/**
 * Sam (p2) is the actor, at `buy` — where `useTurnPanel` always renders its
 * one commit button, so there is no board placement to walk through first
 * (placing a tile next to a lone tile founds a chain and changes stage, which
 * is not what these tests are about). With nothing staged that button reads
 * "Skip", and pressing it ends the turn: a bag-drawing intent, which is the
 * pending path these tests need.
 */
function midGameState() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: [] },
      { name: 'Sam', cash: 6000, hand: [] },
    ],
    stage: 'buy',
    currentPlayerIndex: 1,
    bag: ['I11', 'I12'],
  });
}

describe('a dropped connection', () => {
  it('clears a stuck "Sending…" and goes inert, even mid-turn', () => {
    const f = arriveAs('Sam');
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const state = midGameState();
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });

    // It is Sam's own turn. Skipping the buy ends it, and ending a turn is a
    // bag-drawing intent: it goes on the wire and the session marks itself
    // pending until the server answers.
    fireEvent.click(screen.getByRole('button', { name: /^end turn$/i }));
    expect(screen.getByText(/sending/i)).toBeInTheDocument();

    f.setStatus('closed');

    // Not stuck on "Sending…" forever, and a readable message replaces it —
    // the belt (`connectionLost`, the panel's own alert) and the suspenders
    // (`connected` forcing `canAct` false, `ConnectionStrip`'s own pill) both
    // land. Two distinct roles, not `getByText`, because both messages
    // contain "disconnect" and a bare text query would match twice.
    expect(screen.queryByText(/sending/i)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/disconnect/i);
    // By test id, not by role: the turn toast is also a live region, and
    // since it now announces your *own* turn as well there are two on screen
    // whenever it is your move.
    expect(screen.getByTestId('connection-strip')).toHaveTextContent(/disconnect/i);
  });

  it('resends the stored-identity join once the socket comes back', () => {
    const f = arriveAs('Sam');
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const state = midGameState();
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });
    expect(f.joins).toEqual([{ roomId: 'ABC123', name: 'Sam', protocolVersion: PROTOCOL_VERSION }]);

    f.setStatus('closed');
    f.setStatus('open');

    // The join latch that stopped a second `joinRoom` from ever being sent
    // has to reset on the drop, or this rejoin — the thing that actually
    // rebinds the socket server-side — never happens.
    expect(f.joins).toEqual([
      { roomId: 'ABC123', name: 'Sam', protocolVersion: PROTOCOL_VERSION },
      { roomId: 'ABC123', name: 'Sam', playerId: 'p2', token: 'tok', protocolVersion: PROTOCOL_VERSION },
    ]);
  });
});

describe('a player who has dropped', () => {
  it('is named in the toast when the game is waiting on them', () => {
    const f = arriveAs('Sam');
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });

    // Alex is up, and Alex has dropped. Without this the panel shows a turn
    // that never advances and nothing on screen says why.
    f.sendRoster({
      roomId: 'ABC123',
      lifecycle: 'playing',
      players: [
        { id: 'p1', name: 'Alex', isHost: true, connected: false },
        { id: 'p2', name: 'Sam', isHost: false, connected: true },
      ],
    });

    expect(screen.getByTestId('turn-toast')).toHaveTextContent(/disconnected/i);
    // Not just the toast: the seat itself carries the marker too, so the
    // strip does not silently hardcode everyone present.
    expect(document.querySelector('[data-seat="p1"] [data-presence="away"]')).not.toBeNull();
  });

  it('says nothing about disconnection while everyone is present', () => {
    const f = seated('Sam', false);
    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });

    expect(screen.getByTestId('turn-toast')).not.toHaveTextContent(/disconnected/i);
  });
});

describe('a stale identity, refused', () => {
  it('is cleared, so a later visit gets a clean join instead of repeating the same refusal', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p9', token: 'stale', name: 'Ghost' }),
    );
    const f = fakeConnection();
    renderRoom(f.connection);

    expect(f.joins).toEqual([{ roomId: 'ABC123', name: 'Ghost', playerId: 'p9', token: 'stale', protocolVersion: PROTOCOL_VERSION }]);

    f.sendRejected({ code: 'seatRefused', message: 'That seat in ABC123 is no longer yours' });

    expect(loadIdentity('ABC123')).toBeNull();
  });

  it('leaves a valid identity alone when the refusal is an ordinary in-lobby one', () => {
    // The same rejection event fires for "only the host may begin" once
    // we're already seated — that must not be mistaken for a refused rejoin
    // and clear a perfectly good identity out from under the player.
    const f = seated('Sam', false);
    f.sendRejected({ code: 'notYourTurn', message: 'only the host may begin the game' });

    expect(loadIdentity('ABC123')).toEqual({ playerId: 'p2', token: 'tok', name: 'Sam' });
  });
});

describe('a room that is gone', () => {
  it('reads as an ending, with a way back, rather than a join form', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p2', token: 'tok', name: 'Sam' }),
    );
    const f = fakeConnection();
    renderRoom(f.connection);

    f.sendRejected({ code: 'noSuchRoom', message: 'Room ABC123 is no longer available' });

    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lobby/i })).toBeInTheDocument();
    // Not a join form: there is nothing to join, and offering one invites a
    // player to keep trying a room the server will keep refusing.
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
  });

  it('offers a refused seat a retry instead, because that one is fixable', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p9', token: 'stale', name: 'Ghost' }),
    );
    const f = fakeConnection();
    renderRoom(f.connection);
    const before = f.joins.length;

    f.sendRejected({ code: 'seatRefused', message: 'That seat in ABC123 is no longer yours' });

    // The room is still there. The identity was stale and has been cleared,
    // so joining fresh is exactly the remedy — and it is offered as a retry
    // rather than a name form, because there is no name to correct.
    expect(screen.getByTestId('room-refused')).toBeInTheDocument();
    expect(screen.getByText(/no longer yours/i)).toBeInTheDocument();
    expect(screen.queryByText(/no longer available/i)).toBeNull();
    expect(screen.queryByLabelText(/your name/i)).toBeNull();

    // And the retry really re-joins — as a stranger, since the stale identity
    // was cleared, which is the only join that can now succeed.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(f.joins.slice(before)).toEqual([
      { roomId: 'ABC123', protocolVersion: PROTOCOL_VERSION },
    ]);
  });

  it('replaces a live board with the ending screen, not a dead one, when it disappears mid-game', () => {
    // The exact path a server restart takes: a mid-game player already holds
    // a session (the board is on screen) when the reconnect's stored-identity
    // join comes back `noSuchRoom`. Before this fix, `session !== null`
    // outranked `gone` in the phase ternary, so the board never left the
    // screen — it just went dead, `status` back to `'open'` and every click
    // dropped silently by the server.
    const f = arriveAs('Sam');
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });
    expect(screen.getByTestId('game-surface')).toBeInTheDocument();
    expect(loadIdentity('ABC123')).toEqual({ playerId: 'p2', token: 'tok', name: 'Sam' });

    f.sendRejected({ code: 'noSuchRoom', message: 'Room ABC123 is no longer available' });

    expect(screen.getByTestId('room-gone')).toBeInTheDocument();
    expect(screen.queryByTestId('game-surface')).toBeNull();
    expect(loadIdentity('ABC123')).toBeNull();
  });
});

/**
 * A client and a server that cannot talk.
 *
 * The mid-game case below is Phase 4's worst bug re-run deliberately. There,
 * `session !== null` outranked `gone` in the phase expression, so a mid-game
 * player kept a live-looking board whose every click the server dropped. The
 * same shape is available to `versionMismatch`, and the same remedy applies:
 * handle it terminally in the rejection handler and tear the session down,
 * rather than adding a branch to the ternary and hoping it wins.
 */
describe('a version the server does not speak', () => {
  it('offers a reload rather than a join form', () => {
    const f = fakeConnection();
    renderRoom(f.connection);

    f.sendRejected({ code: 'versionMismatch', message: 'This client speaks protocol 0' });

    expect(screen.getByTestId('stale-client')).toBeInTheDocument();
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
  });

  it('replaces a live board rather than leaving one that cannot act', () => {
    const f = arriveAs('Sam');
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });
    expect(screen.getByTestId('game-surface')).toBeInTheDocument();

    f.sendRejected({ code: 'versionMismatch', message: 'This client speaks protocol 0' });

    expect(screen.getByTestId('stale-client')).toBeInTheDocument();
    expect(screen.queryByTestId('game-surface')).toBeNull();
  });

  /**
   * The screen alone does not prove this.
   *
   * `stale` sits ahead of `playing` in the phase expression, so the right
   * screen appears whether or not the session is torn down — which means
   * removing the teardown leaves every assertion above still green. Found by
   * running exactly that break. The session is a live transport listener that
   * would otherwise outlive the screen, so it is asserted directly here rather
   * than inferred from what is rendered.
   */
  it('tears the session down, not just the screen', () => {
    const f = fakeConnection();
    let latest: ReturnType<typeof useRoom> | null = null;
    function Probe() {
      latest = useRoom('ABC123', () => f.connection);
      return null;
    }
    render(<Probe />);

    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });
    expect(latest!.session, 'no session to tear down — the test proves nothing').not.toBeNull();

    f.sendRejected({ code: 'versionMismatch', message: 'This client speaks protocol 0' });

    expect(latest!.session).toBeNull();
  });

  /**
   * The difference from `noSuchRoom`, and it matters: that one clears the
   * stored seat because nothing can use a token for a room that is not there.
   * Here the room is fine and the seat is still theirs — the *client* is the
   * problem. Clearing the identity would turn a reload, which fixes this, into
   * a lost seat, which nothing fixes.
   */
  it('keeps the stored seat, because a reload is meant to return to it', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p2', token: 'tok', name: 'Sam' }),
    );
    const f = fakeConnection();
    renderRoom(f.connection);

    f.sendRejected({ code: 'versionMismatch', message: 'This client speaks protocol 0' });

    expect(loadIdentity('ABC123')).toEqual({ playerId: 'p2', token: 'tok', name: 'Sam' });
  });
});

/**
 * A refresh, as closely as jsdom can hold one.
 *
 * **This is a remount, not a reload**, and the difference is worth stating
 * where it can be read next to the assertions rather than in a document
 * nobody opens. A real `F5` destroys the module-level socket `getConnection()`
 * holds, every listener on it, and all React state, then rebuilds from
 * whatever `localStorage` kept. What this reproduces: the component tree is
 * destroyed and rebuilt, the connection is a *new* object with no listeners
 * carried over, and `localStorage` is the only thing that survives — which is
 * what makes the second mount a rejoin rather than a first visit. What it
 * cannot reproduce: a real browser's page teardown, module re-evaluation, or
 * anything about socket.io's own reconnect. The prod by-hand pass covers
 * those; this covers the identity-and-resume path underneath them.
 *
 * `closeConnection()` is deliberately not called: it acts on the module
 * singleton, which `RoomPage`'s injected `connect` bypasses entirely. A fresh
 * fake is the honest stand-in.
 */
describe('a refresh mid-turn', () => {
  it('rejoins the same seat and comes back to the open segment, not the start of the turn', () => {
    localStorage.setItem('acquire.name', 'Sam');
    const first = fakeConnection();
    const { unmount } = renderRoom(first.connection);
    first.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const opening = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
      currentPlayerIndex: 1,
    });
    first.sendState({ state: opening, reason: 'commit', segmentStart: opening.nextStepId });
    expect(onBoard('A1')).toHaveAttribute('data-tile-state', 'hand');

    // Sam plays their tile. The segment is open and uncommitted: the server
    // holds a draft, and nothing has been broadcast.
    fireEvent.click(onBoard('A1'));
    expect(onBoard('A1')).toHaveAttribute('data-tile-state', 'filled');

    // The refresh.
    unmount();
    const second = fakeConnection();
    renderRoom(second.connection);

    // The stored identity is what makes this the same seat rather than a new
    // one — the token, not the name.
    expect(second.joins).toEqual([
      { roomId: 'ABC123', name: 'Sam', playerId: 'p2', token: 'tok', protocolVersion: PROTOCOL_VERSION },
    ]);

    second.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    // What the server sends a reconnecting actor: its own open draft, under
    // `resume`. Built here the way the server builds it — from the state
    // after the placement, with the draft's own segmentStart.
    const drafted = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: [] },
      ],
      loners: ['E5', 'A1'],
      bag: ['I11', 'I12'],
      currentPlayerIndex: 1,
      stage: 'buy',
    });
    second.sendState({
      state: drafted,
      reason: 'resume',
      segmentStart: opening.nextStepId,
      previousSegmentStart: 0,
    });

    // Back on the board, still played. A `commit` carrying the pre-placement
    // state — which is what a rejoin got before Phase 4 — would put A1 back
    // in the hand while the server still believed it was played.
    expect(screen.getByTestId('game-surface')).toBeInTheDocument();
    expect(onBoard('A1')).toHaveAttribute('data-tile-state', 'filled');
  });
});

/**
 * The dev-only seeded seat.
 *
 * `server/devSeed.ts` seats a golden game and hands back one URL per seat,
 * because there is no other way to put a browser into a mid-game room — which
 * is what the two-browser merger pass has been waiting on. This is the client
 * half: take the seat the URL names, then get the credentials out of the URL.
 */
describe('a seat handed over in the URL, in dev', () => {
  function renderSeeded(entry: string, connection: Connection) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/room/:roomId"
            element={
              <>
                <RoomPage connect={() => connection} />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('joins as the named seat instead of asking who you are', () => {
    const f = fakeConnection();
    renderSeeded('/room/DEVG2?devSeat=p2&devToken=tok-2&devName=Sam', f.connection);

    // The join must carry the seeded seat's own id and token. A join without
    // them is a stranger arriving at a room whose game has started, which the
    // server refuses — the failure this hook exists to prevent.
    expect(f.joins).toEqual([
      { roomId: 'DEVG2', name: 'Sam', playerId: 'p2', token: 'tok-2', protocolVersion: PROTOCOL_VERSION },
    ]);
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument();
  });

  it('stores the identity, so a refresh rejoins the same seat without the URL', () => {
    const f = fakeConnection();
    renderSeeded('/room/DEVG2?devSeat=p1&devToken=tok-1&devName=Alex', f.connection);

    expect(loadIdentity('DEVG2')).toEqual({ playerId: 'p1', token: 'tok-1', name: 'Alex' });
  });

  it('strips the credentials from the URL once they are stored', () => {
    const f = fakeConnection();
    renderSeeded('/room/DEVG2?devSeat=p1&devToken=tok-1&devName=Alex', f.connection);

    // Otherwise the back button walks into a URL carrying a token, and every
    // screenshot of a by-hand run has a live credential in the address bar.
    expect(screen.getByTestId('location-search')).toHaveTextContent('');
  });

  it('leaves an ordinary arrival completely alone', () => {
    const f = fakeConnection();
    renderSeeded('/room/ABC123', f.connection);

    // Nothing seeded: no identity written, and the join that goes out is a
    // plain first join carrying neither a playerId nor a token — which is
    // what distinguishes it from the seeded case above.
    expect(loadIdentity('ABC123')).toBeNull();
    expect(f.joins).toEqual([{ roomId: 'ABC123', protocolVersion: PROTOCOL_VERSION }]);
  });
});
