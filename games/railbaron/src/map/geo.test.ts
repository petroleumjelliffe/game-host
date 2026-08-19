import { describe, expect, it } from 'vitest';
import {
  cityById, extend, here, isRejection, movement, nodeForCity, path as pathOf,
  remaining as remainingOf, startDraft, tappable, type NodeId
} from '../../engine';
import type { GameEvent } from '../state/events';
import { replay } from '../state/game';
import { destinationOf } from '../state/turns';
import { layout, RAILROADS, sizeCandidates, TARGET, visualRadius, type Placed } from './geo';

const board = layout(1400, 788);

const city = (name: string) => {
  const node = board.nodes.find(n => n.kind === 'city' && n.name === name);
  if (!node) throw new Error(`no lamp for ${name}`);
  return node;
};

const gap = (a: string, b: string) => Math.hypot(city(a).x - city(b).x, city(a).y - city(b).y);

describe('placing the network on the cabinet', () => {
  it('places every node the network carries', () => {
    expect(board.nodes).toHaveLength(550);
    expect(board.nodes.filter(n => n.kind === 'city')).toHaveLength(67);
    expect(board.byId.size).toBe(550);
  });

  it('keeps everything inside the cabinet', () => {
    for (const node of board.nodes) {
      expect(node.x, node.id).toBeGreaterThan(0);
      expect(node.x, node.id).toBeLessThan(1400);
      expect(node.y, node.id).toBeGreaterThan(0);
      expect(node.y, node.id).toBeLessThan(788);
    }
  });

  it('draws a coastline', () => {
    expect(board.landPath.length).toBeGreaterThan(10000);
    expect(board.landPath.startsWith('M')).toBe(true);
  });

  it('lays the country out west to east and north to south', () => {
    expect(city('Seattle').x).toBeLessThan(city('Boston').x);
    expect(city('Los Angeles').x).toBeLessThan(city('Miami').x);
    expect(city('Minneapolis').y).toBeLessThan(city('Houston').y);
    expect(city('Seattle').y).toBeLessThan(city('San Diego').y);
  });

  it('pushes twin cities far enough apart to be two lamps', () => {
    // The whole reason separation exists. Each pair is closer than a lamp is
    // wide in true projection, and two of the three are the board's only $0
    // journeys — a single lamp would merge two distinct destinations.
    expect(gap('San Francisco', 'Oakland')).toBeGreaterThanOrEqual(20.9);
    expect(gap('Minneapolis', 'St. Paul')).toBeGreaterThanOrEqual(20.9);
    expect(gap('Dallas', 'Fort Worth')).toBeGreaterThanOrEqual(20.9);
  });

  it('leaves no two city lamps overlapping', () => {
    const cities = board.nodes.filter(n => n.kind === 'city');
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = cities[i]!;
        const b = cities[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.name}/${b.name}`).toBeGreaterThan(17);
      }
    }
  });

  it('does not shove a separated city off its own part of the map', () => {
    // Separation is licence, not relocation: nudging must not move a lamp so
    // far that it reads as the wrong place.
    expect(city('Oakland').x).toBeLessThan(city('Sacramento').x);
    expect(city('San Francisco').x).toBeLessThan(city('Oakland').x);
    expect(city('Minneapolis').x).toBeLessThan(city('St. Paul').x);
  });

  it('names a railroad for every segment, and knows each one', () => {
    expect(board.edges).toHaveLength(710);
    for (const edge of board.edges) {
      expect(board.byId.has(edge.a)).toBe(true);
      expect(board.byId.has(edge.b)).toBe(true);
      for (const id of edge.railroads) expect(RAILROADS.has(id), id).toBe(true);
    }
  });

  it('gives every city lamp the engine id its colour is looked up by', () => {
    for (const node of board.nodes.filter(n => n.kind === 'city')) {
      expect(cityById(node.cityId!).name).toBe(node.name);
    }
  });

  it('fits a smaller cabinet without leaking outside it', () => {
    const small = layout(700, 394);
    for (const node of small.nodes) {
      expect(node.x, node.id).toBeGreaterThan(0);
      expect(node.x, node.id).toBeLessThan(700);
      expect(node.y, node.id).toBeGreaterThan(0);
      expect(node.y, node.id).toBeLessThan(394);
    }
  });
});

const MINNEAPOLIS = 43;
const ST_PAUL = 47;
const CHICAGO = 20;
const DENVER = 39;

const seated = (home: number, region: 'PL' | 'NC'): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: home, region, payout: null },
  { type: 'orderRolled', seat: 'red', first: 'red' }
];

/**
 * The lamps the map is offering right now, derived from a replayed log the
 * same way `useRoute` derives them — the baron whose turn it is, standing
 * where the log left their pawn, with this leg's movement and this trip's
 * spent sections.
 */
function candidatesIn(events: readonly GameEvent[]): Placed[] {
  const state = replay(events);
  const seat = state.turn === null ? null : state.seats[state.turn];
  const destination = seat === null ? null : destinationOf(seat);
  const roll = state.rolled;
  if (seat === null || seat.at === null || destination === null || roll === null) {
    throw new Error('this fixture is not a state with a leg left to walk');
  }
  const left = state.leg === 0 ? movement(roll) : (roll.bonus ?? 0);
  const draft = startDraft(seat.at, nodeForCity(destination), left, seat.used);
  const legal = new Set<NodeId>(tappable(draft).map(one => one.to));
  const found = board.nodes.filter(node => legal.has(node.id));
  // A state offering nothing at all is a broken fixture rather than a
  // property. One candidate is a real and interesting state — the bonus leg
  // below is one — and it is where a target should be at its largest.
  expect(found.length, `${state.turn} has nothing to tap`).toBeGreaterThan(0);
  return found;
}

/**
 * A whole leg walked out and committed, so the next fixture starts part-way
 * along a trip with sections already spent — the state a baron is in for most
 * of a long journey, and the one where dots crowd together.
 */
function walkALeg(events: readonly GameEvent[]): GameEvent {
  const state = replay(events);
  const seat = state.seats[state.turn!];
  const destination = nodeForCity(destinationOf(seat)!);
  let draft = startDraft(seat.at!, destination, movement(state.rolled!), seat.used);
  const walked: NodeId[] = [seat.at!];
  // "Always move the full number of dots he rolls": step away from the
  // destination while there is roll left, so the leg spends all of it and
  // stops short rather than arriving.
  while (remainingOf(draft) > 0) {
    const reach = tappable(draft).find(one => one.to !== destination)
      ?? tappable(draft)[0]!;
    for (const step of reach.via) {
      const next = extend(draft, step.to);
      if (isRejection(next)) throw new Error('the walk stepped somewhere illegal');
      draft = next;
    }
    walked.push(reach.to);
    if (here(draft) === destination) break;
  }
  return { type: 'moved', seat: seat.id, path: pathOf(draft), arrived: here(draft) === destination };
}

/**
 * Four real states, chosen for the shapes that crowd lamps together: the
 * board's tightest pair of cities, a leg long enough to fan out across open
 * country, a trip already part-walked, and a Bonus Roll leg.
 */
const STATES: { name: string; events: GameEvent[] }[] = (() => {
  const twin: GameEvent[] = [
    ...seated(MINNEAPOLIS, 'PL'),
    { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 },
    { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }
  ];
  const long: GameEvent[] = [
    ...seated(CHICAGO, 'NC'),
    { type: 'arrived', seat: 'red', city: DENVER, region: 'PL', payout: 9000 },
    { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null }
  ];
  const midTrip: GameEvent[] = [
    ...long, walkALeg(long),
    { type: 'turnRolled', seat: 'red', white: [4, 5], bonus: null }
  ];
  const bonusLeg: GameEvent[] = [
    ...seated(MINNEAPOLIS, 'PL'),
    { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 },
    { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: 4 },
    { type: 'moved', seat: 'red',
      path: [nodeForCity(MINNEAPOLIS), nodeForCity(ST_PAUL)], arrived: true },
    { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: 3000 }
  ];
  return [
    { name: 'the twin cities, one hop apart', events: twin },
    { name: 'Chicago to Denver, seven dots of it', events: long },
    { name: 'part-way along that trip, sections already spent', events: midTrip },
    { name: 'a Bonus Roll leg', events: bonusLeg }
  ];
})();

/**
 * Sizing a tap target is a question about the *candidates*, not about the map.
 * Only lamps offered at the same moment render a target, so only they can
 * compete for a tap — bounding each node against the nearest of all 550 left
 * 46 of the 67 cities with a target smaller than the bulb the player can see.
 */
describe('sizing the tap targets of one moment', () => {
  for (const { name, events } of STATES) {
    describe(name, () => {
      const candidates = candidatesIn(events);
      const radii = sizeCandidates(candidates);
      const hit = (node: Placed) => radii.get(node.id)!;

      it('gives every candidate a target at least as big as the lamp it paints', () => {
        expect(candidates.length).toBeGreaterThan(0);
        for (const node of candidates) {
          if (candidates.length === 1) {
            expect(hit(node), node.id).toBe(TARGET.max);
            continue;
          }
          // Unless a nearer candidate caps it — that rule wins, and the next
          // test is the one that pins it.
          const nearest = Math.min(...candidates
            .filter(other => other !== node)
            .map(other => Math.hypot(other.x - node.x, other.y - node.y)));
          if (nearest / 2 < visualRadius(node)) continue;
          expect(hit(node), `${node.id} (${node.name ?? node.kind})`)
            .toBeGreaterThanOrEqual(visualRadius(node));
        }
      });

      it('lets no candidate target swallow another candidate centre', () => {
        for (const a of candidates) {
          for (const b of candidates) {
            if (a === b) continue;
            const apart = Math.hypot(a.x - b.x, a.y - b.y);
            expect(hit(a), `${a.id} reaches ${b.id}, ${apart.toFixed(2)} away`)
              .toBeLessThan(apart);
          }
        }
      });

      it('never offers more than a fingertip', () => {
        for (const node of candidates) {
          expect(hit(node), node.id).toBeLessThanOrEqual(TARGET.max);
          expect(hit(node), node.id).toBeGreaterThan(0);
        }
      });
    });
  }

  it('keeps both twin cities fully tappable when both are candidates', () => {
    // The pair that made the whole rule: two lamps 21px apart, each 9px of
    // painted bulb. Cities are held far enough apart that they can never cap
    // one another below what they paint.
    const twins = ['San Francisco', 'Oakland', 'Minneapolis', 'St. Paul',
                   'Dallas', 'Fort Worth']
      .map(city);
    const radii = sizeCandidates(twins);
    for (const node of twins) {
      expect(radii.get(node.id)!, node.name).toBeGreaterThanOrEqual(visualRadius(node));
    }
  });

  it('gives a lamp with the map to itself the whole fingertip', () => {
    expect(sizeCandidates([city('Denver')]).get(city('Denver').id)).toBe(TARGET.max);
  });
});
