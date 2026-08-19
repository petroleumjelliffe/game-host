import type { ReactNode } from 'react';

/** The step the player is on right now — the only zone that asks for input. */
export interface ActiveStepProps {
  label: string;
  body: ReactNode;
  button?: ReactNode;
}

export function ActiveStep({ label, body, button }: ActiveStepProps) {
  return (
    // No animation class. A step arrives by `StepReveal` growing the zone this
    // sits in — see `panel/stepMotion.ts` for why the motion is a height and
    // not a transform on this element.
    <div className="flex flex-none flex-col gap-3 border-t border-gray-100 bg-slate-50 px-4 py-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.03em] text-gray-500">{label}</div>
      {body}
      {button}
    </div>
  );
}
