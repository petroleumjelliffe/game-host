// src/game/lobby/RoomLobby.tsx
// The New Room state of the lobby card: the code is read-only because you are
// already in the room it names, and the list holds everybody. Its Join Room
// twin is `JoinRoomCard`; both are drawn by `LobbyCard`.
//
// Since the invite flow (2026-09-05) a seat has three states: occupied,
// reserved (invited, not here yet — dashed amber, Remind primary and a
// two-tap Revoke), and empty (which now carries the host's Invite entry —
// the design's ruling that inviting fills *this* seat).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LobbyView } from '@game-host/lobby/client/view';
import { LobbyCard, SeatRow } from './LobbyCard';
import { ShareRoomButton } from './ShareRoomButton';

export interface RoomLobbyProps {
  /**
   * Seats, who you are, and whether you may begin — already worked out.
   * This component used to be handed the raw roster and re-derive all three,
   * and could not render an empty seat at all, because the roster has no way
   * to mention one.
   */
  view: LobbyView;
  /** A refusal that arrived while sitting here — shown, not navigated away from. */
  note?: string | null;
  onStart: () => void;
  /** Rename your own seat. Sent on blur or Enter, not per keystroke. */
  onRename: (name: string) => void;
  /** Give up your own seat — the `Leave` button, which is now the only way. */
  onLeaveSeat: () => void;
  /**
   * The face a seat is about to get. Injected rather than imported: this
   * component knows rooms and seats, not startups, so what a seat number
   * renders as is the caller's to decide.
   */
  seatEmoji: (seat: number) => string | null;
  /**
   * The room's link, when the game wants a Share button under the code block.
   * The kit never computes URLs — for this game the lobby lives at
   * `/room/:id`, so the page passes its own address.
   */
  shareUrl?: string;
  /** Share-sheet text. Absent means the kit's game-neutral default. */
  shareText?: string;
  /**
   * Opens the invite picker. Rendered on empty rows for the host only;
   * absent means no invite affordance at all (a page without the notify
   * machinery, or a test that isn't about it).
   */
  onInvite?: () => void;
  /**
   * Resend the invite behind a reserved seat. Resolves to whether it went —
   * the row shows Sending…/Sent/the refusal without this component knowing
   * who is behind the seat (nobody client-side does; that is the privacy
   * stance working).
   */
  onRemind?: (playerId: string) => Promise<{ ok: boolean; reason?: string }>;
  /** Delete a reserved seat. The row asks twice; this fires on the second tap. */
  onRevoke?: (playerId: string) => void;
  /**
   * Focus the rename field when your row first appears, with its default
   * name selected so typing replaces it. Passed only on the arrival from
   * the pre-join chooser's "Sit here" — a rejoin or a freshly created room
   * must not pop the keyboard on every visit.
   */
  autoFocusName?: boolean;
  /**
   * Offer sign-in (spec 2026-09-09 §Client, decision 1): shown when the
   * device holds no confirmed address, so a friend who arrived by room
   * code meets it before the game starts. Absent means signed in, or no
   * notify service to sign in to.
   */
  onSignIn?: () => void;
}

type RemindNote = 'sending' | 'sent' | 'capped' | 'failed';

export function RoomLobby({
  view, note, onStart, onRename, onLeaveSeat, seatEmoji, shareUrl, shareText,
  onInvite, onRemind, onRevoke, autoFocusName = false, onSignIn,
}: RoomLobbyProps) {
  const isHost = view.you?.isHost === true;

  // A stable ref callback fires once, when the input mounts — later
  // re-renders reuse the same element and never re-steal focus.
  const focusAndSelect = useCallback((el: HTMLInputElement | null) => {
    if (el !== null) {
      el.focus();
      el.select();
    }
  }, []);

  // Occupied is `id && !pending` now — a reserved row has an id too, and
  // counting it as "here" once tripped the "you can start" copy.
  const filled = view.seats.filter((seat) => seat.id !== null && !seat.pending).length;
  const reserved = view.seats.filter((seat) => seat.pending).length;
  const empty = view.seats.length - filled - reserved;

  // Capacity is `view.seats.length`, never a hardcoded number — the seat
  // count is whatever this game's kit configured, and a design's "of 4" is
  // illustrative, not a limit this component may assume.
  const seatNote = reserved > 0
    ? `${filled} of ${view.seats.length} here · ${reserved} seat${reserved === 1 ? '' : 's'} reserved`
    : empty === 0
      ? (isHost ? `All ${view.seats.length} seats filled — you can start` : `All ${view.seats.length} seats filled`)
      : `${filled} of ${view.seats.length} seats — waiting for ${empty} more`;

  // The roster carries no host name of its own — it is just the seat whose
  // `isHost` flag is set. 'the host' is the fallback for the moment before a
  // roster has arrived at all.
  const hostName = view.seats.find((seat) => seat.isHost)?.name ?? 'the host';

  // The just-claimed flourish: a seat id that was reserved last render and
  // is occupied now wears a green ring for six seconds. Tracked by seat id —
  // display indexes shift as seats claim and revoke.
  const prevPending = useRef<Set<string>>(new Set());
  const [justClaimed, setJustClaimed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const nowPending = new Set<string>();
    const claimed: string[] = [];
    for (const seat of view.seats) {
      if (seat.id === null) continue;
      if (seat.pending) nowPending.add(seat.id);
      else if (prevPending.current.has(seat.id)) claimed.push(seat.id);
    }
    prevPending.current = nowPending;
    if (claimed.length === 0) return;
    setJustClaimed((current) => new Set([...current, ...claimed]));
    const timer = setTimeout(() => {
      setJustClaimed((current) => {
        const next = new Set(current);
        for (const id of claimed) next.delete(id);
        return next;
      });
    }, 6000);
    return () => { clearTimeout(timer); };
  }, [view.seats]);

  // Remind and revoke row state, keyed by seat id. Revoke asks twice — one
  // tap is easy to misfire on a phone — and the confirming state expires.
  const [remindNotes, setRemindNotes] = useState<Record<string, RemindNote>>({});
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  useEffect(() => {
    if (confirmingRevoke === null) return;
    const timer = setTimeout(() => { setConfirmingRevoke(null); }, 4000);
    return () => { clearTimeout(timer); };
  }, [confirmingRevoke]);

  const remind = useCallback((playerId: string) => {
    if (onRemind === undefined) return;
    setRemindNotes((notes) => ({ ...notes, [playerId]: 'sending' }));
    void onRemind(playerId).then((outcome) => {
      setRemindNotes((notes) => ({
        ...notes,
        [playerId]: outcome.ok ? 'sent' : outcome.reason === 'rateLimited' ? 'capped' : 'failed',
      }));
    });
  }, [onRemind]);

  return (
    <LobbyCard
      title={isHost ? 'New room' : `Room ${view.code}`}
      subtitle={isHost
        ? 'Share this code with other players'
        : 'You’re in — the game starts when the host says go'}
      code={view.code}
      underCode={shareUrl !== undefined && (
        <ShareRoomButton url={shareUrl} {...(shareText === undefined ? {} : { text: shareText })} />
      )}
      seatNote={(
        <>
          {onSignIn !== undefined && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border-[1.5px] border-[var(--lobby-accent,#2563eb)] bg-[#f0f5ff] px-3 py-2">
              <span className="flex-1 text-[12.5px] text-accent-strong">
                Sign in with your email to keep this seat on your other devices
              </span>
              <button
                type="button"
                onClick={onSignIn}
                className="m-0 flex-none rounded-lg bg-[var(--lobby-accent,#2563eb)] px-3 py-1.5 text-[12.5px] font-semibold text-white"
              >
                Sign in
              </button>
            </div>
          )}
          <p className="text-center text-[12px] text-ink-faint">{seatNote}</p>
        </>
      )}
      note={note}
      onLeave={onLeaveSeat}
      primary={isHost ? (
        <button
          type="button"
          onClick={onStart}
          disabled={!view.canBegin}
          className="m-0 w-full rounded-xl bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-bold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)] disabled:cursor-not-allowed disabled:bg-chipbg disabled:text-ink-ghost"
        >
          {/* Stays "Start game" even while disabled — the seat note above
              already explains why, so the button never had to double as the
              explanation. */}
          Start game
        </button>
      ) : (
        <div className="rounded-xl border-[1.5px] border-warnbd bg-warnbg p-3 text-center">
          <p className="text-[15px] font-bold text-warn-ink">Waiting for {hostName} to start</p>
          <p className="text-[12.5px] text-[#a08a55]">You’ll get a nudge when the first turn is yours</p>
        </div>
      )}
    >
      {view.seats.map((seat) => {
        if (seat.pending && seat.id !== null) {
          const seatId = seat.id;
          const remindNote = remindNotes[seatId];
          return (
            <SeatRow
              key={seatId}
              emoji={null}
              connected={null}
              isHost={false}
              reserved
              actions={seat.canRevoke && (
                <>
                  {onRemind !== undefined && (
                    <button
                      type="button"
                      disabled={remindNote === 'sending' || remindNote === 'sent' || remindNote === 'capped'}
                      onClick={() => { remind(seatId); }}
                      className="m-0 flex-none rounded-lg border-[1.5px] border-[var(--lobby-accent,#2563eb)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--lobby-accent,#2563eb)] disabled:border-line-strong disabled:text-ink-faint"
                    >
                      {remindNote === 'sending' ? 'Sending…'
                        : remindNote === 'sent' ? 'Sent'
                          : remindNote === 'capped' ? 'Sent today'
                            : 'Remind'}
                    </button>
                  )}
                  {onRevoke !== undefined && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmingRevoke === seatId) {
                          setConfirmingRevoke(null);
                          onRevoke(seatId);
                        } else {
                          setConfirmingRevoke(seatId);
                        }
                      }}
                      className={`m-0 flex-none px-1 py-1 text-[12.5px] font-semibold ${
                        confirmingRevoke === seatId ? 'text-danger-ink' : 'text-ink-faint'
                      }`}
                    >
                      {confirmingRevoke === seatId ? 'Sure?' : 'Revoke'}
                    </button>
                  )}
                </>
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#8a6d2f]">
                {seat.name ?? 'Invited'}
                <span className="font-medium text-[#b39a63]"> · invited, not here yet</span>
              </span>
            </SeatRow>
          );
        }
        return (
          <SeatRow
            key={seat.id ?? `empty-${seat.index}`}
            emoji={seatEmoji(seat.index)}
            connected={seat.connected}
            isHost={seat.isHost}
            empty={seat.id === null}
            reconnecting={seat.id !== null && seat.name !== null && !seat.connected}
            justClaimed={seat.id !== null && justClaimed.has(seat.id)}
            actions={seat.id === null && isHost && onInvite !== undefined && (
              // The invite entry point lives on the empty seat itself —
              // inviting fills *this* seat (the design's ruling; the
              // checklist's spot beside Share lost to it).
              <button
                type="button"
                onClick={onInvite}
                className="m-0 flex-none rounded-lg border-[1.5px] border-[var(--lobby-accent,#2563eb)] px-3 py-1 text-[12.5px] font-semibold not-italic text-[var(--lobby-accent,#2563eb)]"
              >
                Invite
              </button>
            )}
          >
            {seat.canRename ? (
              // Your row and only yours: the field. Committed on blur or Enter
              // rather than per keystroke, so the room is not broadcast every
              // letter of a half-typed name.
              //
              // The mockup also draws a × here. It was dropped (owner,
              // 2026-08-07): `Leave`, directly below this list, already vacates
              // your seat, and on the host's row a × read as "boot yourself".
              <input
                aria-label="Your name"
                ref={autoFocusName ? focusAndSelect : undefined}
                defaultValue={seat.name ?? ''}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== '' && next !== seat.name) onRename(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line-strong bg-white px-2 py-1 font-semibold"
              />
            ) : (
              // An empty seat says so rather than being absent — the room's
              // size is information, and the roster could never carry it.
              <span
                className={
                  seat.id === null
                    ? 'min-w-0 flex-1 truncate italic'
                    : 'min-w-0 flex-1 truncate font-semibold'
                }
              >
                {seat.name ?? 'Empty seat'}
              </span>
            )}
          </SeatRow>
        );
      })}
    </LobbyCard>
  );
}
