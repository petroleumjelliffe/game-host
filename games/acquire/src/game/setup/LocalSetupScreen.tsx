import { useState } from 'react';
import { PlayerRoster, type Seat } from './PlayerRoster';

/**
 * Pass-and-play's setup: the shared roster, a start gate, and the seed tucked
 * behind a disclosure.
 *
 * The seed is a debugging affordance — it is what makes a reported game
 * reproducible — so it stays reachable without being the first thing a player
 * sees. It is regenerated per mount so consecutive games differ.
 */
export interface LocalSetupScreenProps {
  onStart: (config: { seed: string; names: string[] }) => void;
  defaultSeed?: string;
  /**
   * The roster to open on — the last table this device played, when the page
   * has one. Props-in like everything else here: the screen never touches
   * storage itself, so where the names persist is the page's business.
   */
  initialNames?: string[];
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function LocalSetupScreen({ onStart, defaultSeed, initialNames }: LocalSetupScreenProps) {
  const [seats, setSeats] = useState<Seat[]>(() =>
    initialNames && initialNames.length >= 2
      ? initialNames.map((name) => ({ name }))
      : [{ name: 'Player 1' }, { name: 'Player 2' }],
  );
  const [seed, setSeed] = useState(() => defaultSeed ?? randomSeed());

  const names = seats.map((s) => s.name.trim());
  const canStart = names.length >= 2 && names.every((n) => n.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Acquire — Startups Edition</h1>
        <p className="text-sm text-gray-600">Pass and play on one device.</p>
      </div>

      <PlayerRoster seats={seats} onChange={setSeats} />

      <details className="rounded-lg border border-gray-200 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-gray-600">Advanced</summary>
        <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
          Seed
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm font-normal normal-case tracking-normal"
          />
        </label>
        <p className="mt-1 text-xs text-gray-500">
          The same seed and the same names replay the same game.
        </p>
      </details>

      <button
        type="button"
        disabled={!canStart}
        onClick={() => onStart({ seed, names })}
        className="m-0 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Start game
      </button>
    </div>
  );
}
