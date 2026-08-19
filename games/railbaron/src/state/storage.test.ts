import { beforeEach, describe, expect, it } from 'vitest';
import { SAVE_VERSION, STORAGE_KEY, clearLog, loadLog, saveLog } from './storage';
import type { GameEvent } from './events';

const log: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'Pete' },
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
  { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
];

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('namespaces its key, because this origin is shared with another game', () => {
    expect(STORAGE_KEY.startsWith('railbaron:')).toBe(true);
  });

  it('round-trips a log, zero payouts included', () => {
    saveLog(log);
    const back = loadLog().events;
    expect(back).toEqual(log);
    expect(back[2]!.type === 'arrived' && back[2]!.payout).toBe(0);
  });

  it('returns an empty log when nothing has been saved', () => {
    expect(loadLog().events).toEqual([]);
  });

  it('returns an empty log rather than throwing on damaged data', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadLog().events).toEqual([]);
  });

  it('ignores a log written by a future version', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, events: log }));
    expect(loadLog().events).toEqual([]);
  });

  it('leaves other games\' keys alone when clearing', () => {
    localStorage.setItem('acquire:something', 'keep me');
    saveLog(log);
    clearLog();
    expect(loadLog().events).toEqual([]);
    expect(localStorage.getItem('acquire:something')).toBe('keep me');
  });

  it('exposes localStorage.length and localStorage.key() on the real Storage implementation', () => {
    localStorage.setItem('key1', 'value1');
    localStorage.setItem('key2', 'value2');
    expect(localStorage.length).toBe(2);
    expect([localStorage.key(0), localStorage.key(1)]).toContain('key1');
    expect([localStorage.key(0), localStorage.key(1)]).toContain('key2');
  });

  it('discards a log where an arrived event names a city id that was never real', () => {
    const bad: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 999, region: 'PL', payout: 0 }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: bad }));
    expect(loadLog().events).toEqual([]);
  });

  it('discards a log where a real city id is filed under the wrong region', () => {
    // City 4 is New York, which is in NE, not SW — structurally valid, but
    // the two fields disagree about where the baron actually is.
    const bad: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 4, region: 'SW', payout: 0 }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: bad }));
    expect(loadLog().events).toEqual([]);
  });

  it('discards a log containing an event with an unknown type', () => {
    const bad = [
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'departed', seat: 'red' }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: bad }));
    expect(loadLog().events).toEqual([]);
  });

  it('discards the whole log when only one of several events is bad, not just the bad one', () => {
    const mostlyGood: unknown[] = [
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 999, region: 'PL', payout: 0 },
      { type: 'joined', seat: 'blue', name: 'Alex' }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: mostlyGood }));
    expect(loadLog().events).toHaveLength(0);
  });

  it('keeps a log containing started and renamed, rather than discarding it', () => {
    // isGameEvent is applied all-or-nothing by loadLog: one unrecognised
    // event and the WHOLE log becomes []. A new event type the validator
    // does not know about therefore does not degrade the save — it destroys
    // it, silently, and only on the next reload.
    const withNewEvents: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'renamed', seat: 'red', name: 'MARGO' },
      { type: 'renamed', seat: 'blue', name: null },
      { type: 'started' }
    ];
    saveLog(withNewEvents);
    expect(loadLog().events).toHaveLength(4);
  });

  it('stamps the time a game was saved', () => {
    saveLog(log);
    expect(loadLog().savedAt).toBeTypeOf('number');
  });

  it('still reads a version 1 record rather than discarding the game', () => {
    // The screen that shows this record exists to protect the game inside
    // it. Bouncing the version would throw away exactly what it offers back.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: log }));
    const loaded = loadLog();
    expect(loaded.events).toHaveLength(3);
    expect(loaded.savedAt).toBeNull();
  });

  it('reports no age when nothing has been saved', () => {
    expect(loadLog().savedAt).toBeNull();
  });

  it('still validates a version 1 record rather than trusting it for being old', () => {
    const bad = [{ type: 'joined', seat: 'nobody', name: 'Pete' }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: bad }));
    expect(loadLog().events).toEqual([]);
  });

  it('round-trips a well-formed log of all three event variants unchanged', () => {
    const full: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'regionRequested', seat: 'red', rolled: 'NE' },
      { type: 'arrived', seat: 'red', city: 4, region: 'NE', payout: 31000 }
    ];
    saveLog(full);
    expect(loadLog().events).toEqual(full);
  });
});

describe('the new turn events survive a round trip', () => {
  const good: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'ADA' },
    { type: 'started' },
    { type: 'orderRolled', seat: 'red', first: 'red' },
    { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
    { type: 'moved', seat: 'red', path: ['c13', 'c95'], arrived: true },
    { type: 'bonusRolled', seat: 'red', face: 3 },
    { type: 'moved', seat: 'red', path: ['c95', 'c13'], arrived: false }
  ];

  it('keeps them all', () => {
    saveLog(good);
    expect(loadLog().events).toEqual(good);
  });

  it('keeps a pre-rolled bonus, so a log written before the staging still loads', () => {
    // `turnRolled` used to carry the face. Games saved that way exist on real
    // tablets, and `replay` reproduces the semantics they were played under —
    // which it cannot do if the validator throws the log away on load.
    const legacy: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: 4 }
    ];
    saveLog(legacy);
    expect(loadLog().events).toEqual(legacy);
  });

  it('discards a log whose Bonus Roll was never on a die', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SAVE_VERSION, savedAt: Date.now(),
      events: [{ type: 'bonusRolled', seat: 'red', face: 0 }]
    }));
    expect(loadLog().events).toEqual([]);
  });

  it('discards a log whose die face was never on a die', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SAVE_VERSION, savedAt: Date.now(),
      events: [{ type: 'turnRolled', seat: 'red', white: [3, 7], bonus: null }]
    }));
    expect(loadLog().events).toEqual([]);
  });

  it('discards a log naming a node that was never real', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SAVE_VERSION, savedAt: Date.now(),
      events: [{ type: 'moved', seat: 'red', path: ['c13', 'nowhere'], arrived: false }]
    }));
    expect(loadLog().events).toEqual([]);
  });

  it('discards a leg that never went anywhere', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SAVE_VERSION, savedAt: Date.now(),
      events: [{ type: 'moved', seat: 'red', path: ['c13'], arrived: false }]
    }));
    expect(loadLog().events).toEqual([]);
  });
});
