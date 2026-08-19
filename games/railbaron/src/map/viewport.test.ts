import { describe, expect, it } from 'vitest';
import {
  ZOOM, centreOn, fit, frame, panBy, screenToMap, viewBox, zoomAbout,
  type Size, type View
} from './viewport';

/** The map's own coordinate space — what `layout()` projects into. */
const EXTENT: Size = { width: 1400, height: 788 };

/** A cabinet of the map's own proportions: at extents the two coincide. */
const SQUARE_ON: Size = { width: 700, height: 394 };

/** Where a map point falls inside the drawn frame, 0..1 on each axis. */
const fractionOf = (point: { x: number; y: number }, view: View, container: Size) => {
  const f = frame(view, container, EXTENT);
  return { fx: (point.x - f.x) / f.width, fy: (point.y - f.y) / f.height };
};

describe('the map viewport', () => {
  it('shows the whole map at extents, whatever shape the window is', () => {
    // The clipping bug in one assertion: no window proportion may cut the map.
    for (const container of [
      { width: 1400, height: 788 },
      { width: 400, height: 900 },
      { width: 2000, height: 500 }
    ]) {
      const f = frame(fit(), container, EXTENT);
      expect(f.x).toBeLessThanOrEqual(0);
      expect(f.y).toBeLessThanOrEqual(0);
      expect(f.x + f.width).toBeGreaterThanOrEqual(EXTENT.width);
      expect(f.y + f.height).toBeGreaterThanOrEqual(EXTENT.height);
      // And the frame is the window's own shape, so nothing letterboxes.
      expect(f.width / f.height).toBeCloseTo(container.width / container.height);
    }
  });

  it('keeps the point under the cursor under the cursor as it zooms', () => {
    const anchor = { x: 400, y: 300 };
    const before = fractionOf(anchor, fit(), SQUARE_ON);
    const zoomed = zoomTo(2, anchor);
    const after = fractionOf(anchor, zoomed, SQUARE_ON);

    expect(zoomed.k).toBe(2);
    expect(after.fx).toBeCloseTo(before.fx);
    expect(after.fy).toBeCloseTo(before.fy);
  });

  it('centres rather than anchors on an axis the map does not fill', () => {
    // A tall window letterboxes the map top and bottom. Holding the cursor's
    // point still down that axis would mean scrolling the empty margin into
    // view, so while the map is shorter than the frame the centre wins and the
    // anchor is honoured across the axis that *is* full. Once zoomed far
    // enough that the map fills both, the anchor holds on both — as the test
    // above shows in a cabinet of the map's own proportions.
    const tall: Size = { width: 500, height: 900 };
    const anchor = { x: 300, y: 120 };
    const zoomed = zoomAbout(fit(), 1.5, anchor, tall, EXTENT);
    const f = frame(zoomed, tall, EXTENT);

    expect(f.height).toBeGreaterThan(EXTENT.height);
    expect(f.y + f.height / 2).toBeCloseTo(EXTENT.height / 2);
    expect((anchor.x - f.x) / f.width)
      .toBeCloseTo((anchor.x - frame(fit(), tall, EXTENT).x) / frame(fit(), tall, EXTENT).width);
  });

  it('will not zoom out past extents, however hard you scroll', () => {
    const out = zoomTo(0.2, { x: 100, y: 100 });
    expect(out.k).toBe(ZOOM.min);
    // And it recentres: at extents there is only one view worth showing.
    expect(out.cx).toBeCloseTo(EXTENT.width / 2);
    expect(out.cy).toBeCloseTo(EXTENT.height / 2);
  });

  it('will not zoom in past the ceiling', () => {
    expect(zoomTo(100, { x: 700, y: 394 }).k).toBe(ZOOM.max);
  });

  it('pans with the drag, one screen pixel for one', () => {
    // At k=2 in a 700-wide cabinet the frame is 700 map units across, so the
    // two spaces are 1:1 and the arithmetic is readable.
    const dragged = panBy({ k: 2, cx: 700, cy: 394 }, 50, 20, SQUARE_ON, EXTENT);
    expect(dragged.cx).toBe(650);
    expect(dragged.cy).toBe(374);
  });

  it('stops panning at the edge of the map rather than dragging in the void', () => {
    const corner = centreOn(fit(), { x: 0, y: 0 }, 2, SQUARE_ON, EXTENT);
    const further = panBy(corner, 400, 400, SQUARE_ON, EXTENT);
    const f = frame(further, SQUARE_ON, EXTENT);
    expect(f.x).toBeCloseTo(0);
    expect(f.y).toBeCloseTo(0);
  });

  it('reads a pointer position as a point on the map', () => {
    const rect = { left: 100, top: 50, width: 700, height: 394 };
    const view: View = { k: 2, cx: 700, cy: 394 };
    // The cabinet's top-left corner is the frame's top-left corner.
    expect(screenToMap(view, { x: 100, y: 50 }, rect, EXTENT)).toEqual({ x: 350, y: 197 });
    // And its centre is the view's centre.
    expect(screenToMap(view, { x: 450, y: 247 }, rect, EXTENT)).toEqual({ x: 700, y: 394 });
  });

  it('centres on a point at a chosen zoom — how it follows a baron', () => {
    const on = centreOn(fit(), { x: 500, y: 300 }, 3, SQUARE_ON, EXTENT);
    expect(on.k).toBe(3);
    expect(on.cx).toBeCloseTo(500);
    expect(on.cy).toBeCloseTo(300);
  });

  it('writes the frame as an SVG viewBox', () => {
    const box = viewBox({ k: 2, cx: 700, cy: 394 }, SQUARE_ON, EXTENT);
    expect(box).toBe('350 197 700 394');
  });
});

/** Zooming about a point, from extents, in the square-on cabinet. */
function zoomTo(factor: number, anchor: { x: number; y: number }): View {
  return zoomAbout(fit(), factor, anchor, SQUARE_ON, EXTENT);
}
