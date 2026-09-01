// The in-game screen. Functional, not fancy: one column that fits a phone —
// header, roster chips, status, last-move banner, board, rack, actions, log.
// All state here is *staging* (tiles placed this turn but not yet sent); the
// game itself is the server's view, replaced wholesale on every commit, and
// an arriving view resets the staging so the two can never disagree for long.

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { EXCHANGE_MINIMUM_BAG } from '../../engine/intents';
import { colOf, rowOf } from '../../engine/board';
import { TILE_VALUES, type Letter, type Tile } from '../../engine/constants';
import type {
  GameView,
  MoveRejectedMessage,
  Placement,
  WireMove,
} from '../../session/protocol';
import { Board } from './Board';
import { BoardViewport } from './BoardViewport';
import { dropAction, hitCell, moveTile, rackSlot, type DragSource } from './dragPlan';
import { useTileDrag } from './useTileDrag';
import { Rack } from './Rack';
import { BlankPicker } from './BlankPicker';
import { PlayerChips } from './PlayerChips';
import { LastMove } from './LastMove';
import { MoveLog } from './MoveLog';
import { GameOverPanel } from './GameOverPanel';
import { RejectionNote } from './RejectionNote';
import { previewPlay } from './scorePreview';
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

/** One server rack tile for the whole turn: `stagedAt` is its board square
 * while staged (its rack slot renders reserved), `as` a blank's chosen
 * letter. The id is the tile's identity for animation across reorders. */
interface RackEntry {
  id: number;
  tile: Tile;
  stagedAt: number | null;
  as?: Letter;
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
  // The rack as displayed: every server tile keeps a slot for the whole
  // turn — staging marks an entry with its board position and the slot
  // renders reserved (dashed) until the tile comes home (the motion spec's
  // "the rack slot stays reserved while the tile is on the board").
  // Stable ids give animations tile identity across reorders. Rebuilt
  // whenever a new view arrives.
  const [rack, setRack] = useState<RackEntry[]>([]);
  const nextEntryId = useRef(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [exchangeOn, setExchangeOn] = useState(false);
  const [exchangeSel, setExchangeSel] = useState<number[]>([]);
  const [pendingBlank, setPendingBlank] = useState<{ pos: number; rackIndex: number } | null>(null);
  const [passArmed, setPassArmed] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const { status: notifyStatus, refresh: refreshNotify } = useNotifyStatus();

  useEffect(() => {
    const me = view.players.find((p) => p.id === viewerId);
    setRack((me?.rack ?? []).map((tile) => {
      const id = nextEntryId.current;
      nextEntryId.current += 1;
      return { id, tile, stagedAt: null };
    }));
    setSelected(null);
    setExchangeOn(false);
    setExchangeSel([]);
    setPendingBlank(null);
    setPassArmed(false);
  }, [view, viewerId]);

  // What's on the board this turn, derived — the entry array is the only
  // truth, so the wire shape (and preview, and Board) never learn about it.
  const staged: Placement[] = rack
    .filter((e): e is RackEntry & { stagedAt: number } => e.stagedAt !== null)
    .map((e) => (e.tile === '_'
      ? { pos: e.stagedAt, tile: '_', as: e.as ?? 'A' }
      : { pos: e.stagedAt, tile: e.tile }));

  const current = view.players.find((p) => p.id === view.currentPlayerId);
  const myTurn = view.stage === 'playing' && view.currentPlayerId === viewerId;
  const canAct = myTurn && connected;
  const exchangeAllowed = view.bagCount >= EXCHANGE_MINIMUM_BAG;
  const bingoStaging = myTurn && staged.length === 7 && rack.every((e) => e.stagedAt !== null);
  // Optimistic score preview for what's staged right now — geometry and
  // arithmetic only, no dictionary (see scorePreview.ts). null whenever
  // there's nothing to price: not your turn, mid-exchange, or an
  // ungeometric/wordless staging.
  const preview = myTurn && !exchangeOn ? previewPlay(view.board, staged) : null;

  const myInitial = view.players.find((p) => p.id === viewerId)?.name[0] ?? '·';
  const otherNames = view.players.filter((p) => p.id !== viewerId).map((p) => p.name).join(', ');

  const lastPlay = [...view.log].reverse().find((r) => r.kind === 'play');
  const lastPlayPositions = lastPlay?.positions;

  /** Stage a rack tile onto an empty cell — shared by tap and drag; a blank
   * detours through the picker either way. The entry keeps its slot. */
  const placeFromRack = (rackIndex: number, pos: number) => {
    const entry = rack[rackIndex];
    if (entry === undefined || entry.stagedAt !== null) return;
    if (entry.tile === '_') {
      setPendingBlank({ pos, rackIndex });
      return;
    }
    setRack((prev) => prev.map((e, i) => (i === rackIndex ? { ...e, stagedAt: pos } : e)));
    setSelected(null);
  };

  /** Take one staged tile back — to its own reserved slot (a tap or an
   * off-board drop), or moved to `slot` when a drag said where. */
  const recallOne = (pos: number, slot: number | null) => {
    setRack((prev) => {
      const idx = prev.findIndex((e) => e.stagedAt === pos);
      if (idx === -1) return prev;
      const cleared = prev.map((e, i) =>
        (i === idx ? { id: e.id, tile: e.tile, stagedAt: null } : e));
      return slot === null ? cleared : moveTile(cleared, idx, slot);
    });
  };

  // Drop targeting measures live rects: they already reflect the zoom
  // transform, so the same math lands the same cell at 1× and 3×.
  const boardGridRef = useRef<HTMLDivElement>(null);
  const rackTilesRef = useRef<HTMLDivElement>(null);
  const dragEnabled = view.stage === 'playing' && !exchangeOn;

  const { drag, start: startDrag, consumeDragClick } = useTileDrag((source, p) => {
    const bRect = boardGridRef.current?.getBoundingClientRect();
    const cell = bRect === undefined ? null : hitCell(bRect, p);
    const rRect = rackTilesRef.current?.getBoundingClientRect();
    const visible = rack.length - (source.kind === 'rack' ? 1 : 0);
    const slot = cell !== null || rRect === undefined ? null : rackSlot(rRect, p, visible);
    const action = dropAction(source, cell, slot, view.board, staged);
    switch (action.kind) {
      case 'place': placeFromRack(action.rackIndex, action.pos); break;
      case 'moveStaged':
        setRack((prev) => prev.map((e) => (e.stagedAt === action.from ? { ...e, stagedAt: action.pos } : e)));
        break;
      case 'reorderRack':
        setRack((prev) => moveTile(prev, action.from, action.slot));
        setSelected(null);
        break;
      case 'recallAt': recallOne(action.from, action.slot); break;
      case 'none': break;
    }
  });

  // Live hover: which tray slot the current drag would drop into — drives
  // the sliding insertion gap.
  const hoverSlot = (() => {
    if (drag === null || !drag.active) return null;
    const rRect = rackTilesRef.current?.getBoundingClientRect();
    if (rRect === undefined) return null;
    const visible = rack.length - (drag.source.kind === 'rack' ? 1 : 0);
    return rackSlot(rRect, drag, visible);
  })();

  const rackTap = (index: number) => {
    if (consumeDragClick()) return;
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
    if (consumeDragClick()) return;
    if (view.board[pos] != null) return;
    setPassArmed(false);

    if (staged.some((p) => p.pos === pos)) {
      // Tap a staged tile to take it back.
      recallOne(pos, null);
      return;
    }

    if (exchangeOn || selected === null) return;
    placeFromRack(selected, pos);
  };

  const pickBlank = (letter: Letter) => {
    if (pendingBlank === null) return;
    setRack((prev) => prev.map((e, i) =>
      (i === pendingBlank.rackIndex ? { ...e, stagedAt: pendingBlank.pos, as: letter } : e)));
    setSelected(null);
    setPendingBlank(null);
  };

  const recall = () => {
    // Every tile back to its own reserved slot — order preserved.
    setRack((prev) => prev.map((e) =>
      (e.stagedAt === null ? e : { id: e.id, tile: e.tile, stagedAt: null })));
    setSelected(null);
  };

  const shuffleRack = () => {
    setRack(shuffled);
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
      .map((i) => rack[i]?.tile)
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
    <div data-testid="game-screen" className="mx-auto flex h-[100dvh] max-w-2xl flex-col bg-paper">
      {/* Pinned top: title bar, chips, status, last move, notes. Scrolls
        * itself only in the over state, where the panel can outgrow a phone. */}
      <div className={`flex-none ${view.stage === 'over' ? 'overflow-y-auto' : ''}`}>
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

      {rejection !== null && rejection.code !== 'invalidWord' && (
        <div className="px-3.5 pt-2.5">
          <RejectionNote rejection={rejection} onDismiss={onDismissRejection} />
        </div>
      )}

      {view.stage === 'over' && (
        <div className="px-3.5 pt-2.5">
          <GameOverPanel view={view} />
        </div>
      )}
      </div>

      {/* The board region — fills whatever the pinned chrome leaves. The
        * inner wrapper is height-driven and square (aspect-ratio), capped by
        * width, so the board is always the largest square that fits. */}
      <div data-testid="board-region" className="relative min-h-0 flex-1">
        <div className="flex h-full items-center justify-center px-3.5 py-2">
          <div className="mx-auto" style={{ height: '100%', aspectRatio: '1 / 1', maxWidth: 'min(100%, 600px)' }}>
            <BoardViewport>
            <div className="relative w-full">
              <Board
                board={view.board}
                staged={staged}
                lastPositions={lastPlayPositions}
                onCellTap={cellTap}
                gridRef={boardGridRef}
                onStagedPointerDown={dragEnabled ? (pos, e) => {
                  const pl = staged.find((p) => p.pos === pos);
                  if (pl !== undefined) startDrag({ kind: 'board', pos, tile: pl.tile }, e);
                } : undefined}
                hiddenPos={drag?.active === true && drag.source.kind === 'board' ? drag.source.pos : null}
              />

              {preview !== null && (() => {
                const col = colOf(preview.anchorPos);
                const row = rowOf(preview.anchorPos);
                const flushRight = col >= 12; // the badge is wider than a cell — hug the edge
                const belowAnchor = row === 0; // no room above row 0 — sit under the anchor
                return (
                  <div
                    data-testid="stage-badge"
                    className={`pointer-events-none absolute z-10 rounded-full bg-accent px-2.5 py-0.5 text-[13px] font-bold text-white shadow ${
                      belowAnchor ? '' : '-translate-y-full'
                    }`}
                    style={{
                      ...(flushRight ? { right: 0 } : { left: `${((col + 1) / 15) * 100}%` }),
                      top: `${((belowAnchor ? row + 1 : row) / 15) * 100}%`,
                    }}
                  >
                    {preview.bingo ? `+${preview.total} · BINGO` : `+${preview.total}`}
                  </div>
                );
              })()}
            </div>
            </BoardViewport>
          </div>
        </div>

        {/* Dictionary rejections get an overlay card instead of the
         * top-of-screen strip: tiles stay staged right where the word
         * failed, so "rearrange or recall" reads as an instruction about
         * what's in front of you. It hangs off the board REGION, outside
         * any zoom transform — screen-anchored and readable at any scale. */}
        {rejection !== null && rejection.code === 'invalidWord' && (
            <div
              data-testid="invalid-card"
              className="absolute inset-x-6 top-[38%] z-20 rounded-2xl border-2 border-danger bg-white px-3.5 py-3 text-center shadow-2xl"
            >
              <p className="text-[15px] font-bold text-danger-ink">
                ✕ {rejection.words?.join(', ') ?? 'That'} isn’t in the dictionary
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-faint">
                Tiles stay on the board — rearrange or recall
              </p>
              <button
                type="button"
                onClick={onDismissRejection}
                className="m-0 mt-2 rounded-lg border border-line-strong px-3 py-1 text-sm font-semibold text-ink-soft"
              >
                OK
              </button>
            </div>
        )}
      </div>

      {/* Pinned bottom: rack + actions (or the exchange UI), above the home bar. */}
      <div className="flex-none pb-[max(12px,env(safe-area-inset-bottom))]">
      {view.stage === 'playing' && (
        <>
          <div className="px-3.5 pt-3.5">
            <Rack
              entries={rack.map((e) => ({ id: e.id, tile: e.stagedAt === null ? e.tile : null }))}
              selected={exchangeOn ? exchangeSel : selected === null ? [] : [selected]}
              onTileTap={rackTap}
              bagCount={view.bagCount}
              tilesRef={rackTilesRef}
              onTilePointerDown={dragEnabled ? (index, e) => {
                const entry = rack[index];
                if (entry !== undefined && entry.stagedAt === null) {
                  startDrag({ kind: 'rack', index, tile: entry.tile }, e);
                }
              } : undefined}
              draggingIndex={drag?.active === true && drag.source.kind === 'rack' ? drag.source.index : null}
              insertionSlot={hoverSlot}
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
                className="m-0 flex min-h-[46px] flex-1 items-center justify-center rounded-xl bg-accent font-bold text-white shadow disabled:cursor-not-allowed disabled:bg-hairline disabled:text-ink-faint disabled:shadow-none"
              >
                {preview === null ? 'Play' : `Play · +${preview.total}`}
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
      </div>

      {/* The move history stays in the code but hidden: Pete wants it back,
        * the reveal (drawer? long-press?) is undecided (2026-08-31). */}
      <section hidden data-testid="move-history" className="px-3.5 pb-3 pt-3">
        <h2 className="mb-1 text-sm font-semibold text-ink-soft">Moves</h2>
        <MoveLog view={view} />
      </section>

      {/* The dragged tile's only representation — rides under the finger. */}
      {drag !== null && drag.active && (
        <div
          data-testid="drag-ghost"
          className={`pointer-events-none fixed z-50 flex h-[50px] w-11 items-center justify-center rounded-md bg-tile font-tile text-lg font-bold ${
            drag.source.tile === '_' ? 'text-tile-blank' : 'text-tile-ink'
          }`}
          style={{ left: drag.x - 22, top: drag.y - 25, boxShadow: 'inset 0 -3px 0 #d9bf8a, 0 6px 14px rgba(0,0,0,.35)' }}
        >
          {drag.source.tile === '_' ? '·' : drag.source.tile}
          <span className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none">
            {TILE_VALUES[drag.source.tile]}
          </span>
        </div>
      )}

      {pendingBlank !== null && (
        <BlankPicker onPick={pickBlank} onCancel={() => { setPendingBlank(null); }} />
      )}

      {notifyOpen && (
        <NotificationSettings onClose={() => { setNotifyOpen(false); refreshNotify(); }} />
      )}
    </div>
  );
}
