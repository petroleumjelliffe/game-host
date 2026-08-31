/**
 * A join this room refused for a reason a player can still act on.
 *
 * Not `noSuchRoom` and not `versionMismatch` — both of those are terminal and
 * have screens of their own. What lands here is a room that exists and did not
 * take you: a stored token whose seat the server has forgotten, or a room that
 * filled up while you were on your way to it.
 *
 * Deliberately not a name form, which is what stood here before. Nothing asks
 * who you are on the way into a room any more, so there is no answer to
 * correct and resubmit. What a player can usefully do is try the same room
 * again — somebody may have left since — or go back.
 */
export interface RoomRefusedProps {
  roomId?: string;
  message: string | null;
  onRetry(): void;
  onExit(): void;
}

export function RoomRefused({ roomId, message, onRetry, onExit }: RoomRefusedProps) {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div
        data-testid="room-refused"
        className="mx-auto max-w-md rounded-xl bg-white p-8 text-center shadow-xl"
      >
        <h1 className="mb-2 text-2xl font-bold">Could not join {roomId ?? 'that room'}</h1>
        {/* The server's own words. It knows why; inventing a friendlier reason
            here would be guessing, and the codes that need special handling
            already have their own screens. */}
        <p className="mb-6 text-sm text-gray-600">{message ?? 'The room refused the seat.'}</p>

        <button
          type="button"
          onClick={onRetry}
          className="m-0 w-full rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-semibold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)]"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onExit}
          className="m-0 mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
        >
          Back to the lobby
        </button>
      </div>
    </div>
  );
}
