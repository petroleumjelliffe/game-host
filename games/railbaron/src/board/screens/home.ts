import { padRows, type ScreenDef } from '../types';

/**
 * Both modes are real now. Online used to be shown disabled rather than
 * hidden, because the mode select's whole statement is that both exist and
 * concealing one misstates it; the row keeps its place and gains its action.
 */
export function home(): ScreenDef {
  return {
    title: 'Departures',
    sub: 'CHOOSE A MODE',
    back: null,
    cols: ['Mode', 'Where', 'Select', 'Players', 'Notes'],
    rows: padRows([
      {
        label: 'Mode 01', status: 'Local', text: 'PASS AND PLAY',
        amount: '2-6', showDollar: false, right: 'One device',
        chip: '#f5c451', tone: 'normal',
        action: { kind: 'navigate', to: 'passAndPlay' }
      },
      {
        label: 'Mode 02', status: 'Remote', text: 'PLAY ONLINE',
        amount: '2-6', showDollar: false, right: 'One each',
        chip: '#2f7fe8', tone: 'normal',
        action: { kind: 'navigate', to: 'joinRoom' }
      }
    ])
  };
}
