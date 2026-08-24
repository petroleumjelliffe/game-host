import type { ReactNode } from 'react';
import type { FlapChar } from './drum';
import type { Row } from './types';
import { TOKENS } from '../game/tokens';

/**
 * Exported so the layout-budget test derives its expectations from the same
 * numbers the row is built with, rather than restating them.
 *
 * These are the design's own column widths, and they are self-consistent
 * only at a 27px tile: five columns, five gaps and the row's padding come
 * to 1301px inside a 1304px board. `TOKENS.tileWidth` is 30, which the old
 * three-column row could afford in a 436px destination and this five-column
 * one cannot — 14 tiles at 30px overflow the 406px column by 27px.
 */
export const BOARD_COLUMN_WIDTHS = {
  chip: 22, label: 168, status: 170, destination: 406, amount: 219, right: 178
} as const;

/** The dollar label in front of the payout tiles. Holds its width whether or
 *  not it is showing, so the tiles do not shift when it arrives. */
export const DOLLAR_WIDTH = 16;

export const BOARD_TILE = {
  width: 27,
  /** The payout carries fewer, wider tiles than the destination — the design's own sizes. */
  amountWidth: 30,
  height: 40,
  /** Each leaf is a 19px window; the 2px between them is the black gap showing through. */
  leafHeight: 19,
  gap: 1,
  columnGap: 22,
  rowPadding: 14,
  /** The board's inner width: 1400 less its 14px bezel and 34px padding. */
  rowWidth: 1304
} as const;

export interface BoardRowProps {
  row: Row;
  /** The destination column's tiles, mid-flap or settled. */
  faces: FlapChar[];
  /** The region panel's single face — a whole word, not a letter. */
  status: FlapChar[];
  /** The payout's tiles. Rendered as plain text, so only the top halves show. */
  amount: FlapChar[];
  /** Whether the payout has landed. The `$` and the HOME note wait for it. */
  amountSettled: boolean;
  onAct: () => void;
  /**
   * Rendered in the destination column in place of the tiles. The rest of
   * the row — chip, seat label, state and note — stays put, so typing a
   * name happens *in* the board rather than replacing a row of it.
   */
  input?: ReactNode;
}

/**
 * A panel is the same flap at a different size: one leaf-pair carrying a
 * whole word rather than a single character. Region names and the train note
 * are labels, not fixed-width character grids.
 */
function Panel({ face, width }: { face: FlapChar; width: number }) {
  return <Leaf face={face} width={width} fontSize={17} colour={TOKENS.pale} align="left" />;
}

/**
 * One physical flap: two leaves over a black gap.
 *
 * The top leaf carries the character arriving, the bottom leaf the one being
 * left behind, and each is a 19px window onto a full-height line of text —
 * the bottom one offset upwards so its own lower half shows through. On the
 * tick a tile lands the two disagree, which is the flap; a tick later they
 * meet. Rendering only the arriving character collapses that into a
 * character that simply changes.
 */
function Leaf(
  { face, width, fontSize, colour, align }: {
    face: FlapChar; width: number; fontSize: number; colour: string; align: 'center' | 'left';
  }
) {
  const line = {
    height: BOARD_TILE.height,
    lineHeight: `${BOARD_TILE.height}px`,
    textAlign: align,
    whiteSpace: 'nowrap' as const,
    paddingLeft: align === 'left' ? 11 : 0,
    boxSizing: 'border-box' as const,
    fontSize,
    color: colour,
    ...(align === 'left'
      ? { letterSpacing: '0.02em', textTransform: 'uppercase' as const }
      : {})
  };
  const half = {
    position: 'absolute' as const,
    left: 0,
    width,
    height: BOARD_TILE.leafHeight,
    overflow: 'hidden' as const,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)'
  };
  return (
    <span
      data-flap={face.top}
      aria-hidden="true"
      style={{
        position: 'relative', display: 'inline-block', width, height: BOARD_TILE.height,
        borderRadius: 3, background: '#000', verticalAlign: 'top', overflow: 'hidden'
      }}
    >
      {/* aria-hidden on the leaves themselves, not only on the tile: the
          value a panel carries is a whole word, so without it every panel
          would offer its text twice to anything reading the page — once per
          leaf — beside the copy that is actually meant to be read. */}
      <span style={{ ...half, top: 0, background: TOKENS.flapTop }} aria-hidden="true">
        <span aria-hidden="true" style={{ display: 'block', ...line }}>{blank(face.top)}</span>
      </span>
      <span style={{ ...half, bottom: 0, background: TOKENS.flapBottom }} aria-hidden="true">
        <span
          aria-hidden="true"
          style={{ display: 'block', ...line, marginTop: -(BOARD_TILE.height - BOARD_TILE.leafHeight) }}
        >
          {blank(face.bottom)}
        </span>
      </span>
    </span>
  );
}

const blank = (character: string) => (character === ' ' ? '\u00a0' : character);

/**
 * A strip of flaps, one per character. The destination and the payout are
 * both these — same leaves, same gap — so the payout turns like part of the
 * board rather than like a number that changed.
 */
function Tiles(
  { faces, colour, fontSize, width }: {
    faces: FlapChar[]; colour: string; fontSize: number; width: number;
  }
) {
  return (
    <>
      {faces.map((face, index) => (
        <span key={index} style={{ marginLeft: index === 0 ? 0 : BOARD_TILE.gap }}>
          <Leaf face={face} width={width} fontSize={fontSize} colour={colour} align="center" />
        </span>
      ))}
    </>
  );
}

export function BoardRow({
  row, faces, status, amount, amountSettled, onAct, input
}: BoardRowProps) {
  // Both columns read only the arriving half. The destination column shows a
  // physical flap with two halves; these two are printed text on a panel, and
  // a panel does not have a leading edge to show mid-turn.
  // Both halves of the panel, so it flips like every other field.
  const statusFace = status[0] ?? { top: '', bottom: '' };
  const amountFace = amount.map(face => face.top).join('').trimEnd();
  const interactive = row.action !== null && row.tone !== 'disabled' && input === undefined;
  const colour =
    row.tone === 'disabled' ? '#4a463e'
      : row.tone === 'dim' ? TOKENS.dim
      : row.tone === 'active' ? TOKENS.amber
      : TOKENS.pale;

  const body = (
    <>
      <span
        aria-hidden="true"
        style={{
          // Proportional, not the design's flat 74px. The design's board is
          // a fixed 788px tall, giving ~92px rows and a 9px gap above each
          // chip; ours is fluid, and on a short viewport a 74px chip exactly
          // fills a 74px row, fusing every seat colour into one stripe.
          // 80% holds the design's ratio at any height. Measured, not guessed.
          width: BOARD_COLUMN_WIDTHS.chip, height: '80%',
          flex: `0 0 ${BOARD_COLUMN_WIDTHS.chip}px`, borderRadius: 2,
          background: row.chip ?? '#141414',
          // The active row's chip rings in amber — the departures-board way
          // of saying "this line is boarding". Everyone else keeps the faint
          // white keyline.
          boxShadow: row.chip
            ? (row.tone === 'active'
              ? `0 0 0 2px ${TOKENS.amber}`
              : '0 0 0 2px rgba(255,255,255,0.14)')
            : 'inset 0 0 0 1px #2c2c2c'
        }}
      />
      <span
        style={{
          width: BOARD_COLUMN_WIDTHS.label, flex: `0 0 ${BOARD_COLUMN_WIDTHS.label}px`,
          fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: TOKENS.dim, whiteSpace: 'nowrap', overflow: 'hidden'
        }}
      >
        {row.label.toUpperCase()}
      </span>
      <span
        data-column="status"
        style={{ width: BOARD_COLUMN_WIDTHS.status, flex: `0 0 ${BOARD_COLUMN_WIDTHS.status}px` }}
      >
        <Panel face={statusFace} width={BOARD_COLUMN_WIDTHS.status - 2} />
      </span>
      <span
        data-column="destination"
        style={{
          width: BOARD_COLUMN_WIDTHS.destination,
          flex: `0 0 ${BOARD_COLUMN_WIDTHS.destination}px`,
          whiteSpace: 'nowrap'
        }}
      >
        {input !== undefined ? input : <>
        {/* The accessible copy carries the destination throughout a flap.
            Reading the drum instead would narrate two seconds of noise.
            Natural case, not the flaps' upper case: some screen readers
            spell out an all-caps word letter by letter. */}
        <span
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
        >
          {row.text}
        </span>
        <Tiles faces={faces} colour={colour} fontSize={29} width={BOARD_TILE.width} />
        </>}
      </span>
      <span
        data-column="amount"
        style={{
          width: BOARD_COLUMN_WIDTHS.amount, flex: `0 0 ${BOARD_COLUMN_WIDTHS.amount}px`,
          whiteSpace: 'nowrap'
        }}
      >
        {/* Read out as one figure rather than as seven tiles, and silent
            until it lands: a screen reader should not be told a payout the
            board is still withholding. */}
        <span
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
        >
          {amountSettled ? amountFace : ''}
        </span>
        {/* Printed on the board, not a flap. It never turns, never arrives
            and never leaves: it is amber on a row that is in play and dim on
            one that is not, and nothing a roll does can change it. Tying it
            to the payout made it vanish mid-roll, which is both wrong for a
            printed label and a tell — a sign that comes and goes says
            something about the figure beside it before the figure has
            landed. */}
        <span
          data-dollar={row.showDollar ? '' : undefined}
          aria-hidden="true"
          style={{
            display: 'inline-block', width: DOLLAR_WIDTH, fontSize: 27,
            lineHeight: `${BOARD_TILE.height}px`, verticalAlign: 'top',
            color: TOKENS.amber,
            // Reserved on every row so the tiles line up down the board, but
            // only inked where this column is money. The menu screens borrow
            // it for a player count, and a dollar sign in front of "2-6" is
            // a different claim entirely.
            visibility: row.showDollar ? 'visible' : 'hidden'
          }}
        >
          $
        </span>
        <Tiles faces={amount} colour={TOKENS.amber} fontSize={31} width={BOARD_TILE.amountWidth} />
      </span>
      <span
        data-column="right"
        style={{ width: BOARD_COLUMN_WIDTHS.right, flex: `0 0 ${BOARD_COLUMN_WIDTHS.right}px` }}
      >
        {/* The leaves are decoration; this is the note itself. It arrives with
            the payout, so a screen reader is not told HOME while the board is
            still turning toward it. */}
        <span
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
        >
          {row.right}
        </span>
        <Panel face={{ top: row.right, bottom: row.right }} width={BOARD_COLUMN_WIDTHS.right - 2} />
      </span>
    </>
  );

  const shared = {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: BOARD_TILE.columnGap,
    flex: 1,
    width: '100%',
    padding: `0 ${BOARD_TILE.rowPadding}px`,
    boxSizing: 'border-box' as const,
    borderBottom: `1px solid ${TOKENS.rule}`,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left' as const
  };

  if (row.action === null) return <div style={shared}>{body}</div>;

  return (
    <button
      type="button"
      onClick={() => { if (interactive) onAct(); }}
      aria-disabled={!interactive}
      style={{ ...shared, border: 0, cursor: interactive ? 'pointer' : 'default' }}
    >
      {body}
    </button>
  );
}
