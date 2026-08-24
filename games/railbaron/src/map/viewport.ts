/**
 * A window onto the map, and the arithmetic that moves it.
 *
 * The map is projected once into a fixed coordinate space (see `layout`), and
 * that space is *not* the size of the cabinet on screen — the cabinet is
 * whatever the browser window leaves for it. What reconciles the two is the
 * SVG viewBox: a rectangle in map coordinates, drawn into whatever pixels the
 * cabinet has. Zoom and pan are therefore nothing but choosing that rectangle,
 * which is why all of it lives here as arithmetic with no React and no DOM.
 *
 * The state is a centre and a zoom factor rather than the rectangle itself.
 * The rectangle depends on the cabinet's proportions, which change under the
 * user's hand as they resize the window; a centre does not. Storing the
 * rectangle would mean recomputing it on every resize and deciding what to
 * preserve while doing so — with a centre there is nothing to decide.
 */

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

/** The window onto the map: `k = 1` is the whole of it, `cx`/`cy` in map units. */
export interface View { k: number; cx: number; cy: number }

export interface Rect { x: number; y: number; width: number; height: number }

/** Where a pointer event's target sits on the page, as `getBoundingClientRect`. */
export interface Bounds { left: number; top: number; width: number; height: number }

/**
 * `min` is 1 by definition: extents is the whole map and there is nothing
 * further out to see. `max` is where a route dot — 2.6 map units across —
 * becomes a comfortable target rather than a speck.
 */
export const ZOOM = { min: 1, max: 8 } as const;

/** The whole map, centred: the view this screen opens on and returns to. */
export const fit = (): View => ({ k: ZOOM.min, cx: NaN, cy: NaN });

/**
 * The rectangle to draw, in map coordinates.
 *
 * At extents it is the smallest rectangle of the cabinet's proportions that
 * still contains the whole map, so a tall window pads above and below rather
 * than cropping the coasts — which is the resize clipping, fixed. Every zoom
 * beyond that divides it.
 *
 * `fit()` leaves the centre as NaN because the honest centre depends on the
 * map, which it has not been given; `clamp` resolves it here.
 */
export function frame(view: View, container: Size, extent: Size): Rect {
  const aspect = container.width / container.height;
  const whole = Math.max(extent.width, extent.height * aspect);
  const width = whole / view.k;
  const height = width / aspect;
  const { cx, cy } = clamp(view, container, extent);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** The same rectangle, as the attribute SVG wants. */
export function viewBox(view: View, container: Size, extent: Size): string {
  const f = frame(view, container, extent);
  return `${f.x} ${f.y} ${f.width} ${f.height}`;
}

/**
 * Keeps the view over the map: the zoom inside its range, and the frame inside
 * the map's own bounds so no drag can strand the player looking at emptiness.
 *
 * An axis the frame overflows — always both axes at extents, and the short axis
 * of an ill-fitting window for a while after that — has no room to pan along,
 * so it locks to the middle of the map rather than clamping to an edge.
 */
export function clamp(view: View, container: Size, extent: Size): View {
  const k = Math.min(ZOOM.max, Math.max(ZOOM.min, view.k));
  const aspect = container.width / container.height;
  const width = Math.max(extent.width, extent.height * aspect) / k;
  const height = width / aspect;

  const centre = (c: number, span: number, size: number) => {
    if (Number.isNaN(c) || span >= size) return size / 2;
    return Math.min(size - span / 2, Math.max(span / 2, c));
  };

  return {
    k,
    cx: centre(view.cx, width, extent.width),
    cy: centre(view.cy, height, extent.height)
  };
}

/**
 * Zooms by a factor while holding one map point still.
 *
 * That point is the cursor, so the map grows out from under it rather than
 * from the middle of the cabinet — the difference between zooming *in on
 * Chicago* and zooming in and then hunting for Chicago. Holding it still means
 * keeping it at the same fraction across the frame, which is the whole trick.
 *
 * `clamp` has the last word, so on an axis the map does not yet fill — a tall
 * window, letterboxed above and below — the point slides toward the middle
 * instead of staying put. Honouring it there would mean scrolling the empty
 * margin into view, which is worse than the drift. The moment the map fills
 * that axis the anchor holds exactly.
 */
export function zoomAbout(
  view: View, factor: number, anchor: Point, container: Size, extent: Size
): View {
  const before = frame(view, container, extent);
  const k = Math.min(ZOOM.max, Math.max(ZOOM.min, view.k * factor));
  const scale = view.k / k;
  const width = before.width * scale;
  const height = before.height * scale;

  const fx = (anchor.x - before.x) / before.width;
  const fy = (anchor.y - before.y) / before.height;

  return clamp({
    k,
    cx: anchor.x - fx * width + width / 2,
    cy: anchor.y - fy * height + height / 2
  }, container, extent);
}

/** Moves the map with the drag: `dx`/`dy` are screen pixels, not map units. */
export function panBy(
  view: View, dx: number, dy: number, container: Size, extent: Size
): View {
  const f = frame(view, container, extent);
  const perPixel = f.width / container.width;
  return clamp({
    k: view.k,
    cx: f.x + f.width / 2 - dx * perPixel,
    cy: f.y + f.height / 2 - dy * perPixel
  }, container, extent);
}

/** How much air a fitted view keeps around its points, in map units. */
const FIT_PAD = 60;

/**
 * The view that shows every given point at once, as close as it can.
 *
 * The zoom is the largest `k` whose frame still contains the padded bounding
 * box of the points, centred on that box — so FIND frames a whole journey,
 * current position and destination together, rather than one end of it. Two
 * far-apart endpoints fall back toward extents; two neighbouring ones are
 * capped at `maxK`, so the view never dives past what a single-point centre
 * would show. `clamp` resolves the edges as everywhere else.
 */
export function fitPoints(
  points: readonly Point[], maxK: number, container: Size, extent: Size
): View {
  if (points.length === 0) return clamp(fit(), container, extent);
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const needW = Math.max(...xs) - Math.min(...xs) + FIT_PAD * 2;
  const needH = Math.max(...ys) - Math.min(...ys) + FIT_PAD * 2;

  const aspect = container.width / container.height;
  const whole = Math.max(extent.width, extent.height * aspect);
  const k = Math.min(maxK, whole / needW, whole / (needH * aspect));

  return clamp({
    k,
    cx: (Math.max(...xs) + Math.min(...xs)) / 2,
    cy: (Math.max(...ys) + Math.min(...ys)) / 2
  }, container, extent);
}

/** Puts a point in the middle of the cabinet, at a chosen zoom. */
export function centreOn(
  view: View, point: Point, k: number, container: Size, extent: Size
): View {
  return clamp({ k, cx: point.x, cy: point.y }, container, extent);
}

/** Reads a pointer position on the page as a point on the map. */
export function screenToMap(
  view: View, screen: Point, bounds: Bounds, extent: Size
): Point {
  const container = { width: bounds.width, height: bounds.height };
  const f = frame(view, container, extent);
  return {
    x: f.x + ((screen.x - bounds.left) / bounds.width) * f.width,
    y: f.y + ((screen.y - bounds.top) / bounds.height) * f.height
  };
}
