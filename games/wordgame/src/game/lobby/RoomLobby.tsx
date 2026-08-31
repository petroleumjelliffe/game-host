// src/game/lobby/RoomLobby.tsx
// The New Room state of the lobby card: the code is read-only because you are
// already in the room it names, and the list holds everybody. Its Join Room
// twin is `JoinRoomCard`; both are drawn by `LobbyCard`.

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
}

export function RoomLobby({
  view, note, onStart, onRename, onLeaveSeat, seatEmoji, shareUrl, shareText,
}: RoomLobbyProps) {
  const isHost = view.you?.isHost === true;

  // Capacity is `view.seats.length`, never a hardcoded number — the seat
  // count is whatever this game's kit configured, and a design's "of 4" is
  // illustrative, not a limit this component may assume.
  const filled = view.seats.filter((seat) => seat.id !== null).length;
  const empty = view.seats.length - filled;
  const seatNote = empty === 0
    ? (isHost ? `All ${view.seats.length} seats filled — you can start` : `All ${view.seats.length} seats filled`)
    : `${filled} of ${view.seats.length} seats — waiting for ${empty} more`;

  // The roster carries no host name of its own — it is just the seat whose
  // `isHost` flag is set. 'the host' is the fallback for the moment before a
  // roster has arrived at all.
  const hostName = view.seats.find((seat) => seat.isHost)?.name ?? 'the host';

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
      seatNote={<p className="text-center text-[12px] text-ink-faint">{seatNote}</p>}
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
      {view.seats.map((seat) => (
        <SeatRow
          key={seat.index}
          emoji={seatEmoji(seat.index)}
          connected={seat.connected}
          isHost={seat.isHost}
          empty={seat.id === null}
          reconnecting={seat.id !== null && seat.name !== null && !seat.connected}
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
      ))}
    </LobbyCard>
  );
}
