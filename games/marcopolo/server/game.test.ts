import { describe, expect, it } from 'vitest';
import type { SeatHolder } from '@game-host/lobby/server/rooms.js';
import { TUNING } from '../protocol/game.js';
import { makeRoom, startMatch, startNextRound, stepRound } from './game.js';

function seats(n: number): SeatHolder[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Swimmer ${i + 1}`,
    token: `t${i + 1}`,
    isHost: i === 0,
    connected: true,
  }));
}

describe('makeRoom', () => {
  it('is a lobby until begun, then playing', () => {
    const room = makeRoom('ABCDEF', seats(3));
    expect(room.lifecycle()).toBe('lobby');
    startMatch(room, () => 0);
    expect(room.lifecycle()).toBe('playing');
  });
});

describe('startMatch', () => {
  it('starts round 1 with an rng-chosen marco and zeroed scores', () => {
    const room = makeRoom('ABCDEF', seats(3));
    const ev = startMatch(room, () => 0); // rng 0 → first player
    expect(ev).toEqual({ type: 'roundStart', round: 1, marcoId: 'p1' });
    expect(room.round).toBe(1);
    expect(room.lastMarcoRound).toEqual({ p1: 1 });
    expect(room.scores).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(room.sim?.marcoId).toBe('p1');
  });
});

describe('stepRound', () => {
  it('on a catch: caught player becomes next marco, survivors score', () => {
    const room = makeRoom('ABCDEF', seats(3));
    startMatch(room, () => 0);
    const polo = room.sim!.players.find((p) => p.role === 'polo')!;
    polo.x = 0.01;
    polo.y = 0;
    const events = stepRound(room, 0.001, () => 0);
    const end = events.find((e) => e.type === 'roundEnd');
    expect(end).toMatchObject({ reason: 'catch', caughtId: polo.id, nextMarcoId: polo.id });
    const survivor = room.players.find((p) => p.id !== 'p1' && p.id !== polo.id)!;
    expect(room.scores[survivor.id]).toBe(1);
    expect(room.scores[polo.id]).toBe(0);
    expect(room.between).toBe(true);
    expect(stepRound(room, 0.05, () => 0)).toEqual([]); // frozen between rounds
  });

  it('on a timeout: all polos score, marco rotates to the longest-waiting', () => {
    const room = makeRoom('ABCDEF', seats(3));
    startMatch(room, () => 0); // marco p1
    room.sim!.elapsed = TUNING.roundSeconds;
    const events = stepRound(room, 0.05, () => 0);
    const end = events.find((e) => e.type === 'roundEnd');
    expect(end).toMatchObject({ reason: 'timeout', caughtId: null, nextMarcoId: 'p2' });
    expect(room.scores).toEqual({ p1: 0, p2: 1, p3: 1 });
  });
});

describe('startNextRound', () => {
  it('starts the following round with the recorded next marco', () => {
    const room = makeRoom('ABCDEF', seats(3));
    startMatch(room, () => 0);
    expect(startNextRound(room, () => 0)).toBeNull(); // mid-round: refused
    room.sim!.elapsed = TUNING.roundSeconds;
    stepRound(room, 0.05, () => 0);
    const ev = startNextRound(room, () => 0);
    expect(ev).toEqual({ type: 'roundStart', round: 2, marcoId: 'p2' });
    expect(room.between).toBe(false);
    expect(room.lastMarcoRound).toEqual({ p1: 1, p2: 2 });
  });
});
