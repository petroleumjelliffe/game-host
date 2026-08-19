/**
 * The pass-and-play curtain: covers the board between turns on a shared device
 * so the next player does not see the previous player's hand, and clears on a
 * single button.
 *
 * This is the one place the lab's "show the same thing to all players"
 * principle is deliberately broken — and the principle does not transfer past
 * pass-and-play, where each player has their own screen.
 */
export interface RevealOverlayProps {
  playerName: string;
  emoji?: string;
  onReveal: () => void;
}

export function RevealOverlay({ playerName, emoji, onReveal }: RevealOverlayProps) {
  return (
    // Fully opaque (owner, hotseat pass): at 95% the board's positions read
    // straight through the veil, and this overlay exists to hide them.
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white">
      {emoji && <span className="text-4xl leading-none">{emoji}</span>}
      <div className="text-lg font-bold text-gray-800">{`Pass to ${playerName}`}</div>
      {/*
        Just "Start". The line above already names who the device is for, and
        the button was repeating it back — "I'm Alex — Reveal" made a handoff
        into a two-part sentence and an identity check nobody was asking for.
        The only thing this button does is begin the turn.
      */}
      <button
        type="button"
        onClick={onReveal}
        className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Start
      </button>
    </div>
  );
}
