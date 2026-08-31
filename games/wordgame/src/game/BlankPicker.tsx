import type { Letter } from '../../engine/constants';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') as Letter[];

export interface BlankPickerProps {
  onPick(letter: Letter): void;
  onCancel(): void;
}

/** A blank declares its letter on placement: a sheet of tile-styled buttons,
 * seven per row like the rack itself. */
export function BlankPicker({ onPick, onCancel }: BlankPickerProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="Choose a letter for the blank"
        className="flex w-full max-w-sm flex-col gap-2.5 rounded-2xl bg-paper p-3.5 shadow-2xl"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <p className="text-center text-[15px] font-bold text-ink">Blank tile — choose its letter</p>
        <div className="grid grid-cols-7 gap-1.5">
          {LETTERS.map((letter) => (
            <button
              key={letter}
              type="button"
              onClick={() => { onPick(letter); }}
              className="h-9 rounded bg-tile font-tile text-base font-bold text-tile-ink"
              style={{ boxShadow: 'inset 0 -2px 0 #d9bf8a, 0 1px 2px rgba(0,0,0,.18)' }}
            >
              {letter}
            </button>
          ))}
        </div>
        <p className="text-center text-[11.5px] text-ink-faint">
          Worth 0 points — shown lowercase on the board
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="m-0 rounded-lg border border-line-strong bg-white px-3 py-2 text-center text-sm font-semibold text-ink-soft"
        >
          Cancel — back to rack
        </button>
      </div>
    </div>
  );
}
