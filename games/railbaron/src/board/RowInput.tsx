import { useState } from 'react';
import { BOARD_COLUMN_WIDTHS, BOARD_TILE } from './BoardRow';
import { TOKENS } from '../game/tokens';
import { FLAP_WIDTH } from './alphabet';

export interface RowInputProps {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Replaces the destination plate in place. Enter commits, Escape abandons,
 * blur commits — the three ways the source design behaves.
 *
 * This is what retired `window.prompt`, and with it the StrictMode
 * double-fire hazard: a prompt inside a state updater fires twice for one
 * tap, because React deliberately invokes updaters twice to catch impure
 * ones.
 */
export function RowInput({ initial, placeholder, onCommit, onCancel }: RowInputProps) {
  const [draft, setDraft] = useState(initial);

  return (
    <input
      autoFocus
      maxLength={FLAP_WIDTH}
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => onCommit(draft.trim().toUpperCase())}
      onKeyDown={event => {
        if (event.key === 'Enter') onCommit(draft.trim().toUpperCase());
        if (event.key === 'Escape') onCancel();
      }}
      style={{
        width: BOARD_COLUMN_WIDTHS.destination - 2,
        height: BOARD_TILE.height,
        boxSizing: 'border-box',
        padding: '0 12px',
        border: 0,
        borderRadius: 3,
        outline: `2px solid ${TOKENS.amber}`,
        outlineOffset: -2,
        background: '#232323',
        font: 'inherit',
        fontSize: 27,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: TOKENS.amber
      }}
    />
  );
}
