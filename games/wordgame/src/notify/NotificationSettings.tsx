// The turn-notification opt-in panel. Turns may be days apart, so this is a
// first-class part of the client — but it degrades to a single honest
// sentence wherever the API is absent (the standalone dev server 404s
// /notify) or the browser lacks the machinery.

import { useCallback, useEffect, useState } from 'react';
import { fetchSettings, notifyPost, type NotifySettings } from './api';
import { getPlayerKey } from './playerKey';
import { pushSupported, urlBase64ToUint8Array } from './push';

type Load =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; settings: NotifySettings };

type EmailNote =
  | 'sent'
  | 'already'
  | 'rateLimited'
  | 'invalid'
  | 'unavailable'
  | 'failed'
  | null;

export interface NotificationSettingsProps {
  onClose(): void;
}

/** iOS can only push to an installed app; a Safari tab has no PushManager. */
function isIOS(): boolean {
  return typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function NotificationSettings({ onClose }: NotificationSettingsProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<EmailNote>(null);

  const playerKey = getPlayerKey();

  // Load settings once. Any failure — network, 404, 503 — is the same
  // honest answer: notifications are unavailable here.
  useEffect(() => {
    let cancelled = false;
    if (playerKey === null) {
      setLoad({ state: 'unavailable' });
      return;
    }
    void fetchSettings(playerKey).then((settings) => {
      if (cancelled) return;
      setLoad(settings === null ? { state: 'unavailable' } : { state: 'ready', settings });
    });
    return () => { cancelled = true; };
  }, [playerKey]);

  // Once settings are in: is this browser's subscription one the server
  // knows? Re-register silently if the browser holds one the server lost.
  useEffect(() => {
    if (load.state !== 'ready' || !load.settings.pushEnabled || !pushSupported()) return;
    if (playerKey === null) return;
    const { pushEndpoints, vapidPublicKey } = load.settings;
    let cancelled = false;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        if (cancelled) return;
        if (sub === null) {
          setPushOn(false);
          return;
        }
        if (pushEndpoints.includes(sub.endpoint)) {
          setPushOn(true);
          return;
        }
        // The browser has a subscription the server doesn't know about.
        if (vapidPublicKey !== null) {
          await notifyPost('/subscriptions', { playerKey, subscription: sub.toJSON() });
          if (!cancelled) setPushOn(true);
        }
      } catch {
        // No worker (dev), or the query failed: leave the toggle off.
      }
    })();
    return () => { cancelled = true; };
  }, [load, playerKey]);

  const enablePush = useCallback(async () => {
    if (load.state !== 'ready' || playerKey === null) return;
    const key = load.settings.vapidPublicKey;
    if (key === null) return;
    setPushBusy(true);
    setPushError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushError('Notifications are blocked for this site in your browser settings.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
      });
      const res = await notifyPost('/subscriptions', { playerKey, subscription: subscription.toJSON() });
      if (!res.ok) throw new Error('subscription refused');
      setPushOn(true);
    } catch {
      setPushError('Could not set up push on this device.');
    } finally {
      setPushBusy(false);
    }
  }, [load, playerKey]);

  const disablePush = useCallback(async () => {
    if (playerKey === null) return;
    setPushBusy(true);
    setPushError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub !== null) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await notifyPost('/subscriptions/remove', { playerKey, endpoint });
      }
      setPushOn(false);
    } catch {
      setPushError('Could not turn push off cleanly — it may already be off.');
    } finally {
      setPushBusy(false);
    }
  }, [playerKey]);

  const submitEmail = useCallback(async () => {
    if (playerKey === null) return;
    const address = email.trim();
    if (address === '') return;
    setEmailBusy(true);
    setEmailNote(null);
    try {
      const res = await notifyPost('/email', { playerKey, email: address });
      if (res.status === 429) setEmailNote('rateLimited');
      else if (res.status === 503) setEmailNote('unavailable');
      else if (res.status === 400) setEmailNote('invalid');
      else if (!res.ok) setEmailNote('failed');
      else {
        const body: unknown = await res.json();
        const result = typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>).result
          : undefined;
        setEmailNote(result === 'alreadyConfirmed' ? 'already' : 'sent');
      }
    } catch {
      setEmailNote('failed');
    } finally {
      setEmailBusy(false);
    }
  }, [playerKey, email]);

  const emailStatus = load.state === 'ready' ? load.settings.email : null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Notification settings"
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">🔔 Notifications</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notification settings"
            className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        {load.state === 'loading' && <p className="text-sm text-gray-600">Loading…</p>}

        {load.state === 'unavailable' && (
          <p className="text-sm text-gray-600">
            Notifications are unavailable on this server.
          </p>
        )}

        {load.state === 'ready' && (
          <div className="flex flex-col gap-6">
            <section>
              <h3 className="mb-1 font-semibold">Push</h3>
              {!pushSupported() ? (
                <p className="text-sm text-gray-600">This browser does not support push notifications.</p>
              ) : !load.settings.pushEnabled ? (
                <p className="text-sm text-gray-600">Push not configured on this server.</p>
              ) : (
                <>
                  <p className="mb-2 text-sm text-gray-600">
                    {pushOn
                      ? 'This device will be notified when it’s your turn.'
                      : 'Get a notification on this device when it’s your turn.'}
                  </p>
                  <button
                    type="button"
                    disabled={pushBusy}
                    onClick={() => { void (pushOn ? disablePush() : enablePush()); }}
                    className="m-0 w-full rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-2 font-semibold text-white hover:bg-[var(--lobby-accent-strong,#1d4ed8)] disabled:bg-gray-300"
                  >
                    {pushOn ? 'Turn off push' : 'Notify me when it’s my turn'}
                  </button>
                  {pushError && <p className="mt-2 text-sm text-red-700">{pushError}</p>}
                </>
              )}
              {isIOS() && (
                <p className="mt-2 text-xs text-gray-500">
                  On iPhone and iPad, push only works after adding this game to your
                  Home Screen (Share → Add to Home Screen).
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-1 font-semibold">Email</h3>
              {!load.settings.emailEnabled ? (
                <p className="text-sm text-gray-600">Email notifications aren’t set up on this server.</p>
              ) : (
                <>
                  {emailStatus !== null && emailNote === null && (
                    <p className="mb-2 text-sm text-gray-600">
                      {emailStatus.status === 'confirmed'
                        ? `Turn emails go to ${emailStatus.address}.`
                        : emailStatus.status === 'pending'
                          ? `Waiting for you to confirm ${emailStatus.address} — check your inbox; the link lasts 24 hours.`
                          : `Emails to ${emailStatus.address} are off — re-enter the address to re-enable.`}
                    </p>
                  )}
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => { e.preventDefault(); void submitEmail(); }}
                  >
                    <input
                      type="email"
                      aria-label="Email address"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); }}
                      placeholder="you@example.com"
                      className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1"
                    />
                    <button
                      type="submit"
                      disabled={emailBusy || email.trim() === ''}
                      className="m-0 rounded-lg border border-gray-300 px-3 py-1 font-semibold hover:bg-gray-50 disabled:text-gray-400"
                    >
                      Save
                    </button>
                  </form>
                  {emailNote !== null && (
                    <p className="mt-2 text-sm text-gray-600">
                      {emailNote === 'sent' && 'Check your inbox — the confirmation link lasts 24 hours.'}
                      {emailNote === 'already' && 'That address is already confirmed.'}
                      {emailNote === 'rateLimited' && 'Too many attempts for now — try again later.'}
                      {emailNote === 'invalid' && 'That doesn’t look like an email address.'}
                      {emailNote === 'unavailable' && 'Email isn’t available on this server.'}
                      {emailNote === 'failed' && 'Could not save that — try again.'}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
