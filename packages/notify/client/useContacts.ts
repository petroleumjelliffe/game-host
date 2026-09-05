// The picker's list, as a hook: loaded when the picker opens, refreshed on
// demand. 'unavailable' reads the same as empty (checklist P2): a player
// with no storage, a dev server without /notify, and nobody-played-yet all
// answer "nobody yet — play a game first".

import { useCallback, useEffect, useState } from 'react';
import { fetchContacts, type ContactRow } from './invites.js';

export interface ContactsState {
  status: 'loading' | 'ready';
  contacts: ContactRow[];
  refresh(): void;
}

export function useContacts(
  room: { game: string; roomId: string } | null,
  active: boolean,
): ContactsState {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [epoch, setEpoch] = useState(0);
  const game = room?.game;
  const roomId = room?.roomId;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setStatus('loading');
    void fetchContacts(
      game !== undefined && roomId !== undefined ? { game, roomId } : undefined,
    ).then((rows) => {
      if (cancelled) return;
      setContacts(rows ?? []);
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [active, game, roomId, epoch]);

  const refresh = useCallback(() => {
    setEpoch((e) => e + 1);
  }, []);

  return { status, contacts, refresh };
}
