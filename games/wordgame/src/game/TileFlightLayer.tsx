// Screen-space tile flights: the motion spec's 220ms travel (tap-to-board,
// tap-home) and 200ms snap-back (invalid drop). Purely presentational — the
// state has already committed when a flight launches; the flight covers the
// gap while the real tile hides. Measured rects already reflect the zoom
// transform, so a flight lands on the cell at 1× and 3× alike.

import { useEffect, useRef, useState } from 'react';
import { TILE_VALUES, type Tile } from '../../engine/constants';
import type { Rect } from './dragPlan';
import { EASE_TRAVEL, reducedMotion } from './motion';

export interface Flight {
  id: number;
  tile: Tile;
  from: Rect;
  to: Rect;
  durationMs: number;
  onDone?(): void;
}

/** Owns the in-flight list. `launch` refuses (returns false) under reduced
 * motion or zero-size rects — jsdom's default — and callers then treat the
 * tile as already landed, which is why no test ever waits on a flight. */
export function useTileFlights() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const nextId = useRef(0);

  const launch = (tile: Tile, from: Rect, to: Rect, durationMs: number, onDone?: () => void): boolean => {
    if (reducedMotion() || from.width <= 0 || from.height <= 0 || to.width <= 0) return false;
    const id = nextId.current;
    nextId.current += 1;
    setFlights((prev) => [...prev, onDone === undefined
      ? { id, tile, from, to, durationMs }
      : { id, tile, from, to, durationMs, onDone }]);
    return true;
  };

  const finish = (id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  };

  return { flights, launch, finish };
}

export function TileFlightLayer({ flights, onFinished }: {
  flights: Flight[];
  onFinished(id: number): void;
}) {
  return (
    <>
      {flights.map((f) => <FlightTile key={f.id} flight={f} onFinished={onFinished} />)}
    </>
  );
}

function FlightTile({ flight, onFinished }: { flight: Flight; onFinished(id: number): void }) {
  // Mount at `from`, then move to `to` on the next frame so the transition
  // carries it. A timer (not transitionend) retires the flight — reduced
  // motion kills the transition and transitionend would never fire.
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => { setLanded(true); });
    const timer = setTimeout(() => {
      flight.onDone?.();
      onFinished(flight.id);
    }, flight.durationMs + 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // A flight is immutable once launched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dx = flight.to.left - flight.from.left;
  const dy = flight.to.top - flight.from.top;
  const scale = flight.to.width / flight.from.width;
  return (
    <div
      data-testid="tile-flight"
      className={`wg-flight pointer-events-none fixed z-50 flex items-center justify-center rounded-md bg-tile font-tile text-lg font-bold ${
        flight.tile === '_' ? 'text-tile-blank' : 'text-tile-ink'
      }`}
      style={{
        left: flight.from.left,
        top: flight.from.top,
        width: flight.from.width,
        height: flight.from.height,
        transform: landed ? `translate(${dx}px, ${dy}px) scale(${scale})` : 'none',
        transformOrigin: '0 0',
        transition: `transform ${flight.durationMs}ms ${EASE_TRAVEL}`,
        boxShadow: 'inset 0 -3px 0 #d9bf8a, 0 6px 14px rgba(0,0,0,.3)',
      }}
    >
      {flight.tile === '_' ? '·' : flight.tile}
      <span className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none">
        {TILE_VALUES[flight.tile]}
      </span>
    </div>
  );
}
