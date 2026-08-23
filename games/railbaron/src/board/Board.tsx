import { useEffect, useMemo } from 'react';
import { BoardRow, BOARD_COLUMN_WIDTHS, BOARD_TILE } from './BoardRow';
import { DiceReadout } from './DiceReadout';
import { RowInput } from './RowInput';
import { useFlap } from './useFlap';
import { padRows, type FieldId, type Row, type ScreenDef } from './types';
import { TOKENS } from '../game/tokens';

export interface BoardProps {
  screen: ScreenDef;
  onRowAct: (row: Row, index: number) => void;
  onBack: () => void;
  /**
   * Fires once the region panel on this row has finished turning. The board
   * is the only thing that knows when that is, and a roll may not reach the
   * log until it has — see `roll` in useGame.
   */
  awaitRegion?: { row: number; onLanded: () => void } | null;
  /** Fires once the dice have finished turning — the gate, as `awaitRegion` is. */
  awaitDice?: { onLanded: () => void } | null;
  onRollDice?: () => void;
  /**
   * The row currently being typed into, named by the same `FieldId` its action
   * carries — not by seat.
   *
   * It used to be a `SeatId`, and the row was found by rebuilding the field id
   * as `seat:${seat}`. That silently could not express the one field that is
   * not a seat: the join board's room code matched no row, so no input was
   * ever rendered, and because every step of that is a no-op rather than a
   * throw, the screen simply did nothing and said nothing.
   *
   * `initial` is supplied rather than read off the row's display text, so the
   * input is seeded with the real underlying value instead of whatever prompt
   * the row happens to be showing.
   */
  editing?: { field: FieldId; placeholder: string; initial: string } | null;
  onCommit?: (value: string) => void;
  onCancel?: () => void;
}

export function Board({
  screen, onRowAct, onBack, awaitRegion = null, awaitDice = null, onRollDice,
  editing = null, onCommit, onCancel
}: BoardProps) {
  const rows = useMemo(() => padRows(screen.rows), [screen.rows]);
  const texts = useMemo(
    () => rows.map(row =>
      ({ status: row.status, text: row.text, amount: row.amount, turn: row.turn ?? 0 })),
    [rows]
  );
  const { rows: faces, settled, flapping, snap } = useFlap(texts, screen.panel);

  // Reported from an effect rather than during render: the caller's handler
  // appends to the event log, and a render that writes state is a render that
  // runs twice under StrictMode and rolls twice.
  const landed = awaitRegion !== null && settled[awaitRegion.row]?.status === true;
  const onLanded = awaitRegion?.onLanded;
  useEffect(() => {
    if (landed && onLanded) onLanded();
  }, [landed, onLanded]);

  const headings = [
    BOARD_COLUMN_WIDTHS.label,
    BOARD_COLUMN_WIDTHS.status,
    BOARD_COLUMN_WIDTHS.destination,
    BOARD_COLUMN_WIDTHS.amount,
    BOARD_COLUMN_WIDTHS.right
  ];

  return (
    <div
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: TOKENS.board, border: `14px solid ${TOKENS.bezel}`,
        boxShadow: 'inset 0 0 0 1px #262626'
      }}
    >
      <header
        style={{
          flex: '0 0 78px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 34px', position: 'relative',
          background: TOKENS.header, borderBottom: '1px solid #2a2a2a'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <span
            style={{
              fontSize: 30, fontWeight: 700, letterSpacing: '0.22em',
              color: TOKENS.amber, textTransform: 'uppercase'
            }}
          >
            Rail Baron
          </span>
          <span
            style={{
              fontSize: 12, letterSpacing: '0.22em', color: TOKENS.dim,
              textTransform: 'uppercase'
            }}
          >
            {screen.title}
          </span>
        </span>
        <span
          style={{
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
            letterSpacing: '0.18em', color: TOKENS.dim
          }}
        >
          <span>{screen.sub}</span>
          {screen.back !== null && (
            <button
              type="button"
              onClick={onBack}
              style={{
                cursor: 'pointer', color: TOKENS.dim, background: 'transparent',
                border: '1px solid #2a2a2a', borderRadius: 3, padding: '8px 12px',
                font: 'inherit', letterSpacing: 'inherit'
              }}
            >
              BACK
            </button>
          )}
        </span>
        {screen.dice && (
          <DiceReadout
            roll={screen.dice.roll}
            live={screen.dice.live}
            highlight={screen.dice.live && screen.dice.mine}
            onRoll={onRollDice}
            onLanded={awaitDice?.onLanded}
          />
        )}
      </header>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: BOARD_TILE.columnGap,
          padding: `16px ${34 + BOARD_TILE.rowPadding}px 10px`, fontSize: 11,
          letterSpacing: '0.24em', textTransform: 'uppercase', color: '#7d7669'
        }}
      >
        <span style={{ flex: `0 0 ${BOARD_COLUMN_WIDTHS.chip}px` }} />
        {screen.cols.map((heading, index) => (
          <span key={index} style={{ flex: `0 0 ${headings[index]}px` }}>{heading}</span>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 34px 20px' }}>
        {rows.map((row, index) => {
          const isEditing =
            editing !== null &&
            row.action?.kind === 'edit' &&
            row.action.field === editing.field;

          return (
            <div key={index} data-board-row="" style={{ display: 'flex', flex: 1 }}>
              <BoardRow
                // The HOME note lands with the payout it stands in for.
                row={{ ...row, right: settled[index]?.amount === false ? '' : row.right }}
                faces={faces[index]?.text ?? []}
                status={faces[index]?.status ?? []}
                amount={faces[index]?.amount ?? []}
                amountSettled={settled[index]?.amount ?? true}
                input={isEditing ? (
                  <RowInput
                    initial={editing.initial}
                    placeholder={editing.placeholder}
                    onCommit={value => onCommit?.(value)}
                    onCancel={() => onCancel?.()}
                  />
                ) : undefined}
                onAct={() => {
                  // A tap during a flap finishes it rather than being
                  // ignored: an inert menu is a worse trade than a
                  // cut-short animation.
                  if (flapping) snap();
                  onRowAct(row, index);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
