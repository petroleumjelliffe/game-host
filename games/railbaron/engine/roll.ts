import { cityById } from './cities.js';
import { payoutBetween } from './payouts.js';
import { rollCityIn, rollRegion } from './rollTable.js';
import type { CityId, RegionId, Rng } from './types.js';

export type RollOutcome =
  | { kind: 'home'; city: CityId; region: RegionId }
  | { kind: 'arrived'; city: CityId; region: RegionId; payout: number }
  | { kind: 'chooseRegion'; rolled: RegionId };

export interface Arrival {
  city: CityId;
  region: RegionId;
  payout: number;
}

/**
 * A baron's first roll is their home town and pays nothing. After that, a
 * roll that names the region they are already in hands the choice to the
 * player instead of picking a city.
 *
 * `taken` is the home cities other barons already hold. "If two players roll
 * the same home city, the second player must roll again — no players can have
 * the same home city." The book says to roll again for region *and* city, so
 * this rerolls the whole destination rather than picking another city inside
 * the region it first named. It applies only to the home roll: two barons may
 * perfectly well be heading for the same place.
 */
export function rollDestination(
  from: CityId | null, rng: Rng, taken: ReadonlySet<CityId> = new Set()
): RollOutcome {
  if (from === null) {
    let guard = 0;
    for (;;) {
      const region = rollRegion(rng);
      const city = rollCityIn(region, rng);
      if (!taken.has(city)) return { kind: 'home', city, region };
      if (++guard > 200) throw new Error('every home city is taken');
    }
  }

  const region = rollRegion(rng);
  if (region === cityById(from).region) return { kind: 'chooseRegion', rolled: region };

  const { city, payout } = destinationInRegion(from, region, rng);
  return { kind: 'arrived', city, region, payout };
}

/** Used both for a normal roll and after the player picks a region. */
export function destinationInRegion(from: CityId, region: RegionId, rng: Rng): Arrival {
  let city = rollCityIn(region, rng);
  // Only reachable when the player chose their own region: the table can name
  // the city they are standing in, and a journey to yourself has no price.
  let guard = 0;
  while (city === from) {
    if (++guard > 100) throw new Error(`could not leave ${from} within ${region}`);
    city = rollCityIn(region, rng);
  }
  return { city, region, payout: payoutBetween(from, city) };
}
