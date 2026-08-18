// One painter for both roles, drawn over the tile floor. The marco view is not
// a client-side secret: polo positions are simply absent from `positions` (the
// server never sent them), so the branches here are styling, not information
// control.

import { TUNING, type StateMessage } from '../../../protocol/game';
import { RIPPLE_MS, SPLASH_MS, type Ripple } from '../game/sessionState';
import { worldScale, worldToScreen } from '../game/camera';
import { creatureFor, playerColor, playerRgba } from './creatures';
import { HeadingTracker, type PoolLayout } from './scene';
import { drawSwimmer } from './swimmer';

export interface SceneOpts {
  layout: PoolLayout;
  youId: string;
  snapshot: StateMessage;
  positions: Map<string, { x: number; y: number }>;
  ripples: Ripple[];
  headings: HeadingTracker;
  now: number;
}

export function drawScene(ctx: CanvasRenderingContext2D, o: SceneOpts): void {
  const { layout, snapshot } = o;
  const size = layout.size;
  const marcoView = o.youId === snapshot.marcoId;

  ctx.save();
  ctx.translate(layout.offsetX, layout.offsetY);
  const center = worldToScreen(0, 0, size);

  // Water outside the arena is scenery — push it back so the pool reads as
  // the pool. The tiles beneath keep moving through the scrim.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-layout.offsetX, -layout.offsetY, size + layout.offsetX * 2, size + layout.offsetY * 2);
  ctx.arc(center.x, center.y, worldScale(TUNING.arenaRadius, size), 0, Math.PI * 2, true);
  ctx.fillStyle = marcoView ? 'rgba(2,6,12,0.78)' : 'rgba(6,40,70,0.45)';
  ctx.fill('evenodd');
  ctx.restore();

  // The pool wall: the deck's nosing, continued round the water.
  ctx.strokeStyle = marcoView ? 'rgba(159,220,247,0.22)' : '#f5f9f8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldScale(TUNING.arenaRadius, size), 0, Math.PI * 2);
  ctx.stroke();

  // The tide: the shrink ring, which is the only thing stopping a hider.
  ctx.strokeStyle = marcoView ? 'rgba(159,220,247,0.45)' : '#9fdcf7';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldScale(snapshot.ringRadius, size), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ripples — one ring per ping, colored by whoever made the sound.
  // Successive pings of a burst are stamped along the shouter's path, so a
  // moving swimmer trails rings; splashes are smaller and die faster.
  for (const r of o.ripples) {
    const life = r.kind === 'splash' ? SPLASH_MS : RIPPLE_MS;
    const age = (o.now - r.at) / life; // 0..1
    if (age >= 1) continue;
    const at = worldToScreen(r.x, r.y, size);
    const alpha = 1 - age;
    ctx.strokeStyle = playerRgba(r.playerId, alpha);
    if (r.kind === 'splash') {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, worldScale(0.025 + age * 0.12, size), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.lineWidth = 2 + 2 * (1 - age);
      ctx.beginPath();
      ctx.arc(at.x, at.y, worldScale(0.06 + age * 0.5, size), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (r.word) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `700 ${Math.round(size / 26)}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.letterSpacing = '0.24em';
      ctx.fillText(r.word.toUpperCase(), at.x, at.y - worldScale(0.09, size) - age * 26);
      ctx.letterSpacing = '0px';
    }
  }

  // Players — whatever positions the server let this viewer have.
  o.headings.retain(new Set(snapshot.players.map((p) => p.id)));
  for (const p of snapshot.players) {
    const pos = o.positions.get(p.id);
    if (!pos) continue;
    const at = worldToScreen(pos.x, pos.y, size);
    const heading = o.headings.update(p.id, pos.x, pos.y);
    const isMarco = p.id === snapshot.marcoId;
    drawSwimmer(ctx, {
      x: at.x,
      y: at.y,
      radius: worldScale(TUNING.avatarRadius, size),
      color: playerColor(p.id),
      emoji: creatureFor(p.id, isMarco),
      heading,
      nowMs: o.now,
      seed: Number.parseInt(p.id.slice(1), 10) || 0,
      dimmed: marcoView,
    });
    // You are the one with a dot inside your ring — the design's own device
    // for "find yourself in the water", carried over from the host's lobby.
    if (p.id === o.youId) {
      const r = worldScale(TUNING.avatarRadius, size);
      ctx.fillStyle = playerColor(p.id);
      ctx.strokeStyle = 'rgba(245,249,248,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x - r * 0.45, at.y + r * 0.45, Math.max(2.5, r * 0.22), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}
