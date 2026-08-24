import {
  CITIES, NODES, RAILROADS, REGIONS, cityById,
  type CityId, type RailroadId, type RegionId,
} from '../../engine/index.js';
import { isRulesShape, type GameRules } from './rules.js';

export type SeatId = 'red' | 'green' | 'blue' | 'yellow' | 'black' | 'white';
export type NodeId = string;

export const SEATS: readonly SeatId[] = ['red', 'green', 'blue', 'yellow', 'black', 'white'];

/**
 * Events record what happened, not what was rolled. Replaying the log gives
 * the same game back without re-rolling any dice, which is what lets undo be
 * truncation and what a server-authoritative version would need.
 *
 * `payout: null` means "no payout applies" — a home town. A journey worth
 * nothing is the number 0, and the two are not interchangeable.
 */
export type GameEvent =
  | { type: 'joined'; seat: SeatId; name: string }
  | { type: 'renamed'; seat: SeatId; name: string | null }
  | { type: 'started'; rules?: GameRules }
  | { type: 'regionRequested'; seat: SeatId; rolled: RegionId }
  /**
   * `arrived` fires when a destination is *rolled*, not when the pawn gets
   * there: it is the companion app's event, kept under its old name because
   * renaming it would break every saved game for one word. Arrival at the
   * destination is `moved.arrived`.
   */
  | { type: 'arrived'; seat: SeatId; city: CityId; region: RegionId; payout: number | null }
  /**
   * Who goes first. "The players roll to see who goes first, the high roll" —
   * recorded rather than re-rolled, so a replayed game deals the same turns.
   * Its presence is also what moves the game from `homes` into `playing`.
   */
  | { type: 'orderRolled'; seat: SeatId; first: SeatId }
  /**
   * The white dice for one turn. A roll written today always carries
   * `bonus: null`: the Bonus Roll is thrown after the white movement has been
   * walked and arrives as its own `bonusRolled` event.
   *
   * The field stays, and the validator still accepts a face in it, because
   * logs written before that staging exist on real tablets. `replay` treats a
   * non-null bonus here as the legacy pre-rolled form and reproduces exactly
   * the behaviour those games were played under.
   */
  | { type: 'turnRolled'; seat: SeatId; white: [number, number]; bonus: number | null }
  /**
   * The Bonus Roll, thrown and announced on its own after the white leg. It is
   * legal only during an open turn whose white pair earned one — a fact
   * `replay` derives from the log's order rather than from anything stored
   * here, exactly as it derives whose turn it is.
   */
  | { type: 'bonusRolled'; seat: SeatId; face: number }
  /** One leg of movement: the path as node ids, and whether it ended on the
   *  destination. Two of these in a turn means a Bonus Roll leg followed the
   *  white one. */
  | { type: 'moved'; seat: SeatId; path: NodeId[]; arrived: boolean }
  /**
   * A railroad purchase, in the arrival window. The price travels in the
   * event for the same reason `payout` does — the log is self-contained —
   * and legal.ts audits it against the price list.
   */
  | { type: 'bought'; seat: SeatId; railroad: RailroadId; price: number }
  /**
   * The announced run home (docs/rules/declaring-and-the-rover.md). The
   * alternate destination is rolled at declaration and carried here; it
   * banks nothing unless the run is cancelled and the baron reaches it.
   */
  | { type: 'declared'; seat: SeatId;
      alternate: { city: CityId; region: RegionId; payout: number } }
  /**
   * The liquidation stub: a forced sale to the bank at half the purchase
   * price, legal only while short. An ordinary log event by design, so a
   * future auction replaces the mechanism without rewriting history.
   */
  | { type: 'sold'; seat: SeatId; railroad: RailroadId; price: number };

// Derived from the engine rather than copied as literals, so a table change
// can't silently drift away from what a loaded log is allowed to contain.
const VALID_SEATS: ReadonlySet<string> = new Set(SEATS);
const VALID_REGIONS: ReadonlySet<RegionId> = new Set(REGIONS.map(region => region.id));
const VALID_CITIES: ReadonlySet<CityId> = new Set(CITIES.map(city => city.id));
const VALID_NODES: ReadonlySet<string> = new Set(NODES.map(node => node.id));
const VALID_RAILROADS: ReadonlySet<string> = new Set(RAILROADS.keys());

const isDie = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;

/**
 * A structurally-valid-but-wrong log (an unknown `type`, a city id that was
 * never real) would otherwise survive `JSON.parse` and throw deep inside
 * `cityById` on every replay — bricking the app with no recovery but clearing
 * site data by hand. This is the gate that keeps that out of `loadLog`.
 */
export function isGameEvent(value: unknown): value is GameEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;

  switch (event.type) {
    case 'joined':
      return VALID_SEATS.has(event.seat as string) && typeof event.name === 'string';
    case 'started':
      // The payload, when present, is the house rules — stamped by the
      // server, validated here so a hand-edited save cannot smuggle a
      // malformed target into every future fold.
      return event.rules === undefined || isRulesShape(event.rules);
    case 'renamed':
      // null is a real value here — it vacates the seat.
      return (
        VALID_SEATS.has(event.seat as string) &&
        (event.name === null || typeof event.name === 'string')
      );
    case 'regionRequested':
      return VALID_SEATS.has(event.seat as string) && VALID_REGIONS.has(event.rolled as RegionId);
    case 'arrived':
      // payout: 0 is a real, legal journey (Minneapolis<->St. Paul,
      // San Francisco<->Oakland) — `typeof === 'number'` here, never a
      // truthiness check, or every $0 save silently loses that stop.
      //
      // VALID_CITIES.has(...) must short-circuit before cityById(...) runs:
      // cityById throws on an id it doesn't recognise, and && evaluates
      // left to right, so a bad id is rejected here rather than reaching
      // the call that would throw on it.
      return (
        VALID_SEATS.has(event.seat as string) &&
        VALID_CITIES.has(event.city as CityId) &&
        VALID_REGIONS.has(event.region as RegionId) &&
        cityById(event.city as CityId).region === event.region &&
        (event.payout === null ||
          (typeof event.payout === 'number' && Number.isFinite(event.payout)))
      );
    case 'orderRolled':
      return VALID_SEATS.has(event.seat as string) && VALID_SEATS.has(event.first as string);
    case 'turnRolled':
      return (
        VALID_SEATS.has(event.seat as string) &&
        Array.isArray(event.white) && event.white.length === 2 && event.white.every(isDie) &&
        (event.bonus === null || isDie(event.bonus))
      );
    case 'bonusRolled':
      // Structural only, like every case here: *when* a Bonus Roll may be
      // taken is a question about the order of the log, and replay is where
      // order is read. A validator that tried to answer it would need the
      // events around this one, which it does not have.
      return VALID_SEATS.has(event.seat as string) && isDie(event.face);
    case 'moved':
      // Two nodes minimum: a leg with no step is not a leg. Every id is
      // checked against the built network for the same reason cities are —
      // a log naming a node that was never real throws deep inside nodeById
      // on every replay and bricks the app.
      return (
        VALID_SEATS.has(event.seat as string) &&
        Array.isArray(event.path) && event.path.length >= 2 &&
        event.path.every(id => typeof id === 'string' && VALID_NODES.has(id)) &&
        typeof event.arrived === 'boolean'
      );
    case 'bought':
    case 'sold':
      // Price travels in the event so the log is self-contained, like
      // arrived.payout; legal.ts audits it against the table, this only
      // checks shape.
      return (
        VALID_SEATS.has(event.seat as string) &&
        VALID_RAILROADS.has(event.railroad as string) &&
        typeof event.price === 'number' && Number.isFinite(event.price) &&
        event.price > 0
      );
    case 'declared': {
      if (!VALID_SEATS.has(event.seat as string)) return false;
      const alt = event.alternate as Record<string, unknown> | null;
      // Same short-circuit discipline as `arrived`: VALID_CITIES gates
      // cityById, which throws on ids it does not know.
      return (
        typeof alt === 'object' && alt !== null &&
        VALID_CITIES.has(alt.city as CityId) &&
        VALID_REGIONS.has(alt.region as RegionId) &&
        cityById(alt.city as CityId).region === alt.region &&
        typeof alt.payout === 'number' && Number.isFinite(alt.payout)
      );
    }
    default:
      return false;
  }
}
