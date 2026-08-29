import { useEffect } from 'react';
import { loadIdentity } from '../net/identity';
import { getPlayerKey } from './playerKey';
import { notifyPost } from './api';

/**
 * Ties this device's notification profile to its seat, so the server can
 * push "your turn" at the right person. Fire-and-forget: fired whenever the
 * room enters the playing phase and an identity exists; a standalone dev
 * server that 404s it costs nothing.
 */
export function useNotifyBind(roomId: string, playing: boolean): void {
  useEffect(() => {
    if (!playing || roomId === '') return;
    const identity = loadIdentity(roomId);
    const playerKey = getPlayerKey();
    if (identity === null || playerKey === null) return;
    void notifyPost('/bind', {
      playerKey,
      game: 'wordgame',
      roomId,
      playerId: identity.playerId,
      token: identity.token,
    }).catch(() => {});
  }, [roomId, playing]);
}
