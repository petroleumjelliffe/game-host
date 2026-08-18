// Every player owns a creature and a ring color, derived from their seat the
// way the lobby intends decoration to be derived (`p1`…`p8` → index). Marco
// wears the shark whoever they are — the role has to be readable across the
// pool — but keeps their own color, so the swap is legible after a catch.
// Ring colors are the design's, in the design's order.

const RINGS = [
  '#6f93b4', '#5d9c62', '#ec87a9', '#b98fd6',
  '#8fa6b8', '#f0a04a', '#e8d36a', '#9fc4e0',
] as const;

const CREATURES = ['🐬', '🐢', '🦩', '🐙', '🦭', '🐠', '🦆', '🐡'] as const;

export const MARCO_EMOJI = '🦈';

function seatIndex(playerId: string): number {
  const n = Number.parseInt(playerId.slice(1), 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return (n - 1) % RINGS.length;
}

export function creatureFor(playerId: string, isMarco: boolean): string {
  return isMarco ? MARCO_EMOJI : CREATURES[seatIndex(playerId)]!;
}

export function playerColor(playerId: string): string {
  return RINGS[seatIndex(playerId)]!;
}

export function playerRgba(playerId: string, alpha: number): string {
  const hex = playerColor(playerId);
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
