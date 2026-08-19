/**
 * The dice, as the departures-board design draws them.
 *
 * Every measurement and colour here is copied from `Departures Board.dc.html`
 * in the Rail Baron Game Board Design project. Change them there first.
 */

/** Which of the nine cells a face lights. */
export const PIPS: Record<number, readonly number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

/**
 * Nine cells, of which the lit ones carry the colour. The rest are
 * transparent rather than painted the leaf's colour: a leaf mid-fall is two
 * different backgrounds, and a hardcoded unlit colour shows the seam.
 */
export function pipCells(value: number, color: string): { bg: string }[] {
  const on = PIPS[value] ?? [];
  return Array.from({ length: 9 }, (_, cell) =>
    ({ bg: on.includes(cell) ? color : 'transparent' }));
}

export const DIE = {
  width: 54,
  height: 56,
  leafHeight: 27,
  radius: 7,
  gap: 11,
  padding: 9,
  pipGap: 4,
  /** The bottom leaf's grid is pushed up so the two halves read as one die. */
  bottomOffset: -29
} as const;

export const COLORS = {
  whiteTop: '#efece2',
  whiteBottom: '#e5e1d5',
  whitePip: '#141210',
  bonusLeaf: '#c9261a',
  bonusBlank: '#0c0c0c',
  bonusPip: '#fdf3e6',
  body: '#000'
} as const;

/** A die's own tick, slower than the board's 52ms — these are heavier leaves. */
export const DICE_MS = 78;

/*
 * The bonus drum used to hold a beat here — the design's 300ms of stillness
 * after the whites landed, so the bonus die was announced as its own thing
 * rather than as a third white. The Bonus Roll is now taken after the white
 * movement has been walked, which separates the two by a whole leg of the
 * turn; a pause measured in ticks has nothing left to add to that, so the
 * constant and the drum machinery that honoured it are both gone.
 */

export const WHITE_FACES = 6;
/** Blank, then 1-6. The blank is the slot a Freight sees empty every turn. */
export const BONUS_FACES = 7;

/**
 * How many ticks a drum turns. `lap` adds a full revolution, so a die that
 * lands on the face it already showed is still visibly rolled — without it a
 * repeated six would sit there and read as a die that was never thrown.
 */
export const dieTurn = (from: number, to: number, faces: number, lap: boolean): number =>
  ((to - from + faces) % faces) + (lap ? faces : 0);
