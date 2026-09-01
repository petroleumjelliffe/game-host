// jsdom rects are 0×0, so translation clamps to 0 here — scale is the
// observable. The translation math itself is pinned in boardTransform.test.ts.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BoardViewport } from './BoardViewport';

function pinchOut() {
  const vp = screen.getByTestId('board-viewport');
  fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerDown(vp, { pointerId: 2, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(vp, { pointerId: 2, clientX: 300, clientY: 100 });
  fireEvent.pointerUp(vp, { pointerId: 2 });
  fireEvent.pointerUp(vp, { pointerId: 1 });
}

describe('BoardViewport', () => {
  it('scales with a two-pointer pinch', () => {
    render(<BoardViewport><div>board</div></BoardViewport>);
    pinchOut();
    expect(screen.getByTestId('board-transform').style.transform).toContain('scale(2)');
  });

  it('double-tap resets to identity', () => {
    render(<BoardViewport><div>board</div></BoardViewport>);
    pinchOut();
    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { pointerId: 3, clientX: 150, clientY: 150 });
    fireEvent.pointerUp(vp, { pointerId: 3 });
    fireEvent.pointerDown(vp, { pointerId: 4, clientX: 152, clientY: 151 });
    fireEvent.pointerUp(vp, { pointerId: 4 });
    expect(screen.getByTestId('board-transform').style.transform).toContain('scale(1)');
  });

  it('one pointer alone never pans or zooms', () => {
    render(<BoardViewport><div>board</div></BoardViewport>);
    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 200, clientY: 220 });
    fireEvent.pointerUp(vp, { pointerId: 1 });
    expect(screen.getByTestId('board-transform').style.transform).toContain('scale(1)');
  });
});
