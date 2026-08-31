/**
 * A client and a server that do not speak the same protocol.
 *
 * The copy names no culprit, and that is the deliberate part. This client
 * ships to GitHub Pages and the server to Render, independently, so **either**
 * can be the newer one — "your app is out of date" would be wrong half the
 * time, and wrong in the direction that sends a player to reload something
 * already current.
 *
 * A reload is the remedy for the common half, and today it works on its own: a
 * refresh fetches the current bundle. That stops being true once a service
 * worker caches the shell, which is exactly why the protocol version landed
 * before the PWA rather than inside it — at that point this button has to
 * reload *past* the worker.
 */
export interface StaleClientProps {
  onReload(): void;
  onExit(): void;
}

export function StaleClient({ onReload, onExit }: StaleClientProps) {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div
        data-testid="stale-client"
        className="mx-auto max-w-md rounded-xl bg-white p-8 text-center shadow-xl"
      >
        <h1 className="mb-2 text-2xl font-bold">This version can&rsquo;t talk to the server</h1>
        <p className="mb-6 text-sm text-gray-600">
          The app and the server are on different versions. Reloading usually
          settles it; if it does not, the server is the one still catching up.
        </p>

        <button
          type="button"
          onClick={onReload}
          className="m-0 w-full rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-semibold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)]"
        >
          Reload to update
        </button>
        <button
          type="button"
          onClick={onExit}
          className="mt-2 w-full rounded-lg px-4 py-3 font-semibold text-gray-600 hover:bg-gray-100"
        >
          Back to the lobby
        </button>
      </div>
    </div>
  );
}
