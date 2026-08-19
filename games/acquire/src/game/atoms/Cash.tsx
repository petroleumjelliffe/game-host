/**
 * Money. Green when it comes in, red when it goes out, muted at zero.
 *
 * Deliberately *not* the same component as `Price`: money is signed and
 * tinted, a stock's value is neutral and only its change is tinted. Keeping
 * them separate is one of the two locked semantic separations, so this
 * component must never call `Price` nor vice versa.
 */
export interface CashProps {
  amount: number;
  /** `delta` renders an explicit +/− prefix, for staged gains and losses. */
  sign?: 'delta';
}

export function Cash({ amount, sign }: CashProps) {
  const abs = Math.abs(amount).toLocaleString('en-US');

  // Zero is neither a gain nor a loss, so it takes no hue in either mode.
  if (amount === 0) {
    return <span className="tabular-nums text-gray-400">$0</span>;
  }

  const tone = amount < 0 ? 'text-red-700' : 'text-green-700';
  // U+2212 MINUS SIGN, not a hyphen: it aligns with the digits at tabular width.
  const text = sign === 'delta' ? `${amount < 0 ? '−' : '+'}$${abs}` : `${amount < 0 ? '−' : ''}$${abs}`;

  return <span className={`tabular-nums ${tone}`}>{text}</span>;
}
