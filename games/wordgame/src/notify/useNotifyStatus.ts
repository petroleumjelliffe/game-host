// One question, asked from two places (the entry header and the game
// header): is this device set up to be nudged? The answer drives the 🔔
// badge and the entry banner; 'unavailable' draws neither, which is the
// standalone dev server's honest state.

import { useCallback, useEffect, useState } from 'react';
import { fetchSettings } from './api';
import { getPlayerKey } from './playerKey';
import { pushSupported } from './push';

export type NotifyStatus = 'loading' | 'unavailable' | 'off' | 'pending' | 'on';

export function useNotifyStatus(): { status: NotifyStatus; refresh(): void } {
  const [status, setStatus] = useState<NotifyStatus>('loading');
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const playerKey = getPlayerKey();
    if (playerKey === null) { setStatus('unavailable'); return; }
    void (async () => {
      const settings = await fetchSettings(playerKey);
      if (cancelled) return;
      if (settings === null) { setStatus('unavailable'); return; }
      if (settings.email?.status === 'confirmed') { setStatus('on'); return; }

      // Push counts as "on" only when THIS browser holds a subscription the
      // server knows — same check NotificationSettings makes.
      if (settings.pushEnabled && pushSupported()) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const sub = await registration.pushManager.getSubscription();
          if (!cancelled && sub !== null && settings.pushEndpoints.includes(sub.endpoint)) {
            setStatus('on');
            return;
          }
        } catch { /* no worker (dev): fall through */ }
      }
      if (cancelled) return;
      setStatus(settings.email?.status === 'pending' ? 'pending' : 'off');
    })();
    return () => { cancelled = true; };
  }, [epoch]);

  const refresh = useCallback(() => { setEpoch((e) => e + 1); }, []);
  return { status, refresh };
}
