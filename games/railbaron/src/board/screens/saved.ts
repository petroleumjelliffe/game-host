import { SEATS } from '../../state/events';
import type { GameState, Seat } from '../../state/game';
import { SEAT_COLORS } from '../../game/tokens';
import { padRows, type ScreenDef } from '../types';

const DAY = 86_400_000;

function howLongAgo(savedAt: number | null, now: number): string {
  if (savedAt === null) return 'Saved';
  const days = Math.floor((now - savedAt) / DAY);
  if (days <= 0) return 'Just now';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * One summary row, not one row per baron. Two action rows plus six barons
 * is eight rows, and the seven-row invariant is what makes the board read
 * as a single physical object rather than a page that happens to be
 * striped. The leader is the most informative single fact about a game you
 * are deciding whether to return to — and the destination column is
 * fourteen characters, so it could not list six names in any case.
 */
export function saved(
  state: GameState,
  savedAt: number | null,
  now: number = Date.now()
): ScreenDef {
  const seated = SEATS.map(id => state.seats[id]).filter(seat => seat.name !== null);
  const turns = seated.reduce((most, seat) => Math.max(most, seat.stops.length), 0);
  const leader = seated.reduce<Seat | null>(
    (best, seat) => (best === null || seat.earned > best.earned ? seat : best),
    null
  );

  return {
    title: 'Pass & Play',
    sub: 'SAVED GAME',
    back: 'home',
    cols: ['Saved game', 'State', 'Player', 'Earned', ''],
    rows: padRows([
      {
        label: 'In progress', status: howLongAgo(savedAt, now), text: 'CONTINUE GAME',
        amount: '', showDollar: false, right: `Turn ${turns}`,
        chip: '#f5c451', tone: 'normal', action: { kind: 'navigate', to: 'play' }
      },
      {
        label: 'Start over', status: 'Discards', text: 'NEW GAME',
        amount: '', showDollar: false, right: 'Confirms first',
        chip: '#e02b1d', tone: 'normal', action: { kind: 'navigate', to: 'confirm' }
      },
      {
        label: 'Leading', status: 'Saved', text: leader?.name ?? '',
        amount: leader ? leader.earned.toLocaleString('en-US') : '',
        showDollar: leader !== null,
        right: `${seated.length} barons · Turn ${turns}`,
        chip: leader ? SEAT_COLORS[leader.id] : null,
        tone: 'dim', action: null
      }
    ])
  };
}
