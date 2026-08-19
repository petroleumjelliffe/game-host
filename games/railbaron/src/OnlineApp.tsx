import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lobbyView, type LobbyLimits } from '@game-host/lobby/client/view';
import { Board } from './board/Board';
import {
  joinRoom as joinRoomScreen, onlineLobby, roomGone, roomRefused, staleClient,
} from './board/screens/online';
import type { FieldId, Row, ScreenDef } from './board/types';
import { useGameShell } from './GameShell';
import { SERVER_URL } from './config';
import { closeConnection, getConnection } from './net/connection';
import { useOnlineGame } from './net/useOnlineGame';
import { useRoom, type RoomState } from './net/useRoom';
import { SEATS, type SeatId } from './state/events';

const MapView = lazy(() => import('./map/MapView').then(m => ({ default: m.MapView })));

/**
 * Online mounts its own Board, and that is a known cost rather than an
 * oversight.
 *
 * `App` keeps one Board across its own routes so the flap plays between them.
 * Sharing that single Board with online would mean `App` calling `useRoom`
 * unconditionally — hooks cannot be called conditionally — which opens a
 * socket to the game server on every load of the mode-select screen, for
 * every player who never goes online. The trade is one lost flap on the
 * home → online transition; within online, lobby → game → map all keep the
 * same Board and animate normally.
 */

/**
 * Both halves read the same rule rather than being told it: the seat space
 * that builds the server's rooms is this same SEATS, so capacity cannot drift
 * and no protocol version is spent on a number neither side had to send.
 */
const LIMITS: LobbyLimits = { capacity: SEATS.length, minPlayers: 2 };

const shellStyle = { height: '100%' } as const;

/** `/online` — type a code, or open a room of your own. */
export function JoinRoomApp() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState<{ placeholder: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The shared connection, touched only when somebody actually asks for a
  // room, so the join screen itself costs no socket. Shared is the point, not
  // a convenience: the seat this create binds rides the socket itself, and
  // `useRoom` on the next route reuses the same socket — the server's rejoin
  // shortcut hands it the same seat back, before any identity reaches
  // storage. An earlier draft opened its own connection here and closed it on
  // navigate, which threw that binding away: the creator arrived in their own
  // room as a stranger.
  useEffect(() => {
    if (!creating) return;
    const connection = getConnection();

    const offJoined = connection.onJoined((msg) => {
      // The room exists and this socket holds seat one of it.
      navigate(`/room/${msg.roomId}`);
    });

    // Every way this can fail arrives here or not at all, and both used to be
    // silent: a refusal was ignored, and a server that never answered left the
    // row tapped and the screen unchanged. The commonest cause is not exotic —
    // a stale page speaking last week's protocol to a freshly deployed
    // server, which is why the advice is to reload.
    const offRejected = connection.onRejected((msg) => {
      setCreating(false);
      setNote(msg.code === 'versionMismatch'
        ? 'Server speaks a different protocol — reload to get the newer client'
        : msg.message);
    });

    const timer = setTimeout(() => {
      setCreating(false);
      setNote(`No answer through ${SERVER_URL} — is the game server behind it running?`);
    }, 8000);

    connection.createRoom();
    // Unsubscribe only — the connection is the app's, and the room screen
    // this navigates to is about to need it. Closing it here is how the
    // creator lost their seat.
    return () => {
      clearTimeout(timer);
      offJoined();
      offRejected();
    };
  }, [creating, navigate]);

  const onRowAct = (row: Row) => {
    if (row.action === null) return;
    switch (row.action.kind) {
      case 'createRoom':
        setNote(null);
        setCreating(true);
        return;
      case 'joinRoom':
        navigate(`/room/${code}`);
        return;
      case 'edit':
        setEditing({ placeholder: row.action.placeholder });
        return;
      case 'navigate':
        if (row.action.to === 'home') navigate('/');
    }
  };

  return (
    <main style={shellStyle}>
      <Board
        screen={joinRoomScreen(code, note)}
        awaitRegion={null}
        onRollDice={() => {}}
        awaitDice={null}
        editing={editing && {
          field: 'roomCode',
          placeholder: editing.placeholder,
          // The code itself, not the row's prompt text.
          initial: code
        }}
        onCommit={(value) => {
          // Room codes are six unambiguous uppercase characters; typing them
          // in lower case is the ordinary way a person copies one off a phone.
          setCode(value.trim().toUpperCase().slice(0, 6));
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
        onBack={() => navigate('/')}
        onRowAct={onRowAct}
      />
    </main>
  );
}

/** `/room/:code` — the lobby until Begin, the game after it. */
export function RoomApp({ code }: { code: string }) {
  const navigate = useNavigate();
  const room = useRoom(code);
  return <RoomBoard room={room} onHome={() => navigate('/')} />;
}

function RoomBoard({ room, onHome }: { room: RoomState; onHome: () => void }) {
  const game = useOnlineGame(room.log, room.transport, room.seat);
  // Online: this device speaks for one baron. Before a seat is granted there
  // is nothing to act with, and 'all' would be wrong — but no game screen is
  // shown then either.
  const shell = useGameShell(game, room.seat ?? 'all');
  const [editing, setEditing] =
    useState<{ field: FieldId; seat: SeatId; placeholder: string } | null>(null);
  const [onMap, setOnMap] = useState(false);

  const view = useMemo(() => lobbyView({
    phase: room.phase,
    status: room.lobby.status,
    roster: room.lobby.roster,
    playerId: room.lobby.playerId,
  }, LIMITS), [room.phase, room.lobby.status, room.lobby.roster, room.lobby.playerId]);

  const playing = room.phase === 'playing';

  const screen: ScreenDef = room.phase === 'gone'
    ? roomGone()
    : room.phase === 'stale'
      ? staleClient()
      : room.phase === 'error'
        ? roomRefused(room.lobby.message)
        : playing
          ? shell.gameScreen
          // The message is a refusal to show in the lobby — a begin or a
          // rename the server wouldn't take — and this board is the only
          // thing that can show it.
          : onlineLobby(view, room.lobby.message);

  const onRowAct = (row: Row, index: number) => {
    if (row.action === null) return;
    // The rows that play the game are the shell's, and it holds the seat gate.
    if (playing && shell.actOnRow(row, index)) return;

    switch (row.action.kind) {
      case 'begin':
        room.lobby.begin();
        return;
      case 'share':
        // Best-effort. A browser that refuses the clipboard still shows the
        // code on the row, which is the thing being shared.
        void navigator.clipboard?.writeText(window.location.href).catch(() => {});
        return;
      case 'leave':
        room.lobby.leaveSeat();
        // Leaving is a real disconnect, not just a route change — the next
        // online visit opens a fresh socket rather than finding this one
        // still bound to a room the player walked out of.
        closeConnection();
        onHome();
        return;
      case 'edit':
        if (!row.action.field.startsWith('seat:')) return;
        setEditing({
          field: row.action.field,
          seat: row.action.field.slice('seat:'.length) as SeatId,
          placeholder: row.action.placeholder,
        });
        return;
      case 'navigate':
        if (row.action.to === 'home') onHome();
        if (row.action.to === 'map') setOnMap(true);
    }
  };

  if (onMap && playing) {
    return (
      <main style={shellStyle}>
        <Suspense fallback={<div style={shellStyle} />}>
          <MapView
            state={game.state}
            onBack={() => setOnMap(false)}
            onMove={shell.onMove}
            dice={shell.dice}
            onRollDice={shell.onRollDice}
            onDiceLanded={shell.onDiceLanded}
          />
        </Suspense>
      </main>
    );
  }

  return (
    <main style={shellStyle}>
      <Board
        screen={screen}
        awaitRegion={playing ? shell.awaitRegion : null}
        onRollDice={shell.onRollDice}
        awaitDice={playing ? shell.awaitDice : null}
        editing={editing && {
          field: editing.field,
          placeholder: editing.placeholder,
          // The name the roster holds, not the row's prompt.
          initial: view.seats.find((s) => s.id === editing.seat)?.name ?? ''
        }}
        onCommit={(value) => {
          // Names are the lobby's online: the roster broadcast is the answer,
          // and no `renamed` event ever reaches the game log.
          if (editing && value.trim() !== '') room.lobby.rename(value.trim());
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
        onBack={onHome}
        onRowAct={onRowAct}
      />
    </main>
  );
}
