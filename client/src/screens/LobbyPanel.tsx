import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { LobbyRoomState } from '../../../vendor/lobby/client/useLobbyRoom';
import type { LobbyView } from '../../../vendor/lobby/client/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../protocol/game';
import { creatureFor } from '../render/creatures';
import { drawIdlePool } from '../render/idle';
import { PoolBackdrop } from './PoolBackdrop';
import { Deck, DECK_MIN_PX } from './Deck';

export function LobbyPanel({ view, lobby }: { view: LobbyView; lobby: LobbyRoomState }) {
  const [qr, setQr] = useState<string | null>(null);
  const [deckHeight, setDeckHeight] = useState(DECK_MIN_PX);
  useEffect(() => {
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 240 }).then(setQr);
  }, []);

  const taken = view.seats.filter((s) => s.id !== null);
  // The swimmers in the water are the roster: seat index picks both the loop
  // and the creature, so the pool reads as "who is here".
  const swimmers = taken.map((s) => ({ seat: s.index, id: s.id! }));

  const share = () => {
    const url = window.location.href;
    if (navigator.share) void navigator.share({ title: 'Marco Polo', url }).catch(() => {});
    else void navigator.clipboard?.writeText(url);
  };

  return (
    <main>
      <PoolBackdrop
        skin="pale"
        mask="cut"
        paint={(ctx, layout, now) => {
          const height = layout.size + layout.offsetY * 2;
          const width = layout.size + layout.offsetX * 2;
          drawIdlePool(
            ctx,
            swimmers,
            { left: 0, top: 0, right: width, bottom: height - deckHeight },
            now,
            Math.max(18, width * 0.062),
          );
        }}
      >
        <div className="chips">
          <span className="chip chip--light">LOBBY</span>
          <span className="chip chip--dark">
            {view.you?.isHost ? 'YOU START' : 'HOST STARTS'}
          </span>
        </div>
        <Deck onHeight={setDeckHeight}>
          <div className="lobby__row">
            {qr && <img className="lobby__qr" src={qr} alt={`Join code ${view.code}`} />}
            <div className="lobby__code">
              <span className="deck__label">ROOM CODE</span>
              <span className="lobby__code-value selectable">{view.code}</span>
              <span className="lobby__hint">SCAN OR TYPE TO JOIN</span>
            </div>
            <div className="lobby__count">
              <span className="lobby__count-cap">MAXIMUM<br />{MAX_PLAYERS} BATHERS</span>
              <span className="lobby__count-rule" />
              <span className="lobby__count-value">{taken.length}</span>
              <span className="lobby__count-label">IN POOL</span>
            </div>
          </div>

          {view.you && (
            <label className="lobby__you">
              <span className="lobby__you-creature">{creatureFor(view.you.id!, false)}</span>
              <input
                className="lobby__you-name"
                defaultValue={view.you.name ?? ''}
                placeholder="YOUR NAME"
                maxLength={12}
                disabled={!view.you.canRename}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== view.you?.name) lobby.rename(name);
                }}
              />
            </label>
          )}

          <div className="lobby__actions">
            <button
              className="btn btn--primary btn--center lobby__start"
              disabled={!view.canBegin}
              onClick={() => lobby.begin()}
            >
              START<span className="btn__pip" />
            </button>
            <button className="btn btn--ghost btn--center" onClick={share}>SHARE</button>
          </div>

          {view.beginBlocked === 'notEnoughPlayers' && (
            <p className="lobby__note">NEED {MIN_PLAYERS} SWIMMERS</p>
          )}
          {view.beginBlocked === 'notHost' && <p className="lobby__note">WAITING FOR THE HOST</p>}
          {lobby.message && <p className="lobby__note lobby__note--error">{lobby.message}</p>}
        </Deck>
      </PoolBackdrop>
    </main>
  );
}
