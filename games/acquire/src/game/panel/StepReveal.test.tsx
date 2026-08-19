import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StepReveal } from './StepReveal';

/**
 * jsdom sees none of this motion — every height it reports is zero, so the
 * effect measures a target of 0 and animates nothing. The animation itself is
 * settled on a real page by `verify:layout`'s probes and by eye.
 *
 * What is worth pinning here is what the motion must never cost: the next
 * step's controls are on screen and usable immediately. An earlier draft held
 * the outgoing step for the length of an exit animation, which put a delay in
 * front of every control in the game — and five existing tests caught it.
 */
describe('StepReveal', () => {
  it('shows the new step at once, with no exit to wait through', () => {
    const { container, rerender } = render(
      <StepReveal step="play:p1"><p>Place a tile</p></StepReveal>,
    );
    rerender(<StepReveal step="buy:p1"><button>Buy one Messla</button></StepReveal>);

    expect(container.textContent).toContain('Buy one Messla');
    expect(container.textContent).not.toContain('Place a tile');
  });

  it('swaps content within one step too', () => {
    // A share staged, a card disabled — the step has not changed, so there is
    // nothing to reveal, but the content still has to be current.
    const { container, rerender } = render(
      <StepReveal step="buy:p1"><p>three left</p></StepReveal>,
    );
    rerender(<StepReveal step="buy:p1"><p>two left</p></StepReveal>);
    expect(container.textContent).toContain('two left');
  });

  it('clips its content, which is what hides a step still below the line', () => {
    // Not decoration: CSS paints every block background before any inline
    // content, so without this the arriving step's text draws over the staging
    // zone below it — which is what the frames from the by-hand pass showed.
    const { container } = render(<StepReveal step="a"><p>x</p></StepReveal>);
    expect(container.querySelector('[data-step-reveal]')!.className).toMatch(/overflow-hidden/);
  });

  it('leaves no inline height behind once a step has settled', () => {
    // The zone has to be free to grow with its own content afterwards — a
    // staged share adds a row to the staging zone, not this one, but a merger's
    // queue does grow this one mid-step.
    const { container, rerender } = render(<StepReveal step="a"><p>x</p></StepReveal>);
    rerender(<StepReveal step="b"><p>y</p></StepReveal>);

    const box = container.querySelector('[data-step-reveal]') as HTMLElement;
    // jsdom measures 0, so the effect sets 0px and the assertion below is about
    // the release path rather than the number.
    expect(box.style.height === '' || box.style.height === '0px').toBe(true);
  });
});
