import { Cash } from '../atoms/Cash';

/** The roster along the bottom of the panel; the active player is outlined. */
export interface PlayersStripPlayer {
  id: string;
  emoji: string;
  name: string;
  cash: number;
  active?: boolean;
  /**
   * Omitted means present. Pass-and-play passes nothing — everyone is at the
   * same device, and an away dot there would be a lie about a person sitting
   * in the room.
   */
  connected?: boolean;
}

export interface PlayersStripProps {
  players: PlayersStripPlayer[];
}

/**
 * Turn order, read from whoever is up.
 *
 * The strip is one row and clips what does not fit, so the seat at the front
 * is the only one guaranteed to be on screen — and that has to be the player
 * whose turn it is. Rotating keeps the reading order true to play order:
 * you, then the person after you, round the table. Sorting would not.
 */
function rotateToActive(players: PlayersStripPlayer[]): PlayersStripPlayer[] {
  const at = players.findIndex((p) => p.active);
  if (at <= 0) return players;
  return [...players.slice(at), ...players.slice(0, at)];
}

export function PlayersStrip({ players }: PlayersStripProps) {
  return (
    // One row, clipped. A seat cannot shrink past its emoji and its cash, so a
    // full table does not fit a 320px panel however it is laid out — six seats
    // want ~1000px. Rather than wrap (which moves every zone below it) or
    // scroll (which nobody would discover), the row simply cuts off, and
    // `rotateToActive` guarantees the seat that matters is at the visible end.
    // A tap-to-expand view is the eventual answer; this is the honest interim.
    <div
      data-zone="roster"
      className="flex flex-none gap-2 overflow-hidden border-t border-gray-200 bg-gray-50 px-3 py-2.5"
    >
      {rotateToActive(players).map((p) => (
        // The active seat is `flex-none` — it keeps its natural width and stays
        // readable, name and cash and all. Everyone else is `min-w-0 flex-1`
        // and gives up whatever room that needs, down to their avatar and past
        // the end of the row. Letting every seat shrink equally, which is what
        // a uniform `flex-1` does, made a six-handed table six unreadable 33px
        // slivers — the active player no better off than anyone else, which
        // defeats the point of rotating them to the front.
        <div
          key={p.id}
          data-seat={p.id}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 ${
            p.active ? 'flex-none border-blue-600 bg-blue-50' : 'min-w-0 flex-1 border-gray-200 bg-white'
          }`}
        >
          <span className="flex-none text-base leading-none">{p.emoji || '•'}</span>
          {p.connected === false && (
            // A dot, not a word: the strip is one clipped row and a seat that
            // grew by a label would push the seat that matters off the end.
            <span
              data-presence="away"
              role="img"
              aria-label={`${p.name} is disconnected`}
              className="h-1.5 w-1.5 flex-none rounded-full bg-gray-400"
            />
          )}
          <span className="min-w-0 truncate font-semibold">{p.name}</span>
          <span className="ml-auto flex-none">
            <Cash amount={p.cash} />
          </span>
        </div>
      ))}
    </div>
  );
}
