import { describe, it, expect } from 'vitest';
import { tok, pushLog, renderLogText } from './log';
import { createTestGameState } from './testHelpers';

describe('log', () => {
  it('assigns incrementing stepIds', () => {
    const state = createTestGameState();
    const a = pushLog(state, 'Placed a tile', [tok.tile('A1')], 'p1');
    const b = pushLog(state, 'Bought shares', [tok.stack('Gobble', 2)], 'p1');
    expect(a.stepId).toBe(1);
    expect(b.stepId).toBe(2);
    expect(state.nextStepId).toBe(3);
    expect(state.log).toHaveLength(2);
  });

  it('records phase, detail tokens and player', () => {
    const state = createTestGameState();
    pushLog(state, 'Founded a startup', [tok.brand('Messla'), tok.text(' at '), tok.tile('C6')], 'p2');
    expect(state.log[0]).toEqual({
      stepId: 1,
      phase: 'Founded a startup',
      playerId: 'p2',
      detail: [
        { kind: 'brand', startupId: 'Messla' },
        { kind: 'text', text: ' at ' },
        { kind: 'tile', coord: 'C6' },
      ],
    });
  });

  it('renders a plain-text fallback for every token kind', () => {
    const state = createTestGameState();
    const e = pushLog(state, 'Merger payout', [
      tok.text('Alex takes '), tok.cash(3000, true),
      tok.text(' for '), tok.stack('Gobble', 6),
      tok.text(' in '), tok.brand('Gobble'), tok.text(' at '), tok.tile('D5'),
    ]);
    expect(renderLogText(e)).toBe('Alex takes +$3,000 for 6× Gobble in Gobble at D5');
  });

  // `money()`'s sign logic branches on both `amount < 0` and `delta` —
  // 0 and negative amounts are the two edges neither of the tests above
  // exercises (both only ever pass a positive amount).
  describe('renderLogText — cash token edges', () => {
    const entryFor = (amount: number, delta?: boolean) =>
      pushLog(createTestGameState(), 'x', [tok.cash(amount, delta)]);

    it('renders zero with no sign when not a delta', () => {
      expect(renderLogText(entryFor(0, false))).toBe('$0');
    });

    it('renders zero with a leading + when it is a delta', () => {
      // delta's sign check is `amount < 0`, which zero never satisfies —
      // so a zero delta still gets the '+' branch, not a bare '$0'.
      expect(renderLogText(entryFor(0, true))).toBe('+$0');
    });

    it('renders a negative amount with a leading - when not a delta', () => {
      expect(renderLogText(entryFor(-500, false))).toBe('-$500');
    });

    it('renders a negative amount with a leading - (not --) when it is a delta', () => {
      // Both branches of the sign ternary resolve to '-' for a negative
      // amount, so the delta flag must not double up the minus sign.
      expect(renderLogText(entryFor(-500, true))).toBe('-$500');
    });
  });
});
