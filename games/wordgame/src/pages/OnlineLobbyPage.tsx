// The Play Online card — mirrors Acquire's. No name form in front of a room:
// Create Room seats you immediately under a default name, and your editable
// own-row in the lobby is where you say who you are.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { askWithTimeout } from '@game-host/lobby/client/answerTimeout';
import { getConnection, type Connection } from '../net/connection';
import { rememberedName, saveIdentity } from '../net/identity';

export interface OnlineLobbyPageProps {
  /** Injectable for tests. The app never passes it. */
  connect?: () => Connection;
}

export function OnlineLobbyPage({ connect = getConnection }: OnlineLobbyPageProps) {
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opened on the first click, not on mount: a visitor who presses Back
  // should not have cost a socket.
  const [connection, setConnection] = useState<Connection | null>(null);

  // One episode per click: the ask, its two answer channels, and the shared
  // timeout that says so when nothing answers. A second click replaces the
  // episode; unmount stops it.
  const stopAsking = useRef<(() => void) | null>(null);
  useEffect(() => () => stopAsking.current?.(), []);

  const create = () => {
    const c = connection ?? connect();
    setConnection(c);
    // Whatever you last called yourself, and nothing invented if you never
    // have: with no name on the wire the server seats you under `Player N`.
    const name = rememberedName() ?? undefined;
    setError(null);
    setWaiting(true);
    stopAsking.current?.();
    stopAsking.current = askWithTimeout({
      ask: () => c.createRoom(name),
      onJoined: c.onJoined,
      onRejected: c.transport.onRejected,
      joined: (msg) => {
        setWaiting(false);
        saveIdentity(msg.roomId, { playerId: msg.playerId, token: msg.token, name: name ?? '' });
        navigate(`/room/${msg.roomId}`);
      },
      rejected: (msg) => {
        setError(msg.message);
        setWaiting(false);
      },
      silence: () => {
        setWaiting(false);
        setError('No answer from the server — it may be restarting. Try again.');
      },
    });
  };

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
