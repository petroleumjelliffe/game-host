import { useEffect, useRef, useState } from 'react';
import type { LobbyView } from '../../../vendor/lobby/client/view';
import type { GameSession } from '../net/useGameSession';
import { liveRipples } from '../game/sessionState';
import { screenToWorld } from '../game/camera';
import { drawScene } from '../render/draw';
import { ScoreboardOverlay } from './ScoreboardOverlay';

const SEND_EVERY_MS = 50;

export function GameScreen({ game, view, youId }: { game: GameSession; view: LobbyView; youId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
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

  function send(force: boolean): void {
    const s = inputRef.current;
    const now = performance.now();
    if (!force && now - s.lastSent < SEND_EVERY_MS) return;
    s.lastSent = now;
    gameRef.current.sendInput({ tx: s.tx, ty: s.ty, turbo: s.turbo });
  }

  function setTarget(e: React.PointerEvent<HTMLCanvasElement>, clear: boolean): void {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const s = inputRef.current;
    if (clear) {
      s.tx = null;
      s.ty = null;
      send(true);
      return;
    }
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width);
    s.tx = Math.max(-1.5, Math.min(1.5, w.x));
    s.ty = Math.max(-1.5, Math.min(1.5, w.y));
    send(false);
  }

  function holdTurbo(held: boolean): void {
    setTurboHeld(held);
    inputRef.current.turbo = held;
    send(true);
  }

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const frame = () => {
      const g = gameRef.current;
      const snap = g.session.latest;
      if (snap) {
        // Backing store is devicePixelRatio-scaled; drawScene works in CSS px.
        const size = canvas.width / (window.devicePixelRatio || 1);
        ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        drawScene(ctx, {
          size,
          youId,
          snapshot: snap,
          positions: g.buffer.at(Date.now()),
          ripples: liveRipples(g.session.ripples, Date.now()),
          now: Date.now(),
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [youId]);

  const side = Math.min(window.innerWidth, window.innerHeight - 120);
  const dpr = window.devicePixelRatio || 1;

  return (
    <main className="game">
      <div className="hud-top">
        <span className={isMarco ? 'role marco' : 'role polo'}>
          {isMarco ? 'you are MARCO' : 'hide — you are a polo'}
        </span>
        <span className="timer">{snapshot.timer}s</span>
      </div>
      <canvas
        ref={canvasRef}
        width={Math.round(side * dpr)}
        height={Math.round(side * dpr)}
        style={{ width: side, height: side, touchAction: 'none' }}
        onPointerDown={(e) => {
          if (steerPointerRef.current !== null) return;
          steerPointerRef.current = e.pointerId;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // A pointer released before the handler ran can't be captured;
            // steering still works, moves just aren't glued to the canvas.
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
      />
      <div className="hud-bottom">
        {isMarco && (
          <button
            className="marco-btn"
            disabled={(you.callCooldown ?? 0) > 0}
            // pointerdown, not click: it must fire from a second finger while
            // the first is mid-drag on the water.
            onPointerDown={(e) => {
              e.preventDefault();
              gameRef.current.call();
            }}
          >
            {you.callCooldown && you.callCooldown > 0
              ? `MARCO… ${Math.ceil(you.callCooldown)}`
              : 'MARCO!'}
          </button>
        )}
        <button
          className={turboHeld ? 'turbo held' : 'turbo'}
          onPointerDown={() => holdTurbo(true)}
          onPointerUp={() => holdTurbo(false)}
          onPointerCancel={() => holdTurbo(false)}
          onPointerLeave={() => turboHeld && holdTurbo(false)}
        >
          <span className="meter" style={{ width: `${you.turbo * 100}%` }} />
          TURBO
        </button>
      </div>
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
