import type { Coord, GameState, LogEntry, LogToken } from './gameTypes';

export const tok = {
  text:  (text: string): LogToken => ({ kind: 'text', text }),
  tile:  (coord: Coord): LogToken => ({ kind: 'tile', coord }),
  brand: (startupId: string): LogToken => ({ kind: 'brand', startupId }),
  cash:  (amount: number, delta = false): LogToken => ({ kind: 'cash', amount, delta }),
  stack: (startupId: string, count: number): LogToken => ({ kind: 'stack', startupId, count }),
};

export function pushLog(
  state: GameState,
  phase: string,
  detail: LogToken[],
  playerId?: string,
  /**
   * A typed payload for a step whose content is richer than a sentence — a
   * merger's payout table, a founder's share certificate. The panel renders a
   * component for it; `detail` may be empty when the payload says everything.
   */
  payload?: LogEntry['payload'],
): LogEntry {
  const entry: LogEntry = { stepId: state.nextStepId, phase, detail };
  if (playerId !== undefined) entry.playerId = playerId;
  if (payload !== undefined) entry.payload = payload;
  state.nextStepId += 1;
  state.log.push(entry);
  return entry;
}

function money(amount: number, delta?: boolean): string {
  const sign = delta ? (amount < 0 ? '-' : '+') : (amount < 0 ? '-' : '');
  return `${sign}$${Math.abs(amount).toLocaleString('en-US')}`;
}

export function renderLogText(entry: LogEntry): string {
  return entry.detail.map((t) => {
    switch (t.kind) {
      case 'text':  return t.text;
      case 'tile':  return t.coord;
      case 'brand': return t.startupId;
      case 'cash':  return money(t.amount, t.delta);
      case 'stack': return `${t.count}× ${t.startupId}`;
    }
  }).join('');
}
