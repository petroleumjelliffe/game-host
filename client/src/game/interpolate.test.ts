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

  it('drops a player whose coordinates stop arriving, rather than remembering them', () => {
    // Becoming Marco strips every polo from the snapshot mid-stream. A buffer
    // that fell back to the last known position here would leak exactly what
    // the server refused to send.
    const buffer = new SnapshotBuffer();
    buffer.push([{ id: 'p1', name: 'a', role: 'polo', connected: true, x: 0.2, y: 0.2 }], 1000);
    buffer.push([{ id: 'p1', name: 'a', role: 'polo', connected: true }], 1050);
    expect(buffer.at(1150).has('p1')).toBe(false);
  });
});
