# Lobby share button — design

**Date:** 2026-08-09
**Status:** Approved design, not yet planned or built
**Scope:** Generic lobby kit (`src/lobby/ui/`); wire-neutral, no server change

## What and why

The New Room card tells players to "Share this code with other players" but offers
no way to do it. A Share button joins the room-code block: one tap copies the room
link and, where the platform has one, opens the native share sheet. Standard lobby
functionality, so it lands in the shared kit and game #2 inherits it.

## Behavior

- **Copy and sheet start in the same gesture tick.** On tap the button starts the
  clipboard write and calls `navigator.share({ url, text })` immediately — **no
  await between the click and the share call**. (Corrected 2026-08-09, found by
  hand in Safari: awaiting the clipboard first spends the click's user activation,
  and Safari then refuses the sheet with `NotAllowedError` — silently, under the
  original design's catch. Chrome's laxer activation window hid it.) A dismissed
  sheet (`AbortError`) is silence; any *other* refusal means no sheet ever showed,
  so the button falls back to the "Copied" label — the copy is the action that
  happened, once its promise confirms it did.
- **Fallback is copy-only.** Where `navigator.share` is absent — desktop Firefox
  has no share API on macOS at all; that is unsupported-by-platform, not a bug —
  the tap copies and the button's label flips to "Copied" for ~2 seconds — a text
  swap, no animation, nothing for `prefers-reduced-motion` to object to.
- **Everyone shares, not just the host.** Any seated player in the lobby sees the
  button; recruiting is not a host privilege. (The card's subtitle already addresses
  everyone.)
- **Guarded like storage.** Clipboard and share calls take the same posture as
  `identity.ts`'s reads: wrapped, failures degrade silently to whatever still works.
  A lobby that throws on a share tap is worse than a share that quietly only copied.
- **The share text is configuration, not code.** The sheet call is
  `navigator.share({ url, text })` where `text` comes through an optional prop with
  a game-neutral default (`"Join my game room"`). A game overrides it at the one
  call site that already passes the URL — so wording changes later are a prop edit
  in the game, never a kit change. The clipboard still gets the bare URL: pasted
  links should be links.

## Where things live

- **`src/lobby/ui/ShareRoomButton.tsx`** — new; props `url: string` (required) and
  `text?: string` (defaults to `"Join my game room"`). Owns the copy/share/label
  machinery. Styled with the kit's `--lobby-*` accent variables like every other
  primary control.
- **`RoomLobby`** gains optional `shareUrl?: string` and `shareText?: string`,
  rendered as the button under the code block when a URL is present.
- **`RoomPage`** passes `window.location.href` — the lobby renders at
  `/room/:roomId`, so the page's own URL *is* the share link. The kit never computes
  URLs; the game hands it one, keeping the kit route-agnostic and the import
  boundary untouched.

## Testing

- Component tests (app project): with a mocked `navigator.share` present, a tap
  calls both `clipboard.writeText(url)` and `share({ url })`; with it absent, a tap
  copies and the label reads "Copied", reverting after the timeout. Both proven able
  to fail per the hollow-gate rule (break the handler, watch red, revert).
- Real-browser look at the card. The genuine share sheet requires a secure context,
  and **browsers disagree about `http://localhost`**: Chrome treats it as
  trustworthy (sheet works in dev), Safari does not — measured 2026-08-09, Safari
  26.4 reports `isSecureContext: false` there and never exposes `navigator.share`,
  so Safari correctly shows the copy-only fallback in dev. Sheet-in-the-flesh
  verification for Safari and phones therefore happens on prod HTTPS — noted, not
  a merge blocker. (Desktop Firefox has no share API at all; fallback is the
  design there.)

## Out of scope

- Share affordances anywhere but the room lobby card (Join card, mid-game).
- A share *title* or richer share payloads — `text` + `url` is the whole surface
  until something needs more. (This supersedes the extraction spec's "no copy
  parameter yet" for this one string: the share text is the first string that
  needed it.)
- Any wire or server change.
