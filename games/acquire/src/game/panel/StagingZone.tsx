import type { ReactNode } from 'react';
import { Cash } from '../atoms/Cash';

/**
 * The staging pile: what the current step has accumulated but not committed.
 *
 * This is where panel-height stability is enforced. Three reservations, all
 * structural rather than conditional, so the zone is the same height in every
 * state a step can be in:
 *
 *  1. the pile carries a `min-h` sized to a populated row, so empty ↔ filled
 *     does not shift;
 *  2. the `Net` total is always rendered — in the header, muted at zero;
 *  3. the action slot is always rendered with a `min-h`, so button ↔ no button
 *     does not shift.
 *
 * The `data-zone` attributes exist so those reservations can be asserted
 * without matching on Tailwind class soup — they document which elements carry
 * the reservation, and removing one breaks a test rather than the eye.
 */
export interface StagingZoneProps {
  label: string;
  shares?: ReactNode;
  cashDelta?: number;
  action?: ReactNode;
}

export function StagingZone({ label, shares, cashDelta = 0, action }: StagingZoneProps) {
  return (
    <div
      data-zone="staging"
      className="flex-none border-t border-dashed border-[#e7dfbf] bg-[#fffdf5] px-4 py-3"
    >
      {/*
        The net total rides the header rather than sitting under the pile. On
        its own row — label, dashed rule, an 18px figure — it took as much
        vertical space as the shares it was totalling, in a column where the
        step stack is already fighting for room. Inline it is the same fact at
        the header's own size, right-aligned so the eye finds it in the corner
        it already scans for totals. `Cash` keeps the tint, which is the part
        that has to survive: red for money going out is how the figure reads
        at a glance.
      */}
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.06em]">
        <span className="min-w-0 text-gray-400">{label}</span>
        {/* `shrink-0` and no wrapping: a long label is allowed to take two
            lines, but the figure must never break between its sign and its
            digits — "NET −" over "$200" reads as two facts. */}
        <span data-zone="net" className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[#a8935a]">Net</span>
          <span className="font-extrabold tracking-normal">
            <Cash amount={cashDelta} sign="delta" />
          </span>
        </span>
      </div>

      {/*
        Fixed, not merely minimum. A `min-h` sized to a *typical* row still
        grows when the row is taller: measured in Chrome, an empty pile sat at
        62px while a staged stack pushed it to 68px, and the depth margin on a
        6+ stack adds another 3px on top of that. 72px clears the tallest thing
        the pile can hold — an `sm` stack at depth 2 — so the zone is the same
        height in every state. jsdom reports 0 for layout, so no test catches
        this; it took measuring the real page.
      */}
      <div data-zone="pile" className="flex h-[72px] min-h-[72px] flex-wrap items-end gap-3">
        {/*
          No placeholder. An empty pile is self-evident, and the word "empty"
          was a label for nothing — the reservation is on this container, so the
          zone is the same height either way and the space reads as waiting for
          something rather than as missing content.
        */}
        {shares}
      </div>

      {/* Same story: the phase-advance button measures 38px, so a 32px
          reservation shifted the zone by 6px whenever a button appeared. */}
      <div data-zone="action" className="mt-3 flex h-10 min-h-[40px] items-stretch">
        {action}
      </div>
    </div>
  );
}
