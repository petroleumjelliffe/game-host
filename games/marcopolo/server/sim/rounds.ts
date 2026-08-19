// Round bookkeeping that is not physics: who is Marco next, who scored.

export function pickNextMarco(
  playerIds: readonly string[],
  lastMarcoRound: Record<string, number>,
  rng: () => number = Math.random,
): string {
  let waited: string[] = [];
  let best = Infinity;
  for (const id of playerIds) {
    const round = lastMarcoRound[id] ?? 0;
    if (round < best) {
      best = round;
      waited = [id];
    } else if (round === best) {
      waited.push(id);
    }
  }
  return waited[Math.floor(rng() * waited.length)]!;
}

export function survivors(poloIds: readonly string[], caughtId: string | null): string[] {
  return poloIds.filter((id) => id !== caughtId);
}
