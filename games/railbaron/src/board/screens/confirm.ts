import { padRows, type ScreenDef } from '../types';

/**
 * Not a route. A discard confirmation should not be bookmarkable, and the
 * back button out of one must be harmless rather than destructive.
 */
export function confirm(): ScreenDef {
  return {
    title: 'Pass & Play',
    sub: 'DISCARD SAVED GAME?',
    back: 'saved',
    cols: ['Confirm', 'State', 'Choose', '', ''],
    rows: padRows([
      {
        label: 'Discard', status: 'Permanent', text: 'YES, DISCARD',
        amount: '', showDollar: false, right: 'Cannot undo',
        chip: '#e02b1d', tone: 'normal', action: { kind: 'navigate', to: 'passAndPlay' }
      },
      {
        label: 'Keep', status: 'Saved', text: 'KEEP PLAYING',
        amount: '', showDollar: false, right: 'Back to game',
        chip: '#f5c451', tone: 'normal', action: { kind: 'navigate', to: 'saved' }
      }
    ])
  };
}
