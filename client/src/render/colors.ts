// Every player owns a color, derived from their seat the way the lobby
// intends decoration to be derived (`p1`…`p8` → palette index) — like
// voices, you learn to tell them apart with your eyes closed. Ripples,
// avatars, labels, and scoreboard chips all read from here.

/** Eight distinguishable hues on dark water, one per seat. */
const PALETTE: readonly [number, number, number][] = [
  [255, 209, 102], // p1 amber
  [110, 198, 255], // p2 sky
  [255, 143, 163], // p3 pink
  [159, 242, 161], // p4 mint
  [201, 167, 255], // p5 violet
  [255, 171, 112], // p6 orange
  [111, 227, 212], // p7 teal
  [242, 242, 122], // p8 lime
];

function triplet(playerId: string): [number, number, number] {
  const index = Number(playerId.slice(1)) - 1;
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length] ?? PALETTE[0]!;
}

export function playerColor(playerId: string): string {
  const [r, g, b] = triplet(playerId);
  return `rgb(${r},${g},${b})`;
}

export function playerRgba(playerId: string, alpha: number): string {
  const [r, g, b] = triplet(playerId);
  return `rgba(${r},${g},${b},${alpha})`;
}
