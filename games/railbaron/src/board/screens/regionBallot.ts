import { REGIONS } from '../../../engine';
import type { Seat } from '../../state/game';
import { SEAT_COLORS } from '../../game/tokens';
import { padRows, type ScreenDef } from '../types';

/**
 * Shown when a roll named the region the baron is already in. There are
 * exactly seven regions and exactly seven rows, so the ballot fills the
 * board — which is where this whole design came from: the board keeps its
 * shape instead of opening a dialog over it.
 */
export function regionBallot(seat: Seat): ScreenDef {
  return {
    title: 'Departures',
    sub: `${(seat.name ?? seat.id).toUpperCase()} ROLLED ITS OWN REGION`,
    back: null,
    cols: ['Choose', 'State', 'Region', '', ''],
    rows: padRows(
      REGIONS.map(region => {
        const rolled = region.id === seat.awaiting;
        return {
          label: 'Region',
          status: rolled ? 'Rolled' : 'Choose',
          // Natural case: the flap uppercases for display, and the
          // accessible copy is better off not shouting.
          text: region.name,
          amount: '',
          showDollar: false,
          right: '',
          chip: SEAT_COLORS[seat.id],
          tone: rolled ? 'dim' : 'normal',
          action: { kind: 'act', seat: seat.id }
        };
      })
    )
  };
}
