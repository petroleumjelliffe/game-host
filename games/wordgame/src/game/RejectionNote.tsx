import type { MoveRejectedMessage } from '../../session/protocol';

export interface RejectionNoteProps {
  rejection: MoveRejectedMessage;
  onDismiss(): void;
}

/** The server's own words on a refused move, dismissible; dictionary
 * rejections name the offending words. */
export function RejectionNote({ rejection, onDismiss }: RejectionNoteProps) {
  return (
    <div
      role="alert"
      data-testid="rejection-note"
      className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      <div className="min-w-0 flex-1">
        <p>{rejection.message}</p>
        {rejection.code === 'invalidWord' && rejection.words !== undefined && (
          <p className="font-semibold">Not in the dictionary: {rejection.words.join(', ')}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-none rounded px-1 text-red-700 hover:bg-red-100"
      >
        ✕
      </button>
    </div>
  );
}
