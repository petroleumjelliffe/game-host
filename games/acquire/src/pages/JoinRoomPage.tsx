import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JoinRoomCard } from '../game/lobby/JoinRoomCard';
import { getConnection, type Connection } from '../net/connection';
import { loadIdentity, rememberName, rememberedName, saveIdentity } from '../net/identity';

export interface JoinRoomPageProps {
  connect?: () => Connection;
}

export function JoinRoomPage({ connect = getConnection }: JoinRoomPageProps) {
  const navigate = useNavigate();
  const connection = connect();
  const [error, setError] = useState<string | null>(null);
  // Disables the submit and blocks a second one while a request is
  // outstanding. Cleared on rejection too — a mistyped code should be
  // correctable, not stuck.
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState('');
  // Prefilled with whatever you last called yourself, and empty if you never
  // have. Empty is a legal join: the server names the seat it gives you.
  const [name, setName] = useState(() => rememberedName() ?? '');
  const sentName = useRef('');

  useEffect(() => {
    const offJoined = connection.onJoined((msg) => {
      saveIdentity(msg.roomId, { playerId: msg.playerId, token: msg.token, name: sentName.current });
      navigate(`/room/${msg.roomId}`);
    });
    const offRejected = connection.transport.onRejected((msg) => {
      setError(msg.message);
      setWaiting(false);
    });
    return () => { offJoined(); offRejected(); };
  }, [connection, navigate]);

  return (
    <JoinRoomCard
      code={code}
      onCodeChange={setCode}
      name={name}
      onNameChange={setName}
      busy={waiting}
      error={error}
      onLeave={() => navigate('/online')}
      onSubmit={() => {
        const roomId = code.trim().toUpperCase();

        // A code this device already holds a seat for is not a join at all —
        // it is the way back in. Sending the tokenless join instead is the
        // owner's own bug: browser-back out of a game, rejoin by code,
        // refused, while the token that would have walked straight in sat
        // unread in storage. The room page's `useRoom` owns the rejoin.
        if (loadIdentity(roomId) !== null) {
          navigate(`/room/${roomId}`);
          return;
        }

        const chosen = name.trim();
        sentName.current = chosen;
        // Only a name you actually typed is worth carrying to the next room.
        if (chosen !== '') rememberName(chosen);
        setError(null);
        setWaiting(true);
        connection.joinRoom({
          roomId,
          // Omitted rather than sent blank: absence is what asks the server to
          // name the seat, and a blank string would mean the same thing only
          // by the server's leniency rather than by the wire's shape.
          ...(chosen === '' ? {} : { name: chosen }),
        });
      }}
    />
  );
}
