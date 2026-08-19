import { describe, expect, it } from 'vitest';
import type { SeatHolder } from '@game-host/lobby/server/rooms.js';
import { TUNING } from '../protocol/game.js';
import { makeRoom, startMatch, stepRound, type MarcoPoloRoom } from './game.js';
import { snapshotFor } from './snapshot.js';

function playingRoom(): MarcoPoloRoom {
  const players: SeatHolder[] = ['p1', 'p2', 'p3'].map((id, i) => ({
    id,
    name: `Swimmer ${i + 1}`,
    token: `t${id}`,
    isHost: i === 0,
    connected: true,
  }));
  const room = makeRoom('ABCDEF', players);
  startMatch(room, () => 0); // marco = p1
  return room;
}

describe('snapshotFor', () => {
  it('gives a polo viewer every position', () => {
    const snap = snapshotFor(playingRoom(), 'p2');
    expect(snap.players).toHaveLength(3);
    for (const p of snap.players) {
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
    }
    expect(snap.you.callCooldown).toBeNull();
  });

  it('NEVER leaks a polo coordinate to the marco viewer', () => {
    const snap = snapshotFor(playingRoom(), 'p1');
    for (const p of snap.players) {
      if (p.role === 'polo') {
        expect('x' in p).toBe(false);
        expect('y' in p).toBe(false);
      } else {
        expect(typeof p.x).toBe('number');
      }
    }
    expect(snap.you.callCooldown).toBe(0);
    // belt and braces: the serialized payload contains no polo coords at all
    const poloSimX = playingRoom().sim!.players.find((p) => p.role === 'polo')!.x;
    expect(JSON.stringify(snap)).not.toContain(String(poloSimX));
  });

  it('reports phase, timer, ring and scores', () => {
    const room = playingRoom();
    let snap = snapshotFor(room, 'p2');
    expect(snap.phase).toBe('grace');
    expect(snap.timer).toBe(TUNING.roundSeconds);
    expect(snap.ringRadius).toBe(TUNING.arenaRadius);
    expect(snap.marcoId).toBe('p1');
    expect(snap.round).toBe(1);
    room.sim!.elapsed = TUNING.graceSeconds + 1;
    snap = snapshotFor(room, 'p2');
    expect(snap.phase).toBe('shrinking');
    room.sim!.elapsed = TUNING.roundSeconds;
    stepRound(room, 0.05, () => 0);
    snap = snapshotFor(room, 'p2');
    expect(snap.phase).toBe('betweenRounds');
    expect(snap.scores.p2).toBe(1);
  });

  it('reports the viewer own turbo', () => {
    const room = playingRoom();
    room.sim!.players.find((p) => p.id === 'p3')!.turbo = 0.25;
    expect(snapshotFor(room, 'p3').you.turbo).toBe(0.25);
  });
});
