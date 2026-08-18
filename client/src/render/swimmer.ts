// One swimmer: a thick colored ring at the true collision radius, and an emoji
// head that leads it by about a body length and bobs. The ring's stroke sits
// outside the radius, which is why a swimmer reads bigger than they catch.

import { bobOffset, type Heading } from './scene';

export interface SwimmerOpts {
  x: number;
  y: number;
  /** Collision radius in CSS px. */
  radius: number;
  color: string;
  emoji: string;
  heading: Heading;
  nowMs: number;
  /** Staggers the bob between seats. */
  seed: number;
  /** Marco's own view is nearly extinguished; their ring goes with it. */
  dimmed?: boolean;
}

export function drawSwimmer(ctx: CanvasRenderingContext2D, o: SwimmerOpts): void {
  const stroke = Math.max(3, o.radius * 0.7);
  ctx.save();
  ctx.shadowColor = 'rgba(6,40,70,0.26)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.strokeStyle = o.dimmed ? 'rgba(111,147,180,0.9)' : o.color;
  ctx.lineWidth = stroke;
  ctx.beginPath();
  ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Ring, head and lead are all pinned to the collision radius so a swimmer's
  // drawn size never lies about what it can catch. The ratios come from the
  // design's own artboards, where a 52px ring carries a 24px head 32px ahead.
  const lead = o.radius * 1.63;
  const hx = o.x + o.heading.x * lead;
  const hy = o.y + o.heading.y * lead + bobOffset(o.nowMs, o.seed) * o.radius * 0.22;
  const size = Math.round(o.radius * 1.26);
  ctx.save();
  ctx.translate(hx, hy);
  // The creature glyphs face left; flip them when swimming right.
  if (o.heading.x > 0) ctx.scale(-1, 1);
  if (o.dimmed) ctx.globalAlpha = 0.85;
  ctx.font = `${size}px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(o.emoji, 0, 0);
  ctx.restore();
}
