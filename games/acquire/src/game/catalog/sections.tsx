import type { ReactNode } from 'react';
import { Tile } from '../atoms/Tile';
import { StockCard } from '../atoms/StockCard';
import { StockStack } from '../atoms/StockStack';
import { Brand } from '../atoms/Brand';
import { Board } from '../Board';
import { Panel } from '../panel/Panel';
import { StepStack } from '../panel/StepStack';
import { ActiveStep } from '../panel/ActiveStep';
import { StagingZone } from '../panel/StagingZone';
import { HandZone } from '../panel/HandZone';
import { PlayersStrip } from '../panel/PlayersStrip';
import { LogDetail } from '../panel/LogDetail';
import { PayoutLines, type PayoutLine } from '../merger/PayoutLines';
import { LiqQueue, type LiqHolder } from '../merger/LiqQueue';
import { LiqActions } from '../merger/LiqActions';
import { FoundGroups } from '../FoundGroups';
import { FinalScoring } from '../FinalScoring';
import { RevealOverlay } from '../RevealOverlay';
import { useTurnPanel } from '../screen/useTurnPanel';
import { authored, fromGolden, goldenState, type CatalogFixture } from './fixtures';

import { AVAILABLE_STARTUPS, TRADE_RATIO, isStartupId } from '../../../engine/startups';
import { getSharePrice } from '../../../engine/gameLogic';
import { floodFillUnclaimed, turnPlayer } from '../../../engine/gameHelpers';
import { getDeadTilesInHand } from '../../../engine/placement';
import { finalScore } from '../../../engine/endGame';
import type { Coord, GameState, StartupId } from '../../../engine/gameTypes';
import type { SessionView } from '../../../session/GameSession';

/* ------------------------------------------------------------------ *
 * Derivations. Everything a catalog state shows is read back out of a
 * replayed golden game — never written down here. `states.html` priced a
 * 41-tile Gobble at $1000 where the engine says $1200, and that figure
 * reached two Phase 0 task briefs; deriving makes that class of error
 * impossible.
 * ------------------------------------------------------------------ */

const noop = () => {};

const active = (s: GameState) => turnPlayer(s);

const foundedIds = (s: GameState): StartupId[] =>
  Object.values(s.startups)
    .filter((x) => x.isFounded && isStartupId(x.id))
    .map((x) => x.id)
    .filter(isStartupId);

const pricesOf = (s: GameState): Record<string, number> =>
  Object.fromEntries(foundedIds(s).map((id) => [id, getSharePrice(s, id)]));

const hqTilesOf = (s: GameState): Coord[] =>
  Object.values(s.startups)
    .filter((x) => x.isFounded && x.foundingTile != null)
    .map((x) => x.foundingTile as Coord);

/** Coord → the placing player's initial, for the last tile each player placed. */
const ownersOf = (s: GameState): Partial<Record<Coord, string>> => {
  const out: Record<string, string> = {};
  for (const p of s.players) {
    if (p.lastPlacedTile) out[p.lastPlacedTile] = p.name.slice(0, 1);
  }
  return out;
};

const stepsOf = (s: GameState) =>
  s.log.map((e) => ({ stepId: e.stepId, phase: e.phase, detail: <LogDetail detail={e.detail} /> }));

/**
 * The payout the engine actually recorded, read off the log entry's payload.
 *
 * Phase 1b derived the bonus *type* with a regex over the entry's rendered
 * text, because the engine discarded `pendingBonuses` inside the same intent.
 * The typed payload replaced that; the qty still comes off the portfolio,
 * since absorbed shares are held until that player liquidates.
 */
function payoutLinesOf(s: GameState): PayoutLine[] {
  const absorbedId = s.mergerContext?.absorbedIds[0];
  const entry = s.log.find((e) => e.payload?.kind === 'payout');
  const payload = entry?.payload;
  if (payload?.kind !== 'payout') return [];

  return payload.bonuses.map((b) => {
    const player = s.players.find((p) => p.id === b.playerId);
    return {
      playerName: b.playerName,
      emoji: player?.emoji,
      qty: absorbedId ? (player?.portfolio[absorbedId] ?? 0) : undefined,
      type: b.type,
      amount: b.amount,
    };
  });
}

function liqHoldersOf(s: GameState): LiqHolder[] {
  const ctx = s.mergerContext;
  if (!ctx) return [];
  const absorbedId = ctx.absorbedIds[0];
  if (absorbedId === undefined) return [];
  return ctx.shareholderQueue.map((pid, i) => {
    const p = s.players.find((x) => x.id === pid);
    return {
      name: p?.name ?? pid,
      emoji: p?.emoji,
      qty: p?.portfolio[absorbedId] ?? 0,
      status: i < ctx.currentShareholderIndex ? 'done' : i === ctx.currentShareholderIndex ? 'current' : 'pending',
    };
  });
}

/* ------------------------------------------------------------------ *
 * The catalog itself.
 * ------------------------------------------------------------------ */

export interface CatalogState {
  label: string;
  kind?: 'wide' | 'atom' | 'overlay';
  fixture: CatalogFixture;
  node: ReactNode;
}

export interface CatalogSection {
  seq: string;
  title: string;
  intent?: string;
  states: CatalogState[];
}

const G8_BLOCKED = goldenState('G8', 0); // Alex holds C6, a dead tile between two safe chains
const G1_PLAY = goldenState('G1', 0);
const G1_FOUND = goldenState('G1', 1);
const G1_BUY = goldenState('G1', 2);
const G13_TIED = goldenState('G13', 1);
const G2_MERGER = goldenState('G2', 1);
/** The opening after seat one's draw: still `stage: 'draw'`, seat two to act. */
const G17_MID_DRAW = goldenState('G17', 1);
const G5_SOLE = goldenState('G5', 1);
const G9_END = goldenState('G9', 2);
const G10_END = goldenState('G10', 1);

const MESSLA_PRICE = getSharePrice(G1_BUY, 'Messla');

/**
 * The real `useTurnPanel` output for one golden state, with `canAct` forced
 * either way — composed into a full `Panel` so the result carries the same
 * `data-slot`/`data-zone` attributes every other panel state on this page
 * does.
 *
 * This is what lets `npm run verify:layout` measure the not-my-turn waiting
 * panel at all: it exists online (`GameScreen`'s `canAct` goes false whenever
 * `viewerId` is not the actor, or the socket is down) but never on
 * `/pass-and-play`, the only route the script drove before. Standing up a
 * real networked room inside the layout script would mean two clients and a
 * server; this reaches the same DOM the hook actually produces, on a real
 * page, for the price of one more catalog card — reusing the same golden
 * state as its "my turn" neighbour so the two are comparable pixel for pixel.
 */
function TurnPanelDemo(
  { state, canAct, actorId }: { state: GameState; canAct: boolean; actorId?: string },
) {
  const view: SessionView = {
    state,
    // `players[turnIndex]` for every ordinary step, but overridable: during the
    // turn-order draw `turnIndex` is still its initial 0 and means nothing —
    // the actor is whoever the draw has reached.
    actorId: actorId ?? active(state).id,
    awaitingReveal: false,
    undoableSteps: [],
    segmentStart: state.nextStepId,
    error: null,
  };
  const { active: activeSlot, staging } = useTurnPanel(view, noop, canAct);
  return (
    <div className="h-[420px] border border-gray-200">
      <Panel
        stepstack={<StepStack entries={stepsOf(state)} onUndo={noop} />}
        active={activeSlot}
        staging={staging}
        hand={
          <HandZone
            name={active(state).name}
            portfolio={active(state).portfolio}
            cash={active(state).cash}
            prices={pricesOf(state)}
          />
        }
        players={
          <PlayersStrip
            players={state.players.map((p, i) => ({
              id: p.id,
              emoji: p.emoji,
              name: p.name,
              cash: p.cash,
              active: i === state.turnIndex,
            }))}
          />
        }
      />
    </div>
  );
}

function buyRow(s: GameState) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {foundedIds(s).map((id) => (
        <StockCard key={id} id={id} price={getSharePrice(s, id)} mode="select" onClick={noop} />
      ))}
    </div>
  );
}

export const SECTIONS: CatalogSection[] = [
  {
    seq: '1',
    title: 'Place a tile',
    intent: 'Hand tiles are actionable; a tile that would merge two safe chains is dead and stays unclickable.',
    states: [
      {
        label: 'place · board with a dead tile',
        kind: 'wide',
        fixture: fromGolden('G8', 0),
        node: (
          <Board
            board={G8_BLOCKED.board}
            hand={active(G8_BLOCKED).hand}
            blocked={getDeadTilesInHand(G8_BLOCKED, active(G8_BLOCKED).id)}
            hqTiles={hqTilesOf(G8_BLOCKED)}
            owners={ownersOf(G8_BLOCKED)}
            onCellClick={noop}
          />
        ),
      },
      {
        label: 'place · active',
        fixture: fromGolden('G1', 0),
        node: (
          <ActiveStep
            label="Place a tile"
            body={
              <>
                {/*
                  No hint line any more. The panel shipped this step without
                  one — its tiles and the board's are lit identically, which
                  says "tap me" without a sentence — and a catalog card that
                  carries copy the real component does not is a card that
                  cannot be used to check the real component.
                */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {active(G1_PLAY).hand.map((c) => (
                    <Tile key={c} coord={c} state="hand" onClick={noop} />
                  ))}
                </div>
              </>
            }
          />
        ),
      },
      {
        label: 'place · completed steps (undoable)',
        fixture: fromGolden('G1', 2),
        node: <StepStack entries={stepsOf(G1_BUY)} onUndo={noop} />,
      },
      {
        label: 'place · completed steps (read-only)',
        fixture: fromGolden('G1', 2),
        node: <StepStack entries={stepsOf(G1_BUY)} />,
      },
    ],
  },

  {
    seq: '2',
    title: 'Found a startup',
    intent: 'Foundable brands bucket under their starting price; brands already on the board are disabled, not hidden.',
    states: [
      {
        label: 'found · active',
        fixture: fromGolden('G1', 1),
        node: (
          <ActiveStep
            label="Found a startup"
            body={
              <FoundGroups
                available={AVAILABLE_STARTUPS.map((s) => s.id)}
                taken={foundedIds(G1_FOUND)}
                foundSize={
                  G1_FOUND.pendingFoundTile
                    ? floodFillUnclaimed([G1_FOUND.pendingFoundTile], G1_FOUND.board).length
                    : 2
                }
                onSelect={noop}
              />
            }
          />
        ),
      },
      {
        label: 'found · with a brand already taken',
        fixture: fromGolden('G1', 2),
        node: (
          <FoundGroups
            available={AVAILABLE_STARTUPS.map((s) => s.id)}
            taken={foundedIds(G1_BUY)}
            foundSize={2}
            onSelect={noop}
          />
        ),
      },
    ],
  },

  {
    seq: '3',
    title: 'Merger — pick a victor',
    intent: 'Tie only: tap a chain to choose the survivor; a non-tie skips straight to payout.',
    states: [
      {
        label: 'merger · pick',
        fixture: fromGolden('G13', 1),
        node: (
          <ActiveStep
            label={`${(G13_TIED.pendingTiedStartups ?? []).join(' & ')} Merger`}
            body={
              <div className="flex flex-wrap items-end gap-2">
                {(G13_TIED.pendingTiedStartups ?? []).filter(isStartupId).map((id) => (
                  <Brand key={id} id={id} mode="select" onClick={noop} />
                ))}
              </div>
            }
          />
        ),
      },
      {
        label: 'merger · completed',
        fixture: fromGolden('G13', 3),
        node: <StepStack entries={stepsOf(goldenState('G13', 3))} />,
      },
    ],
  },

  {
    seq: '4',
    title: 'Merger payout',
    intent: 'Each line shows the qty of the absorbed chain the player held — the reason they earned the bonus.',
    states: [
      {
        label: 'payout · majority and minority',
        fixture: fromGolden('G2', 1),
        node: <PayoutLines bonuses={payoutLinesOf(G2_MERGER)} />,
      },
      {
        label: 'payout · sole holder',
        fixture: fromGolden('G5', 1),
        node: <PayoutLines bonuses={payoutLinesOf(G5_SOLE)} />,
      },
      {
        label: 'payout · nobody to pay',
        fixture: authored('G6 absorbs a chain with no shareholders, but the empty list has no state to read'),
        node: <PayoutLines bonuses={[]} />,
      },
    ],
  },

  {
    seq: '5',
    title: 'Liquidate',
    intent: 'Every holder of the absorbed chain decides in turn; the queue says whose decision is outstanding.',
    states: [
      {
        label: 'liquidate · queue',
        fixture: fromGolden('G2', 1),
        node: <LiqQueue holders={liqHoldersOf(G2_MERGER)} />,
      },
      {
        label: 'liquidate · exchanges',
        fixture: fromGolden('G2', 1),
        node: (
          <LiqActions
            absorbedId="ZuckFace"
            survivorId="Messla"
            unitPrice={G2_MERGER.mergerContext?.absorbedPrices.ZuckFace ?? 0}
            canSell={(active(G2_MERGER).portfolio.ZuckFace ?? 0) > 0}
            canTrade={(active(G2_MERGER).portfolio.ZuckFace ?? 0) >= TRADE_RATIO}
            onSell={noop}
            onTrade={noop}
          />
        ),
      },
      {
        label: 'liquidate · nothing left to hand in',
        fixture: authored('both exchanges unavailable — a holder with no remaining absorbed shares'),
        node: (
          <LiqActions
            absorbedId="ZuckFace"
            survivorId="Messla"
            unitPrice={G2_MERGER.mergerContext?.absorbedPrices.ZuckFace ?? 0}
            canSell={false}
            canTrade={false}
          />
        ),
      },
      {
        // The state that was missing when this panel was first driven by hand:
        // the trade went inert with nothing to say the survivor's pool was
        // empty. Two disabled trades that look identical and mean different
        // things are exactly what this surface exists to tell apart, so it sits
        // next to the one above rather than replacing it.
        label: 'liquidate · survivor sold out',
        fixture: authored('the survivor has no shares left — the trade is inert and says why'),
        node: (
          <LiqActions
            absorbedId="ZuckFace"
            survivorId="Messla"
            unitPrice={G2_MERGER.mergerContext?.absorbedPrices.ZuckFace ?? 0}
            canSell
            canTrade={false}
            survivorSoldOut
            onSell={noop}
          />
        ),
      },
    ],
  },

  {
    seq: '6',
    title: 'Buy shares',
    intent: 'Picks accumulate in staging and commit on end turn.',
    states: [
      {
        label: 'buy · active',
        fixture: fromGolden('G1', 2),
        node: <ActiveStep label="Buy shares" body={buyRow(G1_BUY)} />,
      },
      {
        label: 'buy · completed',
        fixture: fromGolden('G1', 4),
        node: <StepStack entries={stepsOf(goldenState('G1', 4))} />,
      },
    ],
  },

  {
    seq: '—',
    title: 'Staging (spans steps) — all should be the same height',
    intent:
      'Net is always reserved, the pile keeps a populated-row height, and the action slot is always rendered — so empty ↔ filled and button ↔ no-button never shift.',
    states: [
      {
        label: 'staging · empty',
        fixture: authored('an empty pile has no engine state behind it — nothing has been staged yet'),
        node: <StagingZone label="Staging — commits on end turn" />,
      },
      {
        label: 'staging · cart',
        fixture: authored('staging is uncommitted UI state; the engine only sees the committed intent'),
        node: (
          <StagingZone
            label="Staging — commits on end turn"
            shares={<StockStack id="Messla" count={2} price={MESSLA_PRICE} size="sm" onRemove={noop} />}
            cashDelta={-2 * MESSLA_PRICE}
          />
        ),
      },
      {
        label: 'staging · leaving',
        fixture: authored('a liquidation lane mid-decision — uncommitted, so not an engine state'),
        node: (
          <StagingZone
            label="Staging — Sam's liquidation"
            shares={
              <>
                <StockStack id="ZuckFace" count={3} price={400} size="sm" leaving onRemove={noop} />
                <StockStack id="Messla" count={1} price={MESSLA_PRICE} size="sm" />
              </>
            }
            cashDelta={1200}
          />
        ),
      },
      {
        label: 'staging · with action',
        fixture: authored('same zone, with the phase-advance button in the always-reserved slot'),
        node: (
          <StagingZone
            label="Staging — commits on end turn"
            shares={<StockStack id="Messla" count={2} price={MESSLA_PRICE} size="sm" />}
            cashDelta={-2 * MESSLA_PRICE}
            action={
              <button type="button" className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                Buy &amp; end turn
              </button>
            }
          />
        ),
      },
    ],
  },

  {
    seq: '·',
    title: 'Tiles (vocabulary)',
    intent: 'One state vocabulary shared by board cells and inline tiles.',
    states: (
      [
        ['t-empty', 'empty'],
        ['t-filled', 'filled'],
        ['t-hand', 'hand'],
        ['t-placed', 'placed'],
        ['t-blocked', 'blocked'],
        ['t-chain', 'chain'],
        ['t-founded', 'founded'],
      ] as const
    ).map(([label, state]) => ({
      label,
      kind: 'atom' as const,
      fixture: authored('the vocabulary itself — a state, not a position'),
      node: <Tile coord={state === 'blocked' ? 'D4' : 'E6'} state={state} brand="Messla" />,
    })),
  },

  {
    seq: '·',
    title: 'Buy-row cards (vocabulary)',
    intent:
      'The three states a brand can be in during the buy step. Sold out stays in the row rather than disappearing from it — a shorter row says nothing about why.',
    states: [
      {
        label: 'card · for sale',
        node: (
          <StockCard id="Messla" price={MESSLA_PRICE} size="sm" mode="add" label="Buy one Messla" onClick={noop} />
        ),
      },
      {
        label: 'card · founded this turn',
        node: (
          <StockCard
            id="Messla"
            price={MESSLA_PRICE}
            size="sm"
            mode="add"
            badge="new"
            label="Buy one Messla"
            onClick={noop}
          />
        ),
      },
      {
        label: 'card · sold out',
        node: (
          <StockCard
            id="Messla"
            price={MESSLA_PRICE}
            size="sm"
            mode="add"
            badge="sold"
            badgeTone="muted"
            disabled
            label="Messla — sold out"
          />
        ),
      },
    ].map((s) => ({
      ...s,
      kind: 'atom' as const,
      fixture: authored('the vocabulary itself — a state, not a position'),
    })),
  },

  {
    seq: '·',
    title: 'Card stacks (vocabulary)',
    intent:
      'A stock card plus a count outside it. Composable along size (default / sm), depth (scaling with |count|), leaving and removable. Content variants: cash, zero.',
    states: [
      { label: 'stack · 1', node: <StockStack id="Messla" count={1} price={MESSLA_PRICE} /> },
      { label: 'stack · 2', node: <StockStack id="Messla" count={2} price={MESSLA_PRICE} /> },
      { label: 'stack · 6', node: <StockStack id="Messla" count={6} price={MESSLA_PRICE} /> },
      { label: 'stack · sm', node: <StockStack id="ZuckFace" count={2} price={400} size="sm" /> },
      {
        label: 'stack · sm · leaving',
        node: <StockStack id="ZuckFace" count={3} price={400} size="sm" leaving onRemove={noop} />,
      },
      {
        label: 'stack · sm · removable',
        node: <StockStack id="Messla" count={2} price={MESSLA_PRICE} size="sm" onRemove={noop} />,
      },
      { label: 'stack · cash', node: <StockStack id="Cash" count={3} price={400} /> },
      { label: 'stack · zero', node: <StockStack id="Messla" count={0} price={MESSLA_PRICE} /> },
    ].map((s) => ({
      ...s,
      kind: 'atom' as const,
      fixture: authored('the vocabulary itself — a shape, not a position'),
    })),
  },

  {
    seq: '·',
    title: 'Panel (composed)',
    intent: 'The five zones in their fixed order: stepstack → active → staging → hand → players.',
    states: [
      {
        label: 'panel · buy step',
        kind: 'wide',
        fixture: fromGolden('G1', 2),
        node: (
          // Height only: the Panel owns its own width, narrowing below 1024px.
          <div className="h-[560px] border border-gray-200">
            <Panel
              stepstack={<StepStack entries={stepsOf(G1_BUY)} onUndo={noop} />}
              active={<ActiveStep label="Buy shares" body={buyRow(G1_BUY)} />}
              staging={
                <StagingZone
                  label="Staging — commits on end turn"
                  shares={<StockStack id="Messla" count={1} price={MESSLA_PRICE} size="sm" onRemove={noop} />}
                  cashDelta={-MESSLA_PRICE}
                  action={
                    <button
                      type="button"
                      className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Buy &amp; end turn
                    </button>
                  }
                />
              }
              hand={
                <HandZone
                  name={active(G1_BUY).name}
                  portfolio={active(G1_BUY).portfolio}
                  cash={active(G1_BUY).cash}
                  prices={pricesOf(G1_BUY)}
                />
              }
              players={
                <PlayersStrip
                  players={G1_BUY.players.map((p, i) => ({
                    id: p.id,
                    emoji: p.emoji,
                    name: p.name,
                    cash: p.cash,
                    active: i === G1_BUY.turnIndex,
                  }))}
                />
              }
            />
          </div>
        ),
      },
      {
        // `verify:layout`'s only look at the not-my-turn waiting panel — see
        // `TurnPanelDemo`. Same state as its neighbour below; `canAct` is the
        // only thing that differs, which is exactly what a connection drop
        // or an actor handoff changes online.
        label: 'panel · my turn (waiting-panel baseline)',
        kind: 'wide',
        fixture: fromGolden('G1', 2),
        node: <TurnPanelDemo state={G1_BUY} canAct />,
      },
      {
        label: 'panel · not my turn (waiting)',
        kind: 'wide',
        fixture: fromGolden('G1', 2),
        node: <TurnPanelDemo state={G1_BUY} canAct={false} />,
      },
      {
        // The opening, part-way through: seat one has drawn and seat two is
        // up. Carried here because a new step with no catalog entry is exactly
        // how the clipped away-dot went unseen for a whole phase — the catalog
        // is where a state gets looked at rather than merely tested.
        label: 'panel · mid-draw (seat one has drawn)',
        kind: 'wide',
        fixture: fromGolden('G17', 1),
        node: <TurnPanelDemo state={G17_MID_DRAW} canAct actorId="p2" />,
      },
      {
        label: 'panel · mid-merger (the worst squeeze)',
        kind: 'wide',
        fixture: fromGolden('G2', 1),
        // The tallest the active zone ever gets: a liquidation queue plus its
        // sell/trade actions. The step stack is the flex spacer above it, so
        // this is the state that decides whether it survives being squeezed or
        // collapses to nothing — and the undo you most want during a merger
        // lives in it. Reported by hand as "sidebar scrolling doesn't let me
        // scroll up to undo tile placement during mergers".
        node: <TurnPanelDemo state={G2_MERGER} canAct />,
      },
    ],
  },

  {
    seq: '·',
    title: 'Pass and play',
    intent:
      'The one place the "show the same thing to all players" principle is deliberately broken — a shared device needs a curtain between turns.',
    states: [
      {
        label: 'reveal · overlay',
        kind: 'overlay',
        fixture: fromGolden('G1', 0),
        node: (
          <RevealOverlay
            playerName={active(G1_PLAY).name}
            emoji={active(G1_PLAY).emoji}
            onReveal={noop}
          />
        ),
      },
    ],
  },

  {
    seq: '·',
    title: 'Final scoring',
    intent: 'Terminal: one column per player, sorted by total, winner leftmost. No dismiss — Phase 2 adds the route back.',
    states: [
      {
        label: 'final · ended at 41 tiles',
        kind: 'overlay',
        fixture: fromGolden('G9', 2),
        node: <FinalScoring {...finalScore(G9_END)} />,
      },
      {
        label: 'final · ended with every chain safe',
        kind: 'overlay',
        fixture: fromGolden('G10', 1),
        node: <FinalScoring {...finalScore(G10_END)} />,
      },
    ],
  },
];
