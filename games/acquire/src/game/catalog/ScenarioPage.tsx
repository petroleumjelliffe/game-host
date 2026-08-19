import { useMemo, useState } from 'react';
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';
import { createGameSession } from '../../../session/GameSession';
import { GameScreen } from '../GameScreen';
import type { GameState } from '../../../engine/gameTypes';

/**
 * Jump into any state of any golden game and play from it.
 *
 * The catalog answers "does this component look right"; this answers "does the
 * game *work* from here". Reaching a merger by playing takes several minutes
 * and the right seed; reaching one here takes two clicks, and from that point
 * the screen is the real one — a real `GameSession` over the real reducer, with
 * every control live. Whatever you do next is a genuine game, discarded on
 * reload.
 *
 * Deliberately built on the golden corpus rather than on hand-written fixtures.
 * The corpus is the executable rules spec, so every state offered here is one
 * the rules actually produce — a hand-authored "merger about to happen" can be
 * a state no game could reach, which is exactly how a UI comes to handle a case
 * that does not exist and miss one that does.
 *
 * **Lazily routed** (see `src/App.tsx`): it imports the golden games and
 * replays them, and none of that belongs in the main chunk.
 * `npm run check:bundle` is the guard.
 */
interface Scenario {
  gameId: string;
  title: string;
  /** Index into the replay: 0 is the built fixture, i+1 the state after step i. */
  step: number;
  /** What the step that produced this state was called, or the game's own title. */
  label: string;
  state: GameState;
}

function scenariosFor(gameId: string): Scenario[] {
  const game = ALL_GOLDEN_GAMES.find((g) => g.id === gameId);
  if (!game) return [];
  const states = replayGoldenGame(game);

  return states.map((state, i) => ({
    gameId,
    title: game.title,
    step: i,
    label: i === 0 ? 'opening position' : (game.steps[i - 1]?.name ?? `step ${i}`),
    state,
  }));
}

/** A one-line summary of what is on the board, so a step can be picked by sight. */
function summarise(state: GameState): string {
  const cells = Object.values(state.board);
  const placed = cells.filter((c) => c.placed).length;
  const actor = state.players[state.turnIndex]?.name ?? '—';

  // Counted from the board, not from `Startup.tiles`: the intent path claims a
  // chain by writing `startupId` onto each cell, and that array is not what it
  // maintains. Reading it here reported every chain as ×0.
  const size = new Map<string, number>();
  for (const cell of cells) {
    if (cell.placed && cell.startupId) size.set(cell.startupId, (size.get(cell.startupId) ?? 0) + 1);
  }
  const chains = size.size === 0
    ? 'no chains'
    : [...size].map(([id, n]) => `${id} ×${n}`).join(', ');

  return `${state.stage} · ${actor} · ${placed} tiles · ${chains}`;
}

/** G2 before G10: the ids are numbered, so they sort as numbers. */
const GAMES = [...ALL_GOLDEN_GAMES].sort(
  (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
);

export default function ScenarioPage() {
  const [gameId, setGameId] = useState(GAMES[0]?.id ?? '');
  const [picked, setPicked] = useState<Scenario | null>(null);
  /**
   * Which seat the screen belongs to, or none.
   *
   * None is pass-and-play: the curtain between turns, and the panel follows
   * whoever is acting. A seat is the online view — the same screen a player
   * sees on their own device, including all the watching states, which are
   * otherwise reachable only by opening two browsers.
   */
  const [seat, setSeat] = useState<string | undefined>(undefined);

  const scenarios = useMemo(() => scenariosFor(gameId), [gameId]);

  // Keyed so that picking a different scenario builds a fresh session rather
  // than pushing a new state into the old one — a session owns its own history,
  // and a rewind into a state from another game is not a thing to offer.
  if (picked) {
    return (
      <div className="relative h-screen w-full">
        <GameScreen
          key={`${picked.gameId}-${picked.step}-${seat ?? 'all'}`}
          session={createGameSession({ state: picked.state })}
          viewerId={seat}
          onExit={() => setPicked(null)}
        />
        {/*
          Also the way out. `GameScreen`'s own `onExit` renders inside the
          final-scoring overlay, so a scenario picked mid-game would otherwise
          strand you — and most scenarios worth loading are mid-game.
        */}
        <div className="absolute left-1/2 top-2 z-40 -translate-x-1/2">
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="m-0 rounded-full bg-gray-900/85 px-3 py-1 text-[11px] font-semibold text-white hover:bg-gray-900"
          >
            ← scenarios · {picked.gameId} step {picked.step} · {seat ? `as ${seat}` : 'pass-and-play'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold">Scenarios</h1>
      <p className="mt-1 text-sm text-gray-600">
        Any state of any golden game, playable from that point. The rules are real, the state is one
        the rules produced, and nothing you do here is saved.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {GAMES.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGameId(g.id)}
            className={
              g.id === gameId
                ? 'm-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white'
                : 'm-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50'
            }
          >
            {g.id}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm font-semibold text-gray-800">
        {GAMES.find((g) => g.id === gameId)?.title}
      </p>

      <fieldset className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <legend className="sr-only">Whose screen</legend>
        <span className="font-semibold text-gray-700">View as</span>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="seat"
            checked={seat === undefined}
            onChange={() => setSeat(undefined)}
          />
          Pass-and-play
        </label>
        {(scenarios[0]?.state.players ?? []).map((p) => (
          <label key={p.id} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="seat"
              checked={seat === p.id}
              onChange={() => setSeat(p.id)}
            />
            {p.emoji} {p.name}
          </label>
        ))}
      </fieldset>

      <ol className="mt-5 flex flex-col gap-1.5">
        {scenarios.map((s) => (
          <li key={s.step}>
            <button
              type="button"
              onClick={() => setPicked(s)}
              className="m-0 flex w-full flex-col items-start gap-0.5 rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-blue-400 hover:bg-blue-50"
            >
              <span className="text-sm font-semibold text-gray-900">
                {s.step}. {s.label}
              </span>
              <span className="text-xs text-gray-500">{summarise(s.state)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
