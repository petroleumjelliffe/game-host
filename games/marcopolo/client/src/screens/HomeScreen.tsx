import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { askWithTimeout } from '@game-host/lobby/client/answerTimeout';
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
  // client, and a server that never answered showed the same nothing as a
  // healthy one. Both kinds of failure now arrive through one episode: the
  // ask, its two answer channels, and the shared timeout that names the
  // third outcome (see the click handler below).
  const [note, setNote] = useState<string | null>(null);

  // One episode per tap of HOST A GAME. A second tap replaces the first
  // (stopping it first, so nothing is subscribed twice), and leaving the
  // screen stops whichever one is live.
  const stopAsking = useRef<(() => void) | null>(null);
  useEffect(() => () => stopAsking.current?.(), []);

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
                stopAsking.current?.();
                stopAsking.current = askWithTimeout({
                  ask: () =>
                    connection().createRoom(identity.rememberedName() ?? undefined),
                  // Plain references — no implementation in this repo
                  // binds `this`, and the reference is what lets the message
                  // types infer through Subscribe<J>/Subscribe<R>.
                  onJoined: connection().onJoined,
                  onRejected: connection().onRejected,
                  // `joined` arrives while still on this screen; store the
                  // seat so RoomScreen's useLobbyRoom rejoins with the token
                  // instead of taking a second seat.
                  joined: (msg) => {
                    identity.saveIdentity(msg.roomId, {
                      playerId: msg.playerId,
                      token: msg.token,
                      name: identity.rememberedName() ?? '',
                    });
                    navigateToRoom(msg.roomId);
                  },
                  // A protocol mismatch is the commonest refusal and the
                  // least guessable: a tab left open across a deploy speaks
                  // last week's protocol, and the advice is to reload.
                  rejected: (msg) => {
                    setNote(msg.code === 'versionMismatch'
                      ? 'This page is out of date — reload to get the newer client'
                      : msg.message);
                  },
                  silence: () =>
                    setNote('No answer from the server — it may be restarting. Try again.'),
                });
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
