// src/lobby/ui/RoomLobby.tsx
// The New Room state of the lobby card: the code is read-only because you are
// already in the room it names, and the list holds everybody. Its Join Room
// twin is `JoinRoomCard`; both are drawn by `LobbyCard`.

import type { RosterMessage } from '../../../lobby/protocol';
import { LobbyCard, SeatRow } from './LobbyCard';
import { ShareRoomButton } from './ShareRoomButton';

export interface RoomLobbyProps {
  roomId: string;
  players: RosterMessage['players'];
  /** Whose row gets the name field. The design gives it to nobody else. */
  myPlayerId: string | null;
  /** Only the host may start, which is the server's rule too. */
  isHost: boolean;
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
  roomId, players, myPlayerId, isHost, note, onStart, onRename, onLeaveSeat, seatEmoji,
  shareUrl, shareText,
}: RoomLobbyProps) {
  const enough = players.length >= 2;

  return (
    <LobbyCard
      title="New Room"
      subtitle="Share this code with other players"
      code={roomId}
      underCode={shareUrl !== undefined && (
        <ShareRoomButton url={shareUrl} {...(shareText === undefined ? {} : { text: shareText })} />
      )}
      note={note}
      onLeave={onLeaveSeat}
      primary={isHost ? (
        <button
          type="button"
          onClick={onStart}
          disabled={!enough}
          className="m-0 w-full rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-semibold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)] disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {enough ? 'Start game' : 'Waiting for another player'}
        </button>
      ) : (
        <p className="text-center text-sm text-gray-600">Waiting for the host to start.</p>
      )}
    >
      {players.map((p, seat) => (
        <SeatRow key={p.id} emoji={seatEmoji(seat)} connected={p.connected} isHost={p.isHost}>
          {p.id === myPlayerId ? (
            // Your row and only yours: the field. Committed on blur or Enter
            // rather than per keystroke, so the room is not broadcast every
            // letter of a half-typed name.
            //
            // The mockup also draws a × here. It was dropped (owner,
            // 2026-08-07): `Leave`, directly below this list, already vacates
            // your seat, and on the host's row a × read as "boot yourself".
            <input
              aria-label="Your name"
              defaultValue={p.name}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== '' && next !== p.name) onRename(next);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 font-semibold"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
          )}
        </SeatRow>
      ))}
    </LobbyCard>
  );
}
