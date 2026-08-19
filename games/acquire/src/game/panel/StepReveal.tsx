import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { prefersReducedMotion, STEP_RISE_EASE, STEP_RISE_MS } from './stepMotion';

/**
 * The active zone's own height, animated — the whole of the panel's step
 * motion.
 *
 * A step arrives by this box growing from nothing to its natural height, with
 * its content clipped meanwhile. That single property does everything the
 * motion is supposed to do:
 *
 *  - the arriving step is revealed from the staging edge upwards, because its
 *    content sits at the top of a box whose top edge is travelling;
 *  - the history above is pushed up in lockstep, because the step stack is the
 *    panel's flex spacer and its bottom edge *is* this box's top edge;
 *  - the just-completed step's row appears where it belongs and is pushed with
 *    everything else, rather than animating on its own.
 *
 * Nothing here transforms anything, and there is no separate exit: the step
 * that just finished is not in this box any more — it is a row in the history,
 * being pushed. Holding it here to animate it away would be the *third* version
 * of the mistake this replaces, and it would put a delay in front of every
 * control the next step offers.
 *
 * `height: auto` cannot be animated, so the natural height is measured and the
 * box animates `0 → Npx` before being released back to `auto`. That release
 * matters: within one step the content still changes size — a share staged, a
 * card disabled — and must not be pinned to a stale measurement.
 */
export interface StepRevealProps {
  /**
   * Identity of the step on show. When it changes, the box collapses to nothing
   * and grows into the new step. `GameScreen` composes it from the stage and
   * the actor — a merger's liquidation queue moves between players without the
   * stage changing, and that is a new step to whoever is being asked.
   */
  step: string;
  children: ReactNode;
}

export function StepReveal({ step, children }: StepRevealProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef<string | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const changed = shownStep.current !== null && shownStep.current !== step;
    shownStep.current = step;
    if (!changed || prefersReducedMotion()) return;

    if (settle.current !== null) clearTimeout(settle.current);

    // Measured from the content itself: `scrollHeight` is what the box would be
    // if it were not being held at zero. Never counted from the number of rows —
    // a merger's step is three times the height of a placement's.
    box.style.transition = 'none';
    box.style.height = '0px';
    const target = box.scrollHeight;
    void box.offsetHeight;
    box.style.transition = `height ${STEP_RISE_MS}ms ${STEP_RISE_EASE}`;
    box.style.height = `${target}px`;

    settle.current = setTimeout(() => {
      // Back to auto, or the zone would be frozen at the height it had when the
      // step arrived and could not grow with its own content.
      box.style.transition = '';
      box.style.height = '';
      settle.current = null;
    }, STEP_RISE_MS);
  }, [step, children]);

  useLayoutEffect(() => () => {
    if (settle.current !== null) clearTimeout(settle.current);
  }, []);

  // `overflow-hidden` is load-bearing, not tidy: it is what hides the step
  // while the box is shorter than its content. Being a later, opaque sibling
  // does not save the staging zone below — CSS paints every block background
  // before any inline content, so an unclipped step's text draws over it.
  return (
    <div ref={boxRef} data-step-reveal className="overflow-hidden">
      {children}
    </div>
  );
}
