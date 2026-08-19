import { describe, expect, it } from 'vitest';
import { neighbours, nodeForCity, sectionKey } from './network';
import {
  canReach, legalSteps, pathCost, sectionsLeft, stepCost, stepTo, useSection, type Trip
} from './movement';

const MINNEAPOLIS = nodeForCity(43);
const ST_PAUL = nodeForCity(47);
const SAN_FRANCISCO = nodeForCity(65);
const OAKLAND = nodeForCity(60);
const DALLAS = nodeForCity(29);
const FORT_WORTH = nodeForCity(30);

describe('what a step costs', () => {
  it('charges one dot for a route dot', () => {
    expect(stepCost('c13', 'd66')).toBe(1);
  });

  it('charges one dot for a city, because cities count as dots', () => {
    expect(stepCost(DALLAS, FORT_WORTH)).toBe(1);
  });

  it('charges nothing for a junction, because a junction is not a dot', () => {
    const junction = 'j0';
    expect(stepCost('d4', junction)).toBe(0);
  });

  it('charges nothing to cross between twin cities', () => {
    expect(stepCost(MINNEAPOLIS, ST_PAUL)).toBe(0);
    expect(stepCost(ST_PAUL, MINNEAPOLIS)).toBe(0);
    expect(stepCost(SAN_FRANCISCO, OAKLAND)).toBe(0);
    expect(stepCost(OAKLAND, SAN_FRANCISCO)).toBe(0);
  });

  it('sums a whole path', () => {
    expect(pathCost([MINNEAPOLIS, ST_PAUL])).toBe(0);
    expect(pathCost(['c13', 'd66'])).toBe(1);
    expect(pathCost([])).toBe(0);
  });
});

describe('how much of a section is left', () => {
  it('counts one crossing per railroad on the section', () => {
    const edge = neighbours(MINNEAPOLIS).find(e => e.a === ST_PAUL || e.b === ST_PAUL)!;
    expect(edge.railroads.length).toBe(4);
    expect(sectionsLeft(edge, new Map())).toBe(4);
    expect(sectionsLeft(edge, new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 4]]))).toBe(0);
  });

  it('records a crossing without disturbing the map it was given', () => {
    const before = new Map<string, number>();
    const after = useSection(before, 'c13', 'd66');
    expect(before.size).toBe(0);
    expect(after.get(sectionKey('c13', 'd66'))).toBe(1);
    expect(useSection(after, 'd66', 'c13').get(sectionKey('c13', 'd66'))).toBe(2);
  });
});

describe('whether the destination can still be reached', () => {
  it('says yes when nothing has been used', () => {
    expect(canReach(MINNEAPOLIS, DALLAS, new Map())).toBe(true);
  });

  it('says yes when already standing on it', () => {
    expect(canReach(DALLAS, DALLAS, new Map())).toBe(true);
  });

  it('says no once the only way out has been spent', () => {
    // St. Paul is a spur: its single section is the only way in or out, and
    // it carries four railroads, so four crossings exhaust it.
    const used = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 4]]);
    expect(canReach(ST_PAUL, DALLAS, used)).toBe(false);
  });

  it('still says yes with the spur partly spent', () => {
    const used = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 3]]);
    expect(canReach(ST_PAUL, DALLAS, used)).toBe(true);
  });
});

const trip = (over: Partial<Trip>): Trip => ({
  from: 'c13', destination: DALLAS, remaining: 6, used: new Map(), ride: null, ...over
});

describe('a single candidate step', () => {
  it('refuses a node that is not next door', () => {
    expect(stepTo(trip({}), DALLAS)).toBe('not-a-neighbour');
  });

  it('refuses a section whose every railroad has been ridden', () => {
    const used = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 4]]);
    expect(stepTo(trip({ from: MINNEAPOLIS, used }), ST_PAUL)).toBe('section-used');
  });

  it('refuses a step that costs more than is left', () => {
    expect(stepTo(trip({ remaining: 0 }), 'd66')).toBe('no-movement-left');
  });

  it('allows a free step with nothing left, because it costs no dots', () => {
    const step = stepTo(trip({ from: MINNEAPOLIS, destination: DALLAS, remaining: 0 }), ST_PAUL);
    expect(step).toEqual({ to: ST_PAUL, cost: 0, ride: expect.any(Array) });
  });

  it('refuses every step once the destination is underfoot', () => {
    expect(stepTo(trip({ from: DALLAS, destination: DALLAS }), FORT_WORTH))
      .toBe('already-arrived');
    expect(legalSteps(trip({ from: DALLAS, destination: DALLAS }))).toEqual([]);
  });

  it('refuses a step that would strand the pawn', () => {
    // Standing on Minneapolis with St. Paul as the destination, three of the
    // spur's four railroads already ridden: stepping away and back is legal,
    // but a step that used the last one would leave no way in.
    const used = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 4]]);
    expect(stepTo(trip({ from: MINNEAPOLIS, destination: ST_PAUL, used }), 'd66'))
      .toBe('would-strand');
  });

  it('reports which companies the step could have ridden', () => {
    const step = stepTo(trip({ from: MINNEAPOLIS, destination: DALLAS }), ST_PAUL);
    expect(step).not.toBe('section-used');
    expect((step as { ride: readonly string[] }).ride).toEqual(
      expect.arrayContaining(['C&NW', 'CMStP&P', 'NP', 'GN'])
    );
  });
});

describe('changing company', () => {
  it('lets any company be boarded at a dot', () => {
    expect(trip({ ride: null }).ride).toBeNull();
    const steps = legalSteps(trip({ from: MINNEAPOLIS, ride: null }));
    expect(steps.length).toBeGreaterThan(1);
  });

  it('refuses a step onto a line the current run cannot be riding', () => {
    const step = stepTo(trip({ from: MINNEAPOLIS, ride: ['NOT-A-REAL-LINE'] }), ST_PAUL);
    expect(step).toBe('wrong-company');
  });
});

describe('every legal step from here', () => {
  it('is the candidates that were not refused', () => {
    const here = trip({ from: MINNEAPOLIS });
    const all = neighbours(MINNEAPOLIS).map(e => (e.a === MINNEAPOLIS ? e.b : e.a));
    const legal = legalSteps(here).map(s => s.to);
    for (const to of all) {
      const one = stepTo(here, to);
      expect(legal.includes(to)).toBe(typeof one !== 'string');
    }
  });
});
