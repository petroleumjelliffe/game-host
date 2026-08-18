// Small shared answers for the painters and the HUD. Everything here is pure
// (or a tiny deterministic accumulator) because jsdom has no canvas: this is
// the layer where the drawing code's arithmetic can actually be tested.

export interface PoolLayout {
  /** Side of the square the arena circle inscribes, in CSS px. */
  size: number;
  offsetX: number;
  offsetY: number;
}

/**
 * The tiles run full-bleed, but the arena is still a circle of radius 1 — so
 * the play area is the largest centered square, and the water outside it is
 * scenery the swimmers can never reach.
 */
export function poolLayout(viewWidth: number, viewHeight: number): PoolLayout {
  const size = Math.min(viewWidth, viewHeight);
  return { size, offsetX: (viewWidth - size) / 2, offsetY: (viewHeight - size) / 2 };
}

/** `1:14`, as the design's clock reads. Never negative. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function segmentsLit(fraction: number, count: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * count);
}

/**
 * Marco's phone reports the cooldown as "seconds until ready"; the design
 * shows the same fact the other way round — how long since the last shout.
 */
export function lastCallLabel(cooldown: number | null, total: number): string {
  if (cooldown === null || cooldown <= 0) return 'CALL READY';
  // The cooldown and the total it is measured against arrive from different
  // places and can disagree; a negative age in front of a player is worse
  // than a zero.
  return `LAST CALL ${Math.max(0, Math.round(total - cooldown))}s AGO`;
}

const BOB_MS = 2400;

/** −1…1. `seed` staggers seats so the pool does not bob as one body. */
export function bobOffset(nowMs: number, seed: number): number {
  return Math.sin((nowMs / BOB_MS) * Math.PI * 2 + seed * 1.7);
}

export interface Heading {
  x: number;
  y: number;
}

/** How fast the head swings round to a new direction of travel. */
const TURN = 0.18;
/** Below this per-frame movement a swimmer counts as drifting, not steering. */
const MOVED = 1e-4;

/**
 * The emoji head leads the ring, so it needs a direction the snapshots do not
 * carry. Differencing the interpolated positions gives one; smoothing it stops
 * the head snapping around on a jittery frame.
 */
export class HeadingTracker {
  private last = new Map<string, { x: number; y: number }>();
  private dir = new Map<string, Heading>();

  update(id: string, x: number, y: number): Heading {
    const prev = this.last.get(id);
    this.last.set(id, { x, y });
    const dir = this.dir.get(id) ?? { x: 1, y: 0 };
    if (!prev) {
      this.dir.set(id, dir);
      return dir;
    }
    const dx = x - prev.x;
    const dy = y - prev.y;
    const mag = Math.hypot(dx, dy);
    if (mag < MOVED) return dir;
    const nx = dir.x + (dx / mag - dir.x) * TURN;
    const ny = dir.y + (dy / mag - dir.y) * TURN;
    const norm = Math.hypot(nx, ny) || 1;
    const next = { x: nx / norm, y: ny / norm };
    this.dir.set(id, next);
    return next;
  }

  /** Drop players who are no longer in the snapshot. */
  retain(ids: Set<string>): void {
    for (const id of [...this.last.keys()]) {
      if (!ids.has(id)) {
        this.last.delete(id);
        this.dir.delete(id);
      }
    }
  }
}
