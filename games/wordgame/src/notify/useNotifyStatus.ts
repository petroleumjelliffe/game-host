// One question, asked from two places (the entry header and the game
// header): is this device set up to be nudged? The answer drives the 🔔
// badge and the entry banner; 'unavailable' draws neither, which is the
// standalone dev server's honest state.

import { useCallback, useEffect, useState } from 'react';
import { fetchSettings } from './api';
import { getPlayerKey } from './playerKey';
import { pushSupported } from './push';

export type NotifyStatus = 'loading' | 'unavailable' | 'off' | 'pending' | 'on';

export function useNotifyStatus(): { status: NotifyStatus; emailAddress: string | null; refresh(): void } {
  const [status, setStatus] = useState<NotifyStatus>('loading');
  const [emailAddress, setEmailAddress] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const playerKey = getPlayerKey();
    if (playerKey === null) { setStatus('unavailable'); setEmailAddress(null); return; }
    void (async () => {
      const settings = await fetchSettings(playerKey);
      if (cancelled) return;
      if (settings === null) { setStatus('unavailable'); setEmailAddress(null); return; }
      // The entry banner masks and shows this address whether the eventual
      // status is 'on', 'off' or 'pending' — set it once, up front.
      setEmailAddress(settings.email?.address ?? null);
      if (settings.email?.status === 'confirmed') { setStatus('on'); return; }

      // Push counts as "on" only when THIS browser holds a subscription the
      // server knows — same check NotificationSettings makes. `.ready` would
      // hang forever with no worker ever registered (the dev server only
      // registers one in prod, see src/pwa/register.ts), so ask for whatever
      // registration exists right now instead of waiting for one to arrive.
      if (settings.pushEnabled && pushSupported()) {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) {
            const sub = await registration.pushManager.getSubscription();
            if (!cancelled && sub !== null && settings.pushEndpoints.includes(sub.endpoint)) {
              setStatus('on');
              return;
            }
          }
        } catch { /* no worker (dev): fall through */ }
      }
      if (cancelled) return;
      setStatus(settings.email?.status === 'pending' ? 'pending' : 'off');
    })();
    return () => { cancelled = true; };
  }, [epoch]);

  const refresh = useCallback(() => { setEpoch((e) => e + 1); }, []);
  return { status, emailAddress, refresh };
}
