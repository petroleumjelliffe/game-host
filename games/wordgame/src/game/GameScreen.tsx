// The in-game screen. Functional, not fancy: one column that fits a phone —
// header, roster chips, status, last-move banner, board, rack, actions, log.
// All state here is *staging* (tiles placed this turn but not yet sent); the
// game itself is the server's view, replaced wholesale on every commit, and
// an arriving view resets the staging so the two can never disagree for long.

import { useEffect, useState, type ButtonHTMLAttributes } from 'react';
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
import { PlayerChips } from './PlayerChips';
import { LastMove } from './LastMove';
import { MoveLog } from './MoveLog';
import { GameOverPanel } from './GameOverPanel';
import { RejectionNote } from './RejectionNote';
import { seatEmoji } from './seatEmoji';
import { NotificationSettings } from '../notify/NotificationSettings';
import { useNotifyStatus } from '../notify/useNotifyStatus';

export interface GameScreenProps {
  view: GameView;
  viewerId: string;
  roomId: string;
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

/** One of the four 46px icon+caption action buttons. `className` overrides
 * the default border/fill entirely — the pass button's armed (red) state
 * needs that, everything else takes the default. */
function Ctl({
  icon,
  label,
  className,
  ...rest
}: { icon: string; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`m-0 flex w-[46px] flex-none flex-col items-center justify-center rounded-xl border-[1.5px] disabled:text-ink-ghost ${
        className ?? 'border-line-strong bg-white text-ink-soft'
      }`}
    >
      <span className="text-base leading-none" aria-hidden>{icon}</span>
      <span className="text-[8.5px] font-semibold">{label}</span>
    </button>
  );
}

export function GameScreen({
  view, viewerId, roomId, connected, presence, sendMove, rejection, onDismissRejection, onExit,
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
  const { status: notifyStatus, refresh: refreshNotify } = useNotifyStatus();

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
  const bingoStaging = myTurn && localRack.length === 0 && staged.length === 7;

  const myInitial = view.players.find((p) => p.id === viewerId)?.name[0] ?? '·';
  const otherNames = view.players.filter((p) => p.id !== viewerId).map((p) => p.name).join(', ');

  const lastPlay = [...view.log].reverse().find((r) => r.kind === 'play');
  const lastPlayPositions = lastPlay?.positions;

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
    <div data-testid="game-screen" className="mx-auto flex min-h-screen max-w-2xl flex-col bg-paper pb-6">
      <header className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <button
          type="button"
          onClick={onExit}
          className="m-0 flex-none border-0 bg-transparent p-0 text-[15px] font-semibold text-accent"
        >
          ‹ Lobby
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-ink">
          vs {otherNames} · <span className="tracking-widest text-ink-faint">{roomId}</span>
        </div>
        <button
          type="button"
          aria-label="Notifications"
          onClick={() => { setNotifyOpen(true); }}
          className="relative m-0 flex h-8 w-8 flex-none items-center justify-center rounded-full border-0 bg-chipbg text-sm font-semibold text-ink-soft"
        >
          {myInitial}
          {notifyStatus === 'on' && (
            <span
              data-testid="notify-badge"
              className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-paper bg-accent text-[8px]"
            >
              🔔
            </span>
          )}
        </button>
      </header>

      <PlayerChips
        view={view}
        viewerId={viewerId}
        {...(presence === undefined ? {} : { presence })}
        seatEmoji={seatEmoji}
      />

      <div
        data-testid="turn-status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 pt-2.5 text-[12.5px] font-semibold"
      >
        {view.stage === 'playing' ? (
          myTurn ? (
            <span className="text-accent">
              {bingoStaging ? 'Your turn — all seven tiles played!' : 'Your turn'}
            </span>
          ) : (
            <span className="text-ink-faint">
              {current?.name ?? '…'}’s turn{notifyStatus === 'on' ? ' — you’ll get a nudge' : ''}
            </span>
          )
        ) : (
          <span className="text-ink-faint">Game over</span>
        )}
        {view.scorelessTurns > 0 && (
          <span className="font-normal text-ink-faint" data-testid="scoreless-counter">
            Scoreless turns: {view.scorelessTurns}/6
          </span>
        )}
      </div>

      <LastMove view={view} seatEmoji={seatEmoji} />

      {rejection !== null && (
        <div className="px-3.5 pt-2.5">
          <RejectionNote rejection={rejection} onDismiss={onDismissRejection} />
        </div>
      )}

      {view.stage === 'over' && (
        <div className="px-3.5 pt-2.5">
          <GameOverPanel view={view} />
        </div>
      )}

      <div className="px-3.5 pt-3">
        <Board board={view.board} staged={staged} lastPositions={lastPlayPositions} onCellTap={cellTap} />
      </div>

      {view.stage === 'playing' && (
        <>
          <div className="px-3.5 pt-3.5">
            <Rack
              tiles={localRack}
              selected={exchangeOn ? exchangeSel : selected === null ? [] : [selected]}
              onTileTap={rackTap}
              bagCount={view.bagCount}
            />
          </div>

          {exchangeOn ? (
            <div className="flex flex-col items-center gap-2 px-3.5 pb-1 pt-3.5">
              <p className="text-sm text-ink-soft">Select tiles to swap, then confirm.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={confirmExchange}
                  disabled={!canAct || exchangeSel.length === 0}
                  className="m-0 rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:bg-line"
                >
                  Confirm swap ({exchangeSel.length})
                </button>
                <button
                  type="button"
                  onClick={toggleExchange}
                  className="m-0 rounded-lg border border-line px-4 py-2 hover:bg-page"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 px-3.5 pb-1 pt-3.5">
              <button
                type="button"
                onClick={play}
                disabled={!canAct || staged.length === 0}
                className="m-0 flex min-h-[46px] flex-1 items-center justify-center rounded-xl bg-accent font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-ghost"
              >
                Play
              </button>
              <Ctl
                icon="↺"
                label="RECALL"
                aria-label="Recall"
                onClick={recall}
                disabled={staged.length === 0}
              />
              <Ctl
                icon="⇄"
                label="SWAP"
                aria-label="Swap"
                onClick={toggleExchange}
                disabled={!canAct || !exchangeAllowed}
                title={exchangeAllowed ? undefined : `Exchanging needs at least ${EXCHANGE_MINIMUM_BAG} tiles in the bag`}
              />
              <Ctl
                icon="»"
                label={passArmed ? 'SURE?' : 'PASS'}
                aria-label={passArmed ? 'Pass — sure?' : 'Pass'}
                onClick={pass}
                disabled={!canAct}
                className={passArmed ? 'border-red-400 bg-red-50 text-red-700' : undefined}
              />
              <Ctl icon="⤨" label="MIX" aria-label="Mix" onClick={shuffleRack} />
            </div>
          )}
          {!exchangeAllowed && !exchangeOn && (
            <p className="px-3.5 text-center text-xs text-ink-faint">
              Exchanging needs at least {EXCHANGE_MINIMUM_BAG} tiles in the bag ({view.bagCount} left).
            </p>
          )}
        </>
      )}

      <section className="px-3.5 pb-3 pt-3">
        <h2 className="mb-1 text-sm font-semibold text-ink-soft">Moves</h2>
        <MoveLog view={view} />
      </section>

      {pendingBlank !== null && (
        <BlankPicker onPick={pickBlank} onCancel={() => { setPendingBlank(null); }} />
      )}

      {notifyOpen && (
        <NotificationSettings onClose={() => { setNotifyOpen(false); refreshNotify(); }} />
      )}
    </div>
  );
}
