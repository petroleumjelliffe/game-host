import { describe, expect, it } from 'vitest';
import { CITIES } from './cities';
import {
  EDGES, NODES, RAILROADS, TWIN_PAIRS, cityAt, isTwinStep,
  neighbours, nodeById, nodeForCity, sectionKey
} from './network';

describe('the network access layer', () => {
  it('carries every node and edge from the built graph', () => {
    expect(NODES).toHaveLength(550);
    expect(EDGES).toHaveLength(710);
    expect(RAILROADS.size).toBe(28);
  });

  it('finds a node by id and refuses one that was never real', () => {
    expect(nodeById('c13').name).toBe('Minneapolis');
    expect(() => nodeById('d99999')).toThrow(/d99999/);
  });

  it('maps every city id to its node and back', () => {
    for (const city of CITIES) {
      expect(cityAt(nodeForCity(city.id))).toBe(city.id);
    }
  });

  it('reports a dot as carrying no city', () => {
    expect(cityAt('d0')).toBeNull();
  });

  it('lists the edges at a node, in both directions', () => {
    const stPaul = neighbours('c95');
    expect(stPaul).toHaveLength(1);
    expect(stPaul[0]!.railroads).toEqual(
      expect.arrayContaining(['C&NW', 'CMStP&P', 'NP', 'GN'])
    );
  });

  it('keys a section the same whichever way it is walked', () => {
    expect(sectionKey('c13', 'c95')).toBe(sectionKey('c95', 'c13'));
    expect(sectionKey('c13', 'c95')).not.toBe(sectionKey('c13', 'd66'));
  });

  it('knows the two twin pairs the rulebook names, and no others', () => {
    expect(TWIN_PAIRS).toHaveLength(2);
    expect(isTwinStep(nodeForCity(43), nodeForCity(47))).toBe(true);   // Minneapolis/St. Paul
    expect(isTwinStep(nodeForCity(65), nodeForCity(60))).toBe(true);   // San Francisco/Oakland
    expect(isTwinStep(nodeForCity(29), nodeForCity(30))).toBe(false);  // Dallas/Fort Worth
  });
});
