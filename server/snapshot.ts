// Role-filtered views of a room. Marco's blindness is enforced HERE, by
// omission: a coordinate that is never serialized cannot be rendered, so the
// client needs no trust at all. `x`/`y` are left absent (not null) so a
// leaked key is loud in tests: `'x' in p` is the assertion.

import { TUNING, type SnapshotPlayer, type StateMessage } from '../protocol/game.js';
import type { MarcoPoloRoom } from './game.js';
import { ringRadius } from './sim/sim.js';

export function snapshotFor(room: MarcoPoloRoom, viewerId: string): StateMessage {
  const sim = room.sim;
  if (!sim) throw new Error('snapshotFor before startMatch');
  const marcoViewer = viewerId === sim.marcoId;

  const players: SnapshotPlayer[] = room.players.map((seat) => {
    const sp = sim.players.find((p) => p.id === seat.id);
    const base: SnapshotPlayer = {
      id: seat.id,
      name: seat.name,
      role: sp?.role ?? 'polo',
      connected: seat.connected,
    };
    if (!sp || (marcoViewer && sp.role === 'polo')) return base;
    return { ...base, x: sp.x, y: sp.y };
  });

  const you = sim.players.find((p) => p.id === viewerId);
  return {
    round: room.round,
    phase: room.between
      ? 'betweenRounds'
      : sim.elapsed <= TUNING.graceSeconds
        ? 'grace'
        : 'shrinking',
    timer: Math.max(0, Math.ceil(TUNING.roundSeconds - sim.elapsed)),
    ringRadius: ringRadius(sim.elapsed),
    marcoId: sim.marcoId,
    you: { turbo: you?.turbo ?? 0, callCooldown: marcoViewer ? sim.callCooldown : null },
    players,
    scores: { ...room.scores },
  };
}
