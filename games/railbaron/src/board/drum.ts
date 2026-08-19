import { ALPHABET, FLAP_WIDTH, toIndexes } from './alphabet';

export interface Tile {
  cur: number;
  prev: number;
  target: number;
  /**
   * Extra ticks this tile turns before it is allowed to land, on top of the
   * distance it has to cover. This is how a column is made to settle later
   * than one with less distance to travel.
   *
   * Always a whole number of laps. A drum turns one way and cannot stop
   * between faces, so a tile asked to hold for some arbitrary count would
   * end that count somewhere short of its target and have to run most of
   * another lap to reach it — turning a 12-tick delay into a 42-tick one.
   * Whole laps land it back where it started, with exactly its own distance
   * left to go.
   */
  hold: number;
  /** How many faces this tile carries. Characters for a tile grid, whole words for a panel. */
  faces: readonly string[];
}

/** A tile shows two half-flaps: the arriving character above, the leaving one below. */
export interface FlapChar {
  top: string;
  bottom: string;
}

const CHARACTERS = [...ALPHABET];

/**
 * The faces this column's tiles carry: digits, a comma, a hyphen and a
 * blank. The dollar sign is not among them — it is a fixed label in front of
 * the tiles, not something that turns.
 *
 * A tile carrying only these reaches any figure in at most thirteen turns
 * instead of the alphabet's forty-one. The payout lands last in the
 * sequence, and a full alphabet drum there would add two seconds to every
 * roll for characters that can never come up.
 *
 * The hyphen is here because the menu screens reuse this column for a range
 * — "2-6" players. Without it that row read as "2 6", the hyphen silently
 * becoming a blank because the ring had no face for it.
 */
const DIGITS = [...' 0123456789,-'];

export interface DrumSpec {
  from: string;
  to: string;
  width?: number;
  /** Defaults to the full alphabet, one tile per character. */
  faces?: readonly string[];
  /**
   * One tile carrying the whole string, rather than one tile per character —
   * a single physical panel that flips between words. Only the region column
   * works this way; the payout has its own reduced ring but is still a row of
   * tiles, and treating "not the alphabet" as "must be a panel" turned it
   * into one tumbling character.
   */
  whole?: boolean;
  /**
   * The earliest tick any tile in this drum may land. A tile with further to
   * travel than that still takes as long as it takes — this sets a floor, not
   * a schedule, so the cascade across a field still comes from the tiles
   * themselves rather than being dictated here.
   */
  settleAt?: number;
}

function ringIndexes(
  text: string, width: number, faces: readonly string[], whole: boolean
): number[] {
  if (!whole) {
    // Per character, against this drum's own ring. Anything the ring does
    // not carry shows blank, which is index 0 in every ring here.
    const padded = text.toUpperCase().slice(0, width).padEnd(width, ' ');
    return [...padded].map(character => {
      const at = faces.indexOf(character);
      return at < 0 ? 0 : at;
    });
  }
  // A panel carries whole words, so the whole string is one face.
  const at = faces.indexOf(text);
  return [at < 0 ? 0 : at];
}

export function buildDrum(spec: DrumSpec): Tile[] {
  const faces = spec.faces ?? CHARACTERS;
  const whole = spec.whole ?? false;
  const width = whole ? 1 : (spec.width ?? FLAP_WIDTH);
  const settleAt = spec.settleAt ?? 0;

  const start = ringIndexes(spec.from, width, faces, whole);
  return ringIndexes(spec.to, width, faces, whole).map((target, i) => {
    // Both arrays come from the same call so they are the same length by
    // construction, but noUncheckedIndexedAccess cannot know that. A tile
    // with no outgoing face starts from the blank, which is what a widening
    // field should do anyway.
    const cur = start[i] ?? 0;
    const travel = (target - cur + faces.length) % faces.length;
    const laps = Math.max(0, Math.ceil((settleAt - travel) / faces.length));
    return { cur, prev: cur, target, hold: laps * faces.length, faces };
  });
}

/** Whole words rather than characters: one physical panel that flips through a list. */
export const panelDrum = (from: string, to: string, faces: readonly string[], settleAt = 0) =>
  buildDrum({ from, to, faces, settleAt, whole: true });

/** The payout's own reduced ring — see DIGITS. */
export const amountDrum = (from: string, to: string, width: number, settleAt = 0) =>
  buildDrum({ from, to, width, faces: DIGITS, settleAt });

/**
 * How many ticks this drum needs before every tile has landed. Known up
 * front because each tile's remaining distance and hold are both known, which
 * is what lets one column be scheduled to settle after another rather than
 * the two racing.
 */
export function duration(tiles: readonly Tile[]): number {
  return tiles.reduce((longest, tile) => {
    const travel = (tile.target - tile.cur + tile.faces.length) % tile.faces.length;
    const turning = tile.hold + travel;
    // Plus the tick its trailing leaf takes to fall. A tile that never turns
    // has no leaf in the air and needs none.
    return Math.max(longest, turning === 0 ? 0 : turning + 1);
  }, 0);
}

/**
 * One tick. Every unsettled tile moves exactly one place forward; settled
 * tiles hold. The cascade an onlooker sees is not choreographed anywhere —
 * it falls out of tiles having different distances left to travel.
 *
 * `prev` is always the character the tile is leaving, never the one it is
 * arriving at, including on the tick it lands. A physical leaf takes a moment
 * to fall: the top half of the tile shows the new character while the bottom
 * half is still the old one, and only on the following tick do the two agree.
 * Collapsing them the instant a tile lands removes the flap and leaves a
 * character that simply changes.
 */
export function advance(tiles: readonly Tile[]): Tile[] {
  return tiles.map(tile => {
    // Arrived and the leaf has fallen: nothing left to do.
    if (tile.hold === 0 && tile.cur === tile.target) {
      return tile.prev === tile.cur ? tile : { ...tile, prev: tile.cur };
    }
    const next = (tile.cur + 1) % tile.faces.length;
    return { ...tile, cur: next, prev: tile.cur, hold: Math.max(0, tile.hold - 1) };
  });
}

/**
 * Settled means arrived *and* the trailing leaf has fallen. Requiring both is
 * what buys the last tile the extra tick it needs — a strip reported settled
 * the moment its last character arrived would be frozen mid-fall, showing one
 * tile as half old and half new for good.
 */
export function isSettled(tiles: readonly Tile[]): boolean {
  return tiles.every(tile =>
    tile.hold === 0 && tile.cur === tile.target && tile.prev === tile.cur);
}

const show = (tile: Tile, index: number): string => tile.faces[index] ?? ' ';

export function faces(tiles: readonly Tile[]): FlapChar[] {
  return tiles.map(tile => ({ top: show(tile, tile.cur), bottom: show(tile, tile.prev) }));
}

export function staticFaces(text: string, width: number = FLAP_WIDTH): FlapChar[] {
  return toIndexes(text, width).map(index => {
    const face = CHARACTERS[index] ?? ' ';
    return { top: face, bottom: face };
  });
}

/** What a settled panel shows: the value itself, no drum needed. */
export const staticPanel = (text: string): FlapChar[] => [{ top: text, bottom: text }];
