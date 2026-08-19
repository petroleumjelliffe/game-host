import type { Region, RegionId } from './types';

export const REGIONS: readonly Region[] = [
  { id: 'NE', name: 'Northeast', column: 1 },
  { id: 'SE', name: 'Southeast', column: 2 },
  { id: 'NC', name: 'North Central', column: 3 },
  { id: 'SC', name: 'South Central', column: 4 },
  { id: 'PL', name: 'Plains', column: 5 },
  { id: 'NW', name: 'Northwest', column: 6 },
  { id: 'SW', name: 'Southwest', column: 7 }
];

const BY_ID = new Map(REGIONS.map(r => [r.id, r]));

export function regionById(id: RegionId): Region {
  const region = BY_ID.get(id);
  if (!region) throw new Error(`unknown region: ${id}`);
  return region;
}
