// The railroad office: the purchase window as a takeover screen, paged
// five to a board because there are 28 railroads and seven rows, without
// exception. Skippable by design — the Back row is the destination roll's
// doorway, so buying can never block rolling.
import { RAILROADS, railroadPrice } from '../../../engine';
import type { GameState } from '../../state/game';
import { BOARD_ROWS, blankRow, padRows, type Row, type ScreenDef } from '../types';

const PER_PAGE = 5;

export function office(state: GameState, page: number): ScreenDef {
  const unowned = [...RAILROADS.values()]
    .filter((line) => !state.owners.has(line.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const pages = Math.max(1, Math.ceil(unowned.length / PER_PAGE));
  const at = ((page % pages) + pages) % pages;
  const buyer = state.turn === null ? null : state.seats[state.turn];
  const cash = buyer?.banked ?? 0;

  const rows: Row[] = unowned.slice(at * PER_PAGE, at * PER_PAGE + PER_PAGE)
    .map((line) => {
      const price = railroadPrice(line.id);
      const affordable = price <= cash;
      return {
        ...blankRow(),
        label: line.id,
        text: line.name,
        amount: price.toLocaleString('en-US'),
        showDollar: true,
        tone: affordable ? 'normal' as const : 'dim' as const,
        action: affordable ? { kind: 'buy' as const, railroad: line.id } : null,
      };
    });

  const padded = padRows(rows);
  if (pages > 1) {
    padded[BOARD_ROWS - 2] = { ...blankRow(), label: 'More',
      text: `Page ${at + 1} of ${pages}`, tone: 'dim',
      action: { kind: 'office', page: at + 1 } };
  }
  padded[BOARD_ROWS - 1] = { ...blankRow(), label: 'Back',
    text: 'Roll the next stop', tone: 'normal', action: { kind: 'office' } };

  return {
    title: 'Railroads',
    sub: 'FOR SALE',
    back: null,
    cols: ['Line', '', 'Railroad', 'Price', ''],
    rows: padded,
  };
}
