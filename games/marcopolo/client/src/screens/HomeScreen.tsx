import { useEffect, useState } from 'react';
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
              onClick={() => connection().createRoom(identity.rememberedName() ?? undefined)}
            >
              HOST A GAME<span className="btn__pip" />
            </button>
            <button className="btn btn--ghost" onClick={() => navigateToJoin()}>
              JOIN A GAME<span className="btn__pip" />
            </button>
          </div>
          <div className="deck__footer">
            <span>ONLINE · {MIN_PLAYERS}–{MAX_PLAYERS} BATHERS</span>
            <span>MARCO POLO</span>
          </div>
        </Deck>
      </PoolBackdrop>
    </main>
  );
}
