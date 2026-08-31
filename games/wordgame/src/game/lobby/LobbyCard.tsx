// src/game/lobby/LobbyCard.tsx
// The one card the online lobby is drawn on, in both of its states.
//
// New Room and Join Room are the same card in the Lobby Flow design: a title,
// the room code as a wide letter-spaced block, one row per player, a primary
// action and `Leave`. The only differences are whether the code block is typed
// into or read from, and whether the list holds everybody or only you.
//
// They were built as two unrelated screens, and that is precisely how Join
// Room drifted — it became a pair of labelled inputs ("Room code", "Your
// name") while New Room matched the frame. Sharing the card is what stops the
// two answering the same question differently again.
//
// Theming surface: three CSS custom properties, read via Tailwind arbitrary
// values so an un-themed consumer renders exactly today's blue.
//   --lobby-accent        primary button background (default #2563eb)
//   --lobby-accent-strong primary button hover background (default #1d4ed8)
//   --lobby-on-accent     primary button text color (default #ffffff)

import type { ReactNode } from 'react';

export interface SeatRowProps {
  emoji: string | null;
  /**
   * Whether this seat's socket is up — or `null` for "there is no seat yet",
   * which draws no dot at all.
   *
   * Presence is a property of a socket bound to a seat, and the Join card's
   * row has neither. A green dot there reports a connection that does not
   * exist, which is worse than saying nothing.
   */
  connected: boolean | null;
  isHost: boolean;
  /**
   * A seat nobody is in. Drawn dimmed rather than omitted: how many seats a
   * room has is information, and the roster has no way to mention one.
   */
  empty?: boolean;
  /**
   * A seat that IS occupied but whose socket has dropped — a distinct fact
   * from `empty`, drawn as a trailing "reconnecting…" note rather than
   * folded into the presence dot's color alone.
   */
  reconnecting?: boolean;
  /** The name: a plain span in the room, an input on your own row. */
  children: ReactNode;
}

/** One row's chrome. The name itself is the caller's, because the room's field
 *  is uncontrolled (committed on blur) and the join card's is controlled (read
 *  at submit) — one shared input would have to be both. */
export function SeatRow({
  emoji, connected, isHost, empty = false, reconnecting = false, children,
}: SeatRowProps) {
  return (
    <li
      data-empty={empty ? '' : undefined}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
        empty
          ? 'border-[1.5px] border-dashed border-line-strong text-ink-ghost italic'
          : 'border-line bg-white'
      }`}
    >
      <span aria-hidden className="flex-none text-base leading-none">{emoji ?? '·'}</span>
      {!empty && connected !== null && (
        <span
          data-testid="presence-dot"
          aria-hidden
          className={`h-2 w-2 flex-none rounded-full ${connected ? 'bg-green-500' : 'bg-line-strong'}`}
        />
      )}
      {children}
      {reconnecting && (
        <span className="flex-none text-[11px] text-ink-ghost">reconnecting…</span>
      )}
      {isHost && (
        <span className="flex-none text-[10px] font-bold uppercase tracking-wide text-ink-faint">host</span>
      )}
    </li>
  );
}

/** The letter-spaced block, identical in both states — which is the whole
 *  point of the design note: you type the code into the box the host reads it
 *  from. Only its editability changes. */
const CODE_CLASS = 'w-full rounded-2xl bg-[#ece7da] py-4 text-center text-[30px] font-bold tracking-[0.32em]';

export interface LobbyCardProps {
  title: string;
  subtitle: string;
  code: string;
  /** Absent makes the code read-only: you are already in the room it names. */
  onCodeChange?: (next: string) => void;
  /** The rows — see `SeatRow`. */
  children: ReactNode;
  /** Rendered directly under the code block — the New Room card's Share button. */
  underCode?: ReactNode;
  /**
   * A line rendered directly under the seat list — the room's "N of 6 seats"
   * note, or the Join card's "already sat here before" helper. Distinct from
   * `note`: this is informational, never an error, and each caller brings its
   * own text styling.
   */
  seatNote?: ReactNode;
  note?: string | null;
  /** The primary action, or whatever stands in its place. */
  primary: ReactNode;
  onLeave: () => void;
  /** Given, the card is a form, so Enter submits. Join Room uses it. */
  onSubmit?: () => void;
}

export function LobbyCard({
  title, subtitle, code, onCodeChange, children, underCode, seatNote, note, primary, onLeave, onSubmit,
}: LobbyCardProps) {
  const inner = (
    <>
      <h1 className="mb-1 text-center text-[21px] font-bold">{title}</h1>
      <p className="mb-5 -mt-1 text-center text-[13.5px] text-ink-faint">{subtitle}</p>

      {onCodeChange === undefined ? (
        <div data-testid="room-code" className={`mb-6 ${CODE_CLASS}`}>{code}</div>
      ) : (
        <input
          data-testid="room-code"
          aria-label="Room code"
          value={code}
          // Uppercased as you type: the code is generated from an uppercase
          // alphabet, and a lowercase paste that silently fails to match would
          // look like the room is gone rather than like a typo.
          onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
          className={`mb-6 ${CODE_CLASS} border-2 border-dashed border-line-strong uppercase`}
        />
      )}

      {underCode && <div className="-mt-3 mb-6">{underCode}</div>}

      <ul className="mb-3 flex flex-col gap-2">{children}</ul>

      {seatNote && <div className="mb-4">{seatNote}</div>}

      {note && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {note}
        </div>
      )}

      {primary}

      <button
        type="button"
        onClick={onLeave}
        className="m-0 mt-3 w-full rounded-xl border-[1.5px] border-line-strong bg-white px-4 py-2.5 font-semibold text-ink-soft hover:bg-page/40"
      >
        Leave
      </button>
    </>
  );

  const shell = 'mx-auto w-full max-w-[398px] rounded-[22px] bg-paper p-4 shadow-xl';

  return (
    <div className="flex min-h-screen items-start justify-center bg-page px-3 py-7">
      {onSubmit === undefined ? (
        <div className={shell}>{inner}</div>
      ) : (
        <form className={shell} onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{inner}</form>
      )}
    </div>
  );
}
