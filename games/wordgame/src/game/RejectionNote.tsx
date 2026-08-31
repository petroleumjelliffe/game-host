import type { MoveRejectedMessage } from '../../session/protocol';

export interface RejectionNoteProps {
  rejection: MoveRejectedMessage;
  onDismiss(): void;
}

/** The server's own words on a refused move, dismissible. Dictionary
 * rejections (`invalidWord`) never reach this component — GameScreen routes
 * those to the board's own overlay card instead, since only that code ever
 * carries `words`. This strip is for everything else: not your turn, an
 * illegal placement, an exchange the bag can't support. */
export function RejectionNote({ rejection, onDismiss }: RejectionNoteProps) {
  return (
    <div
      role="alert"
      data-testid="rejection-note"
      className="flex items-start gap-2 rounded-lg border border-warnbd bg-warnbg px-3 py-2 text-sm text-warn-ink"
    >
      <p className="min-w-0 flex-1">{rejection.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-none rounded px-1 text-warn-ink"
      >
        ✕
      </button>
    </div>
  );
}
