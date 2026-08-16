// One painter for both roles. The marco view is not a client-side secret:
// polo positions are simply absent from `positions` (the server never sent
// them), so the branches here are styling, not information control.

import { TUNING, type StateMessage } from '../../../protocol/game';
import { RIPPLE_MS, SPLASH_MS, type Ripple } from '../game/sessionState';
import { worldScale, worldToScreen } from '../game/camera';
import { playerColor, playerRgba } from './colors';

export interface SceneOpts {
  size: number;
  youId: string;
  snapshot: StateMessage;
  positions: Map<string, { x: number; y: number }>;
  ripples: Ripple[];
  now: number;
}

export function drawScene(ctx: CanvasRenderingContext2D, o: SceneOpts): void {
  const { size, snapshot } = o;
  const marcoView = o.youId === snapshot.marcoId;
  const center = worldToScreen(0, 0, size);

  // water
  ctx.fillStyle = marcoView ? '#04070c' : '#0b3556';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = marcoView ? '#080f18' : '#11476f';
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldScale(TUNING.arenaRadius, size), 0, Math.PI * 2);
  ctx.fill();

  // shrink ring
  ctx.strokeStyle = marcoView ? '#3a5b7a' : '#7fd4ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldScale(snapshot.ringRadius, size), 0, Math.PI * 2);
  ctx.stroke();

  // ripples — one ring per ping, colored by whoever made the sound.
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
      ctx.font = `${Math.round(size / 22)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(r.word, at.x, at.y - worldScale(0.09, size) - age * 14);
    }
  }

  // players — whatever positions the server let this viewer have. Identity
  // is the fill color; the marco role reads as a red halo on top of it.
  for (const p of snapshot.players) {
    const pos = o.positions.get(p.id);
    if (!pos) continue;
    const at = worldToScreen(pos.x, pos.y, size);
    const r = worldScale(TUNING.avatarRadius, size);
    ctx.fillStyle = playerColor(p.id);
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (p.id === o.youId) {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (p.id === snapshot.marcoId) {
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!marcoView) {
      ctx.fillStyle = playerRgba(p.id, 0.9);
      ctx.font = `${Math.round(size / 30)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(p.name, at.x, at.y + r + 16);
    }
  }
}
