import { MAX_PLAYERS, PLAYER_EMOJI } from '../../../engine/startups';
import { SeatRow } from './SeatRow';

/**
 * The 2–6 seat roster, shared by design between pass-and-play and (from
 * Phase 5) the online waiting room. It knows nothing about transport: no room
 * codes, no host, no sockets. That separation is the entire point — the two
 * setup screens forked historically, and only the roster was ever common.
 */
export interface Seat {
  name: string;
}

export interface PlayerRosterProps {
  seats: Seat[];
  onChange: (seats: Seat[]) => void;
  minSeats?: number;
  maxSeats?: number;
}

/** Seat avatars come from the engine's fixed six, by index. */
export function avatarFor(index: number): string {
  return PLAYER_EMOJI[index % PLAYER_EMOJI.length]!; // wrapped index into a non-empty list
}

export function PlayerRoster({
  seats,
  onChange,
  minSeats = 2,
  // The rule, not the emoji list's length: emoji are decoration and are
  // meant to grow into a larger selectable set, which must not quietly
  // change how many people can sit down.
  maxSeats = MAX_PLAYERS,
}: PlayerRosterProps) {
  const canAdd = seats.length < maxSeats;
  const canRemove = seats.length > minSeats;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {seats.map((seat, i) => (
          <SeatRow
            key={i}
            avatar={avatarFor(i)}
            name={seat.name}
            canRemove={canRemove}
            onNameChange={(name) =>
              onChange(seats.map((s, j) => (j === i ? { ...s, name } : s)))
            }
            onRemove={() => onChange(seats.filter((_, j) => j !== i))}
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...seats, { name: `Player ${seats.length + 1}` }])}
        disabled={!canAdd}
        className="m-0 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Add player
      </button>
    </div>
  );
}
