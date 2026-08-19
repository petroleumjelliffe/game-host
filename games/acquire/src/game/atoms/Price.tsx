/**
 * A stock's value. Neutral on its own; only the *change* carries a hue, so a
 * board full of prices does not read as a board full of gains and losses.
 *
 * The counterpart to `Cash` — see the note there on why the two stay apart.
 */
export interface PriceProps {
  value: number;
  /** The price after the pending placement, when it would move the band. */
  next?: number;
}

export function Price({ value, next }: PriceProps) {
  const moved = next != null && next !== value;
  const up = moved && next > value;
  const tone = up ? 'text-green-700' : 'text-red-700';

  return (
    <span className="tabular-nums text-gray-600">
      {`$${value.toLocaleString('en-US')}`}
      {moved && (
        <>
          <span className={`mx-0.5 ${tone}`}>{up ? '↑' : '↓'}</span>
          <span className={tone}>{`$${next.toLocaleString('en-US')}`}</span>
        </>
      )}
    </span>
  );
}
