import { citiesIn } from './cities.js';
import { REGIONS, regionById } from './regions.js';
import type { CityId, RegionId, Rng } from './types.js';

/**
 * Indexed [row][column]. Column 0 names a region by its position in REGIONS;
 * columns 1–7 name a city by its position within that region's list. Rows
 * 0–10 are the odd half of the die, 11–21 the even. Copied verbatim from
 * js/railbaronv2.js:163-184.
 */
export const CODES: readonly (readonly number[])[] = [
  [6, 4, 8, 1, 10, 5, 8, 2],
  [3, 8, 8, 0, 10, 8, 6, 3],
  [3, 6, 8, 1, 1, 4, 6, 3],
  [3, 6, 1, 1, 8, 8, 6, 3],
  [6, 5, 6, 3, 1, 4, 4, 2],
  [6, 8, 4, 0, 9, 5, 4, 2],
  [4, 5, 6, 0, 3, 1, 4, 2],
  [5, 1, 10, 7, 3, 6, 3, 8],
  [5, 1, 10, 7, 2, 6, 1, 8],
  [4, 1, 7, 7, 2, 2, 1, 8],
  [5, 4, 8, 0, 2, 2, 4, 8],
  [4, 4, 2, 2, 6, 3, 8, 7],
  [1, 4, 2, 2, 6, 3, 8, 7],
  [1, 4, 3, 2, 6, 0, 7, 5],
  [1, 0, 0, 2, 4, 0, 7, 7],
  [2, 2, 0, 4, 8, 0, 7, 6],
  [2, 3, 0, 4, 0, 3, 7, 1],
  [0, 2, 9, 5, 5, 3, 5, 4],
  [0, 7, 5, 6, 7, 3, 2, 0],
  [0, 4, 7, 6, 7, 7, 0, 9],
  [0, 4, 5, 0, 5, 7, 0, 4],
  [0, 4, 7, 6, 6, 5, 8, 4]
];

/** One d6 plus one d6 plus a d2 that shifts the whole result by eleven. */
export function rollRow(rng: Rng): number {
  return Math.floor(rng() * 6) + Math.floor(rng() * 6) + Math.floor(rng() * 2) * 11;
}

export function rollRegion(rng: Rng): RegionId {
  const row = CODES[rollRow(rng)];
  if (!row) throw new Error('roll landed outside the table');
  const region = REGIONS[row[0]!];
  if (!region) throw new Error(`row names a region that does not exist: ${row[0]}`);
  return region.id;
}

export function rollCityIn(region: RegionId, rng: Rng): CityId {
  const row = CODES[rollRow(rng)];
  if (!row) throw new Error('roll landed outside the table');
  const position = row[regionById(region).column]!;
  const city = citiesIn(region)[position];
  if (!city) throw new Error(`no city at position ${position} of ${region}`);
  return city.id;
}
