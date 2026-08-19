import { describe, expect, it } from 'vitest';
import { REGIONS as BOARD_REGIONS } from '../../engine';
import { panelFaces, rowDrums, type RowText } from './choreography';
import { advance, faces, isSettled } from './drum';
import type { RowDrums } from './choreography';

const REGIONS = ['', 'Northeast', 'North Central', 'Plains', 'Southwest'];

/**
 * What the in-play board declares its panel can say. The timings below are
 * measured against it rather than against the two or three regions a row
 * happens to be showing, because the size of the ring is what the panel's
 * hold is counted in — measuring a two-face ring would put the budget half a
 * second under what a player actually waits through.
 */
const REGION_NAMES = BOARD_REGIONS.map(region => region.name);

/** The tick each column lands on, found by turning the drums as the board does. */
function settleTicks(drums: RowDrums) {
  const at = { status: -1, text: -1, amount: -1 };
  let current = drums;
  for (let tick = 0; tick <= 500; tick++) {
    if (at.status < 0 && isSettled(current.status)) at.status = tick;
    if (at.text < 0 && isSettled(current.text)) at.text = tick;
    if (at.amount < 0 && isSettled(current.amount)) at.amount = tick;
    if (at.status >= 0 && at.text >= 0 && at.amount >= 0) return at;
    current = {
      status: advance(current.status),
      text: advance(current.text),
      amount: advance(current.amount)
    };
  }
  throw new Error('a column never settled');
}

/** A roll: the row is stamped, which is what makes the panel turn. */
const roll = (from: RowText, to: RowText) => {
  const drums = rollDrums(from, to);
  return settleTicks(drums);
};

const rollDrums = (from: RowText, to: RowText) => {
  const announced = { ...to, turn: from.turn + 1 };
  const drums = rowDrums(from, announced, panelFaces([from], [announced], REGION_NAMES));
  if (drums === null) throw new Error('expected the row to flap');
  return drums;
};

/** Every face the panel shows, in order, from the tap to the landing. */
function panelSequence(drums: RowDrums): string[] {
  const shown: string[] = [];
  let status = drums.status;
  for (let tick = 0; tick <= 500; tick++) {
    shown.push(faces(status)[0]!.top);
    if (isSettled(status)) return shown;
    status = advance(status);
  }
  throw new Error('the panel never settled');
}

describe('the order a roll arrives in', () => {
  it('lands the region, then the city, then the payout', () => {
    const at = roll(
      { status: 'Northeast', text: 'Boston', amount: '5,000', turn: 0 },
      { status: 'Plains', text: 'Denver', amount: '21,000', turn: 0 }
    );
    expect(at.status).toBeLessThan(at.text);
    expect(at.text).toBeLessThan(at.amount);
  });

  it('still lands the payout last when the city has not changed', () => {
    // A roll that sends a baron to their own home town leaves the city where
    // it is, so its drum has nothing to travel. Scheduling the payout behind
    // the city alone would let HOME appear before the region explaining it.
    const at = roll(
      { status: 'Northeast', text: 'Boston', amount: '5,000', turn: 0 },
      { status: 'Northeast', text: 'Boston', amount: '', turn: 0 }
    );
    expect(at.status).toBeLessThan(at.amount);
    // The city column itself stays still — a baron sent home has not moved —
    // so what matters is that the payout waits for the region regardless.
    expect(at.text).toBe(0);
  });

  it('still turns the panel when the region rolled is the one already showing', () => {
    const at = roll(
      { status: 'Plains', text: 'Denver', amount: '9,000', turn: 0 },
      { status: 'Plains', text: 'Omaha', amount: '4,000', turn: 0 }
    );
    expect(at.status).toBeGreaterThan(0);
    expect(at.status).toBeLessThan(at.text);
  });

  it('leaves a payout still when the figure is the one already showing', () => {
    // A flap does not turn to show what it is already showing, and there is
    // nothing to withhold: the figure was on the board before the tap. Only
    // the panel turns on the announcement itself.
    const at = roll(
      { status: 'Plains', text: 'Denver', amount: '9,000', turn: 0 },
      { status: 'Southwest', text: 'Phoenix', amount: '9,000', turn: 0 }
    );
    expect(at.amount).toBe(0);
    expect(at.status).toBeGreaterThan(0);
  });

  it('turns the panel on the announcement, not on the region changing', () => {
    // THE GATE. A baron who rolls the region they are already in must see
    // exactly what a baron who rolled a new one sees. If the panel only moved
    // when the name changed, sitting still would be the answer.
    const from = { status: 'Plains', text: 'Denver', amount: '9,000', turn: 0 };
    const same = roll(from, { ...from });
    expect(same.status).toBeGreaterThan(0);

    const different = roll(from, { ...from, status: 'Southwest' });
    expect(different.status).toBeGreaterThan(0);
  });

  it('lands the region within about a second of the tap', () => {
    // The suspense is only worth having if the answer still arrives promptly.
    // Two revolutions of an eight-face ring is 0.8s before the panel may
    // land, plus however far round the rolled region happens to be.
    const at = roll(
      { status: 'Northeast', text: 'Boston', amount: '5,000', turn: 0 },
      { status: 'North Central', text: 'Chicago', amount: '4,500', turn: 0 }
    );
    expect(at.status * 52).toBeLessThan(1300);
  });

  it('resolves an ordinary roll in under four seconds', () => {
    // Not the worst case — an unremarkable one, which is what a player waits
    // through most turns. It is close to the worst case rather than well
    // under it, because holding a column back is done in whole laps of its
    // ring: a city tile with less than a column's wait left to travel runs a
    // complete extra lap of the 42-face alphabet, 2.2 seconds, to arrive
    // late. Waiting still and then turning would cost the delay itself and
    // nothing more.
    //
    // Four rather than the three this once was: the panel spins its whole
    // vocabulary twice now instead of turning between the two or three
    // regions that happened to be on the board, and the columns behind it
    // wait for it. That half-second is the suspense, and it is the reason
    // the budget moved rather than the animation quietly outgrowing it.
    const at = roll(
      { status: 'Northeast', text: 'Boston', amount: '5,000', turn: 0 },
      { status: 'North Central', text: 'Chicago', amount: '4,500', turn: 0 }
    );
    expect(at.amount * 52).toBeLessThan(3800);
  });

  it('resolves a whole roll in about four seconds at worst', () => {
    // 52ms a tick. The worst case is a city whose letters have the furthest
    // to travel; anything much beyond this is a wait on every single turn.
    // Each column also spends one tick letting its trailing leaf fall, which
    // is the flap itself and not overhead worth optimising away.
    let worst = 0;
    for (const city of ['Salt Lake City', 'Albany', 'Zanesville', 'A']) {
      const at = roll(
        { status: 'Northeast', text: 'Boston', amount: '5,000', turn: 0 },
        { status: 'Plains', text: city, amount: '35,000', turn: 0 }
      );
      worst = Math.max(worst, at.amount);
    }
    // Worst case, not typical: the longest letter travel in the alphabet
    // plus the payout ring rounding its wait up to a whole lap.
    expect(worst * 52).toBeLessThan(4200);
  });
});

describe('columns with nothing to say', () => {
  it('does not flap a row where nothing changed', () => {
    const row: RowText = { status: 'Plains', text: 'Denver', amount: '9,000', turn: 0 };
    expect(rowDrums(row, row, REGIONS)).toBeNull();
  });

  it('leaves an empty panel and an empty payout still while a name is typed', () => {
    // The setup screens have no region and no payout. Turning those columns
    // through the board's vocabulary to arrive back at blank would be noise,
    // and would hold the row flapping after the name had landed.
    const at = roll(
      { status: '', text: 'Tap to join', amount: '', turn: 0 },
      { status: '', text: 'Ada', amount: '', turn: 0 }
    );
    expect(at.status).toBe(0);
    expect(at.amount).toBe(0);
    expect(at.text).toBeGreaterThan(0);
  });
});

describe('what the panel can flip through', () => {
  it('offers every region the screen declares, not only the ones on the board', () => {
    // The first roll of a game is the case: no baron has a region yet, so
    // the only values on the board are a blank and the one just rolled. A
    // panel that could only offer those has already given the answer away —
    // it has nothing else to show on the way there.
    const faces = panelFaces(
      [{ status: '', text: '', amount: '', turn: 0 }],
      [{ status: 'Plains', text: '', amount: '', turn: 1 }],
      REGION_NAMES
    );
    for (const region of REGION_NAMES) expect(faces).toContain(region);
  });

  it('turns past every other region before landing on the one rolled', () => {
    const shown = panelSequence(rollDrums(
      { status: '', text: '', amount: '', turn: 0 },
      { status: 'Plains', text: 'Denver', amount: '', turn: 0 }
    ));
    for (const region of REGION_NAMES) expect(shown).toContain(region);
    expect(shown[shown.length - 1]).toBe('Plains');
  });

  it('turns whole revolutions, so every region goes past more than once', () => {
    // Suspense, stated as a count. One pass would show each region for a
    // single tick and stop, which reads as a panel arriving rather than one
    // being spun; the rolled region in particular must go by and be passed
    // over before it is landed on.
    // Neighbours on the ring, deliberately: a region most of a revolution
    // away is passed twice by a panel turning one lap and a bit, so a roll
    // with further to travel would pass this test without the laps.
    const shown = panelSequence(rollDrums(
      { status: 'Northeast', text: 'Boston', amount: '5,000', turn: 0 },
      { status: 'Southeast', text: 'Atlanta', amount: '9,000', turn: 0 }
    ));
    for (const region of REGION_NAMES) {
      expect(shown.filter(face => face === region).length).toBeGreaterThan(1);
    }
  });

  it('offers every value on the board, before and after, plus a blank', () => {
    const faces = panelFaces(
      [{ status: 'Northeast', text: '', amount: '', turn: 0 }],
      [{ status: 'Plains', text: '', amount: '', turn: 0 }]
    );
    expect(faces).toContain('');
    expect(faces).toContain('Northeast');
    expect(faces).toContain('Plains');
  });

  it('never offers the same value twice, so a panel cannot land on the wrong one', () => {
    const rows = [
      { status: 'Choose', text: '', amount: '', turn: 0 },
      { status: 'Rolled', text: '', amount: '', turn: 0 },
      { status: 'Choose', text: '', amount: '', turn: 0 }
    ];
    const faces = panelFaces(rows, rows);
    expect(new Set(faces).size).toBe(faces.length);
  });
});
