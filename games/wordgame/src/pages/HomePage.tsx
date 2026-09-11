// The Entry screen: your games, grouped by whose move it is. Replaces the
// old two-door landing page — the doors are still here, pinned to the
// bottom, but now they sit under whatever this device already has a seat
// in. See docs/plans/2026-08-31-wordgame-redesign/Word Game Entry.dc.html
// for the card anatomy this file implements — the 2026-09-10 revision:
// score chips instead of a name line, a Nudge on their-move cards, and a
// REMINDED badge on yours (docs/plans/2026-09-10-turn-nudge.md).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { askWithTimeout } from '@game-host/lobby/client/answerTimeout';
import { getConnection, type Connection } from '../net/connection';
import { rememberedName, saveIdentity, loadIdentity } from '../net/identity';
import { acceptInvite } from '@game-host/notify/client/landing';
import { nudgeTurn, type MineInvite } from '@game-host/notify/client/api';
import { GAME_ID } from '../notify/gameId';
import { useMyGames, type MyGame } from './useMyGames';
import { useNotifyStatus } from '../notify/useNotifyStatus';
import { NotificationSettings } from '../notify/NotificationSettings';
import { UpdateReadyButton } from '@game-host/pwa/client/UpdateReadyButton';
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

/** How long since the last committed move, or '' when there is none. */
function agoLine(summary: KnownSummary): string {
  return summary.lastMove?.at == null ? '' : ago(summary.lastMove.at);
}

type Player = KnownSummary['players'][number];

/**
 * Chip order (design 2026-09-10): the featured player first — whoever the
 * card is about, the current player or the winner — then You, then the
 * rest in seating order. On a your-move card the featured player *is* You,
 * so it reads You-first like the old line did.
 */
function chipOrder(players: Player[], featured: (p: Player) => boolean): Player[] {
  const lead = players.filter(featured);
  const you = players.filter((p) => p.isYou && !featured(p));
  const rest = players.filter((p) => !featured(p) && !p.isYou);
  return [...lead, ...you, ...rest];
}

/**
 * One player's chip: name and score. `tone` is the design's three fills —
 * accent for You when it is your move, shaded for the featured other
 * (their turn, or the winner), plain for everyone else.
 */
function ScoreChip({ player, tone }: { player: Player; tone: 'accent' | 'shaded' | 'plain' }) {
  const name = player.isYou ? 'You' : player.name;
  const score = player.score ?? 0;
  const cls = tone === 'accent'
    ? 'bg-accent text-white'
    : tone === 'shaded'
      ? 'border border-line-strong bg-[#eee8db] text-ink'
      : 'border border-[#dcd4c2] bg-white text-ink-soft';
  return (
    <span
      data-testid="score-chip"
      data-tone={tone}
      className={`rounded-lg px-2.5 py-1 text-[12.5px] font-semibold ${cls}`}
    >
      {name} · {score}
    </span>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-[18px] pb-1 pt-2.5 text-[11.5px] font-semibold tracking-[.07em] text-ink-faint">
      {children}
    </div>
  );
}

/**
 * The tappable card. The open target is a real <button> holding the card's
 * content; an optional `control` (the Nudge) is a sibling overlaid at the
 * top right, never a descendant. A button inside a button is invalid HTML,
 * and a button inside role="button" is no better: ARIA marks a button's
 * children presentational, so assistive tech may flatten the nudge away
 * (review, 2026-09-10). Native buttons also handle Enter and Space
 * themselves, so there is no key handler to get wrong.
 */
function CardShell({
  roomId, navigate, borderClass, bgClass, control, children,
}: {
  roomId: string;
  navigate: NavigateFunction;
  borderClass: string;
  bgClass: string;
  control?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-testid={`game-${roomId}`} className={`relative mx-4 mb-2 rounded-xl ${borderClass} ${bgClass}`}>
      <button
        type="button"
        data-testid={`open-${roomId}`}
        onClick={() => { void navigate(`/room/${roomId}`); }}
        className={`m-0 flex w-full flex-col gap-2 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left ${control !== undefined ? 'pr-24' : ''}`}
      >
        {children}
      </button>
      {control !== undefined && (
        <div className="absolute right-3 top-2.5 flex h-[26px] items-center">{control}</div>
      )}
    </div>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

function MetaRow({ left, right }: { left?: ReactNode; right: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-[11.5px] text-ink-ghost">{left}</span>
      <span className="flex-none text-[11.5px] text-ink-ghost">{right}</span>
    </div>
  );
}

function WaitingCard({ roomId, summary, navigate }: { roomId: string; summary: KnownSummary; navigate: NavigateFunction }) {
  const you = summary.players.find((p) => p.isYou);
  const border = you?.isHost
    ? 'border-[1.5px] border-dashed border-warn-accent'
    : 'border border-line';
  const ordered = chipOrder(summary.players, (p) => p.isYou);
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
      <div className="text-[12px] text-ink-mute">
        {ordered.map((p) => (p.isYou ? 'You' : p.name)).join(', ')}
      </div>
    </CardShell>
  );
}

function YourMoveCard({ roomId, summary, navigate }: { roomId: string; summary: KnownSummary; navigate: NavigateFunction }) {
  const ordered = chipOrder(summary.players, (p) => p.isYou);
  return (
    <CardShell roomId={roomId} navigate={navigate} borderClass="border-[1.5px] border-accent" bgClass="bg-[#f0f5ff]">
      <ChipRow>
        {ordered.map((p, i) => <ScoreChip key={i} player={p} tone={p.isYou ? 'accent' : 'plain'} />)}
      </ChipRow>
      <MetaRow
        left={summary.nudge === 'reminded' && (
          <span
            data-testid="reminded-badge"
            className="rounded-md bg-warnbg px-2 py-0.5 text-[10.5px] font-bold text-warn-ink"
          >
            REMINDED
          </span>
        )}
        right={agoLine(summary)}
      />
    </CardShell>
  );
}

/**
 * The Nudge control on a their-move card: a button while the turn can be
 * nudged, "Reminded ✓" once it has been — by this button or another
 * player's, which the summary reports the same way — and nothing while the
 * turn is too fresh ('waiting') or nobody could receive it. Rendered beside
 * the card's open button, never inside it.
 */
function NudgeControl({ roomId, state }: { roomId: string; state: KnownSummary['nudge'] }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (state === 'reminded' || sent) {
    return <span data-testid="nudge-done" className="text-[12px] font-semibold text-[#3fa053]">Reminded ✓</span>;
  }
  if (state !== 'ready') return null;
  const nudge = () => {
    const identity = loadIdentity(roomId);
    if (identity === null) return;
    setBusy(true);
    void nudgeTurn({ game: GAME_ID, roomId, playerId: identity.playerId, token: identity.token })
      .then((outcome) => { setBusy(false); if (outcome !== 'failed') setSent(true); });
  };
  return (
    <button
      type="button"
      disabled={busy}
      onClick={nudge}
      className="m-0 rounded-lg border-[1.5px] border-accent bg-transparent px-2.5 py-[3px] text-[12px] font-semibold text-accent disabled:opacity-60"
    >
      Nudge
    </button>
  );
}

function TheirMoveCard({ roomId, summary, navigate }: { roomId: string; summary: KnownSummary; navigate: NavigateFunction }) {
  const current = summary.currentPlayerName;
  const ordered = chipOrder(summary.players, (p) => p.isCurrent);
  return (
    <CardShell
      roomId={roomId}
      navigate={navigate}
      borderClass="border border-line"
      bgClass="bg-white"
      control={summary.nudge === 'ready' || summary.nudge === 'reminded'
        ? <NudgeControl roomId={roomId} state={summary.nudge} />
        : undefined}
    >
      <ChipRow>
        {ordered.map((p, i) => (
          <ScoreChip key={i} player={p} tone={p.isCurrent && !p.isYou ? 'shaded' : 'plain'} />
        ))}
      </ChipRow>
      <MetaRow left={`${current ?? '…'}’s turn`} right={agoLine(summary)} />
    </CardShell>
  );
}

function FinishedCard({ roomId, summary, navigate }: { roomId: string; summary: KnownSummary; navigate: NavigateFunction }) {
  const won = (p: Player) => p.isWinner;
  const ordered = chipOrder(summary.players, won);
  const winners = summary.players.filter(won);
  const label = winners.some((p) => p.isYou)
    ? (winners.length > 1 ? 'YOU TIED' : 'YOU WON')
    : `${winners.map((p) => p.name).join(' & ')} WON`;
  return (
    <CardShell roomId={roomId} navigate={navigate} borderClass="border border-line" bgClass="bg-white">
      <ChipRow>
        {ordered.map((p, i) => <ScoreChip key={i} player={p} tone={won(p) ? 'shaded' : 'plain'} />)}
        <span className="flex-1" />
        <span className="flex-none rounded-md bg-[#eee8db] px-2 py-0.5 text-[10.5px] font-semibold text-ink-mute">
          {label.toUpperCase()}
        </span>
      </ChipRow>
      <MetaRow right={agoLine(summary)} />
    </CardShell>
  );
}

/** An invite the person can claim from here (spec 2026-09-09 §Client). */
function InviteCard({ invite, onClaim }: { invite: MineInvite; onClaim: () => void }) {
  const who = invite.inviterName ?? 'A friend';
  return (
    <div
      data-testid={`invite-${invite.roomId}`}
      className="m-0 mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#c9a86a] bg-[#fbf9f3] px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">Room {invite.roomId}</div>
        <div className="text-[12px] text-[#8a6d2f]">{who} saved you a seat</div>
      </div>
      <button
        type="button"
        onClick={onClaim}
        className="m-0 flex-none rounded-lg bg-[var(--lobby-accent,#2563eb)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white"
      >
        Claim
      </button>
    </div>
  );
}

/** The one banner slot under the header: a sentence and a button. */
function Banner({ tone, text, action, onAction }: {
  tone: 'accent' | 'warn';
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div
      className={`mx-4 mb-1.5 flex items-center gap-2.5 rounded-xl border-[1.5px] px-3 py-2.5 ${
        tone === 'accent' ? 'border-accent bg-[#f0f5ff]' : 'border-warn-accent bg-warnbg'
      }`}
    >
      <div className={`flex-1 text-[13px] ${tone === 'accent' ? 'text-accent-strong' : 'text-warn-ink'}`}>
        {text}
      </div>
      <button
        type="button"
        onClick={onAction}
        className={`m-0 flex-none rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white ${
          tone === 'accent' ? 'bg-accent' : 'bg-warn-accent'
        }`}
      >
        {action}
      </button>
    </div>
  );
}

export function HomePage({ connect = getConnection }: HomePageProps) {
  const navigate = useNavigate();
  const { games, invites, address, signedInKnown, refresh } = useMyGames();
  const { status: notifyStatus, emailAddress, refresh: refreshNotify } = useNotifyStatus();
  const [notifyOpen, setNotifyOpen] = useState(false);

  // Accept (spec §Accept): a refusal is not an error — a linked device may
  // have claimed the same invite by link a moment ago, and restore then
  // shows the seat instead of the invite.
  const claim = (invite: MineInvite) => {
    void acceptInvite(invite.game, invite.roomId).then((creds) => {
      if (creds === null) { refresh(); return; }
      saveIdentity(invite.roomId, { playerId: creds.playerId, token: creds.token, name: creds.name });
      navigate(`/room/${invite.roomId}`);
    });
  };

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

      {address !== null && (
        <p className="-mt-2 px-4 pb-2 text-[12px] text-ink-faint">Signed in as {address}</p>
      )}

      {/* Installed app only, and only when a new build is waiting — the
          shared button renders nothing otherwise. The entry page is the one
          screen where nobody is mid-game, so restarting costs nothing. */}
      <div className="px-4">
        <UpdateReadyButton />
      </div>

      {/* One banner (spec 2026-09-09 §Client, three states): a pending
          confirmation first, then sign-in when the service knows this device
          holds no address, then the plain push nudge. The sign-in card shows
          whether or not the device already holds rooms — a device can hold
          rooms and still be unlinked. */}
      {notifyStatus === 'pending' ? (
        <Banner
          tone="warn"
          text={`✉️ Confirm your email — we sent a link to ${maskEmail(emailAddress)}. Tap it, then come back here.`}
          action="Resend"
          onAction={() => { setNotifyOpen(true); }}
        />
      ) : signedInKnown && address === null ? (
        <Banner
          tone="accent"
          text="Sign in with your email to see your games on this device"
          action="Sign in"
          onAction={() => { setNotifyOpen(true); }}
        />
      ) : notifyStatus === 'off' ? (
        <Banner
          tone="accent"
          text="🔔 Turns can be days apart — get a nudge when it’s yours"
          action="Set up"
          onAction={() => { setNotifyOpen(true); }}
        />
      ) : null}

      {invites.length > 0 && (
        <>
          <SectionHeader>INVITED</SectionHeader>
          {invites.map((i) => (
            <InviteCard key={i.roomId} invite={i} onClaim={() => { claim(i); }} />
          ))}
        </>
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
        <NotificationSettings
          // Both refreshes: a sign-out or a fresh confirmation changes the
          // list as much as the badge.
          onClose={() => { setNotifyOpen(false); refreshNotify(); refresh(); }}
        />
      )}
    </div>
  );
}
