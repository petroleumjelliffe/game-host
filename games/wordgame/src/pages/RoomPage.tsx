// The room page, in two layers since the invite flow (2026-09-05).
//
// The outer `RoomPage` resolves any `?invite=` / `?key=` landing FIRST and
// only then mounts the inner `RoomView`, which owns `useRoom`. The split is
// load-bearing, not stylistic: `useLobbyRoom` reads the stored identity
// once at mount and joins the moment the socket opens, so an async claim
// racing it would seat the invitee as a brand-new player and then claim the
// reserved seat too — two seats for one person, and the claimed credentials
// unused until a reload. A render branch cannot stop a hook; a component
// that is not mounted has none.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  landingParam,
  redeemLanding,
  stripLandingParam,
  type LandingCredentials,
  type LandingParam,
} from '@game-host/notify/client/landing';
import { sendRemind } from '@game-host/notify/client/invites';
import { useEnrollPush } from '@game-host/notify/client/useEnrollPush';
import { GameScreen } from '../game/GameScreen';
import { RoomLobby } from '../game/lobby/RoomLobby';
import { InvitePicker } from '../game/lobby/InvitePicker';
import { RoomGone } from '../game/lobby/RoomGone';
import { StaleClient } from '../game/lobby/StaleClient';
import { ConnectionStrip } from '../game/lobby/ConnectionStrip';
import { RoomRefused } from '../game/lobby/RoomRefused';
import { seatEmoji } from '../game/seatEmoji';
import { lobbyView } from '@game-host/lobby/client/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../engine/constants';
import { useRoom } from '../net/useRoom';
import { loadIdentity, saveIdentity } from '../net/identity';
import { useNotifyBind } from '../notify/useNotifyBind';
import { getConnection, closeConnection, type Connection } from '../net/connection';

export interface RoomPageProps {
  /** Injectable so screen tests can drive a fake. The app never passes it. */
  connect?: () => Connection;
}

type Landing =
  | { state: 'none' }
  | { state: 'redeeming' }
  /** The design's claim screen: a seat was held, and is now this device's. */
  | { state: 'claimed'; creds: LandingCredentials }
  /** One screen for invalid, revoked, spent and never-existed — indistinguishable by design. */
  | { state: 'refused' };

export function RoomPage({ connect = getConnection }: RoomPageProps) {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  // Read once at mount: the param is consumed (and stripped) exactly once.
  const [param] = useState<LandingParam | null>(() => landingParam(window.location.search));
  const [landing, setLanding] = useState<Landing>(param === null ? { state: 'none' } : { state: 'redeeming' });

  useEffect(() => {
    if (param === null || roomId === undefined) return;
    let cancelled = false;
    const stored = loadIdentity(roomId);
    void redeemLanding(param).then((creds) => {
      if (cancelled) return;
      stripLandingParam();
      if (creds === null) {
        // `alreadyHere`: a dead link for a seat this device already holds is
        // a no-op, not an error — straight through, no ceremony.
        setLanding(stored !== null ? { state: 'none' } : { state: 'refused' });
        return;
      }
      saveIdentity(roomId, { playerId: creds.playerId, token: creds.token, name: creds.name });
      // A key redemption (multi-device login) and a re-claimed identity pass
      // silently; a fresh invite claim gets the design's moment.
      if (param.kind === 'key' || stored?.playerId === creds.playerId) {
        setLanding({ state: 'none' });
      } else {
        setLanding({ state: 'claimed', creds });
      }
    });
    return () => { cancelled = true; };
    // Mount-only by construction: `param` never changes after the first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (landing.state === 'redeeming') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-6">
        <p className="text-ink-soft">Checking your invite…</p>
      </div>
    );
  }

  if (landing.state === 'refused') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-3 py-7">
        <div className="mx-auto w-full max-w-[398px] rounded-[22px] bg-paper p-6 text-center shadow-xl">
          <h1 className="mb-2 text-[19px] font-bold">That link didn’t work</h1>
          <p className="mx-auto mb-4 max-w-[300px] text-[13.5px] leading-relaxed text-ink-soft">
            It may have been used already, or the invite was taken back. You
            can still join the room as a new player.
          </p>
          <button
            type="button"
            onClick={() => { setLanding({ state: 'none' }); }}
            className="m-0 w-full rounded-xl bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-bold text-white"
          >
            Join as a new player
          </button>
          <button
            type="button"
            onClick={() => { navigate('/'); }}
            className="m-0 mt-3 w-full rounded-xl border-[1.5px] border-line-strong bg-white px-4 py-2.5 font-semibold text-ink-soft"
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  if (landing.state === 'claimed') {
    return (
      <ClaimLanding
        creds={landing.creds}
        roomId={roomId ?? ''}
        onGo={() => { setLanding({ state: 'none' }); }}
      />
    );
  }

  return <RoomView roomId={roomId} connect={connect} />;
}

/**
 * The claim screen with the push-enrollment card folded in — one screen,
 * one moment (the design's ruling, merging checklist P3 and P4).
 */
function ClaimLanding({ creds, roomId, onGo }: {
  creds: LandingCredentials;
  roomId: string;
  onGo: () => void;
}) {
  const enroll = useEnrollPush();
  const who = creds.inviterName ?? 'A friend';
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-3 py-7">
      <div className="mx-auto flex w-full max-w-[398px] flex-col gap-2.5 rounded-[22px] bg-paper p-5 shadow-xl">
        <h1 className="text-center text-[19px] font-bold">You’re in, {creds.name} 🎉</h1>
        <p className="mx-auto max-w-[300px] text-center text-[13.5px] leading-relaxed text-ink-soft">
          {who} saved you a seat in room <strong>{roomId}</strong>. It’s yours
          now — this device remembers it.
        </p>
        <button
          type="button"
          onClick={onGo}
          className="m-0 mt-1.5 w-full rounded-xl bg-[var(--lobby-accent,#2563eb)] px-4 py-2.5 text-[15px] font-bold text-white shadow-[0_2px_6px_rgba(37,99,235,0.35)]"
        >
          Go to the room
        </button>
        {(enroll.state === 'offer' || enroll.state === 'busy' || enroll.state === 'enabled'
          || enroll.state === 'failed' || enroll.state === 'needsInstall') && (
          <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-line bg-white p-3">
            <div aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-[#e8effc] text-[15px]">
              🔔
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold text-ink">
                {enroll.state === 'enabled' ? 'You’ll get a ping when it’s your turn'
                  : enroll.state === 'needsInstall' ? 'Want turn pings on this phone?'
                    : 'Get a ping when it’s your turn?'}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-faint">
                {enroll.state === 'needsInstall'
                  ? 'Add this game to your Home Screen first (Share → Add to Home Screen) — iPhones only push to installed apps.'
                  : enroll.state === 'failed'
                    ? 'That didn’t take — you can try again from settings.'
                    : 'On this device. Change anytime in settings.'}
              </p>
            </div>
            {(enroll.state === 'offer' || enroll.state === 'busy') && (
              <button
                type="button"
                disabled={enroll.state === 'busy'}
                onClick={() => { enroll.enroll(); }}
                className="m-0 flex-none self-center rounded-lg bg-[var(--lobby-accent,#2563eb)] px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60"
              >
                {enroll.state === 'busy' ? '…' : 'Turn on'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RoomView({ roomId, connect }: { roomId: string | undefined; connect: () => Connection }) {
  const navigate = useNavigate();
  const room = useRoom(roomId ?? '', connect);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Whenever this device holds a seat, tell the notification service which
  // seat is ours — in the lobby too, since the invite picker's "already in
  // this room" reads lobby bindings; only the playing bind writes the
  // co-player ledger, server-side. Fire-and-forget.
  useNotifyBind(
    roomId ?? '',
    room.phase === 'playing' ? 'playing' : room.phase === 'lobby' ? 'lobby' : null,
  );

  // Leaving is a real disconnect: the socket this room depends on closes,
  // and `getConnection()` opens a fresh one wherever the player goes next.
  const leave = () => {
    closeConnection();
    navigate('/');
  };

  // The roster is the only thing that knows who is connected — the game view
  // has no idea a socket exists. Undefined until one arrives, which reads as
  // "everyone present" rather than "everyone away".
  const presence = room.roster
    ? Object.fromEntries(room.roster.players.map((p) => [p.id, p.connected]))
    : undefined;

  if (room.phase === 'playing' && room.view && room.playerId) {
    return (
      <>
        <ConnectionStrip status={room.status} />
        <GameScreen
          view={room.view}
          viewerId={room.playerId}
          roomId={roomId ?? ''}
          connected={room.status === 'open'}
          {...(presence === undefined ? {} : { presence })}
          sendMove={room.sendMove}
          rejection={room.rejection}
          onDismissRejection={room.dismissRejection}
          onExit={leave}
        />
      </>
    );
  }

  if (room.phase === 'stale') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        {/* The worker caches nothing (push only), so a plain reload really
            does fetch the current bundle. */}
        <StaleClient onReload={() => { window.location.reload(); }} onExit={leave} />
      </>
    );
  }

  if (room.phase === 'gone') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomGone roomId={roomId} onExit={leave} />
      </>
    );
  }

  if (room.phase === 'error') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomRefused
          roomId={roomId}
          message={room.message}
          onRetry={() => { room.join(); }}
          onExit={leave}
        />
      </>
    );
  }

  if (room.phase === 'lobby' && room.roster) {
    const view = lobbyView(room, { capacity: MAX_PLAYERS, minPlayers: MIN_PLAYERS });
    // The seat proof the invite endpoints need. The identity store, not the
    // hook: the token never rides React state.
    const identity = roomId === undefined ? null : loadIdentity(roomId);
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomLobby
          view={view}
          note={room.message}
          onStart={room.begin}
          onRename={room.rename}
          onLeaveSeat={() => {
            room.leaveSeat();
            leave();
          }}
          seatEmoji={seatEmoji}
          // The lobby lives at /room/:id, so the page's own address IS the
          // share link.
          shareUrl={window.location.href}
          shareText="Join my word game!"
          {...(identity === null ? {} : {
            onInvite: () => { setPickerOpen(true); },
            onRemind: (playerId: string) =>
              sendRemind({
                game: 'wordgame',
                roomId: roomId ?? '',
                playerId: identity.playerId,
                token: identity.token,
                targetPlayerId: playerId,
              }),
            onRevoke: room.revokeSeat,
          })}
        />
        {pickerOpen && identity !== null && (
          <InvitePicker
            roomId={roomId ?? ''}
            self={{ playerId: identity.playerId, token: identity.token }}
            onClose={() => { setPickerOpen(false); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-6">
      <ConnectionStrip status={room.status} />
      <p className="text-ink-soft">{room.phase === 'joining' ? 'Joining…' : 'Connecting…'}</p>
    </div>
  );
}
