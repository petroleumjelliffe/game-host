import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

describe('parseHash', () => {
  it('routes #/room/CODE to the room, uppercased', () => {
    expect(parseHash('#/room/abq2x9')).toEqual({ screen: 'room', roomId: 'ABQ2X9' });
  });

  it('routes everything else home', () => {
    expect(parseHash('')).toEqual({ screen: 'home' });
    expect(parseHash('#/')).toEqual({ screen: 'home' });
    expect(parseHash('#/room/')).toEqual({ screen: 'home' });
  });
});
