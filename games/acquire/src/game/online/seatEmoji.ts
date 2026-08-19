import { PLAYER_EMOJI } from '../../../engine/startups';

/**
 * The face the game is about to give a seat. Derived, never invented: the
 * engine assigns `PLAYER_EMOJI` by seat index at game start, so the lobby can
 * show it early. Null past the end of the table — and null when there is no
 * seat yet, which is every row on the Join card.
 */
export function seatEmoji(seat: number | null): string | null {
  return seat === null ? null : PLAYER_EMOJI[seat] ?? null;
}
