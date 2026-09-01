import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { HomePage, type HomePageProps } from './HomePage';
import type { Connection } from '../net/connection';
import type { JoinedMessage, RejectedMessage } from '@game-host/lobby/protocol/protocol';
import type { NotifyStatus } from '../notify/useNotifyStatus';
import type { RoomSummary } from '../../session/protocol';

type KnownSummary = Extract<RoomSummary, { known: true }>;

// Real useNotifyStatus does a network + localStorage round trip; every
// HomePage render would otherwise kick one off. Mirrors GameScreen.test.tsx.
let notifyStatusValue: NotifyStatus = 'unavailable';
let emailAddressValue: string | null = null;
const refreshNotify = vi.fn();
vi.mock('../notify/useNotifyStatus', () => ({
  useNotifyStatus: () => ({ status: notifyStatusValue, emailAddress: emailAddressValue, refresh: refreshNotify }),
}));

// The identity store: what rooms this device holds a seat in, and the
// remembered display name. Mocked so tests control both without touching
// real localStorage.
const listRoomsMock = vi.fn();
const clearIdentityMock = vi.fn();
const rememberedNameMock = vi.fn();
const saveIdentityMock = vi.fn();
vi.mock('../net/identity', () => ({
  listRooms: (...args: unknown[]) => listRoomsMock(...args),
  clearIdentity: (...args: unknown[]) => clearIdentityMock(...args),
  rememberedName: (...args: unknown[]) => rememberedNameMock(...args),
  saveIdentity: (...args: unknown[]) => saveIdentityMock(...args),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  notifyStatusValue = 'unavailable';
  emailAddressValue = null;
  refreshNotify.mockClear();
  listRoomsMock.mockReset().mockReturnValue([]);
  clearIdentityMock.mockReset();
  rememberedNameMock.mockReset().mockReturnValue(null);
  saveIdentityMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function knownSummary(overrides: Partial<KnownSummary> & { roomId: string }): KnownSummary {
  return {
    known: true,
    lifecycle: 'lobby',
    capacity: 4,
    players: [{ name: 'You', score: null, isHost: true, isYou: true }],
    yourTurn: false,
    currentPlayerName: null,
    lastMove: null,
    winnerNames: null,
    ...overrides,
  };
}

function lobbyRoom(roomId: string): KnownSummary {
  return knownSummary({ roomId });
}

function playingRoom(roomId: string, opts: { yourTurn: boolean }): KnownSummary {
  return knownSummary({
    roomId,
    lifecycle: 'playing',
    capacity: 2,
    players: [
      { name: 'You', score: 10, isHost: true, isYou: true },
      { name: 'Rival', score: 20, isHost: false, isYou: false },
    ],
    yourTurn: opts.yourTurn,
    currentPlayerName: opts.yourTurn ? 'You' : 'Rival',
  });
}

/** Wires `listRooms()` and the `/api/summaries` fetch together from a set of
 * already-known summaries — the ordinary case where the server still
 * recognizes every room this device remembers. */
function mockRooms(summaries: KnownSummary[]) {
  listRoomsMock.mockReturnValue(
    summaries.map((s) => ({
      roomId: s.roomId,
      identity: { playerId: `p-${s.roomId}`, token: `t-${s.roomId}`, name: 'You' },
    })),
  );
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ summaries }) } as Response);
}

function RoomMarker() {
  const { roomId } = useParams();
  return <div>room:{roomId}</div>;
}

function renderHome(props: HomePageProps = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage {...props} />} />
        <Route path="/room/:roomId" element={<RoomMarker />} />
        <Route path="/online/join" element={<div>join page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('HomePage — grouping and navigation', () => {
  it('fetches summaries under the game base path, slash supplied', async () => {
    // Regression: in a build BASE_URL arrives verbatim from the config —
    // '/wordgame', NO trailing slash — and naive concatenation shipped a
    // fetch of '/wordgameapi/summaries' that 404ed on every deployment,
    // emptying the entry list (2026-08-31). The build's real value is now
    // stubbed suite-wide in src/test/setup.ts; this test pins the join.
    mockRooms([playingRoom('KTWQ', { yourTurn: true })]);
    renderHome();
    await screen.findByTestId('game-KTWQ');
    expect(fetchMock).toHaveBeenCalledWith('/wordgame/api/summaries', expect.anything());
  });

  it('groups games by whose move it is', async () => {
    mockRooms([
      lobbyRoom('LARK'),
      playingRoom('KTWQ', { yourTurn: true }),
      playingRoom('MOSS', { yourTurn: false }),
    ]);
    renderHome();

    expect(await screen.findByText('WAITING FOR PLAYERS')).toBeInTheDocument();
    expect(screen.getByText(/YOUR MOVE \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('THEIR MOVE')).toBeInTheDocument();
  });

  it('navigates into a room on tap', async () => {
    mockRooms([playingRoom('KTWQ', { yourTurn: true })]);
    renderHome();

    fireEvent.click(await screen.findByTestId('game-KTWQ'));

    expect(await screen.findByText('room:KTWQ')).toBeInTheDocument();
  });
});

describe('HomePage — the notification nudge', () => {
  it('nudges when notifications are off, and hides the banner when on', async () => {
    mockRooms([]);
    notifyStatusValue = 'off';
    const { unmount } = renderHome();

    expect(await screen.findByText(/get a nudge when it’s yours/)).toBeInTheDocument();
    unmount();

    notifyStatusValue = 'on';
    renderHome();

    await screen.findByText('New room'); // the frame rendered
    expect(screen.queryByText(/get a nudge when it’s yours/)).not.toBeInTheDocument();
  });
});

describe('HomePage — card player lists', () => {
  it('lists everyone You-first in turn order, no emojis, no "vs"', async () => {
    mockRooms([knownSummary({
      roomId: 'KTWQ',
      lifecycle: 'playing',
      players: [
        { name: 'Bob', score: 5, isHost: true, isYou: false },
        { name: 'Alice', score: 10, isHost: false, isYou: true },
        { name: 'Zed', score: 0, isHost: false, isYou: false },
      ],
      yourTurn: false,
      currentPlayerName: 'Bob',
    })]);
    renderHome();
    const card = await screen.findByTestId('game-KTWQ');
    expect(card).toHaveTextContent('You, Zed, Bob');
    expect(card).not.toHaveTextContent('vs ');
  });
});

describe('HomePage — the pending-email banner', () => {
  it('shows the amber confirm banner with the address masked', async () => {
    mockRooms([]);
    notifyStatusValue = 'pending';
    emailAddressValue = 'pete@example.com';
    renderHome();
    expect(await screen.findByText(/Confirm your email/)).toBeInTheDocument();
    expect(screen.getByText(/p•••@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });

  it('masks a missing address as "your email" without crashing', async () => {
    mockRooms([]);
    notifyStatusValue = 'pending';
    emailAddressValue = null;
    renderHome();
    expect(await screen.findByText(/we sent a link to your email/)).toBeInTheDocument();
  });
});

describe('HomePage — stale identities', () => {
  it('drops identities for rooms the server no longer knows', async () => {
    listRoomsMock.mockReturnValue([
      { roomId: 'GONE', identity: { playerId: 'p1', token: 't1', name: 'You' } },
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ summaries: [{ roomId: 'GONE', known: false }] }),
    } as Response);
    renderHome();

    await waitFor(() => { expect(clearIdentityMock).toHaveBeenCalledWith('GONE'); });
  });
});

// Ported from the deleted OnlineLobbyPage.tsx, which had no test file of its
// own in this game (only Acquire's did) — this is the one case worth
// carrying forward: `createRoom` is fire-and-forget, so a server that never
// answers must not leave "New room" stuck disabled forever.
describe('HomePage — creating a room', () => {
  function fakeConnection() {
    let joined: ((m: JoinedMessage) => void) | null = null;
    const rejectedHandlers = new Set<(m: RejectedMessage) => void>();
    const created: (string | undefined)[] = [];

    const connection: Connection = {
      socket: {} as unknown as Socket,
      transport: {
        sendMove: () => {},
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
    };
  }

  it('recovers from silence instead of hanging on "Creating…" forever', async () => {
    vi.useFakeTimers();
    mockRooms([]);
    const f = fakeConnection();
    renderHome({ connect: () => f.connection });

    fireEvent.click(screen.getByRole('button', { name: /new room/i }));
    expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();

    // No `joined`, no `rejected` — the server simply never answers.
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });

    const button = screen.getByRole('button', { name: /new room/i });
    expect(button).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/no answer/i);

    // And it is a recovery, not a dead end: clicking again asks again.
    fireEvent.click(button);
    expect(f.created).toHaveLength(2);
  });

  it('joining seats you and takes you to the room', async () => {
    mockRooms([]);
    const f = fakeConnection();
    renderHome({ connect: () => f.connection });

    fireEvent.click(screen.getByRole('button', { name: /new room/i }));
    f.sendJoined({ roomId: 'ABC123', playerId: 'p1', token: 'tok' });

    expect(await screen.findByText('room:ABC123')).toBeInTheDocument();
    expect(saveIdentityMock).toHaveBeenCalledWith('ABC123', { playerId: 'p1', token: 'tok', name: '' });
  });
});
