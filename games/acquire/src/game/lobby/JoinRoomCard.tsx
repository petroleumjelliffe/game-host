// src/lobby/ui/JoinRoomCard.tsx
// The Join Room state of the lobby card: you type the code into the same block
// the host reads it from, and the list holds only you until the join lands —
// after which `/room/:roomId` draws the same card with everybody in it.
//
// The name field is optional here on purpose. Nothing asks who you are before
// seating you any more; an empty field means the server names you by your
// seat, and your own row in the room is where you change it.

import { LobbyCard, SeatRow } from './LobbyCard';

export interface JoinRoomCardProps {
  code: string;
  onCodeChange: (next: string) => void;
  name: string;
  onNameChange: (next: string) => void;
  /** A join is outstanding: blocks a second submit and says so on the button. */
  busy: boolean;
  error?: string | null;
  onSubmit: () => void;
  onLeave: () => void;
}

export function JoinRoomCard({
  code, onCodeChange, name, onNameChange, busy, error, onSubmit, onLeave,
}: JoinRoomCardProps) {
  // The code is the only requirement. The mockup's empty state says `Join`,
  // the ready state `Join game` — the shorter word on the button that cannot
  // be pressed yet.
  const ready = code.trim() !== '';

  return (
    <LobbyCard
      title="Join Room"
      subtitle="Enter or paste code below"
      code={code}
      onCodeChange={onCodeChange}
      note={error}
      onLeave={onLeave}
      onSubmit={() => { if (ready && !busy) onSubmit(); }}
      primary={
        <button
          type="submit"
          disabled={!ready || busy}
          className="m-0 w-full rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-semibold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)] disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {busy ? 'Joining…' : ready ? 'Join game' : 'Join'}
        </button>
      }
    >
      {/* No emoji: the chip is the seat's, and there is no seat yet. Showing
          seat one's face here would be wrong for everyone who does not turn
          out to be first. */}
      <SeatRow emoji={null} connected={null} isHost={false}>
        <input
          aria-label="Your name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Your name (optional)"
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 font-semibold"
        />
      </SeatRow>
    </LobbyCard>
  );
}
