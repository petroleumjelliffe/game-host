import type { Rng } from './types';

/**
 * Freight to start. EXPRESS costs $4,000 and SUPERCHIEF $40,000 — prices the
 * money spec will charge. Nothing here upgrades a train; this type exists
 * because the Bonus Roll rule already turns on it, and threading it now costs
 * one parameter against a later change to every call site.
 *
 * There is no Fast Freight in this rulebook.
 */
export type TrainType = 'freight' | 'express' | 'superchief';

export interface TurnRoll {
  readonly white: readonly [number, number];
  /**
   * The Bonus Roll's face, or null.
   *
   * null covers two different situations, and the difference is *time* rather
   * than entitlement: a turn that earned no Bonus Roll, and a turn that earned
   * one which has not been thrown yet. `earnsBonus` tells them apart from the
   * white pair alone, which is the whole point — entitlement is fixed when the
   * whites land, the face is not known until the pawn has walked them.
   */
  readonly bonus: number | null;
}

export const d6 = (rng: Rng): number => Math.floor(rng() * 6) + 1;

/**
 * "A player can get no more than one Bonus Roll per turn", and a player
 * entitled to one must take it — so this is a fact about the turn rather than
 * a choice offered to anyone.
 */
export function earnsBonus(train: TrainType, white: readonly [number, number]): boolean {
  switch (train) {
    case 'superchief': return true;
    case 'express': return white[0] === white[1];
    case 'freight': return white[0] === 6 && white[1] === 6;
  }
}

/**
 * Two white dice, and nothing else — exactly two draws from `rng`, whatever
 * the train.
 *
 * The Bonus Roll is not taken here. The book's order is: whites rolled and
 * announced, entitlement fixed at that moment by `earnsBonus`, the pawn walks
 * the full white roll, and only *then* is the bonus die thrown as its own,
 * separately-announced roll. Playtest is what settled it: a player who knows
 * the bonus face while walking the whites plans an 18-dot route, and a player
 * at the table cannot. The staging is part of the rule, not presentation.
 *
 * `train` stays in the signature because entitlement is a fact about this
 * roll and this train, and the caller asks `earnsBonus(train, roll.white)`
 * the moment the whites land. Dropping the parameter would only move the
 * same argument to a different call.
 */
export function rollTurn(_train: TrainType, rng: Rng): TurnRoll {
  const white: [number, number] = [d6(rng), d6(rng)];
  return { white, bonus: null };
}

export const movement = (roll: TurnRoll): number =>
  roll.white[0] + roll.white[1] + (roll.bonus ?? 0);

/**
 * Whether a second leg is still owed, and this is the one place the two legs
 * of a turn stop being interchangeable.
 *
 * Moving the white dice and the bonus die as one continuous run is equivalent
 * to the book's two legs *only while the pawn does not arrive*. If it arrives
 * inside the white dice, the book stops it dead, pays the player, has them
 * roll a **new** destination, and spends the Bonus Roll starting that new trip
 * with the used sections released. So the bonus movement can belong to a
 * different trip entirely, and the turn is not over.
 *
 * Arriving later than the white dice means the arrival happened during the
 * bonus movement of the same trip, which simply ends the turn.
 *
 * **This now serves only the legacy pre-rolled form.** `rollTurn` no longer
 * hands back a bonus face, so a live turn reaches its second leg through
 * `earnsBonus` on the white pair instead — arrival has nothing to do with it.
 * A `turnRolled` event carrying a non-null bonus can only have come from a log
 * written before the staging changed, and `replay` keeps exactly today's
 * behaviour for those by calling this. Do not reach for it on the live path.
 */
export function bonusLegOwed(roll: TurnRoll, spent: number, arrived: boolean): boolean {
  if (!arrived || roll.bonus === null) return false;
  return spent <= roll.white[0] + roll.white[1];
}
