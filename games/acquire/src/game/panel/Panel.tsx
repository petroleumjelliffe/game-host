import type { ReactNode } from 'react';
import { StepReveal } from './StepReveal';

/**
 * The side panel: five slots in one fixed order — `stepstack → active →
 * staging → hand → players`. The order is a locked design decision, so it
 * lives here and not in the order a caller passes the props.
 *
 * The column is full-height and the step stack is the flex spacer, which is
 * what pins the remaining zones to the bottom of the panel.
 *
 * The panel owns its width because it is the fixed side of the layout and the
 * board takes whatever is left: 320px on desktop, narrowing below 1024px so a
 * tablet squeezes the panel rather than the board's aspect ratio.
 */
export interface PanelProps {
  stepstack?: ReactNode;
  active?: ReactNode;
  staging?: ReactNode;
  hand?: ReactNode;
  players?: ReactNode;
  /**
   * Identity of the active step, for `StepReveal`. Given, the active zone
   * animates its height when the step changes and the whole column above moves
   * with it; omitted — the catalog, which renders one state and never
   * changes — the zone is simply its height.
   */
  activeStep?: string;
}

const ORDER = ['stepstack', 'active', 'staging', 'hand', 'players'] as const;

export function Panel(props: PanelProps) {
  return (
    // `overflow-y-auto`, not `overflow-hidden`: a tall active zone — a merger
    // with four liquidators is the worst case — can push the column past the
    // viewport, and clipping meant the zones at the bottom (your shares, your
    // balance, the roster) silently disappeared. The step stack still scrolls
    // within itself; this is the outer escape hatch for when even a collapsed
    // stack is not enough.
    <div className="flex h-full w-[264px] shrink-0 flex-col overflow-y-auto border-l border-gray-200 lg:w-80">
      {ORDER.map((slot) =>
        props[slot] == null ? null : (
          <div
            key={slot}
            data-slot={slot}
            className={
              slot === 'stepstack'
                // A floor, not `min-h-0`.
                //
                // As the flex spacer this zone gives way first, and with no
                // floor it gave way entirely: measured at **0px** during a
                // merger, where the active zone reaches 263px. The column
                // scrolls, so nothing was clipped — but a zone of zero height
                // has nothing to scroll to, which is why the undo was
                // unreachable exactly when a merger made it most wanted.
                //
                // 96px is two rows and the zone's own padding: enough to see a
                // step and reach its undo. Past that the column overflows and
                // `overflow-y-auto` above takes over, which is the behaviour
                // that was always intended.
                ? 'flex min-h-[96px] flex-1 flex-col'
                : 'flex-none'
            }
          >
            {/*
              The active zone is the one thing in this panel that animates: it
              grows from nothing to its own height when the step changes, and
              everything above is pushed by it. See `StepReveal`.
            */}
            {slot === 'active' && props.activeStep !== undefined ? (
              <StepReveal step={props.activeStep}>{props.active}</StepReveal>
            ) : (
              props[slot]
            )}
          </div>
        ),
      )}
    </div>
  );
}
