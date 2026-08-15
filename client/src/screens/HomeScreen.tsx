import { useEffect, useState } from 'react';
import { connection, identity } from '../net/singletons';
import { navigateToRoom } from '../router';

export function HomeScreen() {
  const [code, setCode] = useState('');

  // createRoom's `joined` arrives while still on this screen; store the seat
  // so RoomScreen's useLobbyRoom rejoins with the token instead of taking a
  // second seat.
  useEffect(() => {
    return connection().onJoined((msg) => {
      identity.saveIdentity(msg.roomId, {
        playerId: msg.playerId,
        token: msg.token,
        name: identity.rememberedName() ?? '',
      });
      navigateToRoom(msg.roomId);
    });
  }, []);

  return (
    <main className="home">
      <h1>Marco Polo</h1>
      <p>One phone each. One of you is blind. Everyone makes noise.</p>
      <button
        className="big"
        onClick={() => connection().createRoom(identity.rememberedName() ?? undefined)}
      >
        Start a pool
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) navigateToRoom(code.trim());
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Room code"
          maxLength={6}
          autoCapitalize="characters"
        />
        <button type="submit">Join</button>
      </form>
    </main>
  );
}
