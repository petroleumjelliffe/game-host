import { useRef, useState } from 'react';
import type { LobbyView } from '@game-host/lobby/client/view';
import { TUNING } from '../../../protocol/game';
import type { GameSession } from '../net/useGameSession';
import { liveRipples } from '../game/sessionState';
import { screenToWorld } from '../game/camera';
import { drawScene } from '../render/draw';
import { creatureFor, MARCO_EMOJI } from '../render/creatures';
import { HeadingTracker, lastCallLabel, mmss, poolLayout, segmentsLit } from '../render/scene';
import { PoolBackdrop } from './PoolBackdrop';
import { ScoreboardOverlay } from './ScoreboardOverlay';

const SEND_EVERY_MS = 50;
const TURBO_SEGMENTS = 16;

export function GameScreen({ game, view, youId }: { game: GameSession; view: LobbyView; youId: string }) {
  const gameRef = useRef(game);
  gameRef.current = game;
  const headingsRef = useRef(new HeadingTracker());
  const [turboHeld, setTurboHeld] = useState(false);
  const inputRef = useRef<{ tx: number | null; ty: number | null; turbo: boolean; lastSent: number }>(
    { tx: null, ty: null, turbo: false, lastSent: 0 },
  );
  // Only the pointer that touched the water steers — a second finger on the
  // MARCO or TURBO buttons must not hijack or interrupt the swim gesture.
  const steerPointerRef = useRef<number | null>(null);

  const snapshot = game.session.latest!;
  const you = snapshot.you;
  const isMarco = youId === snapshot.marcoId;
  const stillIn = snapshot.players.filter((p) => p.id !== snapshot.marcoId).length;

  function send(force: boolean): void {
    const s = inputRef.current;
    const now = performance.now();
    if (!force && now - s.lastSent < SEND_EVERY_MS) return;
    s.lastSent = now;
    gameRef.current.sendInput({ tx: s.tx, ty: s.ty, turbo: s.turbo });
  }

  // Steering lives on the <main>, whose element type is HTMLElement.
  function setTarget(e: React.PointerEvent<HTMLElement>, clear: boolean): void {
    const s = inputRef.current;
    if (clear) {
      s.tx = null;
      s.ty = null;
      send(true);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    // The tiles are full-bleed but the arena is the centered square inside
    // them, so the letterbox offset comes off before the world transform.
    const layout = poolLayout(rect.width, rect.height);
    const w = screenToWorld(
      e.clientX - rect.left - layout.offsetX,
      e.clientY - rect.top - layout.offsetY,
      layout.size,
    );
    s.tx = Math.max(-1.5, Math.min(1.5, w.x));
    s.ty = Math.max(-1.5, Math.min(1.5, w.y));
    send(false);
  }

  function holdTurbo(held: boolean): void {
    setTurboHeld(held);
    inputRef.current.turbo = held;
    send(true);
  }

  const lit = segmentsLit(you.turbo, TURBO_SEGMENTS);

  return (
    <main
      className="game"
      onPointerDown={(e) => {
        if (steerPointerRef.current !== null) return;
        steerPointerRef.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer released before the handler ran can't be captured;
          // steering still works, moves just aren't glued to the pool.
        }
        setTarget(e, false);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== steerPointerRef.current) return;
        setTarget(e, false);
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== steerPointerRef.current) return;
        steerPointerRef.current = null;
        setTarget(e, true);
      }}
      onPointerCancel={(e) => {
        if (e.pointerId !== steerPointerRef.current) return;
        steerPointerRef.current = null;
        setTarget(e, true);
      }}
      style={{ touchAction: 'none' }}
    >
      <PoolBackdrop
        skin={isMarco ? 'blind' : 'cool'}
        mask="none"
        paint={(ctx, layout) => {
          const g = gameRef.current;
          const snap = g.session.latest;
          if (!snap) return;
          drawScene(ctx, {
            layout,
            youId,
            snapshot: snap,
            positions: g.buffer.at(Date.now()),
            ripples: liveRipples(g.session.ripples, Date.now()),
            headings: headingsRef.current,
            now: Date.now(),
          });
        }}
      >
        <div className={isMarco ? 'hud-top hud-top--marco' : 'hud-top hud-top--polo'}>
          <span className="hud-top__who">
            {isMarco
              ? `MARCO ${MARCO_EMOJI} · EYES CLOSED`
              : `YOU ${creatureFor(youId, false)} · MARCO ${MARCO_EMOJI}`}
          </span>
          <span className="hud-top__clock">{mmss(snapshot.timer)}</span>
        </div>

        <div className={isMarco ? 'hud-bottom hud-bottom--marco' : 'hud-bottom hud-bottom--polo'}>
          <div className="hud-line">
            {isMarco ? (
              <>
                <span>{stillIn} STILL IN</span>
                <span>{lastCallLabel(you.callCooldown, TUNING.callCooldownSeconds)}</span>
              </>
            ) : (
              <>
                <span>TURBO</span>
                <span>{Math.round(you.turbo * 100)}%</span>
              </>
            )}
          </div>
          {isMarco && (
            <button
              className="call-btn"
              disabled={(you.callCooldown ?? 0) > 0}
              // pointerdown, not click: it must fire from a second finger while
              // the first is mid-drag on the water.
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                gameRef.current.call();
              }}
            >
              CALL MARCO
            </button>
          )}
          <button
            className={turboHeld ? 'turbo-btn turbo-btn--held' : 'turbo-btn'}
            onPointerDown={(e) => {
              e.stopPropagation();
              holdTurbo(true);
            }}
            onPointerUp={() => holdTurbo(false)}
            onPointerCancel={() => holdTurbo(false)}
            onPointerLeave={() => turboHeld && holdTurbo(false)}
          >
            {Array.from({ length: TURBO_SEGMENTS }, (_, i) => (
              <span
                key={i}
                className={i < lit ? 'turbo-btn__seg turbo-btn__seg--lit' : 'turbo-btn__seg'}
              />
            ))}
          </button>
        </div>
      </PoolBackdrop>

      {snapshot.phase === 'betweenRounds' && (
        <ScoreboardOverlay
          snapshot={snapshot}
          roundEnd={game.session.roundEnd}
          isHost={view.you?.isHost === true}
          onNext={() => gameRef.current.nextRound()}
        />
      )}
    </main>
  );
}
