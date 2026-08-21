import type { GoldenGame } from './types.js';

/**
 * The movement rules, stored as data. One game states one rule, and every one
 * of them is awkward to reach by playing normally — which is why they are
 * written down rather than found.
 *
 * Every node id here was read off the built graph, never assumed. The
 * neighbourhoods each game leans on:
 *
 *   c13 Minneapolis -> d417[GN,NP] d131[C&NW] d127[C&NW] d222[CMStP&P]
 *                      d352[CMStP&P] d66[CRI&P] c95 St. Paul[C&NW,CMStP&P,NP,GN]
 *   c95 St. Paul    -> c13 only — a spur
 *   c40 San Francisco -> c41 Oakland[AT&SF,SP] only — a spur
 *   c41 Oakland     -> d271[AT&SF] d54[SP] d86[SP] c40[AT&SF,SP]
 *   c4  Fargo       -> d324[GN] d372[GN] d201[NP] d192[NP]
 *   d417            -> d372[GN] c13[GN,NP] d201[NP]
 *   d372            -> c4[GN] d417[GN]
 *   d131            -> d123[C&NW] c13[C&NW] d15[C&NW]
 *   c12 Billings    -> d397[NP] d147[NP] d64[CB&Q]
 *   d397            -> d176[NP,CMStP&P] c12[NP] d146[CMStP&P]
 *   j2 (junction)   -> d252[GN] d170[NP] d176[NP]
 *   c65 Los Angeles -> d402[AT&SF,SP] d452[AT&SF] d423[SP]
 *   d452            -> c65[AT&SF] c75 San Diego[AT&SF]
 *
 * `bonus-die-freight` also walks the long GN run west of Minneapolis — its
 * first turn ends on d372, and the double-six turn goes on c4 d324 d156 d353
 * d304 d250 d221 d121 d129 d143 d284 d161, then d152 d163 d394 on the bonus.
 * A Freight's double six costs twelve dots to walk, and the rule that game
 * states is about not arriving inside them. Read off the built graph the same
 * way, one dot at a time.
 *
 * Every fixture starts on a city, so `src/state/replay.golden.test.ts` can
 * build a real log for each one and hold the runner and `replay` together.
 *
 * **A golden game invalidated by a later rule is deleted, not patched.** These
 * are the rules as understood when they were written down; a later phase — the
 * money spec first — may make one of them wrong rather than incomplete. The
 * response is to remove the game and say in the commit message which rule
 * retired it. Editing a fixture's steps until it passes again turns the record
 * of what the game does into a record of what the code does, which is exactly
 * what these exist not to be.
 *
 * Not every rule in the spec's table can live here. The runner plays one
 * baron: it has no seats, no turn order and no log, so "two barons rolling the
 * same home city" — the table's ninth row — cannot be written as a golden
 * game at all. It is pinned instead by `engine/roll.test.ts` ("never lands on
 * a home city another baron already holds") and by
 * `src/state/useGame.test.tsx` ("refuses a home city another baron already
 * holds"), which have the seats this file does not.
 *
 * Several games still script a third, unused face for a two-dice roll, and
 * the reason has changed with the staging rather than gone away. `rollTurn`
 * now takes exactly two draws whatever the train — the Bonus Roll is a
 * separate roll, and the `bonusRoll` intent carries its own face. So a
 * correct engine never reaches the spare. An engine that regressed to rolling
 * the bonus up front would, and `runner.ts`'s `scripted()` throws on an empty
 * queue rather than returning a rejection: that throw would fail the game
 * before its own assertion ever ran, pinning nothing. The spare gives the
 * regressed engine somewhere to draw from, so the game runs on to its real
 * `bonus: null` assertion and fails there, saying what actually broke.
 */
export const GAMES: readonly GoldenGame[] = [
  {
    id: 'reuse-by-another-line',
    title: 'a trip that re-crosses its own dots by a different line',
    /**
     * "Each section of rail can be used only once per trip", but the pawn "may
     * move between the same two dots again, as long as it uses a different rail
     * line." Minneapolis–d417 carries GN and NP, so it takes two crossings and
     * refuses a third — while the untouched C&NW section out of the same city
     * is still there for the taking. No-reuse is per section, not per dot.
     */
    setup: { at: 'c13', destination: 'c17' },
    steps: [
      { name: 'roll six', intent: { kind: 'roll', faces: [3, 3, 2] },
        then: { spent: 0, remaining: 6, bonus: null } },
      { name: 'out to d417, on one of its two lines',
        intent: { kind: 'step', to: 'd417' }, then: { spent: 1, remaining: 5 } },
      { name: 'back to Minneapolis on the other',
        intent: { kind: 'step', to: 'c13' },
        then: { spent: 2, remaining: 4, companies: ['GN', 'NP'] } },
      { name: 'a third crossing has no line left to ride',
        intent: { kind: 'step', to: 'd417' }, expectError: 'section-used' },
      { name: 'but a different section out of the same city is untouched',
        intent: { kind: 'step', to: 'd131' },
        then: { spent: 3, remaining: 3, companies: ['GN', 'NP', 'C&NW'] } }
    ],
    final: { at: 'c13', spent: 3 }
  },

  {
    id: 'reuse-survives-a-commit',
    title: 'a section crossed twice stays crossed twice once the leg is committed',
    /**
     * The rule above, carried across the end of a turn. A trip counts
     * crossings, not sections touched: Minneapolis–d417 carries two lines, so
     * a leg may go out and come back, and committing that leg must record
     * *two* crossings rather than "this section has been used". Record it as a
     * mark instead and the third crossing — a turn later, on a line that no
     * longer exists — is quietly offered.
     *
     * The state it leaves is also the only one the app's cross-check can see
     * the difference in (`src/state/replay.golden.test.ts`): a committed leg
     * whose spent-section tally holds a count above one.
     */
    setup: { at: 'c13', destination: 'c17' },
    steps: [
      { name: 'roll two', intent: { kind: 'roll', faces: [1, 1, 2] },
        then: { remaining: 2, bonus: null } },
      { name: 'out to d417 on one of its two lines',
        intent: { kind: 'step', to: 'd417' }, then: { spent: 1 } },
      { name: 'and back into Minneapolis on the other',
        intent: { kind: 'step', to: 'c13' },
        then: { spent: 2, remaining: 0, arrived: false, complete: true } },
      { name: 'end the turn where it started', intent: { kind: 'commit' },
        then: { at: 'c13', usedCount: 1, legOwed: false } },
      { name: 'roll again next turn', intent: { kind: 'roll', faces: [1, 2, 2] },
        then: { remaining: 3, usedCount: 1 } },
      { name: 'a third crossing is refused a turn later, exactly as it was during it',
        intent: { kind: 'step', to: 'd417' }, expectError: 'section-used' },
      { name: 'while the untouched C&NW section is still there',
        intent: { kind: 'step', to: 'd131' }, then: { spent: 1, companies: ['C&NW'] } }
    ],
    final: { at: 'c13', usedCount: 1 }
  },

  {
    id: 'trip-across-turns',
    title: 'a trip that spans several turns',
    /**
     * A trip is not a turn. Sections spent on a turn that ended short of the
     * destination are still spent when the next turn starts — and arriving
     * releases the whole trip's worth at once, not just the last leg's.
     */
    setup: { at: 'c13', destination: 'c4' },
    steps: [
      { name: 'roll two', intent: { kind: 'roll', faces: [1, 1, 2] },
        then: { remaining: 2, bonus: null } },
      { name: 'spend both dots', intent: { kind: 'step', to: 'd417' } },
      { name: 'and stop short of Fargo', intent: { kind: 'step', to: 'd372' },
        then: { spent: 2, remaining: 0, arrived: false, complete: true } },
      { name: 'end the turn part-way along the trip', intent: { kind: 'commit' },
        then: { at: 'd372', usedCount: 2, legOwed: false } },
      { name: 'roll again next turn', intent: { kind: 'roll', faces: [1, 2, 2] },
        then: { remaining: 3, usedCount: 2 } },
      { name: 'the last dot into Fargo', intent: { kind: 'step', to: 'c4' },
        then: { spent: 1, arrived: true, complete: true } },
      { name: 'arriving releases the whole trip', intent: { kind: 'commit' },
        then: { at: 'c4', usedCount: 0 } }
    ],
    final: { at: 'c4', usedCount: 0, legOwed: false }
  },

  {
    id: 'junction-company',
    title: 'a route through a junction',
    /**
     * "A player may change rail lines any number of times, but he can change
     * rail lines only at a dot." j2 is the one fork on the board whose branches
     * carry different companies — d252 on GN, d170 and d176 on NP — so a pawn
     * that reaches it on NP must leave it on NP. Nothing is drawn at a junction
     * for the player to stand on, and it costs no movement either way.
     */
    setup: { at: 'c12', destination: 'c4' },
    steps: [
      { name: 'roll three', intent: { kind: 'roll', faces: [1, 2, 2] },
        then: { remaining: 3 } },
      { name: 'north out of Billings', intent: { kind: 'step', to: 'd397' },
        then: { spent: 1 } },
      { name: 'on to the dot before the fork', intent: { kind: 'step', to: 'd176' },
        then: { spent: 2 } },
      { name: 'the fork itself costs nothing', intent: { kind: 'step', to: 'j2' },
        then: { spent: 2, remaining: 1, complete: false } },
      { name: 'the GN branch is another company, and this is no dot',
        intent: { kind: 'step', to: 'd252' }, expectError: 'wrong-company' },
      { name: 'its own line carries on', intent: { kind: 'step', to: 'd170' },
        then: { spent: 3, remaining: 0, complete: true } },
      { name: 'end the turn on a dot, not on the fork', intent: { kind: 'commit' },
        then: { at: 'd170', usedCount: 4 } }
    ],
    final: { at: 'd170' }
  },

  {
    id: 'twin-minneapolis',
    title: 'Minneapolis and St. Paul',
    /**
     * "Each pair of twin cities count as one dot for the pair." The crossing
     * was paid for on the way into the pair, so stepping between the two costs
     * nothing — a whole roll can be left standing unspent on arrival.
     */
    setup: { at: 'c13', destination: 'c95' },
    steps: [
      { name: 'roll seven', intent: { kind: 'roll', faces: [3, 4, 2] },
        then: { remaining: 7 } },
      { name: 'across the pair, for nothing', intent: { kind: 'step', to: 'c95' },
        then: { spent: 0, remaining: 7, arrived: true, complete: true } },
      { name: 'arrive with the whole roll unspent', intent: { kind: 'commit' },
        then: { at: 'c95', usedCount: 0 } }
    ],
    final: { at: 'c95', usedCount: 0 }
  },

  {
    id: 'twin-bay',
    title: 'San Francisco and Oakland',
    /** The same rule, for the board's other pair. Both, not one. */
    setup: { at: 'c41', destination: 'c40' },
    steps: [
      { name: 'roll seven', intent: { kind: 'roll', faces: [2, 5, 2] },
        then: { remaining: 7 } },
      { name: 'across the bay, for nothing', intent: { kind: 'step', to: 'c40' },
        then: { spent: 0, remaining: 7, arrived: true, complete: true } },
      { name: 'arrive with the whole roll unspent', intent: { kind: 'commit' },
        then: { at: 'c40', usedCount: 0 } }
    ],
    final: { at: 'c40', usedCount: 0 }
  },

  {
    id: 'stranding',
    title: 'a step that would strand the pawn',
    /**
     * "If moving to a particular dot would mean that a pawn could not get to
     * its destination city without going over the same rail section twice, then
     * the pawn cannot move to that particular dot."
     *
     * d452 is the San Diego spur: one AT&SF section in, the same one section
     * back out, and nothing else. Taking it while heading anywhere but San
     * Diego spends the only way home. This is the only such step in the shipped
     * graph that starts from a city with no sections already spent — see the
     * task report.
     */
    setup: { at: 'c65', destination: 'c76' },
    steps: [
      { name: 'roll seven', intent: { kind: 'roll', faces: [4, 3, 2] },
        then: { remaining: 7 } },
      { name: 'down the San Diego spur, which has no way back',
        intent: { kind: 'step', to: 'd452' }, expectError: 'would-strand' },
      { name: 'the refusal cost nothing — the pawn moves on instead',
        intent: { kind: 'step', to: 'd402' }, then: { spent: 1, remaining: 6 } }
    ],
    final: { at: 'c65', spent: 1 }
  },

  {
    id: 'arrive-with-spare',
    title: 'a roll that arrives with movement to spare',
    /**
     * "As soon as his pawn reaches its destination city, it must stop
     * immediately — any extra movement is just lost." The route is finished
     * with movement still in hand, and there is no step left to offer.
     */
    setup: { at: 'c13', destination: 'c4' },
    steps: [
      { name: 'roll eight for a three-dot journey', intent: { kind: 'roll', faces: [4, 4, 2] },
        then: { remaining: 8 } },
      { name: 'out of Minneapolis', intent: { kind: 'step', to: 'd417' } },
      { name: 'along the GN', intent: { kind: 'step', to: 'd372' } },
      { name: 'into Fargo, five dots early', intent: { kind: 'step', to: 'c4' },
        then: { spent: 3, remaining: 5, arrived: true, complete: true } },
      { name: 'the spare movement buys nothing', intent: { kind: 'step', to: 'd372' },
        expectError: 'already-arrived' },
      { name: 'end the turn', intent: { kind: 'commit' },
        then: { at: 'c4', usedCount: 0, legOwed: false } }
    ],
    final: { at: 'c4', legOwed: false }
  },

  {
    id: 'bonus-die-freight',
    title: 'a Freight earns a Bonus Roll on double six, and takes it after the white leg',
    /**
     * Two turns, because the rule has two halves: snake eyes earn a Freight
     * nothing, and only the double six pays.
     *
     * The second turn is also where the staging is stated. The white pair
     * lands with the die still in the cup — `bonus: null`, `entitled: true`,
     * twelve dots to walk and no eighteen — and the Bonus Roll is refused
     * until they have been walked. This leg does *not* arrive, which is the
     * case the first draft of the spec got wrong: the entitlement was fixed
     * when the whites landed and it does not depend on arriving, so the turn
     * stays open and the bonus leg carries on over the same spent sections.
     *
     * Twelve steps is what a double six costs. They are written out because a
     * fixture that computed its own route would be asserting the engine
     * against itself.
     */
    setup: { at: 'c13', destination: 'c8', train: 'freight' },
    steps: [
      { name: 'a pair of ones is still a pair', intent: { kind: 'roll', faces: [1, 1, 2] },
        then: { bonus: null, entitled: false, remaining: 2 } },
      { name: 'no Bonus Roll to take, whenever it is asked for',
        intent: { kind: 'bonusRoll', face: 5 }, expectError: 'no-bonus-entitlement' },
      { name: 'walk it off', intent: { kind: 'step', to: 'd417' } },
      { name: 'and again', intent: { kind: 'step', to: 'd372' },
        then: { spent: 2, complete: true } },
      { name: 'end the turn', intent: { kind: 'commit' }, then: { legOwed: false } },

      { name: 'double six, and no third die comes out with it',
        intent: { kind: 'roll', faces: [6, 6, 5] },
        then: { bonus: null, entitled: true, remaining: 12 } },
      { name: 'the die is not thrown until the whites have been walked',
        intent: { kind: 'bonusRoll', face: 3 }, expectError: 'bonus-too-early' },
      { name: 'on into Fargo', intent: { kind: 'step', to: 'c4' } },
      { name: 'and on', intent: { kind: 'step', to: 'd324' } },
      { name: 'and on', intent: { kind: 'step', to: 'd156' } },
      { name: 'and on', intent: { kind: 'step', to: 'd353' } },
      { name: 'and on', intent: { kind: 'step', to: 'd304' } },
      { name: 'and on', intent: { kind: 'step', to: 'd250' } },
      { name: 'and on', intent: { kind: 'step', to: 'd221' } },
      { name: 'and on', intent: { kind: 'step', to: 'd121' } },
      { name: 'and on', intent: { kind: 'step', to: 'd129' } },
      { name: 'and on', intent: { kind: 'step', to: 'd143' } },
      { name: 'the eleventh dot', intent: { kind: 'step', to: 'd284' } },
      { name: 'the twelfth, still well short of Butte',
        intent: { kind: 'step', to: 'd161' },
        then: { spent: 12, remaining: 0, arrived: false, complete: true } },
      { name: 'the white leg ends without arriving, and the turn does not end with it',
        intent: { kind: 'commit' },
        // Fourteen sections, not twelve: the two the first turn spent are
        // still spent, because nothing has arrived anywhere yet.
        then: { at: 'd161', usedCount: 14, legOwed: true, bonus: null, entitled: true } },
      { name: 'and it cannot be rolled past — the entitlement must be taken',
        intent: { kind: 'roll', faces: [2, 2] }, expectError: 'no-roll' },
      { name: 'now the die is thrown, and it alone pays for the leg',
        intent: { kind: 'bonusRoll', face: 3 },
        then: { bonus: 3, spent: 0, remaining: 3, usedCount: 14 } },
      { name: 'once, though — the face is on the table',
        intent: { kind: 'bonusRoll', face: 6 }, expectError: 'bonus-already-taken' },
      { name: 'no arrival released anything, so the bonus leg cannot go back the way it came',
        intent: { kind: 'step', to: 'd284' }, expectError: 'section-used' },
      { name: 'on into the bonus leg', intent: { kind: 'step', to: 'd152' },
        then: { spent: 1 } },
      { name: 'and on', intent: { kind: 'step', to: 'd163' }, then: { spent: 2 } },
      { name: 'the last of the three', intent: { kind: 'step', to: 'd394' },
        then: { spent: 3, remaining: 0, arrived: false, complete: true } },
      { name: 'and now the turn is over', intent: { kind: 'commit' },
        then: { at: 'd394', usedCount: 17, legOwed: false, bonus: null } }
    ],
    final: { at: 'd394', usedCount: 17, legOwed: false }
  },

  {
    id: 'bonus-die-express',
    title: 'an Express earns a Bonus Roll on any double',
    /**
     * Three the hard way earns nothing; three and three earns the die. Narrow
     * on purpose: what a train is entitled to is the whole rule here, and the
     * leg it buys is walked in `bonus-die-freight`.
     */
    setup: { at: 'c13', destination: 'c8', train: 'express' },
    steps: [
      { name: 'one and two is no double', intent: { kind: 'roll', faces: [1, 2] },
        then: { bonus: null, entitled: false, remaining: 3 } },
      { name: 'walk it off', intent: { kind: 'step', to: 'd417' } },
      { name: 'and on', intent: { kind: 'step', to: 'd372' } },
      { name: 'as far as Fargo', intent: { kind: 'step', to: 'c4' },
        then: { spent: 3, arrived: false, complete: true } },
      { name: 'end the turn', intent: { kind: 'commit' }, then: { legOwed: false } },
      { name: 'a double three is enough for an Express — and the die stays in the cup',
        intent: { kind: 'roll', faces: [3, 3, 5] },
        then: { bonus: null, entitled: true, remaining: 6 } }
    ]
  },

  {
    id: 'bonus-die-superchief',
    title: 'a Superchief earns a Bonus Roll every turn',
    /**
     * No double, no double six — a Superchief is entitled to the die anyway.
     * The same faces earn a Freight or an Express nothing at all. And being
     * entitled to it is not holding it: the white pair is all that is on the
     * table, so the movement is three and not the old seven.
     */
    setup: { at: 'c13', destination: 'c8', train: 'superchief' },
    steps: [
      { name: 'a plain one and two still earns the die',
        intent: { kind: 'roll', faces: [1, 2, 4] },
        then: { bonus: null, entitled: true, remaining: 3 } }
    ]
  },

  {
    id: 'bonus-leg',
    title: 'arriving on the white dice, then a bonus leg',
    /**
     * Arriving inside the white dice does not end the turn: the baron is paid,
     * rolls a new destination, and only then throws the Bonus Roll — which
     * starts that new trip, with the old trip's sections released, which is
     * why the bonus leg may re-cross every section the first leg just used.
     *
     * The order is the book's: arrive, new destination, *then* the die. The
     * white leg is walked knowing only that a Bonus Roll is coming, never how
     * far it will reach.
     *
     * And it happens once. The bonus leg arrives too, and earns nothing for
     * it: "a player can get no more than one Bonus Roll per turn."
     */
    setup: { at: 'c4', destination: 'c13' },
    steps: [
      { name: 'double six on a Freight', intent: { kind: 'roll', faces: [6, 6, 6] },
        then: { bonus: null, entitled: true, remaining: 12 } },
      { name: 'out of Fargo', intent: { kind: 'step', to: 'd372' } },
      { name: 'along the GN', intent: { kind: 'step', to: 'd417' } },
      { name: 'into Minneapolis on the third dot', intent: { kind: 'step', to: 'c13' },
        then: { spent: 3, arrived: true, complete: true } },
      { name: 'the turn is not over — a bonus leg is owed', intent: { kind: 'commit' },
        then: { at: 'c13', usedCount: 0, legOwed: true, bonus: null, entitled: true } },
      { name: 'a new destination first, before the die is thrown',
        intent: { kind: 'destination', to: 'c4' }, then: { usedCount: 0 } },
      { name: 'and now the Bonus Roll', intent: { kind: 'bonusRoll', face: 6 },
        then: { bonus: 6, spent: 0, remaining: 6, usedCount: 0 } },
      { name: 'back over a section the last leg used, now released',
        intent: { kind: 'step', to: 'd417' }, then: { spent: 1 } },
      { name: 'and the next one', intent: { kind: 'step', to: 'd372' },
        then: { spent: 2 } },
      { name: 'into Fargo', intent: { kind: 'step', to: 'c4' },
        then: { spent: 3, remaining: 3, arrived: true, complete: true } },
      { name: 'no second Bonus Roll', intent: { kind: 'commit' },
        then: { at: 'c4', usedCount: 0, legOwed: false } }
    ],
    final: { at: 'c4', usedCount: 0, legOwed: false }
  }
];
