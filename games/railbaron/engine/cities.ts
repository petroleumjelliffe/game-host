import type { City, CityId, RegionId } from './types.js';

const GROUPS: ReadonlyArray<readonly [RegionId, readonly string[]]> = [
  ['NE', ['Albany', 'Baltimore', 'Boston', 'Buffalo', 'New York',
          'Philadelphia', 'Pittsburgh', 'Portland, ME', 'Washington DC']],
  ['SE', ['Atlanta', 'Charleston', 'Charlotte', 'Chattanooga', 'Jacksonville',
          'Knoxville', 'Miami', 'Mobile', 'Norfolk', 'Richmond', 'Tampa']],
  ['NC', ['Chicago', 'Cincinnati', 'Cleveland', 'Columbus', 'Detroit',
          'Indianapolis', 'Milwaukee', 'St. Louis']],
  ['SC', ['Birmingham', 'Dallas', 'Fort Worth', 'Houston', 'Little Rock',
          'Louisville', 'Memphis', 'Nashville', 'New Orleans', 'San Antonio',
          'Shreveport']],
  ['PL', ['Denver', 'Des Moines', 'Fargo', 'Kansas City', 'Minneapolis',
          'Oklahoma City', 'Omaha', 'Pueblo', 'St. Paul']],
  ['NW', ['Billings', 'Butte', 'Casper', 'Pocatello', 'Portland, OR',
          'Rapid City', 'Salt Lake City', 'Seattle', 'Spokane']],
  ['SW', ['El Paso', 'Las Vegas', 'Los Angeles', 'Oakland', 'Phoenix', 'Reno',
          'Sacramento', 'San Diego', 'San Francisco', 'Tucumcari']]
];

export const CITIES: readonly City[] = GROUPS.flatMap(([region, names]) =>
  names.map(name => ({ name, region }))
).map((city, id) => ({ ...city, id }));

const BY_ID = new Map(CITIES.map(c => [c.id, c]));
const BY_REGION = new Map<RegionId, City[]>();
for (const city of CITIES) {
  const list = BY_REGION.get(city.region) ?? [];
  list.push(city);
  BY_REGION.set(city.region, list);
}

export function cityById(id: CityId): City {
  const city = BY_ID.get(id);
  if (!city) throw new Error(`unknown city id: ${id}`);
  return city;
}

export function citiesIn(region: RegionId): readonly City[] {
  return BY_REGION.get(region) ?? [];
}
