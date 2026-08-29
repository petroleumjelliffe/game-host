/**
 * A room the server does not have.
 *
 * Two ways to get here and one screen for both, because the player cannot act
 * on the difference: the game finished and its room was cleared, or the server
 * restarted onto a filesystem that no longer held it (the free Render tier
 * resets its disk — see DEPLOYMENT.md, and the Phase 4 design's ruling that
 * this is an accepted limit rather than a thing to engineer around).
 *
 * Deliberately not a join form. The stored identity has already been cleared
 * by the time this renders, and offering a name field over a room that cannot
 * be joined invites a player to keep trying something that will keep failing.
 */
export interface RoomGoneProps {
  roomId?: string;
  onExit(): void;
}

export function RoomGone({ roomId, onExit }: RoomGoneProps) {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div data-testid="room-gone" className="mx-auto max-w-md rounded-xl bg-white p-8 text-center shadow-xl">
        <h1 className="mb-2 text-2xl font-bold">This room is no longer available</h1>
        <p className="mb-6 text-sm text-gray-600">
          {roomId ? `${roomId} has ended, ` : 'It has ended, '}
          or the server restarted and did not keep it.
        </p>

        <button
          type="button"
          onClick={onExit}
          className="m-0 w-full rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-semibold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)]"
        >
          Back to the lobby
        </button>
      </div>
    </div>
  );
}
