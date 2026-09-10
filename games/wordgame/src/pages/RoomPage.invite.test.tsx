// The invite flow on the real lobby screens: the per-seat Invite entry, the
// reserved row with Remind and a two-tap Revoke, the picker sheet, the
// just-claimed flourish, and the landing — including the race the page was
// restructured for: no join may be sent while a claim is still in flight.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { RoomPage } from './RoomPage';
import type { Connection, ConnectionStatus } from '../net/connection';
import type { StateMessage, WireMove } from '../../session/protocol';
import type {
  JoinedMessage,
  JoinRoomMessage,
  RejectedMessage,
  RosterMessage,
} from '@game-host/lobby/protocol/protocol';

// The claim screen's push card: jsdom is neither iOS nor push-capable, so
// the real hook hides it. One test below forces the iOS-in-Safari state to
// read the install nudge (spec 2026-09-09 §The Safari nudge on iOS).
let enrollState: 'hidden' | 'needsInstall' = 'hidden';
vi.mock('@game-host/notify/client/useEnrollPush', () => ({
  useEnrollPush: () => ({ state: enrollState, enroll: () => {}, decline: () => {} }),
}));

function fakeConnection() {
  const joinedHandlers = new Set<(m: JoinedMessage) => void>();
  const rosterHandlers = new Set<(m: RosterMessage) => void>();
  const stateHandlers = new Set<(m: StateMessage) => void>();
  const rejectedHandlers = new Set<(m: RejectedMessage) => void>();
  const statusListeners = new Set<() => void>();
  const joins: Omit<JoinRoomMessage, 'protocolVersion'>[] = [];
  const revokes: string[] = [];
  const status: ConnectionStatus = 'open';

  const connection: Connection = {
    socket: {} as unknown as Socket,
    transport: {
      sendMove: (_m: WireMove) => {},
      onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
      onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
      isOpen: () => status === 'open',
    },
    status: () => status,
    subscribe: (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; },
    createRoom: () => {},
    joinRoom: (m) => { joins.push(m); },
    beginGame: () => {},
    renamePlayer: () => {},
    leaveSeat: () => {},
    revokeSeat: (playerId) => { revokes.push(playerId); },
    viewRoom: () => {},
    onJoined: (h) => { joinedHandlers.add(h); return () => { joinedHandlers.delete(h); }; },
    onRoster: (h) => { rosterHandlers.add(h); return () => { rosterHandlers.delete(h); }; },
    onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
    close: () => {},
  };

  return {
    connection,
    joins,
    revokes,
    sendJoined: (m: JoinedMessage) => act(() => { for (const h of [...joinedHandlers]) h(m); }),
    sendRoster: (m: RosterMessage) => act(() => { for (const h of [...rosterHandlers]) h(m); }),
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

/** A roster with one reserved seat between the occupied and the empties. */
const rosterWithReserved = (): RosterMessage => ({
  roomId: 'ABC123',
  lifecycle: 'lobby',
  players: [
    { id: 'p1', name: 'Pete', isHost: true, connected: true },
    { id: 'p2', name: 'Maya', isHost: false, connected: true },
  ],
  pending: [{ id: 'p3', name: 'Sam' }],
});

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers every notify endpoint the page touches; tests override per-path. */
function stubNotify(overrides: Record<string, () => Promise<Response>> = {}): void {
  fetchMock.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const path = url.replace(/^[^/]*\/\/[^/]+/, '');
    const override = Object.entries(overrides).find(([p]) => path.endsWith(p));
    if (override) return override[1]();
    if (path.endsWith('/notify/bind')) return Promise.resolve(jsonResponse(200, { ok: true }));
    if (path.endsWith('/notify/settings')) return Promise.resolve(jsonResponse(404, {}));
    if (path.endsWith('/notify/contacts')) return Promise.resolve(jsonResponse(200, { contacts: [] }));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  stubNotify();
  window.history.replaceState(null, '', '/room/ABC123');
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  localStorage.clear();
});

function seatAsHost(fake: ReturnType<typeof fakeConnection>, roster = rosterWithReserved()) {
  fake.sendJoined({ roomId: 'ABC123', playerId: 'p1', token: 'tok' });
  fake.sendRoster(roster);
}

describe('the reserved seat row', () => {
  it('shows the name, no presence dot, Remind, and a two-tap Revoke for the host', async () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAsHost(fake);

    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText(/invited, not here yet/)).toBeInTheDocument();
    expect(screen.getByText('2 of 6 here · 1 seat reserved')).toBeInTheDocument();

    // Revoke asks twice: the first tap arms, the second fires.
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(fake.revokes).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Sure?' }));
    expect(fake.revokes).toEqual(['p3']);

    // Remind resends by seat, and the row says it went.
    stubNotify({
      '/notify/invite/remind': () =>
        Promise.resolve(jsonResponse(200, { ok: true, playerId: 'p3', resend: true })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remind' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Sent' })).toBeDisabled(); });
    const remindCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/notify/invite/remind'),
    );
    expect(JSON.parse(String((remindCall![1] as RequestInit).body))).toMatchObject({
      game: 'wordgame',
      roomId: 'ABC123',
      playerId: 'p1',
      token: 'tok',
      targetPlayerId: 'p3',
    });
  });

  it('offers a guest neither Remind, Revoke, nor Invite', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    fake.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok2' });
    fake.sendRoster(rosterWithReserved());

    expect(screen.queryByRole('button', { name: 'Remind' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
  });

  it('rings the seat for a moment when its reservation converts to a person', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAsHost(fake);

    fake.sendRoster({
      roomId: 'ABC123',
      lifecycle: 'lobby',
      players: [
        { id: 'p1', name: 'Pete', isHost: true, connected: true },
        { id: 'p2', name: 'Maya', isHost: false, connected: true },
        { id: 'p3', name: 'Sam', isHost: false, connected: true },
      ],
      pending: [],
    });
    expect(screen.getByText('just joined')).toBeInTheDocument();
  });
});

describe('the invite picker', () => {
  it('opens from an empty seat, lists contacts with their states, and invites', async () => {
    stubNotify({
      '/notify/contacts': () =>
        Promise.resolve(jsonResponse(200, {
          contacts: [
            { contactId: 'c-kit', name: 'Kit', lastPlayedAt: Date.now(), gameTitle: 'Word Game', reachable: true },
            { contactId: 'c-sam', name: 'Sam', lastPlayedAt: Date.now(), gameTitle: 'Word Game', reachable: false },
            { contactId: 'c-lee', name: 'Lee', lastPlayedAt: Date.now(), gameTitle: 'Word Game', reachable: true, alreadySeated: true },
          ],
        })),
      '/notify/invite': () =>
        Promise.resolve(jsonResponse(200, { ok: true, playerId: 'p4', resend: false })),
    });
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAsHost(fake);

    fireEvent.click(screen.getAllByRole('button', { name: 'Invite' })[0]!);
    expect(screen.getByRole('dialog', { name: 'Invite to room ABC123' })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByText('Kit')).toBeInTheDocument(); });

    // Unreachable stays visible with an actionable reason; seated is dim.
    expect(screen.getByText('Sam hasn’t turned on notifications')).toBeInTheDocument();
    expect(screen.getByText('Already in this room')).toBeInTheDocument();
    // Exactly one row is pickable.
    const inviteButtons = screen.getAllByRole('button', { name: 'Invite' })
      .filter((b) => b.closest('[role="dialog"]') !== null);
    expect(inviteButtons).toHaveLength(1);

    fireEvent.click(inviteButtons[0]!);
    await waitFor(() => { expect(screen.getByText('✓ Invited')).toBeInTheDocument(); });
    const inviteCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/notify/invite'),
    );
    expect(JSON.parse(String((inviteCall![1] as RequestInit).body))).toMatchObject({
      game: 'wordgame',
      roomId: 'ABC123',
      contactId: 'c-kit',
    });
  });

  it('sends an email invite from the second tab, refusals spelled out', async () => {
    stubNotify({
      '/notify/invite': () =>
        Promise.resolve(jsonResponse(503, { ok: false, reason: 'emailUnavailable' })),
    });
    const fake = fakeConnection();
    renderRoom(fake.connection);
    seatAsHost(fake);

    fireEvent.click(screen.getAllByRole('button', { name: 'Invite' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'By email' }));
    fireEvent.change(screen.getByLabelText('Email address to invite'), {
      target: { value: 'friend@example.com' },
    });
    fireEvent.submit(screen.getByLabelText('Email address to invite').closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Email isn’t set up on this server.')).toBeInTheDocument();
    });
  });
});

describe('landing on a link', () => {
  it('never joins while the claim is in flight, then joins the claimed seat', async () => {
    // An artificially slow redemption: the page must hold the join, or the
    // invitee is seated twice — once fresh, once claimed.
    let resolveClaim: (r: Response) => void = () => {};
    stubNotify({
      '/notify/invite/claim': () =>
        new Promise<Response>((resolve) => { resolveClaim = resolve; }),
    });
    window.history.replaceState(null, '', '/room/ABC123?invite=tok-abc');
    const fake = fakeConnection();
    renderRoom(fake.connection);

    expect(screen.getByText('Checking your invite…')).toBeInTheDocument();
    expect(fake.joins).toEqual([]); // the race, held

    act(() => {
      resolveClaim(jsonResponse(200, {
        playerId: 'p3', token: 'minted', name: 'Sam', inviterName: 'Pete',
      }));
    });
    await waitFor(() => { expect(screen.getByText(/You’re in, Sam/)).toBeInTheDocument(); });
    expect(screen.getByText(/Pete saved you a seat in room/)).toBeInTheDocument();
    // The credential left the address bar.
    expect(window.location.search).not.toContain('invite');

    fireEvent.click(screen.getByRole('button', { name: 'Go to the room' }));
    await waitFor(() => { expect(fake.joins).toHaveLength(1); });
    expect(fake.joins[0]).toMatchObject({ roomId: 'ABC123', playerId: 'p3', token: 'minted' });
  });

  it('one refusal screen: a fresh link by email, or the chooser — never a silent join', async () => {
    stubNotify({
      '/notify/invite/claim': () => Promise.resolve(jsonResponse(404, { error: 'unavailable' })),
      '/notify/invite/refresh': () => Promise.resolve(jsonResponse(200, { ok: true })),
    });
    window.history.replaceState(null, '', '/room/ABC123?invite=tok-dead');
    const fake = fakeConnection();
    renderRoom(fake.connection);

    await waitFor(() => { expect(screen.getByText('That link didn’t work')).toBeInTheDocument(); });
    expect(fake.joins).toEqual([]);

    // "Email me a new link" refreshes by the dead token the visitor already
    // holds — the server decides invite-vs-signin behind the vague state.
    fireEvent.click(screen.getByRole('button', { name: 'Email me a new link' }));
    await waitFor(() => { expect(screen.getByText('Check your inbox')).toBeInTheDocument(); });
    const refresh = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/notify/invite/refresh'),
    );
    expect(JSON.parse(String((refresh![1] as RequestInit).body))).toEqual({
      inviteToken: 'tok-dead',
    });

    // "Continue to the room" lands on the pre-join chooser — still no join.
    fireEvent.click(screen.getByRole('button', { name: 'Continue to the room' }));
    fake.sendRoster(rosterWithReserved());
    expect(screen.getByText('Pick your seat to join')).toBeInTheDocument();
    expect(fake.joins).toEqual([]);

    // Joining is the explicit act now.
    fireEvent.click(screen.getByRole('button', { name: 'Sit here' }));
    expect(fake.joins).toHaveLength(1);

    // And the seat you just took wants a name: the rename field is focused
    // with its default selected, so the first thing typed replaces it.
    fake.sendJoined({ roomId: 'ABC123', playerId: 'p4', token: 'tok4' });
    fake.sendRoster({
      ...rosterWithReserved(),
      players: [
        ...rosterWithReserved().players,
        { id: 'p4', name: 'Player 4', isHost: false, connected: true },
      ],
    });
    expect(screen.getByLabelText('Your name')).toHaveFocus();
  });

  it('the chooser claims a seat by email — occupied and reserved rows alike', async () => {
    stubNotify({
      '/notify/seat-signin': () => Promise.resolve(jsonResponse(200, { ok: true })),
    });
    const fake = fakeConnection();
    renderRoom(fake.connection);
    fake.sendRoster(rosterWithReserved());

    // A visitor with no identity: the chooser, not a seat.
    expect(screen.getByText('Pick your seat to join')).toBeInTheDocument();
    expect(fake.joins).toEqual([]);

    // "That's me" on the reserved row resends the invite to its original
    // target — the invitee who lost the email, or a second device.
    fireEvent.click(screen.getAllByRole('button', { name: 'That’s me' })[2]!);
    expect(screen.getByRole('dialog', { name: 'Resend Sam’s invite' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resend the invite' }));
    await waitFor(() => { expect(screen.getByText('Check your inbox')).toBeInTheDocument(); });
    const signin = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/notify/seat-signin'),
    );
    expect(JSON.parse(String((signin![1] as RequestInit).body))).toEqual({
      game: 'wordgame',
      roomId: 'ABC123',
      playerId: 'p3',
    });
  });

  it('mid-game the chooser offers only That’s me — no seats to sit in', () => {
    const fake = fakeConnection();
    renderRoom(fake.connection);
    fake.sendRoster({ ...rosterWithReserved(), lifecycle: 'playing', pending: [] });

    expect(screen.getByText('This game is in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sit here' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'That’s me' })).toHaveLength(2);
  });

  it('a key redemption passes through silently to the room', async () => {
    stubNotify({
      '/notify/redeem-key': () =>
        Promise.resolve(jsonResponse(200, { playerId: 'p2', token: 'minted-2', name: 'Maya' })),
    });
    window.history.replaceState(null, '', '/room/ABC123?key=seat-key-x');
    const fake = fakeConnection();
    renderRoom(fake.connection);

    // No ceremony: straight to the ordinary join with the redeemed seat.
    await waitFor(() => { expect(fake.joins).toHaveLength(1); });
    expect(fake.joins[0]).toMatchObject({ playerId: 'p2', token: 'minted-2' });
  });
});

describe('the claim screen on an iPhone in Safari', () => {
  afterEach(() => { enrollState = 'hidden'; });

  it('says to add to the Home Screen, then sign in from the app with the same email', async () => {
    enrollState = 'needsInstall';
    stubNotify({
      '/notify/invite/claim': () =>
        Promise.resolve(jsonResponse(200, { playerId: 'p3', token: 'minted', name: 'Sam', inviterName: 'Pete' })),
    });
    window.history.replaceState(null, '', '/room/ABC123?invite=tok-abc');
    const fake = fakeConnection();
    renderRoom(fake.connection);
    await waitFor(() => { expect(screen.getByText(/You’re in, Sam/)).toBeInTheDocument(); });
    expect(screen.getByText(/then open it and sign in with the same email/)).toBeInTheDocument();
  });
});
