import type { CSSProperties } from 'react';

/**
 * A client and a server that do not speak the same protocol.
 *
 * The copy names no culprit, and that is the deliberate part. The client
 * (an installed app's cached shell) and the server deploy independently, so
 * **either** can be the newer one — "your app is out of date" would be wrong
 * half the time, and wrong in the direction that sends a player to reload
 * something already current.
 *
 * The reload handed in as `onReload` should be `forceUpdateAndReload`
 * (update.ts) in any game with a service worker: a plain location.reload()
 * can be served the same stale shell again and loop.
 *
 * Shared across games, so styling rides the `--lobby-*` CSS-variable seam
 * with the same fallbacks every lobby component carries — inline styles
 * rather than tailwind classes, because each game's tailwind config maps
 * its own tokens and a workspace package can ride neither. A game themes it
 * by defining the variables; undefined, it is the neutral card the games
 * shipped before extraction.
 */
export interface StaleClientProps {
  onReload(): void;
  onExit(): void;
}

const page: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--lobby-page-bg, #f9fafb)',
  padding: '1.5rem',
  boxSizing: 'border-box',
};

const card: CSSProperties = {
  maxWidth: '28rem',
  margin: '0 auto',
  borderRadius: '0.75rem',
  background: 'var(--lobby-card-bg, #ffffff)',
  color: 'var(--lobby-ink, #111827)',
  padding: '2rem',
  textAlign: 'center',
  boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
};

const button: CSSProperties = {
  display: 'block',
  width: '100%',
  borderRadius: '0.5rem',
  border: 'none',
  padding: '0.75rem 1rem',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
};

export function StaleClient({ onReload, onExit }: StaleClientProps) {
  return (
    <div style={page}>
      <div data-testid="stale-client" style={card}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem', fontWeight: 700 }}>
          This version can&rsquo;t talk to the server
        </h1>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.875rem', color: 'var(--lobby-ink-soft, #4b5563)' }}>
          The app and the server are on different versions. Reloading usually
          settles it; if it does not, the server is the one still catching up.
        </p>

        <button
          type="button"
          onClick={onReload}
          style={{
            ...button,
            background: 'var(--lobby-accent, #2563eb)',
            color: 'var(--lobby-on-accent, #ffffff)',
          }}
        >
          Reload to update
        </button>
        <button
          type="button"
          onClick={onExit}
          style={{
            ...button,
            marginTop: '0.5rem',
            background: 'transparent',
            color: 'var(--lobby-ink-soft, #4b5563)',
          }}
        >
          Back to the lobby
        </button>
      </div>
    </div>
  );
}
