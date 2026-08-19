import { useSyncExternalStore } from 'react';
import type { GameSession, SessionView } from '../../../session/GameSession';

/**
 * Binds a `GameSession` to React.
 *
 * `getView()` must return the *same* object until something changes, or
 * `useSyncExternalStore` loops forever; `GameSession` caches it for exactly
 * that reason. The server snapshot is the same function because there is no
 * server rendering here and a session is always constructed client-side.
 */
export function useGameSession(session: GameSession): SessionView {
  return useSyncExternalStore(session.subscribe, session.getView, session.getView);
}
