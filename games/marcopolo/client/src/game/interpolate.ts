// Snapshots arrive ~every 50ms; frames render every ~16ms. Draw 100ms in the
// past, lerped between the two snapshots that bracket that moment — smooth,
// and never extrapolating a player through a wall of their future.

import type { SnapshotPlayer } from '../../../protocol/game';

const DELAY_MS = 100;

type Frame = { at: number; pos: Map<string, { x: number; y: number }> };

function toFrame(players: SnapshotPlayer[], at: number): Frame {
  const pos = new Map<string, { x: number; y: number }>();
  for (const p of players) {
    if (typeof p.x === 'number' && typeof p.y === 'number') pos.set(p.id, { x: p.x, y: p.y });
  }
  return { at, pos };
}

export class SnapshotBuffer {
  private prev: Frame | null = null;
  private next: Frame | null = null;

  push(players: SnapshotPlayer[], at: number): void {
    this.prev = this.next;
    this.next = toFrame(players, at);
  }

  at(now: number): Map<string, { x: number; y: number }> {
    if (!this.next) return new Map();
    if (!this.prev) return this.next.pos;
    const t = now - DELAY_MS;
    const span = this.next.at - this.prev.at;
    const alpha = span <= 0 ? 1 : Math.min(1, Math.max(0, (t - this.prev.at) / span));
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, b] of this.next.pos) {
      const a = this.prev.pos.get(id) ?? b;
      out.set(id, { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha });
    }
    return out;
  }
}
