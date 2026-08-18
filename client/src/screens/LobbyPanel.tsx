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
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 240 }).then(setQr);
  }, []);

  const taken = view.seats.filter((s) => s.id !== null);
  // The swimmers in the water are the roster: seat index picks both the loop
  // and the creature, so the pool reads as "who is here".
  const swimmers = taken.map((s) => ({ seat: s.index, id: s.id!, asleep: !s.connected }));

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      // The share sheet is its own acknowledgement; a cancel is not a failure.
      try {
        await navigator.share({ title: 'Marco Polo', url });
      } catch {
        // dismissed
      }
      return;
    }
    const note = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        note();
        return;
      } catch {
        // fall through to the old way
      }
    }
    // Plain HTTP on a LAN is this game's usual home, and both modern paths
    // are gated on a secure context — so the last resort is the old one.
    const field = document.createElement('textarea');
    field.value = url;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    try {
      if (document.execCommand('copy')) note();
    } finally {
      field.remove();
    }
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
          {view.you && !view.you.isHost ? (
            // The seat list went away with the redesign, and with it the only
            // way to give a seat back. In an eight-seat room a wrong-room
            // join otherwise locks somebody out until the server reaps it.
            <button className="chip chip--light chip--action" onClick={() => lobby.leaveSeat()}>
              ← LEAVE
            </button>
          ) : (
            <span className="chip chip--light">LOBBY</span>
          )}
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
            <button className="btn btn--ghost btn--center" onClick={() => void share()}>
              {copied ? 'COPIED' : 'SHARE'}
            </button>
          </div>

          {taken.some((s) => !s.connected) && (
            <p className="lobby__note">
              {taken.filter((s) => !s.connected).length} ASLEEP — STILL HOLDING A SEAT
            </p>
          )}
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
