import type { Letter } from '../../engine/constants';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') as Letter[];

export interface BlankPickerProps {
  onPick(letter: Letter): void;
  onCancel(): void;
}

/** A blank declares its letter on placement. Simple modal grid of A–Z. */
export function BlankPicker({ onPick, onCancel }: BlankPickerProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="Choose a letter for the blank"
        className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <p className="mb-3 text-center text-sm font-semibold">Blank tile — which letter?</p>
        <div className="grid grid-cols-6 gap-1">
          {LETTERS.map((letter) => (
            <button
              key={letter}
              type="button"
              onClick={() => { onPick(letter); }}
              className="aspect-square rounded border border-amber-300 bg-amber-100 text-lg font-bold text-amber-950 hover:bg-amber-200"
            >
              {letter}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="m-0 mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
