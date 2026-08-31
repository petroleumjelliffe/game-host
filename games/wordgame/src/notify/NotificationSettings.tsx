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

/** Client-side gate before the address ever reaches the network. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NotificationSettings({ onClose }: NotificationSettingsProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<EmailNote>(null);
  const [validationError, setValidationError] = useState(false);
  // null means "not yet touched by the user" — editing then falls back to
  // whether there's a saved address at all.
  const [editingOverride, setEditingOverride] = useState<boolean | null>(null);
  // A successful submit updates what's shown without waiting on a refetch.
  const [emailOverride, setEmailOverride] = useState<{ address: string; status: string } | null>(null);

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

  const emailStatus = emailOverride ?? (load.state === 'ready' ? load.settings.email : null);
  const editing = editingOverride ?? (emailStatus === null);

  const onEdit = useCallback(() => {
    setEditingOverride(true);
    setDraft(emailStatus?.address ?? '');
    setValidationError(false);
    setEmailNote(null);
  }, [emailStatus]);

  const submitEmail = useCallback(async () => {
    if (playerKey === null) return;
    const address = draft.trim();
    if (address === '') return;
    if (!EMAIL_RE.test(address)) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
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
        const already = result === 'alreadyConfirmed';
        setEmailNote(already ? 'already' : 'sent');
        setEmailOverride({ address, status: already ? 'confirmed' : 'pending' });
        setEditingOverride(false);
      }
    } catch {
      setEmailNote('failed');
    } finally {
      setEmailBusy(false);
    }
  }, [playerKey, draft]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Notification settings"
        className="w-full max-w-md rounded-2xl bg-paper p-6 shadow-xl"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">🔔 Notifications</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notification settings"
            className="rounded px-2 py-1 text-ink-faint hover:bg-hairline/60"
          >
            ✕
          </button>
        </div>

        {load.state === 'loading' && <p className="text-sm text-ink-mute">Loading…</p>}

        {load.state === 'unavailable' && (
          <p className="text-sm text-ink-mute">
            Notifications are unavailable on this server.
          </p>
        )}

        {load.state === 'ready' && (
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-ink">Push</h3>
              {!pushSupported() ? (
                <p className="text-sm text-ink-mute">This browser does not support push notifications.</p>
              ) : !load.settings.pushEnabled ? (
                <p className="text-sm text-ink-mute">Push not configured on this server.</p>
              ) : (
                <>
                  <p className="text-sm text-ink-mute">
                    {pushOn
                      ? 'This device will be notified when it’s your turn.'
                      : 'Get a notification on this device when it’s your turn.'}
                  </p>
                  <button
                    type="button"
                    disabled={pushBusy}
                    onClick={() => { void (pushOn ? disablePush() : enablePush()); }}
                    className={`m-0 min-h-[42px] w-full rounded-lg border px-4 py-2 font-semibold disabled:opacity-60 ${
                      pushOn
                        ? 'border-line-strong bg-white text-ink-soft'
                        : 'border-accent bg-accent text-white'
                    }`}
                  >
                    {pushOn ? 'Turn off push' : 'Notify me when it’s my turn'}
                  </button>
                  {pushError && <p className="text-sm text-danger-ink">{pushError}</p>}
                </>
              )}
              {isIOS() && (
                <p className="text-xs text-ink-ghost">
                  On iPhone and iPad, push only works after adding this game to your
                  Home Screen (Share → Add to Home Screen).
                </p>
              )}
            </section>

            <div className="h-px bg-hairline" />

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-ink">Email</h3>
              {!load.settings.emailEnabled ? (
                <p className="text-sm text-ink-mute">Email notifications aren’t set up on this server.</p>
              ) : (
                <>
                  {emailStatus !== null && emailNote === null && (
                    <p
                      className={`rounded-lg px-2.5 py-2 text-sm ${
                        emailStatus.status === 'confirmed'
                          ? 'bg-[#edf5ee] text-[#3f7a4d]'
                          : 'bg-warnbg text-warn-ink'
                      }`}
                    >
                      {emailStatus.status === 'confirmed'
                        ? `Turn emails go to ${emailStatus.address}.`
                        : emailStatus.status === 'pending'
                          ? `Waiting for you to confirm ${emailStatus.address} — check your inbox; the link lasts 24 hours.`
                          : `Emails to ${emailStatus.address} are off — re-enter the address to re-enable.`}
                    </p>
                  )}

                  {!editing && emailStatus !== null ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 py-2 text-sm text-ink">{emailStatus.address}</div>
                      <button
                        type="button"
                        onClick={onEdit}
                        className="rounded px-0.5 py-2 text-sm font-semibold text-accent hover:text-accent-strong"
                      >
                        Edit
                      </button>
                    </div>
                  ) : (
                    <>
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => { e.preventDefault(); void submitEmail(); }}
                      >
                        <input
                          type="text"
                          aria-label="Email address"
                          value={draft}
                          onChange={(e) => { setDraft(e.target.value); setValidationError(false); }}
                          placeholder="you@example.com"
                          className={`min-w-0 flex-1 rounded-lg border bg-white px-2.5 py-2 text-sm text-ink outline-none ${
                            validationError ? 'border-danger-ink' : 'border-line-strong'
                          }`}
                        />
                        <button
                          type="submit"
                          disabled={emailBusy || draft.trim() === ''}
                          className="m-0 rounded-lg border border-accent bg-accent px-3.5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-line disabled:text-ink-faint"
                        >
                          Save
                        </button>
                      </form>
                      {validationError && (
                        <p className="text-xs text-danger-ink">Enter a valid email address.</p>
                      )}
                    </>
                  )}

                  {emailNote !== null && (
                    <p className="text-sm text-ink-mute">
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

            {emailStatus !== null && emailStatus.status === 'confirmed' && (
              <div className="rounded-lg border border-accent bg-[#f0f5ff] px-3 py-2.5 text-sm text-accent-strong">
                ✓ You’re set — the 🔔 badge now shows on your profile
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
