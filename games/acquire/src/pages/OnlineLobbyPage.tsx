// src/pages/OnlineLobbyPage.tsx
// The Play Online card, per the Lobby Flow design — which has no name form
// in front of a room. Create Room seats you immediately under a default
// name, and the New Room card's editable own-row is where you say who you
// are. `CreateRoomPage`, which existed to collect the name first, is gone.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getConnection, type Connection } from '../net/connection';
import { rememberedName, saveIdentity } from '../net/identity';

/**
 * How long to wait for `createRoom` to be answered before saying so.
 *
 * `createRoom` is fire-and-forget — no ack, no timeout (see
 * `packages/lobby/client/connection.ts`) — so a server that is *absent*
 * rather than refusing sends neither `joined` nor `rejected`, and nothing
 * below would ever clear `waiting`. That is not hypothetical: socket.io
 * buffers the emit while disconnected and delivers it on reconnect, so the
 * click is not lost — but until the server comes back there is nothing to
 * show for it, and a disabled button reading "Creating…" is indistinguishable
 * from a hang. Reported from the LAN 2026-08-20.
 *
 * 8s matches Rail Baron's `OnlineApp.tsx`, which had this from the start and
 * was the only game that did. Long enough to cover a deploy's socket drop and
 * the reconnect backoff behind it; short enough that nobody reloads first.
 */
const NO_ANSWER_MS = 8000;

export interface OnlineLobbyPageProps {
  /** Injectable for tests. The app never passes it. */
  connect?: () => Connection;
}

export function OnlineLobbyPage({ connect = getConnection }: OnlineLobbyPageProps) {
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opened on the first click, not on mount: a visitor who presses Back
  // should not have cost a socket. State rather than a ref so the listener
  // effect below re-runs when it appears.
  const [connection, setConnection] = useState<Connection | null>(null);

  // The name the room is created under, captured at the moment of the click.
  const sentName = useRef('');

  // Cleared by an answer of either kind, and on unmount. A ref rather than
  // state because nothing renders from it — it exists only to be cancelled.
  const noAnswer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopWaiting = () => {
    if (noAnswer.current !== null) { clearTimeout(noAnswer.current); noAnswer.current = null; }
    setWaiting(false);
  };

  const create = () => {
    const c = connection ?? connect();
    setConnection(c);
    // Whatever you last called yourself, and nothing invented if you never
    // have: with no name on the wire the server seats you under `Player N`,
    // and your own lobby row is where you change it.
    //
    // Not `rememberName`d here either — only a name you actually chose is
    // worth carrying to the next room, and `useRoom`'s `rename` is where
    // choosing happens. Remembering a seat-derived default would follow you
    // into a room where you sit in a different seat.
    const name = rememberedName() ?? undefined;
    sentName.current = name ?? '';
    setError(null);
    setWaiting(true);
    c.createRoom(name);
    noAnswer.current = setTimeout(() => {
      noAnswer.current = null;
      setWaiting(false);
      setError('No answer from the server — it may be restarting. Try again.');
    }, NO_ANSWER_MS);
  };

  useEffect(() => {
    if (!connection) return;

    const offJoined = connection.onJoined((msg) => {
      stopWaiting();
      saveIdentity(msg.roomId, { playerId: msg.playerId, token: msg.token, name: sentName.current });
      navigate(`/room/${msg.roomId}`);
    });
    // Same fix CreateRoomPage carried: a server that is down or slow must not
    // leave `waiting` latched forever on a disabled button with no way out.
    const offRejected = connection.transport.onRejected((msg) => {
      setError(msg.message);
      stopWaiting();
    });
    return () => { offJoined(); offRejected(); stopWaiting(); };
  }, [connection, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md rounded-xl bg-white p-8 shadow-xl">
        <h1 className="mb-1 text-center text-2xl font-bold">Play Online</h1>
        <p className="mb-6 text-center text-sm text-gray-600">Everyone plays from their own device</p>

        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={create}
            disabled={waiting}
            className="m-0 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {waiting ? 'Creating…' : 'Create Room'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/online/join')}
            className="m-0 w-full rounded-lg border border-gray-300 px-4 py-3 font-semibold hover:bg-gray-50"
          >
            Join with a code
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="m-0 w-full rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-50"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
