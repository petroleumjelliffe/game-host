export type CityId = number;
export type RegionId = 'NE' | 'SE' | 'NC' | 'SC' | 'PL' | 'NW' | 'SW';

export interface Region {
  id: RegionId;
  name: string;
  /** Column into the roll table that yields a city within this region. 1–7. */
  column: number;
}

export interface City {
  id: CityId;
  name: string;
  region: RegionId;
}

/** Returns a float in [0, 1). Injected so tests can script the dice. */
export type Rng = () => number;
