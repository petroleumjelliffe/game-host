import { PLAYER_EMOJI } from '../../engine/constants';

/**
 * The face a seat gets. Derived, never invented: the engine's
 * `PLAYER_EMOJI` is assigned by seat index, so the lobby can show it early.
 * Null past the end of the table — and null when there is no seat yet.
 */
export function seatEmoji(seat: number | null): string | null {
  return seat === null ? null : PLAYER_EMOJI[seat] ?? null;
}
