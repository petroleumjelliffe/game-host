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
import { refreshInvite, sendRemind, type SigninOutcome } from '@game-host/notify/client/invites';
import { useEnrollPush } from '@game-host/notify/client/useEnrollPush';
import { GameScreen } from '../game/GameScreen';
import { RoomLobby } from '../game/lobby/RoomLobby';
import { InvitePicker } from '../game/lobby/InvitePicker';
import { PreJoin } from '../game/lobby/PreJoin';
import { RoomGone } from '../game/lobby/RoomGone';
import { StaleClient } from '@game-host/pwa/client/StaleClient';
import { forceUpdateAndReload } from '@game-host/pwa/client/update';
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
      <DeadLink
        roomId={roomId ?? ''}
        inviteToken={param?.kind === 'invite' ? param.token : null}
        onContinue={() => { setLanding({ state: 'none' }); }}
        onHome={() => { navigate('/'); }}
      />
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
 * The dead-link view (design screen B1), kept IN the room deliberately: the
 * sign-in it offers is scoped to this room, and routing home would imply a
 * login that gets all your games back — which does not exist. One copy for
 * used, revoked, and invalid; "Email me a new link" lets the server decide
 * (resend the invite, or a sign-in link for the claimed seat) behind the
 * vague sent state; "Continue to the room" lands on the pre-join chooser.
 */
function DeadLink({ roomId, inviteToken, onContinue, onHome }: {
  roomId: string;
  inviteToken: string | null;
  onContinue: () => void;
  onHome: () => void;
}) {
  const [state, setState] = useState<'idle' | 'sending' | SigninOutcome>('idle');

  const resend = () => {
    if (inviteToken === null) return;
    setState('sending');
    void refreshInvite(inviteToken).then(setState);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-3 py-7">
      <div className="mx-auto flex w-full max-w-[398px] flex-col gap-2.5 rounded-[22px] bg-paper p-6 shadow-xl">
        {state === 'sent' || state === 'cooldown' ? (
          <div className="flex flex-col items-center gap-1.5 py-2 text-center">
            <div aria-hidden className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${state === 'sent' ? 'bg-[#e6f2e8] text-[#3fa053]' : 'bg-warnbg'}`}>
              {state === 'sent' ? '✓' : '⏳'}
            </div>
            <p className="text-[15px] font-bold">{state === 'sent' ? 'Check your inbox' : 'Already sent today'}</p>
            <p className="max-w-[280px] text-[13px] leading-relaxed text-ink-soft">
              {state === 'sent'
                ? `If that invite’s email is set up, a fresh link for room ${roomId} is on its way. It can take a minute.`
                : 'A link went out recently. Check your inbox and spam — you can ask again tomorrow.'}
            </p>
          </div>
        ) : (
          <>
            <div aria-hidden className="flex h-12 w-12 items-center justify-center self-center rounded-full bg-[#f6e3dd] text-xl">🔗</div>
            <h1 className="text-center text-[19px] font-bold">That link didn’t work</h1>
            <p className="mx-auto max-w-[300px] text-center text-[13.5px] leading-relaxed text-ink-soft">
              Links to room {roomId} only work once and can go stale. You can
              get a fresh one by email, or look at the room first.
            </p>
            {inviteToken !== null && (
              <button
                type="button"
                disabled={state === 'sending'}
                onClick={resend}
                className="m-0 mt-1.5 w-full rounded-xl bg-[var(--lobby-accent,#2563eb)] px-4 py-2.5 text-[15px] font-bold text-white shadow-[0_2px_6px_rgba(37,99,235,0.35)] disabled:opacity-60"
              >
                {state === 'sending' ? 'Sending…' : 'Email me a new link'}
              </button>
            )}
          </>
        )}
        <button
          type="button"
          onClick={onContinue}
          className="m-0 w-full rounded-xl border-[1.5px] border-line-strong bg-white px-4 py-2.5 font-semibold text-ink-soft"
        >
          Continue to the room
        </button>
        <button
          type="button"
          onClick={onHome}
          className="m-0 py-1 text-center text-[13px] font-semibold text-[var(--lobby-accent,#2563eb)]"
        >
          Go home
        </button>
      </div>
    </div>
  );
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
  const enroll = useEnrollPush('wordgame');
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
  // True only for the arrival from the chooser's "Sit here": the lobby then
  // focuses the rename field with its default name selected, so the first
  // thing typed IS the name. Rejoins and created rooms stay hands-off.
  const [justSat, setJustSat] = useState(false);

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
        {/* The shared worker precaches the shell now (it used to be push
            only), so a plain reload can be served the same stale shell and
            loop — the reload has to get past the worker. */}
        <StaleClient onReload={() => { void forceUpdateAndReload(); }} onExit={leave} />
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

  if (room.phase === 'preview' && room.roster) {
    // A visitor holding no seat: the chooser (design A1, or A2b once the
    // game is running). "Sit here" is the explicit join; "That's me" mails
    // the address already on a seat — the only reclaim path now that the
    // name-match takeover is retired.
    return (
      <>
        <ConnectionStrip status={room.status} />
        <PreJoin
          roomId={roomId ?? ''}
          roster={room.roster}
          capacity={MAX_PLAYERS}
          seatEmoji={seatEmoji}
          onSit={() => {
            setJustSat(true);
            room.join();
          }}
          onHome={leave}
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
          autoFocusName={justSat}
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
