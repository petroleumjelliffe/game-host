# The turn nudge, and the entry cards as chips

**Status:** implemented 2026-09-10, on the entry screen only. Revised the
same day after an adversarial review (seven findings, all addressed), one
owner ruling — **no automatic reminder** — and a second review round
(three more findings, addressed below).

Source: the 2026-09-10 revision of `Word Game Entry.dc.html` in the Claude
Design project (copied beside the other artboards in
[2026-08-31-wordgame-redesign/](2026-08-31-wordgame-redesign/)). Two changes
from the 2026-09-08 version this repo had implemented: every playing or
finished card shows one score chip per player instead of a name line and a
"who played what" fragment, and a their-move card carries a **Nudge**.

## What a nudge is

The only reminder. Notify used to run a 24-hour sweep — a persisted
`currentTurn` marker, checked hourly, one dual-channel send per turn — and
that sweep is gone (owner, 2026-09-10: "don't autoremind"). The marker
stays: it is now the nudge's anchor, and `remindedAt` on it is the
once-per-turn gate. A turn is reminded when a player in the room decides it
should be, and never otherwise.

The rules, each the answer to a review finding:

- **One hour before anyone can nudge** (`NUDGE_MIN_AGE_MS`, measured from
  the turn push). The player just got that push; a nudge inside the hour
  would re-push and mail someone who has just been told. The card shows
  nothing during that hour (`waiting`), not a button that would be refused.
- **Once per turn**, whoever presses it. Every phone in the room sees
  "Reminded ✓" after the first.
- **Not presence-gated.** The sweep skipped a connected player because
  nobody had asked; a nudge was asked for, and a push to someone already on
  the board is the same convenience the turn push is.
- **A nudge supersedes a turn email still waiting out its debounce.** The
  default debounce is a minute and the floor an hour, but the debounce is
  an env var away from being longer, and two mails a minute apart is the
  one thing the reminder must never do.
- **The reminder reaches the person**, expanded from the seat's bindings
  exactly as the turn push is (spec 2026-09-09 §Fan-out). Until this day
  the reminder used the raw bindings, so a seat bound only in Safari with
  the app linked by address was reminded on the one profile with no push.
- **Refused, not silent, when it would reach no one.** Nobody bound to the
  current seat is `unreachable`, and the card never offers a button in that
  state.
- **The marker is written for every reported turn, bound or not.** Before,
  an unbound turn wrote nothing, so a player who enrolled *after* their
  turn began could not be nudged until the next one. Now the marker stands
  from the turn change and the state flips to `ready` the moment they
  bind. An unbound room's record lives **in memory only** until the first
  bind saves it: Rail Baron and Acquire register with notify but never
  call `roomRemoved`, so a file per room they ever play would have been
  immortal (review finding). A restart mid-turn of an unbound room loses
  the marker, and the word game's post-restore re-report puts it back.

`POST /notify/nudge` takes seat credentials only — `game`, `roomId`,
`playerId`, `token` — because the seat is the proof, and there is no reason
to require a notification profile to ask for someone else's reminder. The
refusals: 403 `seatRefused`, 404 `noSuchGame`, 409 for `yourTurn`,
`unreachable`, `alreadyReminded`, `tooSoon`. The client treats
`alreadyReminded` as success (the button was trying to reach exactly that
state) and any other refusal as "leave the button standing".

## How the state reaches the card

`GameTurnReporter.nudgeState?(roomId)` is a pure read on the reporter:
`unreachable | waiting | ready | reminded`. The wordgame summaries handler
stamps it as `nudge` on each playing row (null for lobby and finished rooms,
and null on the standalone dev server where there is no reporter). One
fetch, no second round trip, and the entry page needs no socket to show it —
which matters, because the entry page opens no sockets until you press New
room.

A your-move card with `nudge: 'reminded'` wears the amber **REMINDED** badge.

## The marker after a restart

Notify persists the marker; the word game restores its rooms from saves
that may be one move behind. After such a boot the marker could name the
*next* player while the board still waits on the previous one, and a nudge
would remind the wrong person. So `mount` re-reports every non-lobby room's
turn after restore. Inside notify a re-report of a turn the player was
already told about sends nothing — but it **re-establishes the marker** if
the newer, now-lost turn had superseded it, because without a marker the
turn could never be nudged (the first cut returned early there and stranded
exactly that turn; review finding). A turn the player was never told about
is notified as new. A finished room clears its marker.

Two consequences, both accepted: the re-established marker's clock starts
at boot, so a turn already a day old reads `waiting` for an hour after a
deploy; and a room with no notify record at all (never bound, or older than
this change) gets a fresh marker at boot the same way.

## Chip order

The featured player first — the current player on a their-move card, the
winner(s) on a finished one, You on a your-move card — then You, then the
rest in seating order. Your chip is accent-filled only when it is your move;
a featured other is shaded; everyone else is plain. "YOU WON" / "YOU TIED"
replace the design's "LEE WON" when the winner is you, which the design's
sample data never showed.

Featured-ness rides two new flags on each summary player, `isCurrent` and
`isWinner`, rather than a name lookup: the lobby never made names unique,
and two Sams would otherwise both wear the shaded chip.

## The nudge is a sibling of the open button

The old card was one `<button>`. A Nudge button inside it is a button
inside a button — invalid HTML. The first fix made the card a `div` with
the button role, which is no better: ARIA marks a `button`'s children
presentational, so assistive tech may flatten the nudge away (review
finding). So the card is a plain container holding a native open button
with the card's content, and the Nudge overlaid at the top right as a
sibling. Native buttons handle Enter and Space themselves; there is no key
handler to get wrong, and the test pins that the nudge is not a descendant
of the open button and that nothing in the card carries `role="button"`.

## Not done

The in-room screen has no nudge. The design places it on the entry list
only, and that is where "it's been a day, poke them" actually happens.
