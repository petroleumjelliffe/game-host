// The dice say "you, now": an amber ring when this device's seated player is
// the one who may roll. Never on a spectator's phone — that gate is diceFor's
// `mine`, tested with the play screen; here the component honours the flag.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiceReadout } from './DiceReadout';
import { TOKENS } from '../game/tokens';

describe('DiceReadout highlight', () => {
  it('rings the dice in amber when highlighted', () => {
    render(<DiceReadout roll={null} live={true} highlight={true} />);
    const dice = screen.getByRole('button', { name: /roll the dice/i });
    expect(dice.style.boxShadow).toContain(TOKENS.amber);
  });

  it('shows no ring otherwise', () => {
    render(<DiceReadout roll={null} live={false} highlight={false} />);
    const dice = screen.getByRole('button', { name: /roll the dice/i });
    expect(dice.style.boxShadow ?? '').not.toContain(TOKENS.amber);
  });
});
