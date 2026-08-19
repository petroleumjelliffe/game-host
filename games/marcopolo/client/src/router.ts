import { useEffect, useState } from 'react';

export type Route = { screen: 'home' } | { screen: 'join' } | { screen: 'room'; roomId: string };

export function parseHash(hash: string): Route {
  const m = /^#\/room\/([A-Za-z2-9]+)$/.exec(hash);
  if (m) return { screen: 'room', roomId: m[1]!.toUpperCase() };
  return hash === '#/join' ? { screen: 'join' } : { screen: 'home' };
}

export function navigateToRoom(roomId: string): void {
  window.location.hash = `#/room/${roomId}`;
}

export function navigateToJoin(): void {
  window.location.hash = '#/join';
}

export function navigateHome(): void {
  window.location.hash = '#/';
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
