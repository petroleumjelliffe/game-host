import type { ReactNode } from 'react';
import { StepEntry } from './StepEntry';

/**
 * The turn so far, oldest first.
 *
 * Also the panel's flex spacer: it takes the remaining height and bottom-aligns
 * its content, which is what pins the zones below it to the bottom of the panel.
 *
 * **It has no motion of its own, and that is the design.** The history moves
 * because the active zone below it grows and pushes it — the stack's bottom
 * edge is that zone's top edge, so the two are the same motion by construction.
 * Two earlier attempts animated this list directly, against a zone whose height
 * changed in one frame; what the eye caught was the jump underneath the
 * choreography. See `stepMotion.ts` and `StepReveal.tsx`.
 */
export interface StepStackEntry {
  stepId: number;
  phase: string;
  detail: ReactNode;
  /**
   * Who did it — a name, or `You`. Absent where there is nobody to name, which
   * is the catalog and any entry the engine files without a player.
   */
  actor?: string;
  /**
   * Whether this step can be rewound to. Snapshots are filed per *intent*, and
   * one intent can push several log entries — a merger writes the placement,
   * the merge and the payout under one action. Offering undo on an entry with
   * no snapshot would throw out of `rewindTo`, so the caller says which are
   * real undo points.
   */
  undoable?: boolean;
}

export interface StepStackProps {
  entries: StepStackEntry[];
  onUndo?: (stepId: number) => void;
}

export function StepStack({ entries, onUndo }: StepStackProps) {
  return (
    <div className="flex flex-1 flex-col justify-end overflow-y-auto px-4 pb-2 pt-3.5">
      <div data-step-list className="flex flex-col gap-3">
        {entries.map((e) => (
          <StepEntry
            key={e.stepId}
            phase={e.phase}
            actor={e.actor}
            detail={e.detail}
            stepId={e.stepId}
            onUndo={e.undoable ? onUndo : undefined}
          />
        ))}
      </div>
    </div>
  );
}
