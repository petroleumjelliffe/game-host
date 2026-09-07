// The enrollment card's brain (checklist P4): offered once at the landing
// moment, remembered when declined, honest about a browser that cannot
// push. Headless — the game renders the card; this decides whether one
// exists and what its button does.

import { useCallback, useEffect, useState } from 'react';
import { fetchSettings } from './api.js';
import { getPlayerKey } from './playerKey.js';
import { enrollPush, syncSubscription } from './pushSubscription.js';
import { pushSupported } from './push.js';

const DECLINED_KEY = 'notify.enroll.declined';

export type EnrollPushState =
  /** No card: unsupported+not-iOS, unconfigured, declined before, or already on. */
  | 'hidden'
  /** iOS in Safari: push needs the home-screen app, so the card becomes an explainer. */
  | 'needsInstall'
  | 'offer'
  | 'busy'
  | 'enabled'
  | 'failed';

function isIOS(): boolean {
  return typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function declinedBefore(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * `gameId` scope-tags the subscription this card mints (shared-PWA spec) —
 * every game passes its own id. Optional only so clients written before
 * the tag keep compiling; they mint legacy any-scope records.
 */
export function useEnrollPush(gameId?: string): {
  state: EnrollPushState;
  enroll(): void;
  decline(): void;
} {
  const [state, setState] = useState<EnrollPushState>('hidden');
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Declined is remembered, not re-asked every landing (checklist P4).
    if (declinedBefore()) return;
    const playerKey = getPlayerKey();
    if (playerKey === null) return;
    if (!pushSupported()) {
      // The iOS-in-Safari case: the ask becomes an add-to-home-screen
      // explainer, and repeats once inside the installed app (where
      // pushSupported() is true and this branch never runs).
      if (isIOS()) setState('needsInstall');
      return;
    }
    void (async () => {
      const settings = await fetchSettings(playerKey);
      if (cancelled || settings === null || !settings.pushEnabled) return;
      const on = await syncSubscription(
        playerKey,
        settings.pushEndpoints,
        settings.vapidPublicKey,
        gameId,
      );
      if (cancelled || on) return; // already reachable: nothing to offer
      setVapidKey(settings.vapidPublicKey);
      setState('offer');
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const enroll = useCallback(() => {
    const playerKey = getPlayerKey();
    if (playerKey === null || vapidKey === null) return;
    setState('busy');
    void enrollPush(playerKey, vapidKey, gameId).then((result) => {
      setState(result === 'enabled' ? 'enabled' : 'failed');
    });
  }, [vapidKey, gameId]);

  const decline = useCallback(() => {
    try {
      localStorage.setItem(DECLINED_KEY, String(Date.now()));
    } catch {
      // Unstorable declines re-ask next landing; better than never asking.
    }
    setState('hidden');
  }, []);

  return { state, enroll, decline };
}
