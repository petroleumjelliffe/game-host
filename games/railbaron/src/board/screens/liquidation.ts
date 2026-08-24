// The forced sale, as a takeover — the regionBallot precedent: the board
// keeps its shape instead of opening a dialog over it. It appears because
// legal.ts is refusing everything else anyway; the screen only offers the
// one legal act. A short baron with NO holdings never reaches here —
// shortSeat() requires something to sell, and a penniless seat's negative
// balance rides until the elimination text is transcribed (the spec's
// named hole, resolved at the table).
import { RAILROADS, bankSalePrice } from '../../../engine';
import { SEAT_COLORS } from '../../game/tokens';
import type { GameState, Seat } from '../../state/game';
import { blankRow, padRows, type Row, type ScreenDef } from '../types';

export function liquidation(_state: GameState, short: Seat): ScreenDef {
  const rows: Row[] = short.holdings.map((id) => ({
    ...blankRow(),
    label: id,
    text: RAILROADS.get(id)?.name ?? id,
    amount: bankSalePrice(id).toLocaleString('en-US'),
    showDollar: true,
    chip: SEAT_COLORS[short.id],
    tone: 'normal' as const,
    action: { kind: 'sell' as const, railroad: id },
  }));
  return {
    title: 'Forced sale',
    sub: `${(short.name ?? short.id).toUpperCase()} OWES $${(-short.banked).toLocaleString('en-US')}`,
    back: null,
    cols: ['Line', '', 'Railroad', 'Bank pays', ''],
    rows: padRows(rows),
  };
}
