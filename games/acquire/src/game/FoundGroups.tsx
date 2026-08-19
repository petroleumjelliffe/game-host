import { Brand } from './atoms/Brand';
import { Price } from './atoms/Price';
import { AVAILABLE_STARTUPS, getSharePriceAtSize } from '../../engine/startups';
import type { StartupId } from '../../engine/gameTypes';

/**
 * The founding screen: foundable brands bucketed under their starting price,
 * groups in ascending price order.
 *
 * The prices are *derived* — `getSharePriceAtSize(tier, foundSize)` per brand —
 * never quoted. Two Phase 0 task briefs shipped wrong share prices by writing
 * the numbers down, and at a two-tile founding they happen to read
 * $200 / $300 / $400, which is exactly the kind of figure that gets copied.
 *
 * Brands already on the board render disabled rather than hidden: a player
 * learning the game should see the whole field.
 */
export interface FoundGroupsProps {
  available: StartupId[];
  taken: StartupId[];
  foundSize: number;
  onSelect?: (id: StartupId) => void;
}

const TIERS = new Map(AVAILABLE_STARTUPS.map((s) => [s.id, s.tier]));

export function FoundGroups({ available, taken, foundSize, onSelect }: FoundGroupsProps) {
  const groups = new Map<number, StartupId[]>();
  for (const id of available) {
    const tier = TIERS.get(id);
    if (tier == null) continue;
    const price = getSharePriceAtSize(tier, foundSize);
    const bucket = groups.get(price);
    if (bucket) bucket.push(id);
    else groups.set(price, [id]);
  }

  const prices = [...groups.keys()].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-3">
      {prices.map((price) => (
        <div key={price} data-group-price={price} className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-1.5 text-[13px]">
            <span className="font-bold">
              <Price value={price} />
            </span>
            <span className="text-[11px] uppercase tracking-[0.03em] text-gray-400">
              initial share price
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {groups.get(price)!.map((id) => (
              <Brand
                key={id}
                id={id}
                mode="select"
                disabled={taken.includes(id)}
                onClick={onSelect ? () => onSelect(id) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
