// src/game/lobby/PreJoin.tsx
// The pre-join chooser (design screens A1 / A2b) and the "That's me" claim
// sheet (A2, with C1's sent and cooldown states). A visitor who opens a
// room URL holding no seat lands here: pick an empty seat to join, or have
// the address already on a seat emailed a way back in. This replaced the
// silent auto-join, and — with the name-match takeover retired — the
// emailed link is the only way onto a new device.

import { useState } from 'react';
import type { RosterMessage } from '@game-host/lobby/protocol/protocol';
import { requestSeatSignin, type SigninOutcome } from '@game-host/notify/client/invites';
import { GAME_ID } from '../../notify/gameId';

export interface PreJoinProps {
  roomId: string;
  roster: RosterMessage;
  /** The explicit join — "Sit here". Lobby only; the server picks the seat. */
  onSit: () => void;
  onHome: () => void;
  /** Room capacity, for the empty-seat padding (lobby lifecycle only). */
  capacity: number;
  seatEmoji: (seat: number) => string | null;
}

interface ClaimTarget {
  playerId: string;
  name: string;
  /** A reserved seat resends its invite; an occupied one mails a sign-in link. */
  reserved: boolean;
}

export function PreJoin({ roomId, roster, onSit, onHome, capacity, seatEmoji }: PreJoinProps) {
  const [claiming, setClaiming] = useState<ClaimTarget | null>(null);
  const [hint, setHint] = useState(false);
  const inLobby = roster.lifecycle === 'lobby';
  const pending = roster.pending ?? [];
  const emptySeats = Math.max(0, capacity - roster.players.length - pending.length);

  return (
    <div className="flex min-h-screen items-start justify-center bg-page px-3 py-7">
      <div className="mx-auto flex w-full max-w-[398px] flex-col gap-2.5 rounded-[22px] bg-paper p-4 shadow-xl">
        <h1 className="mt-2 text-center text-[21px] font-bold">Room {roomId}</h1>
        {inLobby ? (
          <>
            <p className="-mt-1.5 text-center text-[13.5px] text-ink-faint">Pick your seat to join</p>
            <div data-testid="room-code" className="w-full rounded-2xl bg-[#ece7da] py-4 text-center text-[30px] font-bold tracking-[0.32em]">
              {roomId}
            </div>
          </>
        ) : (
          <div className="rounded-xl border-[1.5px] border-warnbd bg-warnbg p-3 text-center">
            <p className="text-[15px] font-bold text-warn-ink">This game is in progress</p>
            <p className="text-[12.5px] text-[#a08a55]">If one of these seats is yours, claim it by email</p>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {roster.players.map((player, index) => (
            <li
              key={player.id}
              className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5"
            >
              <span aria-hidden className="flex-none text-base leading-none">{seatEmoji(index) ?? '·'}</span>
              <span
                aria-hidden
                className={`h-2 w-2 flex-none rounded-full ${player.connected ? 'bg-green-500' : 'bg-line-strong'}`}
              />
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                {player.name}
                {player.isHost && (
                  <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">host</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => { setClaiming({ playerId: player.id, name: player.name, reserved: false }); }}
                className="m-0 flex-none px-1 text-[12.5px] font-semibold text-[var(--lobby-accent,#2563eb)]"
              >
                That’s me
              </button>
            </li>
          ))}
          {inLobby && pending.map((seat) => (
            <li
              key={seat.id}
              className="flex items-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#c9a86a] bg-[#fbf9f3] px-3 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#8a6d2f]">
                {seat.name ?? 'Invited'}
                <span className="font-medium text-[#b39a63]"> · invited, not here yet</span>
              </span>
              {/* The invitee who lost the email arrives here by the shared
                  URL; the resend goes only to the original target, so a
                  forwardee clicking it re-pings the real invitee. */}
              <button
                type="button"
                onClick={() => {
                  setClaiming({ playerId: seat.id, name: seat.name ?? 'Invited', reserved: true });
                }}
                className="m-0 flex-none px-1 text-[12.5px] font-semibold text-[var(--lobby-accent,#2563eb)]"
              >
                That’s me
              </button>
            </li>
          ))}
          {inLobby && Array.from({ length: emptySeats }, (_, i) => (
            <li
              key={`empty-${i}`}
              className="flex items-center gap-2 rounded-xl border-[1.5px] border-dashed border-line-strong px-3 py-2.5 italic text-ink-ghost"
            >
              <span aria-hidden className="flex-none text-base leading-none">·</span>
              <span className="min-w-0 flex-1 truncate text-[14px]">Empty seat</span>
              {i === 0 && (
                <button
                  type="button"
                  onClick={onSit}
                  className="m-0 flex-none rounded-lg bg-[var(--lobby-accent,#2563eb)] px-3.5 py-1.5 text-[12.5px] font-semibold not-italic text-white shadow-[0_2px_6px_rgba(37,99,235,0.3)]"
                >
                  Sit here
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="min-h-6 flex-1" />
        <button
          type="button"
          onClick={() => { setHint(true); }}
          className="m-0 py-1 text-center text-[13px] font-semibold text-[var(--lobby-accent,#2563eb)]"
        >
          Signed in on another phone? Email me a link
        </button>
        {hint && (
          <p className="-mt-1 text-center text-[12px] text-ink-faint">
            Tap “That’s me” next to your seat above.
          </p>
        )}
        <button
          type="button"
          onClick={onHome}
          className="m-0 w-full rounded-xl border-[1.5px] border-line-strong bg-white px-4 py-2.5 font-semibold text-ink-soft"
        >
          Go home
        </button>
      </div>

      {claiming !== null && (
        <SeatClaimSheet
          roomId={roomId}
          target={claiming}
          onClose={() => { setClaiming(null); }}
        />
      )}
    </div>
  );
}

type SheetState = 'idle' | 'sending' | SigninOutcome;

/**
 * The A2 sheet with C1's outcomes folded in. One sheet for both cases —
 * only the copy changes — and the seat's address is never shown. Both
 * outcomes are exactly as vague as the server's answer: the sheet cannot
 * know, and must not imply, whether the seat has email at all.
 */
function SeatClaimSheet({ roomId, target, onClose }: {
  roomId: string;
  target: ClaimTarget;
  onClose: () => void;
}) {
  const [state, setState] = useState<SheetState>('idle');

  const send = () => {
    setState('sending');
    void requestSeatSignin({ game: GAME_ID, roomId, playerId: target.playerId }).then(setState);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(43,40,32,0.28)]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={target.reserved ? `Resend ${target.name}’s invite` : `Get back into ${target.name}’s seat`}
        className="w-full max-w-[398px] rounded-t-[22px] bg-paper px-4 pb-5 pt-3.5 shadow-[0_-8px_32px_rgba(31,41,26,0.25)]"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div aria-hidden className="mx-auto mb-2.5 h-1 w-9 rounded-sm bg-line-strong" />
        {state === 'sent' || state === 'cooldown' ? (
          <div className="flex flex-col items-center gap-1.5 py-2 text-center">
            <div aria-hidden className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${state === 'sent' ? 'bg-[#e6f2e8] text-[#3fa053]' : 'bg-warnbg'}`}>
              {state === 'sent' ? '✓' : '⏳'}
            </div>
            <p className="text-[15px] font-bold">{state === 'sent' ? 'Check your inbox' : 'Already sent today'}</p>
            <p className="max-w-[280px] text-[13px] leading-relaxed text-ink-soft">
              {state === 'sent'
                ? `If that seat’s email is set up, a link for room ${roomId} is on its way. It can take a minute.`
                : 'A link went out for this seat recently. Check your inbox and spam — you can ask again tomorrow.'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="m-0 mt-0.5 text-[12.5px] font-semibold text-[var(--lobby-accent,#2563eb)]"
            >
              Back to the room
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-[16px] font-bold text-ink">
                {target.reserved ? `Resend ${target.name === 'Invited' ? 'the' : `${target.name}’s`} invite` : `Get back into ${target.name}’s seat`}
              </h2>
              <button type="button" onClick={onClose} aria-label="Close" className="m-0 rounded px-1 text-lg text-ink-ghost">✕</button>
            </div>
            <p className="text-[13.5px] leading-relaxed text-ink-soft">
              {target.reserved
                ? 'We’ll resend the invite to the address it was sent to. Opening it claims this seat.'
                : 'We’ll email the address on this seat a sign-in link for this room. Opening it on this phone puts you in the seat — your other devices stay signed in.'}
            </p>
            <button
              type="button"
              disabled={state === 'sending'}
              onClick={send}
              className="m-0 w-full rounded-xl bg-[var(--lobby-accent,#2563eb)] px-4 py-2.5 text-[15px] font-bold text-white shadow-[0_2px_6px_rgba(37,99,235,0.35)] disabled:opacity-60"
            >
              {state === 'sending' ? 'Sending…' : target.reserved ? 'Resend the invite' : 'Email me a link'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="m-0 text-center text-[12.5px] text-ink-ghost"
            >
              Not you? Go back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
