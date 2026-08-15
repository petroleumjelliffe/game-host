// One painter for both roles. The marco view is not a client-side secret:
// polo positions are simply absent from `positions` (the server never sent
// them), so the branches here are styling, not information control.

import { TUNING, type StateMessage } from '../../../protocol/game';
import { RIPPLE_MS, type Ripple } from '../game/sessionState';
import { worldScale, worldToScreen } from '../game/camera';

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

  // ripples
  for (const r of o.ripples) {
    const age = (o.now - r.at) / RIPPLE_MS; // 0..1
    if (age >= 1) continue;
    const at = worldToScreen(r.x, r.y, size);
    const alpha = 1 - age;
    ctx.strokeStyle =
      r.word === 'marco' ? `rgba(255,110,110,${alpha})` : `rgba(140,235,255,${alpha})`;
    ctx.lineWidth = 2 + 2 * (1 - age);
    for (const lag of [0, 0.18, 0.36]) {
      const a = age - lag;
      if (a <= 0) continue;
      ctx.beginPath();
      ctx.arc(at.x, at.y, worldScale(0.06 + a * 0.5, size), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `${Math.round(size / 22)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(r.word, at.x, at.y - worldScale(0.09, size) - age * 14);
  }

  // players — whatever positions the server let this viewer have
  for (const p of snapshot.players) {
    const pos = o.positions.get(p.id);
    if (!pos) continue;
    const at = worldToScreen(pos.x, pos.y, size);
    const r = worldScale(TUNING.avatarRadius, size);
    const isMarco = p.id === snapshot.marcoId;
    ctx.fillStyle = isMarco ? '#ff6e6e' : p.id === o.youId ? '#ffe27a' : '#8cebff';
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (p.id === o.youId) {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (!marcoView) {
      ctx.fillStyle = 'rgba(232,241,248,0.8)';
      ctx.font = `${Math.round(size / 30)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(p.name, at.x, at.y + r + 14);
    }
  }
}
