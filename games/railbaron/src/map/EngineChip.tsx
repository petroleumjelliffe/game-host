import { useEffect, useRef, useState } from 'react';
import type { TurnRoll } from '../../engine';
import { COLORS, DICE_MS, PIPS } from '../board/dice';

/**
 * The chip: one overlay riding above the baron's engine, changing costume as
 * the turn goes — the dice tumble there when thrown, the moves left count
 * down there as the route is tapped out, and END TURN lands there when the
 * leg is spent. Geometry and colours are copied from variant 5b of
 * `Train Movement Style.dc.html` in the Rail Baron Game Board Design project;
 * change them there first.
 *
 * It is drawn in map coordinates inside the map's own SVG, which is what lets
 * it ride the pan, the zoom and the pawn's own glide without a screen-space
 * projection of its own. Everything here is scenery: no element takes a tap
 * (the roll lives on the HUD), so the interaction layer's guarantee — every
 * hit target above every painted shape — holds without an exception.
 */

/**
 * How the engine and the chip riding it travel between nodes — the 5b move
 * transition. One definition for both, so they can never drift apart mid-glide.
 */
export const GLIDE = 'transform 380ms cubic-bezier(.35,.7,.3,1)';

/** Ticks of tumble before the thrown faces land. */
const TUMBLE_TICKS = 8;
/** How long the landed dice lie on the table before the counter takes over. */
const SETTLE_MS = 780;

const DIE = { size: 26, radius: 4, pip: 2.5 } as const;
const TRAY = { pad: 8, gap: 6, radius: 8, height: 38, lift: 34 } as const;
const COUNT = { height: 24, lift: 26 } as const;
const END = { width: 86, height: 26, lift: 30 } as const;

/** Whether a seat's colour is too dark to carry dark text or read on the tray. */
const dark = (hex: string): boolean => {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b < 100;
};

function Die({ x, y, value, red }: { x: number; y: number; value: number; red: boolean }) {
  const on = PIPS[value] ?? [];
  return (
    <g aria-hidden="true">
      <rect x={x} y={y} width={DIE.size} height={DIE.size} rx={DIE.radius}
            fill={red ? COLORS.bonusLeaf : COLORS.whiteTop} pointerEvents="none" />
      {on.map(cell => (
        <circle key={cell}
                cx={x + 6 + (cell % 3) * 7} cy={y + 6 + Math.floor(cell / 3) * 7}
                r={DIE.pip} fill={red ? COLORS.bonusPip : COLORS.whitePip}
                pointerEvents="none" />
      ))}
    </g>
  );
}

export interface EngineChipProps {
  /** Where the engine stands, in map coordinates. */
  x: number;
  y: number;
  /** The baron up's seat colour. */
  color: string;
  /** The dice as this device knows them — pending rolls included. */
  roll: TurnRoll | null;
  /** Moves this leg still has to spend. */
  remaining: number;
  /** The leg is finished — arrived, or every move spent — and may commit. */
  done: boolean;
  /** Fires once per roll, when the tumble has landed. The announce gate. */
  onLanded?: () => void;
}

export function EngineChip({ x, y, color, roll, remaining, done, onLanded }: EngineChipProps) {
  const [phase, setPhase] = useState<'idle' | 'tumbling' | 'settled'>('idle');
  const [tick, setTick] = useState(0);
  /** Only the red die turns for a Bonus Roll — the whites were already told. */
  const [redOnly, setRedOnly] = useState(false);

  const landed = useRef<(() => void) | undefined>(onLanded);
  landed.current = onLanded;
  /** The roll last set tumbling; `undefined` until the first effect runs. */
  const started = useRef<string | undefined>(undefined);
  /** The last roll whose landing has been reported. Fires once per roll. */
  const reported = useRef<string | undefined>(undefined);
  /** The white faces already shown, for telling a Bonus Roll from a new pair. */
  const prevWhites = useRef('');

  const whiteKey = roll === null ? '' : `${roll.white[0]}-${roll.white[1]}`;
  const key = roll === null ? '' : `${whiteKey}-${roll.bonus ?? 0}`;

  useEffect(() => {
    if (started.current === key) return;
    const first = started.current === undefined;
    started.current = key;
    const heldWhites = prevWhites.current !== '' && prevWhites.current === whiteKey;
    prevWhites.current = whiteKey;
    if (roll === null) { setPhase('idle'); return; }
    if (first) {
      /**
       * Mounted with the roll already known — a reload, or arriving from the
       * board mid-turn. These dice are old news: tumbling them would read as a
       * throw nobody made, so the chip goes straight to the counter. The
       * landing is still reported, because a pending roll can genuinely be in
       * this state — the player rolled on the other screen and navigated here
       * before the drums finished — and unannounced dice would strand the
       * turn. With nothing pending the report is a no-op.
       */
      setPhase('idle');
      if (reported.current !== key) { reported.current = key; landed.current?.(); }
      return;
    }
    setRedOnly(heldWhites && roll.bonus !== null);
    setTick(0);
    setPhase('tumbling');
  }, [key, whiteKey, roll]);

  useEffect(() => {
    if (phase !== 'tumbling') return;
    const timer = setInterval(() => { setTick(current => current + 1); }, DICE_MS);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'tumbling' || tick < TUMBLE_TICKS) return;
    setPhase('settled');
    if (reported.current !== key) { reported.current = key; landed.current?.(); }
  }, [phase, tick, key]);

  useEffect(() => {
    if (phase !== 'settled') return;
    const timer = setTimeout(() => { setPhase('idle'); }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const lightInk = dark(color);

  let costume = null;
  if ((phase === 'tumbling' || phase === 'settled') && roll !== null) {
    const turning = phase === 'tumbling';
    // The tumble cycles the faces deterministically — no random draw sits in
    // the render path, and the thrown faces land exactly on the last tick.
    const faces = redOnly
      ? [{ value: turning ? ((tick * 2) % 6) + 1 : roll.bonus ?? 1, red: true }]
      : roll.white.map((value, i) =>
          ({ value: turning ? ((tick + i * 2) % 6) + 1 : value, red: false }));
    const width = TRAY.pad * 2 + faces.length * DIE.size + (faces.length - 1) * TRAY.gap;
    const top = -TRAY.lift - TRAY.height;
    const label = turning
      ? (redOnly ? 'Bonus die, turning' : 'White dice, turning')
      : redOnly
        ? `Bonus die, ${roll.bonus ?? 0}`
        : `White dice, ${roll.white[0]} and ${roll.white[1]}`;
    costume = (
      <g role="img" aria-label={label}>
        <rect x={-width / 2} y={top} width={width} height={TRAY.height} rx={TRAY.radius}
              fill="rgba(20,15,10,0.78)" pointerEvents="none" />
        {faces.map((face, i) => (
          <Die key={i} x={-width / 2 + TRAY.pad + i * (DIE.size + TRAY.gap)}
               y={top + (TRAY.height - DIE.size) / 2} value={face.value} red={face.red} />
        ))}
      </g>
    );
  } else if (done) {
    costume = (
      <g role="img" aria-label="End turn">
        <rect x={-END.width / 2} y={-END.lift - END.height} width={END.width}
              height={END.height} rx={END.height / 2} fill={color} pointerEvents="none" />
        <text x={0} y={-END.lift - END.height / 2 + 4} textAnchor="middle"
              fontSize={12} fontWeight={700} letterSpacing="0.14em"
              fill={lightInk ? '#f2efe6' : '#0f0c08'}
              fontFamily="'Roboto Condensed', sans-serif" pointerEvents="none">
          END TURN
        </text>
      </g>
    );
  } else if (remaining > 0) {
    const digits = String(remaining).length;
    const width = 56 + digits * 10;
    const top = -COUNT.lift - COUNT.height;
    costume = (
      <g role="img" aria-label={`${remaining} left`}>
        <rect x={-width / 2} y={top} width={width} height={COUNT.height}
              rx={COUNT.height / 2} fill="rgba(20,15,10,0.82)"
              stroke={color} strokeWidth={1} pointerEvents="none" />
        <text x={-width / 2 + 11} y={top + 17} fontSize={17} fontWeight={700}
              fill={lightInk ? '#f2efe6' : color}
              fontFamily="'Roboto Condensed', sans-serif" pointerEvents="none">
          {remaining}
        </text>
        <text x={-width / 2 + 17 + digits * 10} y={top + 15.5} fontSize={9}
              letterSpacing="0.14em" fill="#fdf3e0" opacity={0.72}
              fontFamily="'DM Mono', ui-monospace, monospace" pointerEvents="none">
          LEFT
        </text>
      </g>
    );
  }

  return (
    <g data-chip="" data-motion="" pointerEvents="none"
       style={{ transform: `translate(${x}px, ${y}px)`, transition: GLIDE }}>
      {costume}
    </g>
  );
}
