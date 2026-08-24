/**
 * The chip: one overlay riding above the baron's engine, carrying the turn's
 * arithmetic — the moves left count down there as the route is tapped out,
 * and END TURN lands there when the leg is spent. Geometry and colours are
 * copied from variant 5b of `Train Movement Style.dc.html` in the Rail Baron
 * Game Board Design project; change them there first.
 *
 * The dice are deliberately NOT here. They ride the readout at the top of
 * the map, where the roll stays on show for the whole turn — a counter that
 * spends down is no use without the roll it is spending, and the chip has
 * nowhere to keep both.
 *
 * It is drawn in map coordinates inside the map's own SVG, which is what lets
 * it ride the pan, the zoom and the pawn's own glide without a screen-space
 * projection of its own. Everything here is scenery all the same: the one
 * action it shows — END TURN — is taken through a matching target the
 * interaction layer draws over it, so its guarantee that every hit target
 * paints above every painted shape holds without an exception. The pill is
 * therefore aria-hidden: the target riding it carries the name.
 */

/**
 * How the engine and the chip riding it travel between nodes — the 5b move
 * transition. One definition for both, so they can never drift apart mid-glide.
 */
export const GLIDE = 'transform 380ms cubic-bezier(.35,.7,.3,1)';

const COUNT = { height: 24, lift: 26 } as const;
const END = { width: 86, height: 26, lift: 30 } as const;

/** Whether a seat's colour is too dark to carry dark text or read as ink. */
const dark = (hex: string): boolean => {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b < 100;
};

export interface EngineChipProps {
  /** Where the engine stands, in map coordinates. */
  x: number;
  y: number;
  /** The baron up's seat colour. */
  color: string;
  /** Moves this leg still has to spend. */
  remaining: number;
  /** The leg is finished — arrived, or every move spent — and may commit. */
  done: boolean;
}

export function EngineChip({ x, y, color, remaining, done }: EngineChipProps) {
  const lightInk = dark(color);

  let costume = null;
  if (done) {
    costume = (
      <g aria-hidden="true">
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
