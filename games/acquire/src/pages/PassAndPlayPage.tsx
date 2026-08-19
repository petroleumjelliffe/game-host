// src/pages/PassAndPlayPage.tsx
// The lobby half of the pass-and-play route split.
//
// This page owns the decision the design gives it: nothing saved → setup;
// save present → setup plus the Continue card; save stale → setup plus one
// line saying so. The game itself lives at /pass-and-play/game, which mounts
// from the save — so starting a game here means writing the initial state and
// navigating, and "new game" and "resumed game" arrive at the board the same
// way. That initial write is also what makes a refresh during the *first*
// turn return to the deal rather than to a dead route.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocalSetupScreen } from '../game/setup/LocalSetupScreen';
import { createGameSession } from '../../session/GameSession';
import { clear, load, loadFailure, save } from '../game/local/localSave';
import { loadNames, saveNames } from '../game/local/localNames';

/** `Last played: 2 days ago` — the Continue card's line, from `savedAt`. */
function lastPlayed(savedAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - savedAt) / 60_000));
  if (minutes < 1) return 'Last played: just now';
  if (minutes < 60) return `Last played: ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last played: ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `Last played: ${days} day${days === 1 ? '' : 's'} ago`;
}

export function PassAndPlayPage() {
  const navigate = useNavigate();
  // Re-read after a discard, not once per mount: the page's whole job is to
  // reflect what is saved, and the discard below changes that mid-mount.
  const [generation, setGeneration] = useState(0);
  const saved = useMemo(() => load(), [generation]);
  const failure = useMemo(() => loadFailure(), [generation]);
  const [confirming, setConfirming] = useState(false);

  const start = (config: { seed: string; names: string[] }) => {
    // The names outlive the game they start (owner: names persist on device,
    // across games) — the next setup opens on this table.
    saveNames(config.names);
    // The session is built only to deal the opening state; the game route
    // rebuilds its own from the save. One mount path over there is worth one
    // throwaway construction here.
    save(createGameSession(config).getView().state);
    navigate('game');
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50 p-6">
      <div className="mt-8 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h1 className="text-center text-xl font-bold">Pass &amp; Play</h1>
        <p className="mb-4 text-center text-sm text-gray-600">Pass and play on this device</p>

        {failure === 'stale' && (
          // Named, not silent: the failure mode being designed out is a save
          // that quietly vanished, indistinguishable from never having
          // existed. The bytes stay until a new deal overwrites them.
          <p data-testid="stale-save" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            A saved game from an older version can&rsquo;t be continued.
          </p>
        )}

        {saved ? (
          // The mockup's saved state: New Game above Continue, no roster. The
          // roster only appears once there is nothing left to discard — which
          // is what makes "confirm only when a game exists" structural: the
          // button needing a confirmation does not otherwise exist.
          <>
            {confirming ? (
              // Inline, not a modal — the modal family is deleted and stays
              // deleted. Discarding is irreversible and one press away,
              // directly above the card showing the thing it destroys.
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="mb-2 text-sm font-semibold text-red-800">Discard the saved game?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      clear();
                      setConfirming(false);
                      setGeneration((g) => g + 1);
                    }}
                    className="m-0 flex-1 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="m-0 flex-1 rounded-lg border border-gray-300 px-4 py-2 font-semibold hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="m-0 mb-4 w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
              >
                New Game
              </button>
            )}

            <p className="mb-1 text-sm font-semibold text-gray-700">Continue</p>
            <section data-testid="continue-card" className="rounded-lg border border-gray-200 p-3">
              <h2 className="font-bold">Game in progress</h2>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm text-gray-600">
                  {saved.state.players.map((p) => `${p.emoji} ${p.name}`).join(', ')}
                </p>
                <p className="flex-none text-xs text-gray-500">{lastPlayed(saved.savedAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('game')}
                className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
              >
                Continue
              </button>
            </section>
          </>
        ) : (
          <LocalSetupScreen onStart={start} initialNames={loadNames() ?? undefined} />
        )}

        <button
          type="button"
          onClick={() => navigate('/')}
          className="m-0 mt-4 w-full rounded-lg border border-gray-300 px-4 py-2 font-semibold hover:bg-gray-50"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
