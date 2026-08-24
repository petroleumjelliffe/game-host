// The Departures Board's Total tile, finally built — the turns plan left it
// "with the money spec" by name. Deliberately plain: one row per seated
// baron, the banked total (never `earned`: the in-flight trip is not money
// yet), the declared run when one is on, and the winner when it is over.
// The design mock's "Fast Freight" train column stays unbuilt until phase 2
// — that train does not exist in this rulebook.
import { cityById } from '../../engine';
import { SEAT_COLORS } from '../game/tokens';
import { SEATS } from '../state/events';
import type { GameState } from '../state/game';

const dollars = (amount: number): string => `$${amount.toLocaleString('en-US')}`;

const strip: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '0.35em 1.25em', alignItems: 'baseline',
  padding: '0.4em 0.8em', margin: 0, listStyle: 'none',
  fontFamily: "'DM Mono', ui-monospace, monospace",
  fontSize: 12, letterSpacing: '0.08em',
};

export function MoneyStrip({ state }: { state: GameState }) {
  const seated = SEATS.filter((id) => state.seats[id].name !== null);
  if (seated.length === 0 || state.phase === 'setup') return null;
  const winner = state.winner === null ? null : state.seats[state.winner];

  return (
    <section aria-label="money">
      {winner !== null && (
        <p role="status" style={{ ...strip, fontSize: 14 }}>
          <strong>{winner.name ?? winner.id} wins</strong>
          &nbsp;— {dollars(winner.banked)}, home to{' '}
          {winner.home === null ? '?' : cityById(winner.home).name}.
        </p>
      )}
      <ul style={strip}>
        {seated.map((id) => {
          const seat = state.seats[id];
          return (
            <li key={id}>
              <span style={{ color: SEAT_COLORS[id] }}>●</span>{' '}
              <span>{seat.name}</span> <strong>{dollars(seat.banked)}</strong>
              {seat.run !== null && state.winner === null && (
                <em>{seat.run.toHome
                  ? ` declared — racing home to ${seat.home === null ? '?' : cityById(seat.home).name}`
                  : ` caught — bound for ${cityById(seat.run.alternate.city).name}`}</em>
              )}
            </li>
          );
        })}
        {state.rules.seed !== undefined && <li><small>seeded game</small></li>}
      </ul>
    </section>
  );
}
