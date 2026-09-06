// This game's face on the shared bind hook: it knows the game id and where
// identities live; the shared half knows the wire. Lobby binds feed the
// invite picker's "already in this room"; the playing bind writes the
// co-player ledger server-side.

import { useNotifyBind as useSharedNotifyBind } from '@game-host/notify/client/useNotifyBind';
import { loadIdentity } from '../net/identity';

export function useNotifyBind(roomId: string, phase: 'lobby' | 'playing' | null): void {
  const identity = phase === null || roomId === '' ? null : loadIdentity(roomId);
  useSharedNotifyBind({ game: 'wordgame', roomId, phase, identity });
}
