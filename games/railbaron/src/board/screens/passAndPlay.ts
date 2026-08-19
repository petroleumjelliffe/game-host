import { SEATS } from '../../state/events';
import type { GameState } from '../../state/game';
import { SEAT_COLORS } from '../../game/tokens';
import { padRows, type Row, type ScreenDef } from '../types';

const MINIMUM_BARONS = 2;

export function passAndPlay(state: GameState): ScreenDef {
  const seats: Row[] = SEATS.map((id, index) => {
    const seat = state.seats[id];
    const taken = seat.name !== null;
    return {
      label: `Seat ${index + 1}`,
      status: taken ? 'Ready' : 'Open',
      text: taken ? seat.name! : 'TAP TO JOIN',
      amount: '',
      showDollar: false,
      right: taken ? 'Tap to edit' : '',
      chip: taken ? SEAT_COLORS[id] : null,
      tone: taken ? 'normal' : 'dim',
      // A taken row is editable too — that is how a name is corrected, and
      // it is why setup needs no undo.
      action: { kind: 'edit', field: `seat:${id}`, placeholder: 'Type a name, press Enter' }
    };
  });

  const ready = SEATS.filter(id => state.seats[id].name !== null).length >= MINIMUM_BARONS;

  return {
    title: 'Pass & Play',
    sub: 'THIS DEVICE',
    back: 'home',
    cols: ['Seat', 'State', 'Player name', '', 'Action'],
    rows: padRows([
      ...seats,
      {
        label: '',
        status: ready ? 'Ready' : 'Waiting',
        text: 'START GAME',
        amount: '',
        showDollar: false,
        right: ready ? 'Deals seat 1' : 'Need 2 seats',
        chip: null,
        tone: ready ? 'normal' : 'disabled',
        action: ready ? { kind: 'navigate', to: 'play' } : null
      }
    ])
  };
}
