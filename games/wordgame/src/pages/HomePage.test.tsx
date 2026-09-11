import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { HomePage, type HomePageProps } from './HomePage';
import type { Connection } from '../net/connection';
import type { JoinedMessage, RejectedMessage } from '@game-host/lobby/protocol/protocol';
import type { NotifyStatus } from '../notify/useNotifyStatus';
import type { Mine } from '@game-host/notify/client/api';
import type { RoomSummary } from '../../session/protocol';

type KnownSummary = Extract<RoomSummary, { known: true }>;
type Player = KnownSummary['players'][number];

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
const loadIdentityMock = vi.fn();
vi.mock('../net/identity', () => ({
  listRooms: (...args: unknown[]) => listRoomsMock(...args),
  loadIdentity: (...args: unknown[]) => loadIdentityMock(...args),
  clearIdentity: (...args: unknown[]) => clearIdentityMock(...args),
  rememberedName: (...args: unknown[]) => rememberedNameMock(...args),
  saveIdentity: (...args: unknown[]) => saveIdentityMock(...args),
}));
// The restore call needs a device key; a fixed one keeps localStorage out of it.
vi.mock('../notify/playerKey', () => ({ getPlayerKey: () => 'k'.repeat(24) }));

const acceptInviteMock = vi.fn();
vi.mock('@game-host/notify/client/landing', async (importActual) => ({
  ...(await importActual<typeof import('@game-host/notify/client/landing')>()),
  acceptInvite: (...a: unknown[]) => acceptInviteMock(...a),
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
  loadIdentityMock.mockReset().mockImplementation((roomId: string) =>
    ({ playerId: `p-${roomId}`, token: `t-${roomId}`, name: 'You' }));
  acceptInviteMock.mockReset();
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
    players: [{ name: 'You', score: null, isHost: true, isYou: true, isCurrent: false, isWinner: false }],
    yourTurn: false,
    currentPlayerName: null,
    lastMove: null,
    winnerNames: null,
    nudge: null,
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
      { name: 'You', score: 10, isHost: true, isYou: true, isCurrent: opts.yourTurn, isWinner: false },
      { name: 'Rival', score: 20, isHost: false, isYou: false, isCurrent: !opts.yourTurn, isWinner: false },
    ],
    yourTurn: opts.yourTurn,
    currentPlayerName: opts.yourTurn ? 'You' : 'Rival',
  });
}

/** Wires `listRooms()` and the `/api/summaries` fetch together from a set of
 * already-known summaries — the ordinary case where the server still
 * recognizes every room this device remembers. `mine` is what /notify/me
 * answers; null is the standalone dev server, which has no such route. */
function mockRooms(summaries: KnownSummary[], mine: Mine | null = null) {
  listRoomsMock.mockReturnValue(
    summaries.map((s) => ({
      roomId: s.roomId,
      identity: { playerId: `p-${s.roomId}`, token: `t-${s.roomId}`, name: 'You' },
    })),
  );
  fetchMock.mockImplementation((input: string) =>
    Promise.resolve(input === '/notify/me'
      ? ({ ok: mine !== null, json: async () => mine ?? {} } as Response)
      : input === '/notify/nudge'
        ? ({ ok: true, json: async () => ({ ok: true }) } as Response)
        : ({ ok: true, json: async () => ({ summaries }) } as Response)));
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

    fireEvent.click(await screen.findByTestId('open-KTWQ'));

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

describe('HomePage — card chips', () => {
  const player = (name: string, score: number, flags: Partial<Player> = {}): Player =>
    ({ name, score, isHost: false, isYou: false, isCurrent: false, isWinner: false, ...flags });
  const threeUp = (overrides: Partial<KnownSummary>, flags: { current?: string; winners?: string[] } = {}) =>
    knownSummary({
      roomId: 'KTWQ',
      lifecycle: 'playing',
      players: [
        player('Bob', 5, { isHost: true, isCurrent: flags.current === 'bob', isWinner: flags.winners?.includes('bob') ?? false }),
        player('Alice', 10, { isYou: true, isCurrent: flags.current === 'alice', isWinner: flags.winners?.includes('alice') ?? false }),
        player('Zed', 0, { isCurrent: flags.current === 'zed', isWinner: flags.winners?.includes('zed') ?? false }),
      ],
      ...overrides,
    });

  it('their move: the current player leads, shaded; then You; then the rest', async () => {
    mockRooms([threeUp({ yourTurn: false, currentPlayerName: 'Zed' }, { current: 'zed' })]);
    renderHome();
    const card = await screen.findByTestId('game-KTWQ');
    const chips = within(card).getAllByTestId('score-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Zed · 0', 'You · 10', 'Bob · 5']);
    expect(chips.map((c) => c.dataset.tone)).toEqual(['shaded', 'plain', 'plain']);
    expect(card).toHaveTextContent('Zed’s turn');
    expect(card).not.toHaveTextContent('vs ');
  });

  it('featured chips follow the flags, not the name — two Sams, one current', async () => {
    mockRooms([knownSummary({
      roomId: 'KTWQ',
      lifecycle: 'playing',
      players: [
        player('Sam', 5, { isCurrent: true }),
        player('Alice', 10, { isYou: true }),
        player('Sam', 7),
      ],
      currentPlayerName: 'Sam',
    })]);
    renderHome();
    const chips = within(await screen.findByTestId('game-KTWQ')).getAllByTestId('score-chip');
    expect(chips.map((c) => [c.textContent, c.dataset.tone])).toEqual([
      ['Sam · 5', 'shaded'], ['You · 10', 'plain'], ['Sam · 7', 'plain'],
    ]);
  });

  it('your move: You lead in accent, the rest in seating order', async () => {
    mockRooms([threeUp({ yourTurn: true, currentPlayerName: 'Alice' }, { current: 'alice' })]);
    renderHome();
    const card = await screen.findByTestId('game-KTWQ');
    const chips = within(card).getAllByTestId('score-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['You · 10', 'Bob · 5', 'Zed · 0']);
    expect(chips[0]!.dataset.tone).toBe('accent');
    expect(card).not.toHaveTextContent('YOUR TURN');
  });

  it('finished: the winner leads, shaded, with a WON badge', async () => {
    mockRooms([threeUp({ lifecycle: 'over', currentPlayerName: null, winnerNames: ['Bob'] }, { winners: ['bob'] })]);
    renderHome();
    const card = await screen.findByTestId('game-KTWQ');
    const chips = within(card).getAllByTestId('score-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Bob · 5', 'You · 10', 'Zed · 0']);
    expect(chips[0]!.dataset.tone).toBe('shaded');
    expect(card).toHaveTextContent('BOB WON');
  });

  it('finished: a win of your own says so', async () => {
    mockRooms([threeUp({ lifecycle: 'over', currentPlayerName: null, winnerNames: ['Alice'] }, { winners: ['alice'] })]);
    renderHome();
    expect(await screen.findByTestId('game-KTWQ')).toHaveTextContent('YOU WON');
  });
});

describe('HomePage — nudging the player whose move it is', () => {
  it('Nudge posts the seat to /notify/nudge, flips to Reminded, and does not open the room', async () => {
    mockRooms([{ ...playingRoom('MOSS', { yourTurn: false }), nudge: 'ready' }]);
    renderHome();
    const card = await screen.findByTestId('game-MOSS');
    fireEvent.click(within(card).getByRole('button', { name: 'Nudge' }));

    expect(await within(card).findByTestId('nudge-done')).toHaveTextContent('Reminded ✓');
    expect(fetchMock).toHaveBeenCalledWith('/notify/nudge', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ game: 'wordgame', roomId: 'MOSS', playerId: 'p-MOSS', token: 't-MOSS' }),
    }));
    expect(screen.queryByText('room:MOSS')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Nudge' })).not.toBeInTheDocument();
  });

  it('a refusal other than already-reminded leaves the button standing', async () => {
    mockRooms([{ ...playingRoom('MOSS', { yourTurn: false }), nudge: 'ready' }]);
    fetchMock.mockImplementation((input: string) =>
      Promise.resolve(input === '/notify/nudge'
        ? ({ ok: false, status: 409, json: async () => ({ ok: false, reason: 'unreachable' }) } as Response)
        : input === '/notify/me'
          ? ({ ok: false, json: async () => ({}) } as Response)
          : ({ ok: true, json: async () => ({ summaries: [{ ...playingRoom('MOSS', { yourTurn: false }), nudge: 'ready' }] }) } as Response)));
    renderHome();
    const card = await screen.findByTestId('game-MOSS');
    fireEvent.click(within(card).getByRole('button', { name: 'Nudge' }));
    await waitFor(() => { expect(within(card).getByRole('button', { name: 'Nudge' })).not.toBeDisabled(); });
    expect(within(card).queryByTestId('nudge-done')).not.toBeInTheDocument();
  });

  it('the Nudge is a sibling of the open button, never inside it', async () => {
    // A button inside a button is invalid HTML, and a button inside
    // role="button" is flattened by assistive tech; both were shipped and
    // reviewed out on 2026-09-10. The open button is native, so Enter and
    // Space need no handler of ours.
    mockRooms([{ ...playingRoom('MOSS', { yourTurn: false }), nudge: 'ready' }]);
    renderHome();
    const card = await screen.findByTestId('game-MOSS');
    const openButton = within(card).getByTestId('open-MOSS');
    const nudge = within(card).getByRole('button', { name: 'Nudge' });
    expect(openButton.contains(nudge)).toBe(false);
    expect(card.querySelector('[role="button"]')).toBeNull();
    fireEvent.click(openButton);
    expect(await screen.findByText('room:MOSS')).toBeInTheDocument();
  });

  it('a turn already reminded shows Reminded ✓ and no button; unreachable and waiting show neither', async () => {
    mockRooms([
      { ...playingRoom('MOSS', { yourTurn: false }), nudge: 'reminded' },
      { ...playingRoom('FERN', { yourTurn: false }), nudge: 'unreachable' },
      { ...playingRoom('OAKS', { yourTurn: false }), nudge: null },
      { ...playingRoom('PINE', { yourTurn: false }), nudge: 'waiting' },
    ]);
    renderHome();
    const moss = await screen.findByTestId('game-MOSS');
    expect(within(moss).getByTestId('nudge-done')).toBeInTheDocument();
    expect(within(moss).queryByRole('button', { name: 'Nudge' })).not.toBeInTheDocument();
    for (const id of ['game-FERN', 'game-OAKS', 'game-PINE']) {
      const card = screen.getByTestId(id);
      expect(within(card).queryByTestId('nudge-done')).not.toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Nudge' })).not.toBeInTheDocument();
    }
  });

  it('your own reminded turn wears the REMINDED badge', async () => {
    mockRooms([
      { ...playingRoom('KTWQ', { yourTurn: true }), nudge: 'reminded' },
      { ...playingRoom('LARK', { yourTurn: true }), nudge: 'ready' },
    ]);
    renderHome();
    expect(within(await screen.findByTestId('game-KTWQ')).getByTestId('reminded-badge')).toHaveTextContent('REMINDED');
    expect(within(screen.getByTestId('game-LARK')).queryByTestId('reminded-badge')).not.toBeInTheDocument();
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
      revokeSeat: () => {},
      viewRoom: () => {},
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

describe('HomePage — sign-in and invites', () => {
  it('offers sign-in when the service knows this device holds no address', async () => {
    mockRooms([], { address: null, seats: [], invites: [] });
    notifyStatusValue = 'off';
    renderHome();
    expect(await screen.findByText(/Sign in with your email/)).toBeInTheDocument();
    // The plain nudge yields to the sign-in card.
    expect(screen.queryByText(/get a nudge when it’s yours/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('dialog', { name: 'Notification settings' })).toBeInTheDocument();
  });

  it('shows no sign-in card when there is no service to sign in to', async () => {
    mockRooms([], null);
    renderHome();
    await screen.findByText('New room');
    expect(screen.queryByText(/Sign in with your email/)).not.toBeInTheDocument();
  });

  it('says who is signed in', async () => {
    mockRooms([], { address: 'pete@example.com', seats: [], invites: [] });
    renderHome();
    expect(await screen.findByText('Signed in as pete@example.com')).toBeInTheDocument();
  });

  it('lists invites as cards; claiming one writes the seat and opens the room', async () => {
    mockRooms([], {
      address: 'pete@example.com', seats: [],
      invites: [{ game: 'wordgame', roomId: 'INV111', playerId: 'p3', inviterName: 'Alice', gameTitle: 'Word Game' }],
    });
    acceptInviteMock.mockResolvedValue({ playerId: 'p3', token: 't3', name: 'Pete', inviterName: 'Alice' });
    renderHome();
    expect(await screen.findByText(/Alice saved you a seat/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    await screen.findByText('room:INV111');
    expect(acceptInviteMock).toHaveBeenCalledWith('wordgame', 'INV111');
    expect(saveIdentityMock).toHaveBeenCalledWith('INV111', { playerId: 'p3', token: 't3', name: 'Pete' });
  });

  it('a refused claim re-runs restore instead of showing an error', async () => {
    mockRooms([], {
      address: 'pete@example.com', seats: [],
      invites: [{ game: 'wordgame', roomId: 'INV111', playerId: 'p3', inviterName: null, gameTitle: 'Word Game' }],
    });
    acceptInviteMock.mockResolvedValue(null);
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter((c) => c[0] === '/notify/me').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
