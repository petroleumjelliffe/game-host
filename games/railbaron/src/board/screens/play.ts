import { cityById, nodeForCity, regionById, REGIONS, type RegionId, type TurnRoll } from '../../../engine';
import { SEATS, type SeatId } from '../../state/events';
import type { GameState } from '../../state/game';
import { needsDestination } from '../../state/turns';
import { SEAT_COLORS } from '../../game/tokens';
import { blankRow, BOARD_ROWS, padRows, type Row, type ScreenDef } from '../types';

/**
 * The dice as both surfaces show them. The board's header and the map's HUD
 * render the same readout through the same gate, so the state it reads is
 * derived once here rather than twice, differently.
 *
 * There are two live states now, because a turn holds two rolls: the white
 * pair at the start, and the Bonus Roll once the white movement has been
 * walked. Both are announced by the same drums before either reaches the log,
 * and `pendingDice`/`pendingBonus` are the rolls that have been made but not
 * yet told — the readout shows them, nothing else can.
 */
export function diceFor(
  state: GameState,
  pendingDice: TurnRoll | null = null,
  pendingBonus: number | null = null,
  actAs: SeatId | 'all' = 'all'
): { roll: TurnRoll | null; live: boolean; mine: boolean } {
  const waiting = pendingDice !== null || pendingBonus !== null;
  // A pending bonus face rides on the white pair already in the log: it is one
  // roll of one turn, not a new pair of dice.
  const roll = pendingDice
    ?? (pendingBonus !== null && state.rolled !== null
      ? { white: state.rolled.white, bonus: pendingBonus }
      : state.rolled);
  return {
    roll,
    // Live when the baron up has a destination and either owes the white dice
    // or owes the Bonus Roll. After an arrival the new destination comes
    // first, which `needsDestination` covers for both.
    live: state.turn !== null
      && !waiting
      && (state.rolled === null || state.bonusOwed)
      && !needsDestination(state.seats[state.turn], nodeForCity),
    // Whether these dice belong to this device: the shared tablet ('all')
    // always owns them; online, only the seated actor's own phone does. The
    // amber ring reads `live && mine`, so a spectator never sees a glow that
    // is not theirs to act on.
    mine: actAs === 'all' || state.turn === actAs
  };
}

/**
 * `pending` is a roll whose region has been named but which has not yet
 * reached the log. Its row shows that region and nothing else new — the
 * destination and payout still show where the baron was, because where they
 * are going is not known to the board until the panel has landed.
 */
export function play(
  state: GameState,
  turns: Partial<Record<SeatId, number>> = {},
  pending: { seat: SeatId; region: RegionId } | null = null,
  pendingDice: TurnRoll | null = null,
  pendingBonus: number | null = null,
  actAs: SeatId | 'all' = 'all'
): ScreenDef {
  const rows: Row[] = SEATS
    .map(id => state.seats[id])
    .filter(seat => seat.name !== null)
    .map(seat => {
      const latest = seat.stops[seat.stops.length - 1];
      const rolling = pending !== null && pending.seat === seat.id;
      // A payout of 0 is a real, legal journey — the board's twin-city
      // pairs pay it. Only null means "no payout applies", i.e. a home town.
      const paid = latest !== undefined && latest.payout !== null;
      return {
        // Carried on every row, not only the one rolling, so that committing
        // the roll does not itself look like a fresh announcement.
        turn: turns[seat.id] ?? 0,
        label: seat.name!,
        status: rolling
          ? regionById(pending!.region).name
          : (latest ? regionById(latest.region).name : ''),
        text: latest ? cityById(latest.city).name : '',
        amount: paid ? latest.payout!.toLocaleString('en-US') : '',
        // Every baron's row carries the printed sign, whatever this roll
        // paid — a home town does not rub it off the board.
        showDollar: true,
        right: latest !== undefined && latest.payout === null ? 'Home' : '',
        chip: SEAT_COLORS[seat.id],
        // Only the baron whose turn it is can act, and only to start a trip:
        // the dice are rolled from the board's own readout and the pawn is
        // walked on the map, so a row with a destination has nothing to offer.
        // 'active' is reserved for the row that is the tap — the actor owed
        // a destination. An actor mid-trip is 'normal': their move is on the
        // dice and the map, and lighting their row would point at the wrong
        // control.
        tone: state.turn === seat.id && needsDestination(seat, nodeForCity)
          ? 'active'
          : state.turn === null || state.turn === seat.id ? 'normal' : 'dim',
        action: state.turn === seat.id && needsDestination(seat, nodeForCity)
          ? { kind: 'act', seat: seat.id }
          : (state.turn === null ? { kind: 'act', seat: seat.id } : null)
      };
    });

  // Seven rows, six barons: the last is always free, and the map takes it.
  // Padding to the row above first pins it to the bottom of the board, so it
  // does not slide up the screen as barons join — a row that moves under the
  // finger between turns is one that gets tapped by mistake.
  const withMap = padRows(rows).slice(0, BOARD_ROWS - 1);

  // Its own row, immediately above the map: a row carries one action, so
  // undo cannot ride on the map row. Written into the padded array at a
  // fixed index rather than pushed before padding, so it sits pinned to the
  // bottom of the board for the same reason the map row is — a control that
  // drifts between a run of blanks and the barons as they join is one that
  // gets tapped by mistake. The board is seven rows, always — with six
  // barons seated there is no spare slot and this is left off rather than
  // the board growing.
  if (state.phase === 'playing' && rows.length < BOARD_ROWS - 1) {
    withMap[BOARD_ROWS - 2] = { ...blankRow(), label: 'Undo', text: 'Take back a turn',
                                tone: 'dim', action: { kind: 'undo' } };
  }

  withMap.push({
    ...blankRow(),
    label: 'Map',
    // Fourteen tiles. "View the network" is sixteen and lost its last two.
    text: 'View the map',
    action: { kind: 'navigate', to: 'map' }
  });

  return {
    title: 'Departures',
    // The header answers "is it me?" in words. On the actor's own device it
    // shouts; on every other device — and on the shared tablet, where "you"
    // would mean six people — it names the baron. Acquire's TurnToast found
    // this gap first: "I can't see whose turn it is."
    sub: state.turn !== null && actAs === state.turn
      ? 'YOUR TURN'
      : (state.turn !== null && state.seats[state.turn].name
        ? `${state.seats[state.turn].name!.toUpperCase()} IS UP`
        : 'IN PLAY'),
    back: 'home',
    cols: ['Baron', 'Region', 'Destination', 'Payout', ''],
    rows: withMap,
    // Every region a roll could name, not the few already on the board. The
    // first roll of a game is the case that needs it: nothing is showing yet,
    // so a panel built from the rows would have the answer and a blank to
    // turn between.
    panel: REGIONS.map(region => region.name),
    dice: diceFor(state, pendingDice, pendingBonus, actAs)
  };
}
