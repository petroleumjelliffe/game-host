# QA notes — wordgame + turn notifications playtest

**Date:** 2026-08-31
**Branch:** `claude/scrabble-notifications-lobby-i6a8q8`
**Setup:** composed host (`dev:host`) on localhost:4000, Mailpit catching email
on localhost:1025 (UI at :8025), `NOTIFY_DEBOUNCE_MS=500`.

## Notes

- Joining is asynchronous here, where other games' lobbies are effectively
  synchronous (everyone present before start). Invites are shared links, so
  the host needs visibility into who has actually joined — and right now the
  game can be started before the other players have connected at all.
  - **Scope rulings (owner, 2026-08-31):** starting with disconnected seated
    players is fine and gets no warning; no joining after start; no
    confirm-before-start dialog. Out of scope: inviting by email/past players.
  - **Root cause found and fixed (2026-08-31):** the roster UI already showed
    every joiner regardless of connection — but lobby-stage rooms were never
    persisted, so any restart/deploy between "friends joined" and "host
    pressed start" silently deleted the room. Lobby rooms now save on every
    seating change (create/join/rename/leave) and restore across restarts.
  - Maybe later: notify the host when a player takes a seat (needs a new
    payload kind in the notify contract — its own small pass).
- need drag and drop for tiles
- show notifcations enabled icon after confirming email address.
- use 2L 2W 3L 3W abbreviations instead

## Bugs

- blank letter should be CAPS after selecting

## Follow-ups

- Acquire and Rail Baron already report turns server-side but have no client
  opt-in UI yet — client-only work to extend notifications to them.
