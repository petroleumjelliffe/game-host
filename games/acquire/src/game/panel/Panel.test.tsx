import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Panel } from './Panel';

describe('Panel', () => {
  // The zone order is a locked design decision, so it must come from the
  // component and not from the order a caller happens to pass the props in.
  it('renders the five zones in the fixed order regardless of prop order', () => {
    const { container } = render(
      <Panel
        players={<span>players</span>}
        hand={<span>hand</span>}
        staging={<span>staging</span>}
        active={<span>active</span>}
        stepstack={<span>stepstack</span>}
      />,
    );
    const slots = Array.from(container.querySelectorAll('[data-slot]')).map((el) =>
      el.getAttribute('data-slot'),
    );
    expect(slots).toEqual(['stepstack', 'active', 'staging', 'hand', 'players']);
  });

  it('omits a zone entirely when its slot is not supplied', () => {
    const { container } = render(<Panel stepstack={<span>stepstack</span>} />);
    const slots = Array.from(container.querySelectorAll('[data-slot]')).map((el) =>
      el.getAttribute('data-slot'),
    );
    expect(slots).toEqual(['stepstack']);
  });

  it('is a full-height column so the step stack can pin the zones below it', () => {
    const { container } = render(<Panel stepstack={<span>stepstack</span>} />);
    expect(container.firstElementChild?.className).toMatch(/flex-col/);
    expect(container.firstElementChild?.className).toMatch(/h-full/);
  });

  /**
   * The panel scrolls rather than clipping. A tall active zone — a merger with
   * four liquidators is the worst case — can push the total past the viewport,
   * and with `overflow-hidden` the zones at the bottom (your shares, your
   * balance, the roster) simply vanished with nothing to say they were there.
   * The step stack still scrolls inside itself; this is the outer escape hatch
   * for when even a collapsed stack is not enough.
   */
  it('scrolls its column instead of clipping what does not fit', () => {
    const { container } = render(<Panel stepstack={<span>stepstack</span>} />);
    expect(container.firstElementChild?.className).toMatch(/overflow-y-auto/);
    expect(container.firstElementChild?.className).not.toMatch(/overflow-hidden/);
  });

  /**
   * Once the column scrolls, the zones below the step stack must keep their
   * own height rather than being squeezed by it — `flex-none` is what stops a
   * scrolling parent from compressing them into their content.
   */
  it('keeps the non-spacer zones at their natural height', () => {
    const { container } = render(
      <Panel stepstack={<span>s</span>} active={<span>a</span>} players={<span>p</span>} />,
    );
    for (const slot of ['active', 'players']) {
      expect(container.querySelector(`[data-slot="${slot}"]`)?.className).toMatch(/flex-none/);
    }
  });
});
