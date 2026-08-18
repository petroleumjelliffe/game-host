// Swimmers drifting in the lobby water. Closed Lissajous loops, one per seat,
// inset inside the pool so nobody clips the deck or the screen edge — the
// design's hand-drawn bezier paths, made procedural and bounded.

import { creatureFor, playerColor } from './creatures';
import type { Heading } from './scene';
import { drawSwimmer } from './swimmer';

export interface IdleBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface IdlePoint {
  x: number;
  y: number;
  heading: Heading;
}

/** Every loop closes on this period, so the pool never jumps. */
export const IDLE_PERIOD_MS = 24000;

// Coprime-ish lobes and a per-seat phase: eight loops that share the water
// without tracing each other.
const LOBES = [
  { a: 1, b: 2 }, { a: 2, b: 1 }, { a: 1, b: 3 }, { a: 3, b: 2 },
  { a: 2, b: 3 }, { a: 3, b: 1 }, { a: 1, b: 1 }, { a: 2, b: 2 },
] as const;

function point(seat: number, b: IdleBounds, ms: number, inset: number) {
  const lobe = LOBES[seat % LOBES.length]!;
  const phase = (seat * Math.PI * 2) / LOBES.length;
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  const rx = Math.max(0, (b.right - b.left) / 2 - inset);
  const ry = Math.max(0, (b.bottom - b.top) / 2 - inset);
  const t = (ms / IDLE_PERIOD_MS) * Math.PI * 2;
  return {
    x: cx + Math.sin(t * lobe.a + phase) * rx,
    y: cy + Math.sin(t * lobe.b + phase * 1.3) * ry,
  };
}

export function idleAt(seat: number, bounds: IdleBounds, ms: number, inset: number): IdlePoint {
  const here = point(seat, bounds, ms, inset);
  const ahead = point(seat, bounds, ms + 120, inset);
  const dx = ahead.x - here.x;
  const dy = ahead.y - here.y;
  const mag = Math.hypot(dx, dy) || 1;
  return { ...here, heading: { x: dx / mag, y: dy / mag } };
}

export interface IdleSwimmer {
  /** Seat index, 0-based — decides the loop, the creature and the color. */
  seat: number;
  /** Seat id when these are real players; used for color and creature. */
  id: string;
  /** A seated player whose phone has dropped: still holding a seat, but gone. */
  asleep?: boolean;
}

/** Paints a pool of drifting swimmers into the 2D layer. */
export function drawIdlePool(
  ctx: CanvasRenderingContext2D,
  swimmers: readonly IdleSwimmer[],
  bounds: IdleBounds,
  nowMs: number,
  radius: number,
): void {
  for (const s of swimmers) {
    const at = idleAt(s.seat, bounds, nowMs, radius * 2.6);
    ctx.save();
    // Still in their seat, still counted, but not really here.
    if (s.asleep) ctx.globalAlpha = 0.35;
    drawSwimmer(ctx, {
      x: at.x,
      y: at.y,
      radius,
      color: playerColor(s.id),
      emoji: creatureFor(s.id, false),
      heading: at.heading,
      nowMs,
      seed: s.seat,
    });
    ctx.restore();
  }
}
