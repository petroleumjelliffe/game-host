import { lazy, Suspense, useState } from 'react';
import { matchPath, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { Rng } from '../engine';
import { Board } from './board/Board';
import { home } from './board/screens/home';
import { passAndPlay } from './board/screens/passAndPlay';
import { saved } from './board/screens/saved';
import { confirm } from './board/screens/confirm';
import type { FieldId, Row, ScreenDef } from './board/types';
import { useGameShell } from './GameShell';
import { JoinRoomApp, RoomApp } from './OnlineApp';

/**
 * The map is loaded only when someone asks for it. It carries the projected
 * network, the coastline and d3-geo — around 160KB that the roller, which is
 * the whole app for most of a game, has no use for.
 */
const MapView = lazy(() => import('./map/MapView').then(m => ({ default: m.MapView })));
import type { SeatId } from './state/events';
import { useGame } from './state/useGame';

export interface AppProps {
  /** Injectable so tests can script the dice through the full ballot path. */
  rng?: Rng;
}

/**
 * The routes this app answers to. Not every screen has one — the discard
 * confirmation and the region ballot are states within a route, because a
 * confirmation should not be bookmarkable and the back button out of one
 * must be harmless.
 */
const ROUTES = ['/', '/pass-and-play', '/pass-and-play/game', '/pass-and-play/map'] as const;
type KnownRoute = (typeof ROUTES)[number];

const isKnown = (path: string): path is KnownRoute =>
  (ROUTES as readonly string[]).includes(path);

/**
 * The online routes are handled before the board is: `/room/:code` cannot be a
 * member of a const list, and both mount their own Board — see OnlineApp for
 * why that is a deliberate trade rather than an oversight.
 */
const ONLINE_ROUTE = '/online';

/**
 * There is exactly one Board, mounted above the routing, and the route only
 * decides which ScreenDef it is handed.
 *
 * This is not a tidiness preference. A Board per route means navigation
 * unmounts one and mounts another, `useFlap` sees a first render and
 * correctly declines to animate — so the flap, which is the entire point of
 * the design, never plays on the transition it exists for. It would also
 * give each route its own `useGame`, and therefore its own copy of the
 * event log.
 */
export default function App({ rng }: AppProps = {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const game = useGame(rng);
  const { state, savedAt, rename, start, reset } = game;
  // Pass-and-play: one device, every baron.
  const shell = useGameShell(game, 'all');
  // The field is kept beside the seat rather than rebuilt as `seat:${seat}`
  // at the Board: the seat is what `rename` needs, the field is what the
  // Board matches on, and deriving either from the other is what let the
  // join board's non-seat field render nothing at all.
  const [editing, setEditing] =
    useState<{ field: FieldId; seat: SeatId; placeholder: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (pathname === ONLINE_ROUTE) return <JoinRoomApp />;
  const inRoom = matchPath('/room/:code', pathname);
  if (inRoom?.params.code) return <RoomApp code={inRoom.params.code} />;

  if (!isKnown(pathname)) return <Navigate to="/" replace />;

  const resuming = state.phase !== 'setup';

  // A stale bookmark or a typed URL can ask for the game board when there
  // is no game. Rendering it anyway gives a board of seven blank rows with
  // nothing tappable on it — a dead end whose only affordance is BACK.
  // The map is reached from the game and shows what each baron is doing, so
  // it is guarded the same way.
  if (pathname.startsWith('/pass-and-play/') && !resuming) {
    return <Navigate to="/pass-and-play" replace />;
  }

  // The map is not a ScreenDef and is not seven rows, so it replaces the
  // Board rather than being handed to it. Everything below this line is the
  // board and does not apply.
  if (pathname === '/pass-and-play/map') {
    return (
      <main style={{ height: '100%' }}>
        <Suspense fallback={
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#e8e6e1', fontFamily: "'DM Mono', ui-monospace, monospace",
            fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8a8377'
          }}>
            Warming the lamps
          </div>
        }>
          <MapView
            state={state}
            onBack={() => navigate('/pass-and-play/game')}
            onMove={shell.onMove}
            dice={shell.dice}
            onRollDice={shell.onRollDice}
            onDiceLanded={shell.onDiceLanded}
          />
        </Suspense>
      </main>
    );
  }

  const passAndPlayScreen = (): ScreenDef => {
    if (confirming) return confirm();
    return resuming ? saved(state, savedAt) : passAndPlay(state);
  };

  // Every route but the map, which returned above — it is not a ScreenDef.
  const screens: Record<Exclude<KnownRoute, '/pass-and-play/map'>, ScreenDef> = {
    '/': home(),
    '/pass-and-play': passAndPlayScreen(),
    '/pass-and-play/game': shell.gameScreen
  };

  const onRowAct = (row: Row, index: number) => {
    if (row.action === null) return;

    // The rows that play the game — act, order, undo — belong to the shell,
    // which pass-and-play and online share. What is left is this app's own:
    // renaming a seat and moving between its routes.
    if (shell.actOnRow(row, index)) return;

    if (row.action.kind === 'edit') {
      // Every editable row on this app's screens is a seat — the room code is
      // the join board's, which App never renders. Guard anyway rather than
      // slice blindly: FieldId now has a member that is not a seat.
      if (!row.action.field.startsWith('seat:')) return;
      setEditing({
        field: row.action.field,
        seat: row.action.field.slice('seat:'.length) as SeatId,
        placeholder: row.action.placeholder
      });
      return;
    }

    if (row.action.kind !== 'navigate') return;
    switch (row.action.to) {
      case 'passAndPlay':
        // Only reachable from the confirmation's YES, DISCARD row.
        if (confirming) reset();
        setConfirming(false);
        navigate('/pass-and-play');
        break;
      case 'confirm':
        setConfirming(true);
        break;
      case 'saved':
        setConfirming(false);
        break;
      case 'play':
        if (!resuming) start();
        navigate('/pass-and-play/game');
        break;
      case 'map':
        navigate('/pass-and-play/map');
        break;
      case 'joinRoom':
        navigate(ONLINE_ROUTE);
        break;
    }
  };

  return (
    <main style={{ height: '100%' }}>
      <Board
        screen={screens[pathname]}
        awaitRegion={shell.awaitRegion}
        onRollDice={shell.onRollDice}
        awaitDice={shell.awaitDice}
        editing={editing && {
          field: editing.field,
          placeholder: editing.placeholder,
          initial: state.seats[editing.seat].name ?? ''
        }}
        onCommit={value => {
          if (editing) rename(editing.seat, value || null);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
        onBack={() => {
          // Backing out of the confirmation returns to the saved game
          // rather than leaving the route, which is why it is not a route.
          if (confirming) { setConfirming(false); return; }
          navigate('/');
        }}
        onRowAct={onRowAct}
      />
    </main>
  );
}
