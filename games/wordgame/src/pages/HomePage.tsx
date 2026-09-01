// The Entry screen: your games, grouped by whose move it is. Replaces the
// old two-door landing page — the doors are still here, pinned to the
// bottom, but now they sit under whatever this device already has a seat
// in. See docs/plans/2026-08-31-wordgame-redesign/Word Game Entry.dc.html
// for the card anatomy this file implements.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { askWithTimeout } from '@game-host/lobby/client/answerTimeout';
import { getConnection, type Connection } from '../net/connection';
import { rememberedName, saveIdentity } from '../net/identity';
import { useMyGames, type MyGame } from './useMyGames';
import { useNotifyStatus } from '../notify/useNotifyStatus';
import { NotificationSettings } from '../notify/NotificationSettings';
import { ago } from '../game/LastMove';
import type { RoomSummary } from '../../session/protocol';

export interface HomePageProps {
  /** Injectable for tests. The app never passes it. */
  connect?: () => Connection;
}

type KnownSummary = Extract<RoomSummary, { known: true }>;

/** first char + '•••' + '@domain' — 'p•••@gmail.com'. No address on hand
 * (the settings haven't loaded, or none is set) reads as 'your email'
 * rather than showing nothing. */
function maskEmail(address: string | null): string {
  if (address === null) return 'your email';
  const at = address.indexOf('@');
  if (at <= 0) return address;
  return `${address[0]}•••${address.slice(at)}`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function moveFragment(lastMove: KnownSummary['lastMove']): string | null {
  if (lastMove === null) return null;
  if (lastMove.kind === 'play') {
    return `${lastMove.name} played ${(lastMove.word ?? '').toUpperCase()} for ${lastMove.score}`;
  }
  // RoomSummary's lastMove carries no tile count, unlike the in-game log —
  // "swapped tiles" rather than "swapped N tiles".
  if (lastMove.kind === 'exchange') return `${lastMove.name} swapped tiles`;
  return `${lastMove.name} passed`;
}

/** Competition ranking (1, 2, 2, 4, …): how many players outscore you, plus
 * one. Ties share a rank rather than splitting it. */
function rankOf(players: { score: number | null }[], you: { score: number | null }): number {
  const yourScore = you.score ?? 0;
  return players.filter((p) => (p.score ?? 0) > yourScore).length + 1;
}

/** The subline shared by every playing/finished card: a score line (2-player
 * scores, or your rank among 3+), then the last-move fragment, then how long
 * ago — each omitted when there's nothing to say. */
function playingSubline(summary: KnownSummary): string {
  const you = summary.players.find((p) => p.isYou);
  const others = summary.players.filter((p) => !p.isYou);
  const parts: string[] = [];
  if (summary.players.length === 2 && you !== undefined && others[0] !== undefined) {
    parts.push(`You ${you.score ?? 0}`);
    parts.push(`${others[0].name} ${others[0].score ?? 0}`);
  } else if (you !== undefined) {
    parts.push(`${ordinal(rankOf(summary.players, you))} of ${summary.players.length}`);
  }
  const frag = moveFragment(summary.lastMove);
  if (frag !== null) parts.push(frag);
  if (summary.lastMove?.at != null) {
    const agoText = ago(summary.lastMove.at);
    if (agoText !== '') parts.push(agoText);
  }
  return parts.join(' · ');
}

/** Everyone in the room as one line, "You" first with the rest following in
 * turn order — matching the in-game chip row, and replacing the seat-emoji
 * strip that read as noise (feedback 2026-09-01). */
function playerLine(summary: KnownSummary): string {
  const i = summary.players.findIndex((p) => p.isYou);
  const ordered = i <= 0
    ? summary.players
    : [...summary.players.slice(i), ...summary.players.slice(0, i)];
  return ordered.map((p) => (p.isYou ? 'You' : p.name)).join(', ');
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-[18px] pb-1 pt-2.5 text-[11.5px] font-semibold tracking-[.07em] text-ink-faint">
      {children}
    </div>
  );
}

function CardShell({
  roomId, navigate, borderClass, bgClass, children,
}: {
  roomId: string;
  navigate: NavigateFunction;
  borderClass: string;
  bgClass: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={`game-${roomId}`}
      onClick={() => navigate(`/room/${roomId}`)}
      className={`m-0 mx-4 mb-2 flex w-[calc(100%-2rem)] flex-col gap-[3px] rounded-xl px-3 py-2.5 text-left ${borderClass} ${bgClass}`}
    >
      {children}
    </button>
  );
}

function WaitingCard({ roomId, summary, navigate }: { roomId: string; summary: KnownSummary; navigate: NavigateFunction }) {
  const you = summary.players.find((p) => p.isYou);
  const border = you?.isHost
    ? 'border-[1.5px] border-dashed border-warn-accent'
    : 'border border-line';
  return (
    <CardShell roomId={roomId} navigate={navigate} borderClass={border} bgClass="bg-white">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[14px] font-semibold text-ink">
          Room {roomId}{you?.isHost === true ? ' · you host' : ''}
        </span>
        <span className="flex-none rounded-md bg-warnbg px-2 py-0.5 text-[10.5px] font-bold text-warn-ink">
          {summary.players.length} OF {summary.capacity}
        </span>
      </div>
      <div className="text-[12px] text-ink-mute">{playerLine(summary)}</div>
    </CardShell>
  );
}

function YourMoveCard({ roomId, summary, navigate }: { roomId: string; summary: KnownSummary; navigate: NavigateFunction }) {
  return (
    <CardShell roomId={roomId} navigate={navigate} borderClass="border-[1.5px] border-accent" bgClass="bg-[#f0f5ff]">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[14px] font-semibold text-ink">{playerLine(summary)}</span>
        <span className="flex-none rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-bold text-white">
          YOUR TURN
        </span>
      </div>
      <div className="text-[12px] text-ink-mute">{playingSubline(summary)}</div>
    </CardShell>
  );
}

function TheirMoveCard({ roomId, summary, navigate }: { roomId: string; summary: KnownSummary; navigate: NavigateFunction }) {
  return (
    <CardShell roomId={roomId} navigate={navigate} borderClass="border border-line" bgClass="bg-white">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[14px] font-semibold text-ink-soft">{playerLine(summary)}</span>
        <span className="flex-none rounded-md bg-[#eee8db] px-2 py-0.5 text-[10.5px] font-semibold text-ink-mute">
          {(summary.currentPlayerName ?? '…').toUpperCase()}’S TURN
        </span>
      </div>
      <div className="text-[12px] text-ink-ghost">{playingSubline(summary)}</div>
    </CardShell>
  );
}

function FinishedCard({ roomId, summary, navigate }: { roomId: string; summary: KnownSummary; navigate: NavigateFunction }) {
  const winner = (summary.winnerNames ?? []).join(' & ');
  return (
    <CardShell roomId={roomId} navigate={navigate} borderClass="border border-line" bgClass="bg-white">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[14px] font-semibold text-ink-soft">{playerLine(summary)}</span>
        <span className="flex-none rounded-md bg-[#eee8db] px-2 py-0.5 text-[10.5px] font-semibold text-ink-mute">
          {winner} WON
        </span>
      </div>
      <div className="text-[12px] text-ink-ghost">{playingSubline(summary)}</div>
    </CardShell>
  );
}

export function HomePage({ connect = getConnection }: HomePageProps) {
  const navigate = useNavigate();
  const { games } = useMyGames();
  const { status: notifyStatus, emailAddress, refresh: refreshNotify } = useNotifyStatus();
  const [notifyOpen, setNotifyOpen] = useState(false);

  // The create-room episode, lifted verbatim from the deleted
  // OnlineLobbyPage: the ask, its two answer channels, and the shared
  // timeout that says so when nothing answers.
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opened on the first click, not on mount: a visitor who never presses
  // New room should not have cost a socket.
  const [connection, setConnection] = useState<Connection | null>(null);
  const stopAsking = useRef<(() => void) | null>(null);
  useEffect(() => () => stopAsking.current?.(), []);

  const createRoom = () => {
    const c = connection ?? connect();
    setConnection(c);
    // Whatever you last called yourself, and nothing invented if you never
    // have: with no name on the wire the server seats you under `Player N`.
    const name = rememberedName() ?? undefined;
    setError(null);
    setWaiting(true);
    stopAsking.current?.();
    stopAsking.current = askWithTimeout({
      ask: () => c.createRoom(name),
      onJoined: c.onJoined,
      onRejected: c.transport.onRejected,
      joined: (msg) => {
        setWaiting(false);
        saveIdentity(msg.roomId, { playerId: msg.playerId, token: msg.token, name: name ?? '' });
        navigate(`/room/${msg.roomId}`);
      },
      rejected: (msg) => {
        setError(msg.message);
        setWaiting(false);
      },
      silence: () => {
        setWaiting(false);
        setError('No answer from the server — it may be restarting. Try again.');
      },
    });
  };

  const initial = (rememberedName()?.[0] ?? '?').toUpperCase();

  const lobbyGames: MyGame[] = games?.filter((g) => g.summary.lifecycle === 'lobby') ?? [];
  const yourMoveGames: MyGame[] = games?.filter((g) => g.summary.lifecycle === 'playing' && g.summary.yourTurn) ?? [];
  const theirMoveGames: MyGame[] = games?.filter((g) => g.summary.lifecycle === 'playing' && !g.summary.yourTurn) ?? [];
  const finishedGames: MyGame[] = games?.filter((g) => g.summary.lifecycle === 'over') ?? [];

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col bg-paper">
      <header className="flex items-center gap-2.5 px-4 pb-3 pt-[18px]">
        <h1 className="flex-1 text-[21px] font-bold text-ink">Word Game</h1>
        <button
          type="button"
          aria-label="Notifications"
          onClick={() => { setNotifyOpen(true); }}
          className="relative m-0 flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border-0 bg-chipbg text-sm font-semibold text-ink-soft"
        >
          {initial}
          {notifyStatus === 'on' && (
            <span
              data-testid="notify-badge"
              className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-paper bg-accent text-[8px]"
            >
              🔔
            </span>
          )}
        </button>
      </header>

      {(notifyStatus === 'off' || notifyStatus === 'pending') && (
        <div
          className={`mx-4 mb-1.5 flex items-center gap-2.5 rounded-xl border-[1.5px] px-3 py-2.5 ${
            notifyStatus === 'off' ? 'border-accent bg-[#f0f5ff]' : 'border-warn-accent bg-warnbg'
          }`}
        >
          <div className={`flex-1 text-[13px] ${notifyStatus === 'off' ? 'text-accent-strong' : 'text-warn-ink'}`}>
            {notifyStatus === 'off'
              ? '🔔 Turns can be days apart — get a nudge when it’s yours'
              : `✉️ Confirm your email — we sent a link to ${maskEmail(emailAddress)}`}
          </div>
          <button
            type="button"
            onClick={() => { setNotifyOpen(true); }}
            className={`m-0 flex-none rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white ${
              notifyStatus === 'off' ? 'bg-accent' : 'bg-warn-accent'
            }`}
          >
            {notifyStatus === 'off' ? 'Set up' : 'Resend'}
          </button>
        </div>
      )}

      {lobbyGames.length > 0 && (
        <>
          <SectionHeader>WAITING FOR PLAYERS</SectionHeader>
          {lobbyGames.map((g) => (
            <WaitingCard key={g.roomId} roomId={g.roomId} summary={g.summary} navigate={navigate} />
          ))}
        </>
      )}

      {yourMoveGames.length > 0 && (
        <>
          <SectionHeader>{`YOUR MOVE (${yourMoveGames.length})`}</SectionHeader>
          {yourMoveGames.map((g) => (
            <YourMoveCard key={g.roomId} roomId={g.roomId} summary={g.summary} navigate={navigate} />
          ))}
        </>
      )}

      {theirMoveGames.length > 0 && (
        <>
          <SectionHeader>THEIR MOVE</SectionHeader>
          {theirMoveGames.map((g) => (
            <TheirMoveCard key={g.roomId} roomId={g.roomId} summary={g.summary} navigate={navigate} />
          ))}
        </>
      )}

      {finishedGames.length > 0 && (
        <>
          <SectionHeader>FINISHED</SectionHeader>
          {finishedGames.map((g) => (
            <FinishedCard key={g.roomId} roomId={g.roomId} summary={g.summary} navigate={navigate} />
          ))}
        </>
      )}

      <div className="mt-auto flex flex-col gap-2 px-4 pb-5 pt-3">
        {error !== null && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={createRoom}
          disabled={waiting}
          className="m-0 flex min-h-[46px] w-full items-center justify-center rounded-xl bg-accent text-[16px] font-bold text-white shadow-[0_2px_6px_rgba(37,99,235,.35)] disabled:cursor-not-allowed disabled:bg-line disabled:shadow-none"
        >
          {waiting ? 'Creating…' : 'New room'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/online/join')}
          className="m-0 flex min-h-[44px] w-full items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-white text-[15px] font-semibold text-ink-soft"
        >
          Join with a code
        </button>
      </div>

      {notifyOpen && (
        <NotificationSettings onClose={() => { setNotifyOpen(false); refreshNotify(); }} />
      )}
    </div>
  );
}
