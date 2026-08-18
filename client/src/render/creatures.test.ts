import { describe, expect, it } from 'vitest';
import { MARCO_EMOJI, creatureFor, playerColor, playerRgba } from './creatures';

describe('creatures', () => {
  it('gives each seat its own creature and ring color', () => {
    expect(creatureFor('p1', false)).toBe('🐬');
    expect(creatureFor('p4', false)).toBe('🐙');
    expect(playerColor('p1')).toBe('#6f93b4');
    expect(playerColor('p3')).toBe('#ec87a9');
  });

  it('puts the shark on whoever is marco, but keeps their color', () => {
    expect(creatureFor('p4', true)).toBe(MARCO_EMOJI);
    expect(playerColor('p4')).toBe('#b98fd6');
  });

  it('wraps past the eighth seat rather than throwing', () => {
    expect(creatureFor('p9', false)).toBe(creatureFor('p1', false));
    expect(playerColor('p9')).toBe(playerColor('p1'));
  });

  it('survives an id it cannot parse', () => {
    expect(playerColor('nonsense')).toBe('#6f93b4');
    expect(creatureFor('nonsense', false)).toBe('🐬');
  });

  it('makes rgba from the same hue', () => {
    expect(playerRgba('p2', 0.5)).toBe('rgba(93,156,98,0.5)');
  });
});
