# Railroad purchase prices — rulebook transcription

**Transcribed 2026-08-23**, supplied by the owner in thousands of dollars.
One of the four debts the declaring-and-rover transcription left open. This
document is the record; phase 2 turns it into an engine table with a digest
test, the way `PAYOUT_TABLE` and `CODES` are pinned.

Names are normalized to the ids `engine/network.json` already carries — the
map data is the authority on spelling. Two normalizations from the paste,
both checked against that list: `CMSt.P&P` → `CMStP&P` (punctuation) and
`S&L` → `SAL` (Seaboard Air Line; no S&L exists on this map). All 28
reconcile; nothing is missing and nothing is extra.

| Railroad | Price ($000) |
| --- | --- |
| ACL | 12 |
| AT&SF | 40 |
| B&M | 4 |
| B&O | 24 |
| C&NW | 14 |
| C&O | 20 |
| CB&Q | 20 |
| CMStP&P | 18 |
| CRI&P | 29 |
| D&RGW | 6 |
| GM&O | 12 |
| GN | 17 |
| IC | 14 |
| L&N | 18 |
| MP | 21 |
| N&W | 12 |
| NP | 14 |
| NYC | 28 |
| NYNH&H | 4 |
| PA | 30 |
| RF&P | 4 |
| SAL | 14 |
| SLSF | 19 |
| SOU | 20 |
| SP | 42 |
| T&P | 10 |
| UP | 40 |
| WP | 8 |

## Transcription note

The paste originally read **SLSF 119** — out of family against a 4–42 range —
and the cell was held out of the record until the owner checked the printed
page: **it is 19** (confirmed 2026-08-23, a doubled keystroke). Kept here
because the payout table's digest-test history says mis-copied cells survive
range checks; this one was caught by exactly the scrutiny that policy asks
for.

(For the eventual digest: prices are dollars ×1000 at runtime, matching
`payoutBetween`'s convention.)
