/**
 * The panel's step motion, as decisions separate from the DOM that performs
 * them.
 *
 * They live apart because jsdom reports every height as zero, so a test that
 * drove the real effect would measure nothing, take the do-nothing branch, and
 * pass whatever the rule said. The rules are testable; the pixels are checked
 * on a real page by `npm run verify:layout`.
 *
 * ## One property, on one element
 *
 * A step arriving is **the active zone growing from nothing to its own
 * height**, clipped. Everything else follows from layout: the step stack is the
 * panel's flex spacer, so its bottom edge *is* the active zone's top edge, and
 * a zone growing underneath the history pushes the history up in lockstep. No
 * transform on the stack, no transform on the arriving step, nothing to keep in
 * sync — because there is only one thing moving.
 *
 * Two earlier attempts animated the *contents* instead: the step list by one
 * distance and the arriving step's content by another, while the zone's height
 * changed in a single frame. Both shipped green — suite, typecheck, and browser
 * probes — and both were wrong in the same way, because the probes measured
 * what the implementation did rather than what the motion is for. The jump the
 * eye caught was the one thing neither of them animated.
 */

/**
 * How long a step takes to arrive.
 *
 * Slower than the two earlier attempts (280ms, then 340ms), because a step now
 * travels its own full height rather than a fixed offset — a merger's step is
 * 187px tall, and covering that in a third of a second reads as a flinch.
 */
export const STEP_RISE_MS = 480;

/**
 * An even curve, deliberately not the surface's `step-up`
 * (`cubic-bezier(0.2, 0.7, 0.3, 1)`, which spends 70% of its distance in the
 * first 20% of its time).
 *
 * That suits a fade-and-lift where the element is visible throughout. Here the
 * distance *is* the reveal — the step is behind the staging edge until it has
 * travelled — so front-loading the travel front-loads the whole effect. Measured
 * on a real page, the front-loaded version went from hidden to 91% visible in
 * 120ms and then crept the last five pixels.
 */
export const STEP_RISE_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/*
 * There is no exit duration here on purpose. A step does not leave this zone —
 * by the time the next one arrives, the one that finished is already a row in
 * the history being pushed. An exit was built and removed: holding the outgoing
 * step to animate it away put its whole duration in front of every control the
 * next step offers.
 */

/**
 * Whether this device has asked for less motion.
 *
 * Guarded because `matchMedia` does not exist in jsdom, where every test in
 * `src/` runs — an unguarded call throws before any assertion is reached.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
