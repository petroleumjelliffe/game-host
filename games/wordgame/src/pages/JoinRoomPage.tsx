import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [waiting, setWaiting] = useState(false);
  // A room link (`?code=`) prefills the box rather than auto-joining — the
  // page still asks for a name first. Uppercased immediately: the code is
  // generated from an uppercase alphabet, so a lowercase link should look
  // exactly like typing it in.
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => (params.get('code') ?? '').toUpperCase());
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
        // it is the way back in. The room page's `useRoom` owns the rejoin.
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
          // Omitted rather than sent blank: absence is what asks the server
          // to name the seat.
          ...(chosen === '' ? {} : { name: chosen }),
        });
      }}
    />
  );
}
