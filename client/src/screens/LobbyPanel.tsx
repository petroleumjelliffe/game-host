import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { LobbyRoomState } from '../../../vendor/lobby/client/useLobbyRoom';
import type { LobbyView } from '../../../vendor/lobby/client/view';

export function LobbyPanel({ view, lobby }: { view: LobbyView; lobby: LobbyRoomState }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 240 }).then(setQr);
  }, []);

  return (
    <main className="lobby">
      <h1>Pool {view.code}</h1>
      {qr && <img className="qr" src={qr} alt={`Join code ${view.code}`} />}
      <p className="share">Scan to jump in, or share the code.</p>
      <ul className="seats">
        {view.seats.map((seat) => (
          <li key={seat.index} className={seat.id ? 'taken' : 'empty'}>
            {seat.id === null ? (
              <span className="empty-seat">open water</span>
            ) : seat.canRename ? (
              <input
                defaultValue={seat.name ?? ''}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== seat.name) lobby.rename(name);
                }}
              />
            ) : (
              <span>
                {seat.name}
                {seat.isHost ? ' ⭐' : ''}
                {seat.connected ? '' : ' 💤'}
              </span>
            )}
          </li>
        ))}
      </ul>
      {view.canBegin && <button className="big" onClick={() => lobby.begin()}>Everybody in — start</button>}
      {view.beginBlocked === 'notEnoughPlayers' && <p>Need at least 3 swimmers.</p>}
      {view.beginBlocked === 'notHost' && <p>Waiting for the host to start…</p>}
      {lobby.message && <p className="error">{lobby.message}</p>}
      {view.you && !view.you.isHost && <button onClick={() => lobby.leaveSeat()}>Leave</button>}
    </main>
  );
}
