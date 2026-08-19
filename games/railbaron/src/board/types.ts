import type { TurnRoll } from '../../engine';
import type { SeatId } from '../state/events';

/**
 * Every screen the board can show, plus `map` — which the board cannot show.
 * The map is a lit cabinet, not seven rows of flaps, so it renders instead of
 * the Board rather than through it. It is named here anyway because a row has
 * to be able to navigate to it, and a second navigation vocabulary for one
 * destination would cost more than this note does.
 */
export type ScreenId =
  | 'home' | 'passAndPlay' | 'saved' | 'confirm' | 'play' | 'regionBallot' | 'homes' | 'map'
  /**
   * Online. There is no id for "create a room": creating one seats you in it
   * immediately (the Lobby Flow correction), so NEW ROOM is an action, not a
   * screen you can be on.
   */
  | 'onlineLobby' | 'joinRoom';

/** What an editable row is editing. Seat names, and the room code to join. */
export type FieldId = `seat:${SeatId}` | 'roomCode';

export type RowAction =
  | { kind: 'navigate'; to: ScreenId }
  | { kind: 'edit'; field: FieldId; placeholder: string }
  | { kind: 'act'; seat: SeatId }
  /** Roll for who goes first. One row, once per game, so it carries no payload. */
  | { kind: 'order' }
  | { kind: 'undo' }
  /** Open a room and take the first seat in it, in one step. */
  | { kind: 'createRoom' }
  /** Join the room whose code has been typed. */
  | { kind: 'joinRoom' }
  /** Put the room's URL on the clipboard, for sending to the other players. */
  | { kind: 'share' }
  /** The host starts the game. */
  | { kind: 'begin' }
  /** Give up your seat and go home. Lobby-only; mid-game leaving is a drop. */
  | { kind: 'leave' }
  | null;

/**
 * One of seven. The action is a union rather than independent `go`, `edit`
 * and `disabled` fields, because those can contradict one another — a row
 * carrying both a destination and an edit target, or disabled alongside a
 * live action — and this cannot.
 */
export interface Row {
  /**
   * Which announcement this row is showing. It is not displayed anywhere.
   *
   * The board animates when what a row says changes — which cannot express
   * the case that matters most here: a baron rolling the region they are
   * already in. Nothing changes, so nothing turns, so the board sits still
   * and the stillness itself is the answer. Stamping the row makes the roll,
   * not the text, the thing that starts the flap, so the same region and a
   * new one are indistinguishable while the panel is moving.
   *
   * Only the in-play screen sets it; everywhere else a row has nothing to
   * announce and leaves it alone.
   */
  turn?: number;
  label: string;
  status: string;
  text: string;
  amount: string;
  showDollar: boolean;
  right: string;
  chip: string | null;
  tone: 'normal' | 'dim' | 'disabled';
  action: RowAction;
}

export interface ScreenDef {
  title: string;
  sub: string;
  back: ScreenId | null;
  cols: [string, string, string, string, string];
  rows: Row[];
  /**
   * Everything this screen's status panel is allowed to say, whether or not a
   * row is saying it. The panel turns through this on its way to the value it
   * lands on, which is what makes a roll suspenseful rather than announced:
   * without it the ring holds only the values already on the board, and the
   * first roll of a game has none.
   *
   * Optional because a screen whose panel never turns has no vocabulary to
   * declare — the values on its rows are the whole of it.
   */
  panel?: readonly string[];
  /**
   * The dice this screen shows. There is one pair on the table and everyone
   * uses it, so this belongs to the screen rather than to a row.
   */
  dice?: { roll: TurnRoll | null; live: boolean } | null;
}

/** The board is this many rows on every screen, without exception. */
export const BOARD_ROWS = 7;

export function blankRow(): Row {
  return {
    label: '', status: '', text: '', amount: '', showDollar: false,
    right: '', chip: null, tone: 'dim', action: null
  };
}

/**
 * Truncating as well as padding. A screen that defines more than seven rows
 * is a design bug, and dropping the overflow here makes it show up as a
 * missing row rather than a board that silently changes height.
 */
export function padRows(rows: readonly Row[]): Row[] {
  const out = rows.slice(0, BOARD_ROWS);
  while (out.length < BOARD_ROWS) out.push(blankRow());
  return out;
}
