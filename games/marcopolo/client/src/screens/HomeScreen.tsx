import { useEffect, useState, useSyncExternalStore } from 'react';
import { connection, identity } from '../net/singletons';
import { navigateToJoin, navigateToRoom } from '../router';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../protocol/game';
import { drawIdlePool } from '../render/idle';
import { PoolBackdrop } from './PoolBackdrop';
import { Deck, DECK_MIN_PX } from './Deck';

// Set dressing: three creatures in the water behind the opening screen.
const DECOR = [{ seat: 0, id: 'p1' }, { seat: 3, id: 'p4' }, { seat: 6, id: 'p7' }];

export function HomeScreen() {
  // The deck is a wall the swimmers bounce off, and only the deck knows how
  // tall it ended up.
  const [deckHeight, setDeckHeight] = useState(DECK_MIN_PX);

  // The connection has always known whether it was open; this screen was the
  // one that never asked. HOST A GAME was a bare onClick, and socket.io
  // buffers an emit made while disconnected — so with the server unreachable
  // the tap produced a room several seconds later, or never, with nothing on
  // screen either way. Reported 2026-08-20 as "it hung the first time and I
  // had to reload".
  //
  // `subscribe`/`status` are shaped for useSyncExternalStore already: one
  // listener, one snapshot, no local copy of state that can disagree with the
  // socket.
  const status = useSyncExternalStore(
    (onChange) => connection().subscribe(onChange),
    () => connection().status(),
  );

  // Rail Baron says this and Acquire says this; Marco Polo said nothing at
  // all, on any screen — `onRejected` had no subscriber anywhere in this
  // client. A protocol mismatch is the commonest cause and the least
  // guessable: a tab left open across a deploy speaks last week's protocol,
  // is refused, and shows the same nothing as a healthy server would.
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => connection().onRejected((msg) => {
    setNote(msg.code === 'versionMismatch'
      ? 'This page is out of date — reload to get the newer client'
      : msg.message);
  }), []);

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
    <main>
      <PoolBackdrop
        skin="pale"
        mask="cut"
        paint={(ctx, layout, now) => {
          const height = layout.size + layout.offsetY * 2;
          const width = layout.size + layout.offsetX * 2;
          drawIdlePool(
            ctx,
            DECOR,
            { left: 0, top: 0, right: width, bottom: height - deckHeight },
            now,
            Math.max(18, width * 0.062),
          );
        }}
      >
        <div className="chips">
          <span className="chip chip--light">ONLINE</span>
          <span className="chip chip--dark">EYES CLOSED. EARS OPEN.</span>
        </div>
        <Deck onHeight={setDeckHeight}>
          <div className="deck__stack">
            <button
              className="btn btn--primary"
              // Disabled rather than queued. The buffered-emit behaviour is
              // useful mid-game, where a dropped frame of connectivity should
              // not lose a move; on a button that creates a room it just
              // swallows the tap.
              disabled={status !== 'open'}
              onClick={() => {
                setNote(null);
                connection().createRoom(identity.rememberedName() ?? undefined);
              }}
            >
              {status === 'open' ? 'HOST A GAME' : 'CONNECTING…'}
              <span className="btn__pip" />
            </button>
            <button className="btn btn--ghost" onClick={() => navigateToJoin()}>
              JOIN A GAME<span className="btn__pip" />
            </button>
          </div>
          {note !== null && (
            // role=status, so a screen reader hears it: this is the only
            // feedback for an action whose failure is otherwise invisible.
            <p className="deck__note" role="status">{note}</p>
          )}
          <div className="deck__footer">
            <span>ONLINE · {MIN_PLAYERS}–{MAX_PLAYERS} BATHERS</span>
            <span>MARCO POLO</span>
          </div>
        </Deck>
      </PoolBackdrop>
    </main>
  );
}
