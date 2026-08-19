// src/pages/PassAndPlayGamePage.tsx
// The board half of the pass-and-play route split.
//
// One mount path: the save. The lobby writes the initial state before
// navigating here, so "new game" and "resumed game" arrive identically, and a
// deep link or refresh with nothing saved redirects to the lobby rather than
// rendering a dead board. `createGameSession({ state })` raises the curtain
// for any non-draw state on its own, which is the curtain-on-reload ruling
// satisfied by construction.

import { useEffect, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { GameScreen } from '../game/GameScreen';
import { createGameSession } from '../../session/GameSession';
import { clear, load, save } from '../game/local/localSave';

export function PassAndPlayGamePage() {
  const navigate = useNavigate();

  // Read once per mount. A save written *by this page* must not rebuild the
  // session — that would throw away the snapshot store, and undo with it.
  const saved = useMemo(() => load(), []);
  const session = useMemo(
    () => (saved ? createGameSession({ state: saved.state }) : null),
    [saved],
  );

  // Save on segment close — the same boundary the server treats as
  // authoritative, and the undo and pass-the-device boundary. Watching
  // `segmentStart` move (rather than writing on every notification) is what
  // keeps staged, uncommitted work out of the save: the ruling is that a
  // refresh mid-turn returns you to the start of the turn.
  useEffect(() => {
    if (!session) return;
    let lastSegmentStart = session.getView().segmentStart;
    let savedEnd = false;

    return session.subscribe(() => {
      const view = session.getView();
      if (view.segmentStart !== lastSegmentStart) {
        lastSegmentStart = view.segmentStart;
        save(view.state);
      }
      // The end of the game is a boundary too — final scoring must survive a
      // refresh, and the future library inherits a final state from this.
      if (view.state.stage === 'end' && !savedEnd) {
        savedEnd = true;
        save(view.state);
      }
    });
  }, [session]);

  // Backgrounding the device raises the curtain (owner, from the first real
  // install: coming back to the app showed the hand sitting open). Raised on
  // *hidden*, not on return — by the time the app is visible again it may be
  // in someone else's hands, and a curtain raised then would flash the hand
  // first. Session construction covers fresh launches; this covers the
  // living page that never remounts. Pass-and-play only by construction:
  // online plays through NetworkSession, whose conceal() is a no-op because
  // that screen only ever shows the viewer's own seat.
  useEffect(() => {
    if (!session) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') session.conceal();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [session]);

  if (!session) return <Navigate to="/pass-and-play" replace />;

  return (
    <GameScreen
      session={session}
      // The one sanctioned clear besides the lobby's confirmed discard: the
      // game is fully over, and the lobby then offers a new game rather than
      // a continue. Only renders on final scoring — see GameScreen.
      onEndGame={() => {
        clear();
        navigate('/pass-and-play');
      }}
      onExit={() => navigate('/')}
      // The floating back in the board margin — the installed app has no
      // browser chrome. To the pass-and-play lobby, whose Continue card is
      // this same game: leaving is never losing it.
      onBack={() => navigate('/pass-and-play')}
    />
  );
}
