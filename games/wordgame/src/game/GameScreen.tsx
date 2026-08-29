// The in-game screen. Functional, not fancy: one column that fits a phone —
// status, board, rack, actions, scores, log. All state here is *staging*
// (tiles placed this turn but not yet sent); the game itself is the server's
// view, replaced wholesale on every commit, and an arriving view resets the
// staging so the two can never disagree for long.

import { useEffect, useState } from 'react';
import { EXCHANGE_MINIMUM_BAG } from '../../engine/intents';
import type { Letter, Tile } from '../../engine/constants';
import type {
  GameView,
  MoveRejectedMessage,
  Placement,
  WireMove,
} from '../../session/protocol';
import { Board } from './Board';
import { Rack } from './Rack';
import { BlankPicker } from './BlankPicker';
import { ScorePanel } from './ScorePanel';
import { MoveLog } from './MoveLog';
import { GameOverPanel } from './GameOverPanel';
import { RejectionNote } from './RejectionNote';
import { NotificationSettings } from '../notify/NotificationSettings';

export interface GameScreenProps {
  view: GameView;
  viewerId: string;
  connected: boolean;
  /** Roster presence by playerId; undefined reads as "everyone present". */
  presence?: Record<string, boolean>;
  sendMove(move: WireMove): void;
  rejection: MoveRejectedMessage | null;
  onDismissRejection(): void;
  onExit(): void;
}

function shuffled<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

export function GameScreen({
  view, viewerId, connected, presence, sendMove, rejection, onDismissRejection, onExit,
}: GameScreenProps) {
  // The rack as displayed: the server's rack minus staged tiles, in a
  // locally shuffled order. Rebuilt whenever a new view arrives.
  const [localRack, setLocalRack] = useState<Tile[]>([]);
  const [staged, setStaged] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [exchangeOn, setExchangeOn] = useState(false);
  const [exchangeSel, setExchangeSel] = useState<number[]>([]);
  const [pendingBlank, setPendingBlank] = useState<{ pos: number; rackIndex: number } | null>(null);
  const [passArmed, setPassArmed] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);

  useEffect(() => {
    const me = view.players.find((p) => p.id === viewerId);
    setLocalRack(me?.rack ?? []);
    setStaged([]);
    setSelected(null);
    setExchangeOn(false);
    setExchangeSel([]);
    setPendingBlank(null);
    setPassArmed(false);
  }, [view, viewerId]);

  const current = view.players.find((p) => p.id === view.currentPlayerId);
  const myTurn = view.stage === 'playing' && view.currentPlayerId === viewerId;
  const canAct = myTurn && connected;
  const exchangeAllowed = view.bagCount >= EXCHANGE_MINIMUM_BAG;

  const removeRackAt = (index: number) => {
    setLocalRack((rack) => rack.filter((_, i) => i !== index));
  };

  const rackTap = (index: number) => {
    setPassArmed(false);
    if (exchangeOn) {
      setExchangeSel((sel) =>
        sel.includes(index) ? sel.filter((i) => i !== index) : [...sel, index],
      );
      return;
    }
    setSelected((prev) => (prev === index ? null : index));
  };

  const cellTap = (pos: number) => {
    if (view.board[pos] != null) return;
    setPassArmed(false);

    const stagedHere = staged.find((p) => p.pos === pos);
    if (stagedHere !== undefined) {
      // Tap a staged tile to take it back.
      setStaged((prev) => prev.filter((p) => p.pos !== pos));
      setLocalRack((rack) => [...rack, stagedHere.tile]);
      return;
    }

    if (exchangeOn || selected === null) return;
    const tile = localRack[selected];
    if (tile === undefined) return;
    if (tile === '_') {
      setPendingBlank({ pos, rackIndex: selected });
      return;
    }
    setStaged((prev) => [...prev, { pos, tile }]);
    removeRackAt(selected);
    setSelected(null);
  };

  const pickBlank = (letter: Letter) => {
    if (pendingBlank === null) return;
    setStaged((prev) => [...prev, { pos: pendingBlank.pos, tile: '_', as: letter }]);
    removeRackAt(pendingBlank.rackIndex);
    setSelected(null);
    setPendingBlank(null);
  };

  const recall = () => {
    if (staged.length === 0) return;
    setLocalRack((rack) => [...rack, ...staged.map((p) => p.tile)]);
    setStaged([]);
    setSelected(null);
  };

  const shuffleRack = () => {
    setLocalRack(shuffled);
    setSelected(null);
    setExchangeSel([]);
  };

  const toggleExchange = () => {
    if (exchangeOn) {
      setExchangeOn(false);
      setExchangeSel([]);
      return;
    }
    recall();
    setSelected(null);
    setExchangeOn(true);
    setExchangeSel([]);
  };

  const confirmExchange = () => {
    const tiles = exchangeSel
      .map((i) => localRack[i])
      .filter((t): t is Tile => t !== undefined);
    if (tiles.length === 0) return;
    sendMove({ type: 'exchange', tiles });
    setExchangeOn(false);
    setExchangeSel([]);
  };

  const play = () => {
    if (staged.length === 0) return;
    sendMove({ type: 'play', placements: staged });
  };

  const pass = () => {
    if (!passArmed) {
      setPassArmed(true);
      return;
    }
    setPassArmed(false);
    sendMove({ type: 'pass' });
  };

  return (
    <div data-testid="game-screen" className="mx-auto flex min-h-screen max-w-2xl flex-col gap-3 p-2 pb-6 sm:p-4">
      <header className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">Word Game</h1>
        <button
          type="button"
          onClick={() => { setNotifyOpen(true); }}
          className="m-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          🔔 Notifications
        </button>
        <button
          type="button"
          onClick={onExit}
          className="m-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Leave
        </button>
      </header>

      <div data-testid="turn-status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {view.stage === 'playing' ? (
          myTurn ? (
            <span className="rounded bg-yellow-200 px-2 py-0.5 font-bold">Your turn</span>
          ) : (
            <span className="font-semibold">{current?.name ?? '…'}’s turn</span>
          )
        ) : (
          <span className="font-semibold">Game over</span>
        )}
        <span className="text-gray-600">Bag: {view.bagCount}</span>
        {view.scorelessTurns > 0 && (
          <span className="text-gray-600" data-testid="scoreless-counter">
            Scoreless turns: {view.scorelessTurns}/6
          </span>
        )}
      </div>

      {rejection !== null && (
        <RejectionNote rejection={rejection} onDismiss={onDismissRejection} />
      )}

      {view.stage === 'over' && <GameOverPanel view={view} />}

      <Board board={view.board} staged={staged} onCellTap={cellTap} />

      {view.stage === 'playing' && (
        <>
          <Rack
            tiles={localRack}
            selected={exchangeOn ? exchangeSel : selected === null ? [] : [selected]}
            onTileTap={rackTap}
          />

          {exchangeOn ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-gray-600">Select tiles to exchange, then confirm.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={confirmExchange}
                  disabled={!canAct || exchangeSel.length === 0}
                  className="m-0 rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-2 font-semibold text-white disabled:bg-gray-300"
                >
                  Confirm exchange ({exchangeSel.length})
                </button>
                <button
                  type="button"
                  onClick={toggleExchange}
                  className="m-0 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={play}
                disabled={!canAct || staged.length === 0}
                className="m-0 rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Play
              </button>
              <button
                type="button"
                onClick={recall}
                disabled={staged.length === 0}
                className="m-0 rounded-lg border border-gray-300 px-3 py-2 hover:bg-gray-50 disabled:text-gray-400"
              >
                Recall
              </button>
              <button
                type="button"
                onClick={toggleExchange}
                disabled={!canAct || !exchangeAllowed}
                title={exchangeAllowed ? undefined : `Exchanging needs at least ${EXCHANGE_MINIMUM_BAG} tiles in the bag`}
                className="m-0 rounded-lg border border-gray-300 px-3 py-2 hover:bg-gray-50 disabled:text-gray-400"
              >
                Exchange
              </button>
              <button
                type="button"
                onClick={pass}
                disabled={!canAct}
                className={`m-0 rounded-lg border px-3 py-2 disabled:text-gray-400 ${
                  passArmed ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                {passArmed ? 'Pass — sure?' : 'Pass'}
              </button>
              <button
                type="button"
                onClick={shuffleRack}
                className="m-0 rounded-lg border border-gray-300 px-3 py-2 hover:bg-gray-50"
              >
                Shuffle
              </button>
            </div>
          )}
          {!exchangeAllowed && !exchangeOn && (
            <p className="text-center text-xs text-gray-500">
              Exchanging needs at least {EXCHANGE_MINIMUM_BAG} tiles in the bag ({view.bagCount} left).
            </p>
          )}
        </>
      )}

      <ScorePanel view={view} viewerId={viewerId} {...(presence === undefined ? {} : { presence })} />

      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Moves</h2>
        <MoveLog view={view} />
      </section>

      {pendingBlank !== null && (
        <BlankPicker onPick={pickBlank} onCancel={() => { setPendingBlank(null); }} />
      )}

      {notifyOpen && <NotificationSettings onClose={() => { setNotifyOpen(false); }} />}
    </div>
  );
}
