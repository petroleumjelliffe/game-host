/**
 * Who still has to liquidate, in turn order.
 *
 * A merger stops the game for every holder of the absorbed chain in turn, so
 * the queue answers "whose decision are we waiting on, and how many are left".
 */
export interface LiqHolder {
  emoji?: string;
  name: string;
  qty: number;
  status: 'done' | 'current' | 'pending';
}

export interface LiqQueueProps {
  holders: LiqHolder[];
}

const STATUS_CLASSES: Record<LiqHolder['status'], string> = {
  done: 'border-gray-200 bg-gray-50 text-gray-400',
  current: 'border-blue-600 bg-blue-50 text-gray-900',
  pending: 'border-gray-200 bg-white text-gray-600',
};

const MARK: Record<LiqHolder['status'], string> = {
  done: '✓',
  current: '›',
  pending: '·',
};

export function LiqQueue({ holders }: LiqQueueProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {holders.map((h) => (
        <div
          key={h.name}
          data-liq-status={h.status}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[13px] ${STATUS_CLASSES[h.status]}`}
        >
          <span aria-hidden className="flex-none">{MARK[h.status]}</span>
          {h.emoji && <span className="flex-none text-base leading-none">{h.emoji}</span>}
          <span className="font-semibold">{h.name}</span>
          <span className="tabular-nums text-gray-500">{`×${h.qty}`}</span>
        </div>
      ))}
    </div>
  );
}
