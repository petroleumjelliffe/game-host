import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { JoinRoomCard } from '../game/lobby/JoinRoomCard';

/**
 * A code box and a button. It never joins: the room page's chooser
 * (PreJoin) is where a seat is taken or reclaimed, and it needs the
 * roster to offer either. Sending a fresh join from here refused every
 * started room — the "seat taken" an installed app saw on 2026-09-09.
 */
export function JoinRoomPage() {
  const navigate = useNavigate();
  // A room link (`?code=`) prefills the box. Uppercased immediately: the
  // code is generated from an uppercase alphabet, so a lowercase link
  // should look exactly like typing it in.
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => (params.get('code') ?? '').toUpperCase());

  return (
    <JoinRoomCard
      code={code}
      onCodeChange={setCode}
      onLeave={() => navigate('/')}
      onSubmit={() => { navigate(`/room/${code.trim().toUpperCase()}`); }}
    />
  );
}
