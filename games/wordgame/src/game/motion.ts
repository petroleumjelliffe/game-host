// The spec's motion tokens (Word Game Motion.dc.html): one idea everywhere —
// grow on lift, direct travel, settle with a small overshoot on landing.
export const LIFT_MS = 120;
export const DROP_MS = 160;
export const TRAVEL_MS = 220;
export const REFLOW_MS = 180;
export const STAGGER_MS = 60;
export const SNAPBACK_MS = 200;
export const BADGE_OUT_MS = 120;
export const EASE_LIFT = 'cubic-bezier(.34,1.56,.64,1)';
export const EASE_DROP = 'cubic-bezier(.22,1,.36,1)';
export const EASE_TRAVEL = 'cubic-bezier(.2,.8,.2,1)';
export const EASE_REFLOW = 'cubic-bezier(.4,0,.2,1)';

/** True when the OS asks for less motion — JS-driven flights check this;
 * CSS animations die under the media block in styles/index.css. Absent
 * matchMedia (jsdom) reads as no preference; flights there skip on zero
 * rects anyway. */
export function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
