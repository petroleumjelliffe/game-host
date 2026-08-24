import { useMemo, useState } from 'react';
import {
  cityById, nodeForCity, path as pathOf, sectionKey, usedAfter,
  type NodeId, type RegionId, type TurnRoll
} from '../../engine';
import { SEAT_COLORS } from '../game/tokens';
import { SEATS, type SeatId } from '../state/events';
import type { GameState } from '../state/game';
import { destinationOf, needsDestination } from '../state/turns';
import { EngineChip, GLIDE } from './EngineChip';
import {
  CITY_R, DOT_R, layout, RAILROADS, sizeCandidates, visualRadius, type Placed
} from './geo';
import { markers, pawns, type Marker } from './lit';
import { PLAYBACK_MS, usePlayback } from './usePlayback';
import { useRoute } from './useRoute';
import { STEP, useViewport } from './useViewport';

/**
 * The map's own coordinate space — no longer the cabinet's size on screen.
 *
 * The cabinet is whatever the window leaves it; this is the space the network
 * is projected into once, and the viewBox is what reconciles the two. Keeping
 * it fixed is what lets the projection stay a `useMemo` with no dependencies
 * while the window is dragged about.
 */
const WIDTH = 1400;
const HEIGHT = 788;
const EXTENT = { width: WIDTH, height: HEIGHT } as const;

/** One per region, so a city reads as its region before you read its name. */
const REGION_COLOR: Record<RegionId, string> = {
  NE: '#ff6b5a',
  SE: '#ffb347',
  NC: '#7ad67f',
  SC: '#4fc9d4',
  PL: '#7aa6ff',
  NW: '#c58cff',
  SW: '#ff7ab8'
};

/** The narrowest cabinet that still has room for the game's name in the rail. */
const TITLE_ROOM = 820;

/** Unlit lamps still catch a little light, exactly as on a real board. */
const DIM = 0.3;

/** At most three lines are drawn per segment; shared trackage runs deeper. */
const MAX_LINES_PER_EDGE = 3;
const LINE_SPREAD = 1.7;

/**
 * How much of a section this trip has left, as the track is drawn.
 *
 * `null` is untouched; `'part'` means crossed, with a company still free to
 * cross it again — the book's "he may move between the same two dots again, as
 * long as it uses a different rail line"; `'true'` means every crossing is
 * spent and the engine will refuse it with `section-used` until the pawn
 * arrives and the whole trip is released.
 */
type Spent = 'true' | 'part' | null;

const spentState = (crossings: number, lines: number): Spent =>
  crossings <= 0 ? null : crossings >= lines ? 'true' : 'part';

function Track({ nodes, edges, spent, spentColor }: Pick<ReturnType<typeof layout>, 'edges'> & {
  nodes: Map<string, Placed>;
  /** Crossings this trip, by section — the very map the engine refuses steps with. */
  spent: ReadonlyMap<string, number>;
  /** The baron up's colour — spent track is theirs alone, and lights in it. */
  spentColor: string;
}) {
  // Geometry depends on the projection alone, so tapping out a route — which
  // changes `spent` on every step — does not recompute any of it.
  const segments = useMemo(() => edges.flatMap(edge => {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) return [];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    // Perpendicular, so several railroads over one stretch of track lie
    // side by side rather than on top of one another.
    const nx = -dy / length;
    const ny = dx / length;
    const lines = edge.railroads.slice(0, MAX_LINES_PER_EDGE);
    const offset = (lines.length - 1) / 2;
    return [{
      key: `${edge.a}-${edge.b}`, section: sectionKey(edge.a, edge.b),
      a, b, nx, ny, lines, offset, capacity: edge.railroads.length
    }];
  }), [edges, nodes]);

  return (
    <>
      <g>
        {segments.map(s => (
          <line
            key={s.key} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y}
            stroke="#1c1108" strokeWidth={4.6} strokeLinecap="round" opacity={0.55}
          />
        ))}
      </g>
      <g>
        {segments.map(s => {
          const state = spentState(spent.get(s.section) ?? 0, s.capacity);
          return (
            <g key={s.key} data-edge={s.section} {...(state ? { 'data-spent': state } : {})}>
              {s.lines.map((id, i) => {
                const k = (i - s.offset) * LINE_SPREAD;
                return (
                  <line
                    key={`${s.key}-${id}`}
                    x1={s.a.x + s.nx * k} y1={s.a.y + s.ny * k}
                    x2={s.b.x + s.nx * k} y2={s.b.y + s.ny * k}
                    stroke={RAILROADS.get(id)?.color ?? '#8b6a42'}
                    strokeWidth={1.5} strokeLinecap="round" opacity={0.85}
                  />
                );
              })}
              {/* Spent track lights up in the baron's colour instead of the
                  old burn-out: where the trip has been is the thing the
                  player is actually reading, and a lit line is legible where
                  colour draining to 12% never was. `usedAfter` counts the
                  draft's own steps, so this is also the tapped route drawing
                  itself — one vocabulary for "traveled", live and committed. */}
              {state !== null && (
                <TraveledSegment a={s.a} b={s.b} color={spentColor}
                                 partial={state === 'part'} />
              )}
            </g>
          );
        })}
      </g>
    </>
  );
}

/**
 * One segment of track the trip has traveled, in the mover's own colour: a
 * wide soft underlay and a bright line over it, so the route reads as lit
 * from beneath rather than merely drawn on. Each segment fades in as the
 * pawn takes it — the animation runs once on mount, which is exactly when
 * the step was walked. The spent track and the committed trail both draw
 * through this, so the route being tapped out and the route playing back
 * cannot look like two different things.
 *
 * `partial` is the shared-trackage case: one line across the section is
 * crossed, another still free. The section is lit — it has been traveled —
 * but the bright line holds back, so a fully spent section still reads
 * brighter than one the pawn may cross again.
 */
function TraveledSegment({ a, b, color, partial = false }: {
  a: Placed; b: Placed; color: string; partial?: boolean;
}) {
  return (
    <g data-motion="" style={{ animation: 'rb-fade 260ms linear both' }}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color}
            strokeWidth={9} strokeLinecap="round" opacity={0.16} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color}
            strokeWidth={3} strokeLinecap="round" opacity={partial ? 0.5 : 0.95} />
    </g>
  );
}

/**
 * Both lamps below are scenery only now — every circle they draw carries
 * `pointerEvents: 'none'`. Painted SVG shapes capture taps regardless of
 * opacity (`pointer-events: visiblePainted` excludes only *unpainted*
 * geometry, not translucent), and a city's glow is drawn well past its
 * bulb — wide enough, at this scale, to sit on top of a neighbouring dot's
 * tap target and steal taps meant for it. The actual tappable surface is
 * `InteractionLayer` below, bubbled above everything so nothing can ever
 * cover it.
 */

/**
 * How a lamp says the cursor is on *it*.
 *
 * Every lamp the leg can reach is lit at once, so lit alone never answered the
 * question the player is actually asking — which of these am I about to take?
 * The ring each candidate already wears is what carries it: under the pointer
 * it closes in, brightens to full, and picks up a halo, so one lamp reads as
 * chosen among its lit neighbours rather than merely lit.
 */
const HOVER_RING = { stroke: '#fffdf6', width: 2.6, opacity: 1 } as const;
const IDLE_RING = { stroke: '#fff6e2', width: 1.4, opacity: 0.8 } as const;

/** A bulb in its socket: the housing is always drawn, the filament is not. */
function CityLamp({ node, color, lit, marker, candidate, hover }: {
  node: Placed; color: string; lit: boolean; marker: Marker | undefined;
  candidate: boolean; hover: boolean;
}) {
  const r = CITY_R;
  const { x, y } = node;
  const ring = hover ? HOVER_RING : IDLE_RING;
  return (
    <g data-node={node.id} data-hover={hover ? 'true' : undefined}>
      <circle cx={x} cy={y + r * 0.07} r={r * 1.06} fill="#000" opacity={0.5} pointerEvents="none" />
      <circle cx={x - r * 0.07} cy={y - r * 0.09} r={r * 0.98} fill="#f2f0eb" pointerEvents="none" />
      <circle cx={x + r * 0.1} cy={y + r * 0.13} r={r * 0.88} fill="#9b9a96" pointerEvents="none" />
      <circle cx={x} cy={y} r={r * 0.72} fill="#100c08" pointerEvents="none" />
      <g style={{ opacity: lit ? 1 : DIM, transition: 'opacity 90ms cubic-bezier(.2,.8,.3,1)' }}>
        <circle cx={x} cy={y} r={r * 2.6} fill={color} opacity={0.12} pointerEvents="none" />
        <circle cx={x} cy={y} r={r * 1.5} fill={color} opacity={0.24} pointerEvents="none" />
        <circle cx={x} cy={y} r={r * 0.64} fill={color} pointerEvents="none" />
        <circle cx={x - r * 0.2} cy={y - r * 0.24} r={r * 0.2} fill="#fff" opacity={0.6} pointerEvents="none" />
      </g>
      {hover && (
        <circle cx={x} cy={y} r={r * 2.9} fill="#fffdf6" opacity={0.14} pointerEvents="none" />
      )}
      {candidate && (
        <circle cx={x} cy={y} r={r * (hover ? 1.62 : 1.75)} fill="none"
                stroke={ring.stroke} strokeWidth={ring.width} opacity={ring.opacity}
                pointerEvents="none"
                style={{ transition: 'r 90ms cubic-bezier(.2,.8,.3,1)' }} />
      )}
      <title>
        {node.name}
        {marker ? ` — ${marker.name}'s ${marker.role}` : ''}
      </title>
    </g>
  );
}

function RouteLamp({ node, lit, candidate, hover }: {
  node: Placed; lit: boolean; candidate: boolean; hover: boolean;
}) {
  const r = DOT_R;
  const { x, y } = node;
  return (
    <g data-node={node.id} data-hover={hover ? 'true' : undefined}>
      <circle cx={x} cy={y} r={r * 1.5} fill="#2a1c0d" pointerEvents="none" />
      <g style={{ opacity: lit ? 1 : DIM, transition: 'opacity 110ms cubic-bezier(.2,.8,.3,1)' }}>
        <circle cx={x} cy={y} r={r * (hover ? 5.4 : 4.2)} fill="#fff6e2"
                opacity={hover ? 0.2 : 0.1} pointerEvents="none" />
        <circle cx={x} cy={y} r={r * 2.2} fill="#fff6e2" opacity={0.2} pointerEvents="none" />
        <circle cx={x} cy={y} r={r * (hover ? 1.35 : 1)} fill="#fffaf0" pointerEvents="none" />
      </g>
      {candidate && (
        <circle cx={x} cy={y} r={r * (hover ? 2.9 : 3.2)} fill="none"
                stroke={hover ? HOVER_RING.stroke : IDLE_RING.stroke}
                strokeWidth={hover ? 1.8 : 1} opacity={hover ? 1 : 0.75}
                pointerEvents="none"
                style={{ transition: 'r 90ms cubic-bezier(.2,.8,.3,1)' }} />
      )}
    </g>
  );
}

/**
 * Every node, named, for whoever is working on the board.
 *
 * A mis-traced node can only be reported by naming it, and the board shows no
 * ids — "the dot closest to Chattanooga" cost a round trip to resolve. This
 * gives each lamp a tooltip: the id for a route dot, name and id for a city.
 *
 * It needs a layer of its own because the lamps cannot carry it. Every circle
 * they draw is `pointerEvents: 'none'`, so there is nothing there to hover and
 * the `<title>` a city already has never appears. These circles are hoverable
 * and exactly the size of the painted lamp — and rendered *before* the
 * interaction layer, so a candidate's real target still sits on top and no tap
 * is ever taken by a label.
 *
 * Development only: `import.meta.env.DEV` is false in the built bundle, so
 * this renders nothing at all in the game as it ships.
 */
function NodeLabels({ nodes }: { nodes: readonly Placed[] }) {
  if (!import.meta.env.DEV) return null;
  return (
    <g data-labels="">
      {nodes.map(node => (
        <circle key={node.id} cx={node.x} cy={node.y} r={visualRadius(node)} fill="transparent">
          <title>{node.name ? `${node.name} (${node.id})` : node.id}</title>
        </circle>
      ))}
    </g>
  );
}

/**
 * The tappable surface, all of it, bubbled above every lamp and pawn: one
 * transparent circle per candidate node. Rendered last in the SVG so nothing
 * drawn earlier — a city's glow, a pawn, a route line — can ever sit on top of
 * a hit target and steal the tap meant for it. A node that currently may not
 * be tapped (not a legal candidate, or a previous move is still playing back)
 * contributes no circle at all, exactly as the old per-lamp `Tappable`
 * rendered no button for it.
 *
 * Which is also why the targets are sized *here*, per render, rather than once
 * for the whole map in geo.ts: the only lamps that can compete for a tap are
 * the ones offered at this moment, and they are the ones in this layer. See
 * `sizeCandidates`.
 */
function InteractionLayer({ nodes, legal, enabled, onTap, onHover, action }: {
  nodes: readonly Placed[]; legal: ReadonlySet<NodeId>; enabled: boolean;
  onTap: (id: NodeId) => void;
  onHover: (id: NodeId | null) => void;
  /**
   * The chip's own tap, riding above the baron up's engine: the dice when it
   * is time to roll, END TURN when the leg is done. It lives here, not on the
   * chip, because this layer is the one place a hit target may paint — and it
   * is offered independently of `enabled`, because the Bonus Roll is taken
   * exactly when every lamp is closed.
   */
  action: { label: string; x: number; y: number; onTap: () => void } | null;
}) {
  const targets = useMemo(() => {
    const candidates = nodes.filter(node => legal.has(node.id));
    const radii = sizeCandidates(candidates);
    return candidates.map(node => ({ node, hit: radii.get(node.id)! }));
  }, [nodes, legal]);

  return (
    <g>
      {action && (
        <rect
          x={action.x - 44} y={action.y - 80} width={88} height={94}
          fill="transparent"
          role="button" aria-label={action.label}
          onClick={action.onTap}
          style={{ cursor: 'pointer' }}
        />
      )}
      {enabled && targets.map(({ node, hit }) => {
        const label = node.kind === 'city' ? (node.name ?? node.id) : `Dot ${node.id}`;
        return (
          <circle
            key={node.id}
            cx={node.x} cy={node.y} r={hit}
            fill="transparent"
            role="button" aria-label={label}
            onClick={() => onTap(node.id)}
            // Enter and leave rather than over and out: the targets abut, and
            // over/out also fire for a move within one target.
            onPointerEnter={() => onHover(node.id)}
            onPointerLeave={() => onHover(null)}
            style={{ cursor: 'pointer' }}
          />
        );
      })}
    </g>
  );
}

/** The HUD sits on the cabinet, so it borrows the cabinet's brass. */
const HUD_BUTTON = {
  fontFamily: "'DM Mono', ui-monospace, monospace",
  fontSize: 12,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#f0cd94',
  background: 'rgba(43,23,10,0.55)',
  border: '1px solid #5c3a1e',
  borderRadius: 3,
  padding: '6px 12px'
} as const;

export interface MapViewProps {
  state: GameState;
  onBack: () => void;
  onMove: (seat: SeatId, path: readonly NodeId[], arrived: boolean) => void;
  /** The dice, threaded through so the map can roll them too — see below. */
  dice: { roll: TurnRoll | null; live: boolean; mine: boolean };
  /** Whose device this is: a seat online, 'all' on the shared tablet. */
  viewer?: SeatId | 'all';
  onRollDice: () => void;
  onDiceLanded: () => void;
}

/**
 * Why the dice can be rolled on both surfaces. The readout lives on the board
 * and is shared; on one tablet that would mean tapping the dice there and
 * then navigating here to move — an extra trip every turn, on the view that
 * is *not* where the turn happens. The map goes through the same
 * `onRollDice`/`onDiceLanded` gate, so there is one gate on two surfaces —
 * but it wears the map's own costume: the dice wait, are tapped, and tumble
 * on the chip above the engine (`EngineChip`, plus the interaction layer's
 * target riding it), which is also what reports the landing here.
 */
export function MapView({
  state, onBack, onMove, dice, onRollDice, onDiceLanded, viewer = 'all'
}: MapViewProps) {
  // The projection is expensive and depends on nothing that changes — the
  // network is a build artefact and the cabinet is a fixed size.
  const board = useMemo(() => layout(WIDTH, HEIGHT), []);
  const lamps = useMemo(() => markers(state), [state]);
  const route = useRoute(state, onMove);
  const viewport = useViewport(EXTENT);
  const [pointedAt, setPointedAt] = useState<NodeId | null>(null);
  const drafted = route.draft === null ? null : pathOf(route.draft);

  /**
   * The baron up owes a destination roll, so there is nothing to walk here.
   *
   * Two states reach it. The ordinary one is between trips. The other is the
   * bonus leg: a pawn that arrives inside the white dice is paid, rolls a new
   * destination and spends the bonus die starting that new trip — so the turn
   * stays open with dice already on the table and still nothing to do until
   * the destination exists.
   *
   * Both used to leave this screen saying "0 left" with COMMIT and UNDO
   * greyed out and no way to learn what it was waiting for. The map says so
   * and points at the board, where the roll is: the announce gate for a
   * destination is the region panel and the own-region ballot, and neither
   * belongs here.
   */
  const upNext = state.turn === null ? null : state.seats[state.turn];
  const owesDestination = upNext !== null && needsDestination(upNext, nodeForCity);
  /**
   * The sibling state, and the other way this screen used to read as stranded.
   *
   * A turn whose white pair earned a Bonus Roll stays open once the white
   * movement is walked — "if entitled, he must take it" — but the die has not
   * been thrown, so the leg has nothing to spend. Unlike the destination
   * above, the roll that clears it is *here*: the same readout this screen
   * already renders. So this says what is owed and leaves the dice, three
   * inches away, to take it.
   *
   * It also closes the interaction layer, which the destination case gets for
   * free and this one does not. A zero-movement leg affords no step — except
   * across a twin pair, which costs nothing and which the engine therefore
   * offers correctly. Tapping it drew a line the player could neither commit
   * nor undo, both controls being hidden here. So the suppression is explicit;
   * see the layer's own comment below.
   *
   * A destination owed as well comes first, in the book's own order.
   */
  const owesBonus = state.turn !== null && !owesDestination && state.bonusOwed;

  // The path comes from the log, not from the draft: this is what makes the
  // walk visible in any tab just watching along.
  const lastMove = state.lastMove;
  /**
   * Whether this device is the one that made the move. The animation is for
   * players the move is *broadcast* to — whoever tapped it out has already
   * watched it happen, and replaying it at them doubles the move. The shared
   * tablet is every seat's own device, so it never watches a replay; online,
   * only the mover's phone skips it. The path still lands complete (the trail
   * draws in full at once), only the walk itself is skipped.
   */
  const ownMove = lastMove !== null
    && (viewer === 'all' || viewer === lastMove.seat);
  // The mover is part of the key: two barons can commit the same dots one
  // after the other, and the path alone would make the second walk look like
  // the first still showing.
  const replaying = usePlayback(
    lastMove?.path ?? null, PLAYBACK_MS, lastMove?.seat ?? null, !ownMove);

  /**
   * Where the baron up has walked to so far this leg.
   *
   * The draft is the only record of it — the log hears about a leg once, when
   * it commits — so until then `seat.at` still holds where the leg began. That
   * is right for the log and wrong for the board: a route tapped out across
   * three states used to leave the pawn standing in the first one, and FIND,
   * which goes to the baron up, went to where they set out from rather than
   * where they now stand.
   */
  const walkedTo = drafted === null || drafted.length < 2
    ? null
    : drafted[drafted.length - 1]!;

  /**
   * The pawns as drawn, which is not quite the pawns as logged.
   *
   * Two things move one: the last committed leg still playing back, where the
   * mover sits at the node playback has reached rather than at rest on
   * `seat.at` (the two agree once `replaying.done`, the log having recorded
   * the leg's true end when it committed); and the draft above. They cannot
   * both apply — no lamp is tappable until playback finishes — so playback
   * comes first and the draft answers for every other moment.
   */
  const standing = useMemo(() => {
    const base = pawns(state);
    const playing = lastMove !== null && !replaying.done
      ? { seat: lastMove.seat, at: replaying.shown[replaying.shown.length - 1] }
      : state.turn !== null && walkedTo !== null
        ? { seat: state.turn, at: walkedTo }
        : null;
    if (playing === null || playing.at === undefined) return base;

    const out = new Map<NodeId, SeatId[]>();
    for (const [node, seats] of base) {
      const rest = seats.filter(id => id !== playing.seat);
      if (rest.length > 0) out.set(node, rest);
    }
    const here = out.get(playing.at);
    if (here) here.push(playing.seat);
    else out.set(playing.at, [playing.seat]);
    return out;
  }, [state, lastMove, replaying.shown, replaying.done, walkedTo]);

  /**
   * The pawns flattened to one entry per seat, in seat order. Keyed by seat
   * rather than by node deliberately: a pawn that keeps its element across a
   * move is what the glide transition carries to the new node — a key that
   * changes with the node would remount it already arrived, and the move
   * would cut instead of travel.
   */
  const engines = useMemo(() => {
    const out: { seat: SeatId; node: Placed; slot: number }[] = [];
    for (const [id, seats] of standing) {
      const node = board.byId.get(id);
      if (!node) continue;
      seats.forEach((seatId, slot) => { out.push({ seat: seatId, node, slot }); });
    }
    out.sort((a, b) => SEATS.indexOf(a.seat) - SEATS.indexOf(b.seat));
    return out;
  }, [standing, board]);

  const playing = SEATS
    .map(id => state.seats[id])
    .filter(seat => seat.name !== null && seat.stops.length > 0);

  /**
   * Whether a lamp may be tapped at all — see the interaction layer below for
   * the two things that close it.
   */
  const canTap = replaying.done && !owesBonus;

  /**
   * The lamp the pointer is on, derived rather than stored.
   *
   * A tap changes the leg beneath a cursor that has not moved, so no leave
   * event arrives to clear it — and the lamp it was on is very often no longer
   * a candidate. Deriving the mark against the current `legal` set means it
   * cannot outlive what it was marking; the same holds when the layer closes
   * for playback or a Bonus Roll.
   */
  const hovered = pointedAt !== null && canTap && route.legal.has(pointedAt)
    ? pointedAt
    : null;

  /**
   * The sections this trip has spent, for the baron up alone.
   *
   * `usedAfter` counts the draft's own steps on top of what earlier turns of
   * the trip spent, so the track closes behind the pawn as the route is tapped
   * rather than only once it commits. It is the same map `tripOf` hands the
   * engine, which is what keeps the drawing and the rule from disagreeing:
   * what is drawn spent is exactly what `section-used` will refuse.
   *
   * Only the baron up. Another seat's spent track is their business, and
   * drawing all of them at once would say nothing about the turn in hand.
   */
  const spentTrack = useMemo(() => {
    if (route.draft !== null) return usedAfter(route.draft);
    const seat = state.turn === null ? null : state.seats[state.turn];
    return seat?.used ?? new Map<string, number>();
  }, [route.draft, state]);

  /** Where the baron up is standing — mid-route that is the draft, not the log. */
  const standingAt = state.turn === null
    ? null
    : walkedTo ?? state.seats[state.turn].at;
  const baron = standingAt === null ? undefined : board.byId.get(standingAt);
  /** The other end of the journey FIND frames — the destination, once rolled. */
  const destinationCity = upNext === null ? null : destinationOf(upNext);
  const destinationNode = destinationCity === null
    ? undefined
    : board.byId.get(nodeForCity(destinationCity));

  /**
   * Whether the chip is on duty at all: a turn under way with somewhere to
   * walk, and no committed move still playing back over it.
   */
  const chipShowing = state.turn !== null && !owesDestination && replaying.done
    && baron !== undefined;

  /**
   * The one tap the chip offers, drawn as a target in the interaction layer
   * (see its `action` prop for why it lives there). Time to roll wins: dice
   * waiting to be thrown and a committable leg cannot both be true, since
   * `live` means the white pair is unthrown or the Bonus Roll is owed, and
   * either way there is no finished leg to commit. A pan begun on the chip
   * must not also take its tap — the same rule every lamp follows.
   */
  const chipAction = !chipShowing || baron === undefined
    ? null
    : dice.live && dice.mine
      ? { label: 'Roll the dice', x: baron.x, y: baron.y,
          onTap: () => { if (!viewport.wasDrag()) onRollDice(); } }
      : route.canCommit
        ? { label: 'End turn', x: baron.x, y: baron.y,
            onTap: () => { if (!viewport.wasDrag()) route.commit(); } }
        : null;

  return (
    <div style={{
      padding: 'clamp(6px, 1.6vw, 34px)',
      height: '100%',
      boxSizing: 'border-box',
      overflow: 'hidden',
      background: '#e8e6e1',
      fontFamily: "'Roboto Condensed', system-ui, sans-serif"
    }}>
      {/* The map's own motion vocabulary: the fade a traveled segment arrives
          with, and the breathing of the engine whose turn it is. Keyframes
          cannot be written inline, so this is the map's one style tag — and
          everything tagged data-motion goes still, transitions included, for
          anyone who asked the system for reduced motion. */}
      <style>{`
        @keyframes rb-fade { from { opacity: 0 } }
        @keyframes rb-breathe { 0%, 100% { opacity: 0.95 } 50% { opacity: 0.62 } }
        @media (prefers-reduced-motion: reduce) {
          [data-motion] { animation: none !important; transition: none !important }
        }
      `}</style>
      {/* A tap anywhere on the cabinet finishes a playing-back move early —
          the same rule this board already applies to a flap. Harmless once
          there is nothing left to skip: `usePlayback` treats a further call
          as a no-op. */}
      <div
        ref={viewport.ref}
        onClick={replaying.skip}
        onPointerDown={viewport.onPointerDown}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          boxShadow: '0 30px 70px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          position: 'relative',
          background: 'linear-gradient(180deg,#4a2c17,#331d0e)',
          // The gestures are the map's own. Without this the browser claims
          // the drag for scrolling and the pinch for zooming the page.
          touchAction: 'none',
          cursor: viewport.dragging ? 'grabbing' : 'grab'
        }}
      >
        {/* Grain and a bevelled frame: the board is a lit cabinet, not a screen. */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background:
            'repeating-linear-gradient(93deg,rgba(255,255,255,0.035) 0px,rgba(255,255,255,0.035) 1px,transparent 1px,transparent 7px),'
            + 'repeating-linear-gradient(88deg,rgba(0,0,0,0.10) 0px,rgba(0,0,0,0.10) 2px,transparent 2px,transparent 13px)'
        }} />
        <div style={{
          position: 'absolute',
          inset: 0,
          boxShadow: 'inset 0 0 120px rgba(0,0,0,0.55), inset 0 0 0 12px #5c3a1e, inset 0 0 0 13px #2b170a',
          pointerEvents: 'none',
          zIndex: 3
        }} />

        <svg
          width="100%" height="100%" viewBox={viewport.viewBox}
          style={{ position: 'absolute', inset: 0, display: 'block' }}
          // Not role="img": the lamps a baron may move to are real buttons
          // inside it, and a picture has no controls.
          role="group"
          aria-label="The Rail Baron network. Each baron's destination and the city they set out from are lit in their colour."
        >
          <path d={board.landPath} fill="rgba(0,0,0,0.20)" stroke="#8b6a42" strokeWidth={3}
                strokeLinejoin="round" transform="translate(0,3)" />
          <path d={board.landPath} fill="rgba(255,240,214,0.045)" stroke="#d6ab6d" strokeWidth={1.5}
                strokeLinejoin="round" />

          <Track edges={board.edges} nodes={board.byId} spent={spentTrack}
                 spentColor={state.turn === null ? '#fff6e2' : SEAT_COLORS[state.turn]} />

          {/* The portion of the last committed move walked so far — the same
              path everyone watching this log sees, drawn in the mover's own
              colour so it reads as their trail rather than a new draft. */}
          {lastMove && replaying.shown.length > 1 && (
            <g data-route="trail">
              {replaying.shown.slice(1).map((id, i) => {
                const a = board.byId.get(replaying.shown[i]!);
                const b = board.byId.get(id);
                if (!a || !b) return null;
                return (
                  <TraveledSegment key={i} a={a} b={b}
                                   color={SEAT_COLORS[lastMove.seat]} />
                );
              })}
            </g>
          )}

          {/* There is no separate drawing of the draft any more. The route as
              tapped out IS the spent track: `usedAfter` counts the draft's
              steps section by section, so the lit treatment inside Track
              draws each one as it is taken — and what is drawn lit is exactly
              what `section-used` will refuse, one map for both. */}

          <g>
            {board.nodes.filter(n => n.kind === 'dot').map(node => {
              const candidate = route.legal.has(node.id);
              return <RouteLamp key={node.id} node={node} lit={candidate}
                                candidate={candidate} hover={hovered === node.id} />;
            })}
          </g>
          <g>
            {board.nodes.filter(n => n.kind === 'city').map(node => {
              const marker = node.cityId === undefined
                ? undefined
                : lamps.get(node.cityId)?.[0];
              const region = node.cityId === undefined
                ? undefined
                : cityById(node.cityId).region;
              const candidate = route.legal.has(node.id);
              return (
                <CityLamp
                  key={node.id}
                  node={node}
                  lit={marker !== undefined || candidate}
                  marker={marker}
                  candidate={candidate}
                  hover={hovered === node.id}
                  color={marker
                    ? SEAT_COLORS[marker.seat]
                    : (region ? REGION_COLOR[region] : '#e8a13c')}
                />
              );
            })}
          </g>

          {/* One engine per baron, stacked where several share a node. The
              look is the 5b piece from `Train Movement Style.dc.html`: a
              seat-coloured disc in a dark rim with a specular catch, and —
              on the baron up alone — a glow that breathes. Position is a
              transform on the group so a move glides it there; see `engines`
              above for why the key is the seat. */}
          <g>
            {engines.map(({ seat: seatId, node, slot }) => {
              const active = seatId === state.turn;
              const color = SEAT_COLORS[seatId];
              return (
                <g key={seatId} role="img" data-node={node.id} data-motion=""
                   aria-label={state.seats[seatId].name ?? seatId}
                   style={{
                     transform: `translate(${node.x + slot * 5}px, ${node.y - 11}px)`,
                     transition: GLIDE
                   }}>
                  {active && (
                    <g aria-hidden="true">
                      <circle r={17} fill={color} opacity={0.18} pointerEvents="none" />
                      <circle r={9} fill={color} opacity={0.34} pointerEvents="none" />
                    </g>
                  )}
                  <g aria-hidden="true" data-motion=""
                     style={active
                       ? { animation: 'rb-breathe 1.6s ease-in-out infinite' }
                       : undefined}>
                    <circle cy={0.6} r={6.4} fill="#100c08" opacity={0.55}
                            pointerEvents="none" />
                    <circle r={5.6} fill={color} stroke="#100c08" strokeWidth={1.4}
                            pointerEvents="none" />
                    <circle cx={-1.7} cy={-1.6} r={1.5} fill="#fff" opacity={0.7}
                            pointerEvents="none" />
                  </g>
                  <title>{state.seats[seatId].name}</title>
                </g>
              );
            })}
          </g>

          {/* The chip riding above the baron up's engine — dice, then the
              count, then END TURN. Hidden while a destination is owed (there
              is nothing to walk) and while a committed move is playing back
              (the walk on show is the log's, not a draft's). It stays mounted
              through a Bonus Roll being owed: the red die tumbles there when
              thrown, and with nothing to say it draws nothing. */}
          {chipShowing && state.turn !== null && baron !== undefined && (
            <EngineChip
              x={baron.x} y={baron.y}
              color={SEAT_COLORS[state.turn]}
              roll={dice.roll}
              remaining={route.remaining}
              done={route.canCommit}
              live={dice.live && dice.mine}
              onLanded={onDiceLanded}
            />
          )}

          {/* The tappable surface, last of all: see InteractionLayer above
              for why it must render after every painted lamp and pawn.

              Two things close it. A lamp is not tappable while the last
              committed move is still walking — a player must not start a new
              route over an animation of the previous one. And nothing is
              tappable while a Bonus Roll is owed: the leg has no movement
              until the die is thrown, so any step taken there is a step the
              player cannot commit. That is not hypothetical — a pawn standing
              on one half of a twin pair can cross to the other for nothing,
              which the engine rightly offers at zero movement, and tapping it
              drew a route line with no COMMIT and no UNDO to answer it. */}
          {/* Named lamps for whoever is working on the board, and nothing at
              all in the shipped bundle. Before the interaction layer, so a
              real tap target always wins. */}
          <NodeLabels nodes={board.nodes.filter(n => n.kind !== 'junction')} />

          <InteractionLayer
            nodes={board.nodes}
            legal={route.legal}
            enabled={canTap}
            action={chipAction}
            onHover={setPointedAt}
            /* A pan begun on a lamp must not also tap it. The lamps sit on
               the surface the player drags, so without this every drag that
               happened to start on a candidate drafted a step. */
            onTap={id => { if (!viewport.wasDrag()) route.tap(id); }}
          />
        </svg>

        {/* The top rail: BACK, the name of the game, and whatever the turn is
            asking for, in one flow.

            They used to be three absolutely positioned corners, which could
            not collide while the cabinet was a fixed 1400 wide. It is now as
            wide as the window, so at anything narrow the title ran straight
            through the turn's controls. In a row they share the width instead:
            the title takes what is left over and is clipped rather than
            overrunning, since it is decoration and the controls are not.

            The rail itself is transparent to the pointer so that a drag begun
            on the empty part of it still pans the map; its children take their
            clicks back individually. */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 4,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '26px 34px', boxSizing: 'border-box', pointerEvents: 'none'
        }}>
          <button
            onClick={onBack}
            style={{
              ...HUD_BUTTON, flex: '0 0 auto', cursor: 'pointer', pointerEvents: 'auto'
            }}
          >
            Back
          </button>

          {/* The centre slot: whose turn, in words, when a turn is under way —
              the thing a phone-holder actually needs — falling back to the
              title. The turn stays even on narrow viewports (it is short);
              the title still yields below TITLE_ROOM, where "R" is worse
              than nothing. YOUR TURN only on the actor's own device; the
              shared tablet names the baron — six people are looking at it. */}
          {state.turn !== null && state.seats[state.turn].name ? (
            <div style={{
              flex: '1 1 auto', minWidth: 0, textAlign: 'center',
              fontSize: 'clamp(13px, 2vw, 24px)', fontWeight: 700,
              letterSpacing: '0.3em', textTransform: 'uppercase',
              whiteSpace: 'nowrap', overflow: 'hidden',
              color: viewer === state.turn ? '#f5c451' : '#f0cd94',
              textShadow: '0 2px 0 #2b170a'
            }}>
              {viewer === state.turn
                ? 'Your turn'
                : `${state.seats[state.turn].name} is up`}
            </div>
          ) : viewport.size.width >= TITLE_ROOM ? (
            <div style={{
              flex: '1 1 auto', minWidth: 0, textAlign: 'center',
              fontSize: 'clamp(15px, 2.2vw, 30px)', fontWeight: 700,
              letterSpacing: '0.36em', textTransform: 'uppercase',
              whiteSpace: 'nowrap', overflow: 'hidden',
              color: '#f0cd94', textShadow: '0 2px 0 #2b170a'
            }}>
              Rail Baron
            </div>
          ) : <div style={{ flex: '1 1 auto' }} />}

          {/* The turn's controls. The draft they act on lives in screen state
              and never in the log, which is why UNDO costs nothing — the one
              thing that writes anything down is END TURN, over the engine. */}
          {state.turn !== null && owesDestination && (
            <div style={{
              flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
              pointerEvents: 'auto'
            }}>
              {/* One button, not a notice beside a separate way out: the roll
                  it names lives on the board, so saying it IS the way there. */}
              <button onClick={onBack} style={{ ...HUD_BUTTON, cursor: 'pointer' }}>
                {state.rolled === null
                  ? 'ROLL A NEW DESTINATION'
                  : 'ARRIVED — ROLL A NEW DESTINATION'}
              </button>
            </div>
          )}

          {owesBonus && (
            <div style={{
              flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
              pointerEvents: 'auto'
            }}>
              {/* A notice, not the control: the red die itself sits above the
                  engine, and the tap that throws it is there — the same place
                  the pair was thrown from at the top of the turn. */}
              <span style={{ ...HUD_BUTTON, background: 'rgba(43,23,10,0.35)' }}>
                BONUS ROLL — TAKE THE RED DIE
              </span>
            </div>
          )}

          {state.turn !== null && !owesDestination && !owesBonus && (
            <div style={{
              flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
              pointerEvents: 'auto'
            }}>
              {/* Only UNDO is left up here. The rest of the turn rides the
                  engine itself: the dice wait there to be thrown, the count
                  spends down there, and END TURN — the tap that commits — is
                  the pill the counter hardens into. UNDO stays on the rail
                  because it acts on the route as a whole, not on the place
                  the pawn stands. */}
              <button
                onClick={route.undo}
                disabled={!route.draft?.steps.length}
                style={{
                  ...HUD_BUTTON,
                  cursor: route.draft?.steps.length ? 'pointer' : 'default',
                  opacity: route.draft?.steps.length ? 1 : 0.45
                }}
              >
                UNDO
              </button>
            </div>
          )}
        </div>

        {/* The viewport's own controls, down the right-hand edge below the
            turn's cluster. Everything here can be done with the wheel and a
            drag; these are for touch, where there is no wheel, and for FIT,
            which nothing else offers. */}
        <div style={{
          position: 'absolute', top: 96, right: 34, zIndex: 4,
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch'
        }}>
          <button
            aria-label="Zoom in"
            onClick={() => viewport.zoomBy(STEP)}
            style={{ ...HUD_BUTTON, cursor: 'pointer', fontSize: 15, padding: '2px 12px' }}
          >
            +
          </button>
          <button
            aria-label="Zoom out"
            onClick={() => viewport.zoomBy(1 / STEP)}
            style={{ ...HUD_BUTTON, cursor: 'pointer', fontSize: 15, padding: '2px 12px' }}
          >
            −
          </button>
          <button
            aria-label="Fit the whole map"
            onClick={viewport.fitAll}
            style={{ ...HUD_BUTTON, cursor: 'pointer' }}
          >
            FIT
          </button>
          {baron && (
            <button
              aria-label="Find the baron up"
              /* The whole journey, not one end of it: where the pawn stands
                 and where it is going, framed together. Mid-trip with no
                 destination rolled yet, the pawn alone is the journey. */
              onClick={() => viewport.fitTo(destinationNode !== undefined
                ? [baron, destinationNode] : [baron])}
              style={{ ...HUD_BUTTON, cursor: 'pointer' }}
            >
              FIND
            </button>
          )}
        </div>

        {playing.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 26, left: 34, right: 34,
            display: 'flex', gap: 10, zIndex: 2
          }}>
            {playing.map(seat => {
              const stop = seat.stops[seat.stops.length - 1]!;
              return (
                <div key={seat.id} style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 12px', boxSizing: 'border-box', borderRadius: 3,
                  background: 'linear-gradient(180deg,rgba(126,96,65,0.85),rgba(90,66,41,0.85))',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 2px 4px rgba(0,0,0,0.45)'
                }}>
                  <span style={{
                    width: 11, height: 11, borderRadius: '50%',
                    background: SEAT_COLORS[seat.id],
                    boxShadow: `0 0 10px ${SEAT_COLORS[seat.id]}`
                  }} />
                  <span style={{
                    fontSize: 15, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: '#fdf3e0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {cityById(stop.city).name}
                  </span>
                  <span style={{
                    marginLeft: 'auto', fontFamily: "'DM Mono', ui-monospace, monospace",
                    fontSize: 13, color: '#f2c273'
                  }}>
                    {/* 0 is a real payout; only null means the roll was a home town. */}
                    {stop.payout === null ? 'HOME' : `$${stop.payout.toLocaleString('en-US')}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
