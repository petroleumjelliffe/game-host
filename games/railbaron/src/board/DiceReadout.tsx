import { useEffect, useRef, useState } from 'react';
import type { TurnRoll } from '../../engine';
import { BONUS_FACES, COLORS, DICE_MS, DIE, WHITE_FACES, dieTurn, pipCells } from './dice';
import { TOKENS } from '../game/tokens';

/**
 * One drum: the face showing, the face still falling away, and ticks left to
 * spin. A drum with nothing left to spin and nothing left falling has stopped.
 *
 * There used to be a fourth field, `wait`, which held the bonus drum still
 * while the whites turned and then for a beat past them. The beat existed to
 * separate the bonus from the whites *within one roll*; the Bonus Roll is now
 * taken after the white movement has been walked, so the two are separated in
 * time by the turn itself and there is nothing left for a pause to say.
 */
interface Drum { cur: number; prev: number; left: number; faces: number; }

const rest = (faces: number): Drum => ({ cur: 0, prev: 0, left: 0, faces });

const tick = (drum: Drum): Drum => {
  if (drum.left <= 0) return drum.prev === drum.cur ? drum : { ...drum, prev: drum.cur };
  return { ...drum, cur: (drum.cur + 1) % drum.faces, prev: drum.cur, left: drum.left - 1 };
};

const stopped = (drum: Drum): boolean => drum.left <= 0 && drum.prev === drum.cur;

export interface DiceReadoutProps {
  /** The dice of the turn under way, or null when none has been rolled. */
  roll: TurnRoll | null;
  /** Whether tapping does anything — only the baron whose turn it is may roll. */
  live: boolean;
  /**
   * The amber your-move ring. Deliberately not derived from `live` here:
   * `live` is shared state (true on every device when the actor may roll),
   * and the ring must light only the seated actor's own device — the caller
   * passes `dice.live && dice.mine`.
   */
  highlight?: boolean;
  onRoll?: () => void;
  /** Fires once, when every drum has stopped. The gate for committing a roll. */
  onLanded?: () => void;
}

/**
 * Three drums in the middle of the header: one pair of white dice on the
 * table, shared, plus the bonus die's own drum.
 *
 * The bonus drum is always there and rests on a black blank. That empty slot
 * is the design's point — it shows a Freight player what a Superchief gets
 * every turn, and makes the upgrade legible before you buy it rather than
 * after.
 *
 * **A turn throws this readout twice.** The white pair goes first; the Bonus
 * Roll, when one was earned, is thrown after the white movement has been
 * walked. So a roll key whose white faces are unchanged is the second of
 * those, and the white drums must hold still through it — they are lying on
 * the table showing what they rolled, and lapping them would read as a
 * re-throw of dice nobody touched.
 *
 * Faces are not readable until the drums stop: the accessible name is the
 * value only once settled, which is the same rule the region panel follows.
 * A caller waiting on `onLanded` therefore cannot learn the roll early.
 */
export function DiceReadout({ roll, live, highlight = false, onRoll, onLanded }: DiceReadoutProps) {
  const [drums, setDrums] = useState<[Drum, Drum, Drum]>(
    () => [rest(WHITE_FACES), rest(WHITE_FACES), rest(BONUS_FACES)]
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const landed = useRef<(() => void) | undefined>(onLanded);
  landed.current = onLanded;

  // Keyed on the faces rather than the object: the caller rebuilds `roll`
  // every render, and keying on identity would restart the drums every tick.
  // The white half is kept separately rather than sliced back out of `key`,
  // because "did the white dice change" is a question asked every time the
  // drums are set turning.
  const whiteKey = roll === null ? '' : `${roll.white[0]}-${roll.white[1]}`;
  const key = roll === null ? '' : `${whiteKey}-${roll.bonus ?? 0}`;
  /** The white faces the drums were last set turning for. */
  const whitesShowing = useRef<string>('');
  // Seeded with a sentinel no real key can equal — not with `key` itself.
  // Seeding it with the mount-time key would make the very first effect run
  // a no-op whenever a roll is already present at mount (every test here,
  // and any re-render that lands with dice mid-turn), leaving the drums
  // silently parked at rest instead of turning to the awaited face.
  const started = useRef<string | undefined>(undefined);
  /**
   * The roll the drums are currently turning for. State rather than a ref,
   * because two things read it during render: `turning` below, and the
   * landing effect. It starts on the same sentinel `started` does — at mount
   * with a roll already in hand the drums are still at rest, which is not the
   * same as having landed on it.
   */
  const [begun, setBegun] = useState('');
  /** The last roll whose landing has been reported. Fires once per roll. */
  const reported = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (started.current === key) return;
    started.current = key;
    // Whether the white dice are the same ones already on the table, read
    // before this run claims them. An empty previous key is "no dice were
    // showing", which is not the same as showing these.
    const heldWhites = whitesShowing.current !== '' && whitesShowing.current === whiteKey;
    whitesShowing.current = whiteKey;
    reported.current = undefined;
    setBegun(key);
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    if (roll === null) {
      // The dice come off the table between turns. Returning here without
      // touching the drums left the last player's bonus number sitting on the
      // red die for the whole of the next baron's turn, up to the moment they
      // tapped — a number they had not rolled, on a die they might not earn.
      setDrums([rest(WHITE_FACES), rest(WHITE_FACES), rest(BONUS_FACES)]);
      return;
    }

    setDrums(current => {
      // Held whites do not turn at all — not even the lap that makes a die
      // landing on the face it already showed read as thrown, because this is
      // the case where it genuinely was not thrown. Only the Bonus Roll
      // reaches this branch, and only the red drum moves for it.
      const whiteLeft0 = heldWhites
        ? 0 : dieTurn(current[0].cur, roll.white[0] - 1, WHITE_FACES, true);
      const whiteLeft1 = heldWhites
        ? 0 : dieTurn(current[1].cur, roll.white[1] - 1, WHITE_FACES, true);
      return [
        { ...current[0], left: whiteLeft0 },
        { ...current[1], left: whiteLeft1 },
        // The bonus drum laps only when it is showing something: falling
        // round to the blank should look like the die being put away, not
        // thrown. A stale face from a previous roll therefore falls away as
        // the next roll's whites *begin* turning rather than at the end of
        // them — holding it through the spin reads to a player as if this
        // roll had earned a bonus.
        { ...current[2],
          left: dieTurn(current[2].cur, roll.bonus ?? 0, BONUS_FACES, roll.bonus !== null) }
      ];
    });

    // Nothing but the drums turning. The updater is pure and hands back the
    // state it was given when no drum moved, so a tick past the end costs no
    // render.
    timer.current = setInterval(() => {
      setDrums(current => {
        const next: [Drum, Drum, Drum] = [tick(current[0]), tick(current[1]), tick(current[2])];
        return next.every((drum, i) => drum === current[i]) ? current : next;
      });
    }, DICE_MS);
    // `key` changes exactly when a new roll arrives, which is the only time
    // this should restart; `whiteKey` is derived from the same roll, so
    // listing it would restart the drums mid-spin on an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, roll]);

  /**
   * The landing, reported from an effect rather than from inside the updater
   * above.
   *
   * Telling the caller is a consequence of the drums having stopped, not part
   * of working out where they stopped — and React invokes an updater twice
   * under StrictMode precisely because it expects one to be pure. It was
   * correct in there only because clearing `timer.current` made the second
   * invocation a no-op, which is the same hazard `src/state/useGame.ts`
   * documents at length. Here the guard says what it means: once per roll.
   *
   * `begun !== key` is what keeps a roll already in hand at mount from
   * reporting a landing before a single drum has moved. The drums are at rest
   * and every one of them counts as stopped, but they have not been set
   * turning for this roll yet — and reporting there would also clear the
   * interval that was about to turn them.
   */
  useEffect(() => {
    if (roll === null || begun !== key || reported.current === key) return;
    if (!drums.every(stopped)) return;
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    reported.current = key;
    landed.current?.();
  }, [drums, begun, key, roll]);

  useEffect(() => () => { if (timer.current !== null) clearInterval(timer.current); }, []);

  const turning = begun !== key || !drums.every(stopped);

  return (
    <div
      role="button"
      aria-label="Roll the dice"
      aria-disabled={!live}
      onClick={() => { if (live) onRoll?.(); }}
      style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        display: 'flex', alignItems: 'center', gap: DIE.gap,
        cursor: live ? 'pointer' : 'default',
        padding: 6, borderRadius: 10,
        boxShadow: highlight
          ? `0 0 0 2px ${TOKENS.amber}, 0 0 18px rgba(245, 196, 81, 0.35)`
          : 'none'
      }}
    >
      {drums.map((drum, index) => {
        const bonus = index === 2;
        const face = (at: number) => (bonus ? at : at + 1);
        const leaf = (at: number) =>
          bonus
            ? (face(at) === 0 ? COLORS.bonusBlank : COLORS.bonusLeaf)
            : (at === drum.cur ? COLORS.whiteTop : COLORS.whiteBottom);
        const pip = bonus ? COLORS.bonusPip : COLORS.whitePip;
        const value = face(drum.cur);
        const name = turning
          ? (bonus ? 'Bonus die, turning' : 'White die, turning')
          : bonus
            ? (value === 0 ? 'Bonus die, not earned' : `Bonus die, ${value}`)
            : `White die, ${value}`;

        return (
          <span
            key={index}
            role="img"
            aria-label={name}
            style={{
              position: 'relative', display: 'inline-block',
              width: DIE.width, height: DIE.height, borderRadius: DIE.radius,
              background: COLORS.body, overflow: 'hidden',
              boxShadow: '0 3px 8px rgba(0,0,0,0.55)'
            }}
          >
            <Leaf half="top" bg={leaf(drum.cur)} pips={pipCells(face(drum.cur), pip)} />
            <Leaf half="bottom" bg={leaf(drum.prev)} pips={pipCells(face(drum.prev), pip)} />
          </span>
        );
      })}
    </div>
  );
}

function Leaf({ half, bg, pips }: {
  half: 'top' | 'bottom'; bg: string; pips: { bg: string }[];
}) {
  const top = half === 'top';
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', left: 0, [top ? 'top' : 'bottom']: 0,
        width: DIE.width, height: DIE.leafHeight, overflow: 'hidden', background: bg,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,${top ? 0.18 : 0.12})`
      }}
    >
      <div
        style={{
          width: DIE.width, height: DIE.height, boxSizing: 'border-box',
          padding: DIE.padding, display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: 'repeat(3,1fr)',
          gap: DIE.pipGap,
          ...(top ? {} : { marginTop: DIE.bottomOffset })
        }}
      >
        {pips.map((cell, i) => (
          <div key={i} style={{ borderRadius: '50%', background: cell.bg }} />
        ))}
      </div>
    </div>
  );
}
