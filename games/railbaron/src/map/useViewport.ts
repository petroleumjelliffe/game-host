import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  centreOn, fit, fitPoints, panBy, screenToMap, viewBox as boxFor, zoomAbout,
  type Point, type Size, type View
} from './viewport';

/**
 * How far a pointer may travel before it is a drag rather than a tap.
 *
 * It has to be more than zero: a finger on glass never holds still, and a mouse
 * button rarely comes up on the pixel it went down on. And it has to be small,
 * because every legal lamp is a click target sitting on the very surface the
 * player pans with — past this distance the tap is suppressed, so a route step
 * is never drafted by a drag that merely passed over the lamp.
 */
const DRAG_SLOP = 5;

/**
 * Wheel notches into a zoom factor, exponentially — so a notch scales the view
 * by a constant ratio wherever you are, rather than by a constant number of map
 * units, which would crawl at extents and leap when zoomed in.
 */
const WHEEL_RATE = 0.0015;

/** Firefox and a few mice report wheel deltas in lines, not pixels. */
const LINE_HEIGHT = 16;

/** Close enough to read a city's name, far enough to see where it leads. */
export const FOLLOW_ZOOM = 3;

/** What a button press zooms by — roughly two wheel notches. */
export const STEP = 1.6;

/**
 * The map's window, wired to a real element: measuring, the wheel, and the drag.
 *
 * All the arithmetic lives in `viewport.ts`; this holds the view, the size of
 * the cabinet it is drawn into, and the browser's own awkwardness — a wheel
 * listener that has to be non-passive, pointer moves that must be followed
 * outside the element, and a first render that happens before anything has
 * been laid out.
 */
export function useViewport(extent: Size) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>(fit);
  /**
   * Until the cabinet has been laid out it has no size, and the map's own
   * proportions are the best available guess — which is also what makes the
   * first paint correct rather than a frame of something wrong.
   */
  const [size, setSize] = useState<Size>(extent);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const [dragging, setDragging] = useState(false);
  /** Every pointer currently down on the map, by id: one drags, two pinch. */
  const down = useRef(new Map<number, Point>());
  /** Distance travelled since the pointer went down, against `DRAG_SLOP`. */
  const travel = useRef(0);
  const dragged = useRef(false);
  const spread = useRef(0);

  /** Where the cabinet is on the page, falling back to its assumed size. */
  const bounds = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { left: 0, top: 0, ...sizeRef.current };
    }
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, []);

  /** Zooms about a point given in page coordinates — a cursor, or two fingers. */
  const zoomAt = useCallback((factor: number, at: Point) => {
    const b = bounds();
    const container = { width: b.width, height: b.height };
    setView(v => zoomAbout(v, factor, screenToMap(v, at, b, extent), container, extent));
  }, [bounds, extent]);

  /** Zooms about the middle of the cabinet: what the HUD's + and − do. */
  const zoomBy = useCallback((factor: number) => {
    const b = bounds();
    zoomAt(factor, { x: b.left + b.width / 2, y: b.top + b.height / 2 });
  }, [bounds, zoomAt]);

  const fitAll = useCallback(() => setView(fit()), []);

  const goTo = useCallback((point: Point, k = FOLLOW_ZOOM) => {
    setView(v => centreOn(v, point, k, sizeRef.current, extent));
  }, [extent]);

  /** Frames all the given points at once, no closer than FOLLOW_ZOOM. */
  const fitTo = useCallback((points: readonly Point[]) => {
    setView(() => fitPoints(points, FOLLOW_ZOOM, sizeRef.current, extent));
  }, [extent]);

  // The cabinet's size, measured and then watched. jsdom implements no
  // ResizeObserver, so its absence is normal rather than exceptional.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize(current =>
          current.width === rect.width && current.height === rect.height
            ? current
            : { width: rect.width, height: rect.height });
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * The wheel, as a native non-passive listener.
   *
   * React's `onWheel` is delegated and passive, so `preventDefault` inside it
   * does nothing and the page scrolls out from under the map while it zooms.
   * This is the one case where going around React is the fix rather than a
   * shortcut.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? LINE_HEIGHT : 1);
      zoomAt(Math.exp(-delta * WHEEL_RATE), { x: event.clientX, y: event.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  /**
   * Moves and releases are followed on the window rather than on the map: a
   * drag that leaves the cabinet — over the HUD, off the edge of the browser —
   * is still the same drag, and a button released out there must still end it.
   */
  useEffect(() => {
    const distance = () => {
      const [a, b] = [...down.current.values()];
      return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    };
    const middle = () => {
      const [a, b] = [...down.current.values()];
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    };

    const onMove = (event: PointerEvent) => {
      const from = down.current.get(event.pointerId);
      if (!from) return;
      const to = { x: event.clientX, y: event.clientY };
      down.current.set(event.pointerId, to);

      // Two fingers are a pinch, and a pinch is a zoom about the point
      // between them — never a pan, or the map would fight the gesture.
      if (down.current.size >= 2) {
        const now = distance();
        const at = middle();
        if (at && spread.current > 0 && now > 0) zoomAt(now / spread.current, at);
        spread.current = now;
        dragged.current = true;
        return;
      }

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      travel.current += Math.hypot(dx, dy);
      if (travel.current > DRAG_SLOP) dragged.current = true;
      const b = bounds();
      setView(v => panBy(v, dx, dy, { width: b.width, height: b.height }, extent));
    };

    const onUp = (event: PointerEvent) => {
      down.current.delete(event.pointerId);
      spread.current = distance();
      if (down.current.size === 0) setDragging(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [bounds, extent, zoomAt]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    down.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (down.current.size === 1) {
      travel.current = 0;
      dragged.current = false;
    } else {
      const [a, b] = [...down.current.values()];
      spread.current = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    }
    setDragging(true);
  }, []);

  /**
   * Whether the gesture that just ended moved the map.
   *
   * Read by the tap handler, which the browser calls *after* the pointer is up:
   * the flag therefore survives the release and is cleared by the next press,
   * not by this one.
   */
  const wasDrag = useCallback(() => dragged.current, []);

  return {
    ref,
    view,
    /** The cabinet as measured — what the HUD lays itself out against. */
    size,
    viewBox: boxFor(view, size, extent),
    dragging,
    onPointerDown,
    wasDrag,
    zoomBy,
    fitAll,
    goTo,
    fitTo
  };
}
