// src/net/devSeat.ts
// The client half of `server/devSeed.ts`: take the seat a dev URL names.
//
// A seeded room's lifecycle is already `playing`, so a browser arriving
// without a token is refused with `seatRefused` — correctly. The tokens exist
// only in the seeding route's response, so they arrive in the URL and are put
// where `identity.ts` already keeps them.
//
// Dev only. Every branch below is behind `import.meta.env.DEV`, so the whole
// thing is dead code in a production build; `RoomPage.test.tsx` covers the
// behaviour and a grep of `dist/assets` for `devSeat` covers the removal.

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { saveIdentity } from './identity';

const PARAMS = ['devSeat', 'devToken', 'devName'];

/**
 * Stores the seat named by `?devSeat=&devToken=&devName=`, then strips it.
 *
 * **Call this above `useRoom`.** The write happens in a `useState`
 * initializer rather than an effect because `useRoom` reads the stored
 * identity once, during its own first render (`useRef(loadIdentity(roomId))`),
 * and effects run after that render. Written in an effect this would land one
 * render too late: the browser would show a join form for a seat it already
 * holds, which is the one-frame flash Phase 4's Finding 3 was about, arriving
 * by a different route.
 */
export function useDevSeat(roomId: string): void {
  const location = useLocation();
  const navigate = useNavigate();

  useState(() => {
    if (!import.meta.env.DEV) return null;
    const params = new URLSearchParams(location.search);
    const playerId = params.get('devSeat');
    const token = params.get('devToken');
    if (roomId === '' || playerId === null || token === null) return null;

    // The name is cosmetic — the server ignores it on a rejoin, which is what
    // a seeded seat always is — but `loadIdentity` requires one, and the
    // roster's names come from the server anyway.
    saveIdentity(roomId, { playerId, token, name: params.get('devName') ?? playerId });
    return null;
  });

  // Strip the credentials once they are stored. `replace`, so the back button
  // does not walk into a URL carrying a live token — and so no screenshot of a
  // by-hand run has one in the address bar.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(location.search);
    if (!PARAMS.some((p) => params.has(p))) return;
    for (const p of PARAMS) params.delete(p);
    const rest = params.toString();
    navigate({ pathname: location.pathname, search: rest === '' ? '' : `?${rest}` }, { replace: true });
  }, [location.pathname, location.search, navigate]);
}
