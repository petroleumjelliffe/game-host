import { Cash } from '../atoms/Cash';

/**
 * Who gets paid when a chain is absorbed, and why.
 *
 * `qty` is the number of shares of the *absorbed* chain the player held — the
 * reason they earned majority or minority — so it belongs on the line next to
 * the amount.
 */
export interface PayoutLine {
  playerName: string;
  emoji?: string;
  qty?: number;
  type: 'majority' | 'minority' | 'both';
  amount: number;
}

export interface PayoutLinesProps {
  bonuses: PayoutLine[];
}

/**
 * `both` is the sole-holder case: majority and minority combined into one
 * figure. It reads as what it is — the bare word "Both" reads as a UI bug.
 */
const ROLE_LABEL: Record<PayoutLine['type'], string> = {
  majority: 'Majority',
  minority: 'Minority',
  both: 'Majority + minority',
};

export function PayoutLines({ bonuses }: PayoutLinesProps) {
  if (bonuses.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-[13px] text-gray-500">No shareholders to pay.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {bonuses.map((b, i) => (
        <div
          key={`${b.playerName}-${b.type}-${i}`}
          data-bonus-line
          data-role={b.type}
          className="flex items-center gap-2 text-[13px]"
        >
          {b.emoji && <span className="flex-none text-base leading-none">{b.emoji}</span>}
          <span className="font-semibold">{b.playerName}</span>
          {b.qty != null && <span className="tabular-nums text-gray-500">{`×${b.qty}`}</span>}
          <span className="text-gray-500">{`· ${ROLE_LABEL[b.type]}`}</span>
          <span className="ml-auto font-semibold">
            <Cash amount={b.amount} sign="delta" />
          </span>
        </div>
      ))}
    </div>
  );
}
