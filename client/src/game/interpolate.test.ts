import { describe, expect, it } from 'vitest';
import type { SnapshotPlayer } from '../../../protocol/game';
import { SnapshotBuffer } from './interpolate';

const player = (id: string, x: number): SnapshotPlayer => ({
  id, name: id, role: 'polo', connected: true, x, y: 0,
});

describe('SnapshotBuffer', () => {
  it('lerps between the last two snapshots, 100ms behind', () => {
    const buf = new SnapshotBuffer();
    buf.push([player('p2', 0)], 1000);
    buf.push([player('p2', 0.1)], 1050);
    // render at 1125 → sample time 1025 → halfway through the 1000→1050 span
    expect(buf.at(1125).get('p2')!.x).toBeCloseTo(0.05, 5);
    // beyond the span: clamp to the newest, never extrapolate
    expect(buf.at(1400).get('p2')!.x).toBeCloseTo(0.1, 5);
  });

  it('omits players without coordinates (marco view)', () => {
    const buf = new SnapshotBuffer();
    buf.push([{ id: 'p2', name: 'p2', role: 'polo', connected: true }], 1000);
    expect(buf.at(1200).has('p2')).toBe(false);
  });

  it('returns the single snapshot before a second arrives', () => {
    const buf = new SnapshotBuffer();
    buf.push([player('p2', 0.3)], 1000);
    expect(buf.at(1000).get('p2')!.x).toBe(0.3);
  });
});
