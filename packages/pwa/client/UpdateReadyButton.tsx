import { isInstalledApp } from './installed.js';
import { useUpdateReady } from './update.js';

/**
 * The "a new build is waiting" affordance, extracted from acquire's
 * HomePage. The gate lives here rather than at every call site: in a
 * browser tab this is noise — a plain refresh picks the new build up
 * through the network-first worker — but the installed app has no refresh
 * gesture, so this button is its one civilised way in (owner, from the
 * first real install). When nothing is waiting, or this is a tab, it
 * renders nothing at all — so a game's entry page can include it
 * unconditionally.
 *
 * Styling is the same `--lobby-*` seam as StaleClient: a quiet bordered
 * row, never a primary action.
 */
export function UpdateReadyButton() {
  const update = useUpdateReady();
  if (!isInstalledApp() || !update.ready) return null;
  return (
    <button
      type="button"
      onClick={update.apply}
      style={{
        display: 'block',
        width: '100%',
        marginTop: '0.75rem',
        borderRadius: '0.5rem',
        border: '1px solid var(--lobby-line, #d1d5db)',
        background: 'transparent',
        padding: '0.5rem 1rem',
        font: 'inherit',
        fontSize: '0.875rem',
        color: 'var(--lobby-ink-soft, #4b5563)',
        cursor: 'pointer',
      }}
    >
      Update ready — restart the app
    </button>
  );
}
