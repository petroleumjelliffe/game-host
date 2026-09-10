// src/game/lobby/JoinRoomCard.tsx
// The Join Room state of the lobby card: you type the code into the same block
// the host reads it from. Submitting goes to the room, whose chooser shows
// who is there and offers "Sit here" or "That's me" — so no name is asked
// here; the lobby asks after you sit.

import { LobbyCard } from './LobbyCard';

export interface JoinRoomCardProps {
  code: string;
  onCodeChange: (next: string) => void;
  onSubmit: () => void;
  onLeave: () => void;
}

export function JoinRoomCard({ code, onCodeChange, onSubmit, onLeave }: JoinRoomCardProps) {
  const ready = code.trim() !== '';

  return (
    <LobbyCard
      title="Join room"
      subtitle="Enter or paste the room code"
      code={code}
      onCodeChange={onCodeChange}
      seatNote={(
        <p className="text-center text-xs text-ink-ghost">
          Already sat here before? The code takes you straight back in.
        </p>
      )}
      onLeave={onLeave}
      onSubmit={() => { if (ready) onSubmit(); }}
      primary={
        <button
          type="submit"
          disabled={!ready}
          className="m-0 w-full rounded-xl bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-bold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)] disabled:cursor-not-allowed disabled:bg-chipbg disabled:text-ink-ghost"
        >
          {ready ? 'Open room' : 'Join'}
        </button>
      }
    >
      {/* No seat rows: there is no seat yet, and the room's chooser draws
          the real ones. */}
      {null}
    </LobbyCard>
  );
}
