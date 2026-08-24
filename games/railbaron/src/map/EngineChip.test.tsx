import { describe, expect, it } from 'vitest';
import { chipSide } from './EngineChip';

/**
 * Which side of the engine the chip rides. Above is home; it yields when the
 * next-move lamps crowd that space, because a counter parked on a candidate
 * hides exactly the thing the player is choosing between.
 */
describe('picking the chip a side', () => {
  const at = { x: 500, y: 300 };

  it('stays above when nothing is in the way', () => {
    expect(chipSide(at, [])).toBe('above');
    // A lamp beside the engine, or well past the chip's reach, crowds nothing.
    expect(chipSide(at, [
      { x: 400, y: 260 },   // too far left
      { x: 500, y: 300 },   // the engine's own node
      { x: 500, y: 380 }    // far below, outside the zone
    ])).toBe('above');
  });

  it('swings below when a candidate lights up where the counter sits', () => {
    expect(chipSide(at, [{ x: 505, y: 260 }])).toBe('below');
  });

  it('holds above when below is just as crowded — no flapping for nothing', () => {
    expect(chipSide(at, [
      { x: 505, y: 260 },
      { x: 495, y: 340 }
    ])).toBe('above');
  });

  it('picks the clearer side when both are crowded unevenly', () => {
    expect(chipSide(at, [
      { x: 505, y: 260 },
      { x: 480, y: 270 },
      { x: 495, y: 340 }
    ])).toBe('below');
  });
});
