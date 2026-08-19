# Lobby UI extraction — by-hand pass

**Date:** 2026-08-12
**Branch:** `chore/lobby-ui-extraction`
**Built bundle** via `npm run preview` — which this branch had to fix first — against a private
server on `PORT=3002` with its own `GAMES_DIR`, so nothing touched the server another shell had
on 3001.

**Why by hand:** the move is verified structurally by 830 unchanged tests, but jsdom reports zero
for all layout, so a moved component can pass every assertion while looking broken. `verify:layout`
drives pass-and-play only — none of these screens are on its path, and none ever have been.

## Screens reached

| Component | How | Result |
|---|---|---|
| `LobbyCard` | `/online` | "Play Online — Create Room / Join with a code" |
| `RoomLobby` | Create Room | Seat row with the game-injected 🦊 emoji, `HOST` badge, "Waiting for another player" |
| `ShareRoomButton` | In the room | "Share link" present next to the room code |
| `JoinRoomCard` | `/online/join` | "Join Room — Enter or paste code below", Room code + Your name, Join disabled until a code is typed |
| `RoomGone` | `/room/ZZZZZZ` | "This room is no longer available — ZZZZZZ has ended, or the server restarted and did not keep it." |
| `ConnectionStrip` | Killed the server under a live room | "Can't reach the server — retrying", above the room, which stayed rendered |

All six render correctly and are not visually broken. The seat emoji still arrives from the game
rather than the lobby, which is the injection point the extraction depends on.

## Screens not reached

Recorded rather than faked, per the plan.

- **`RoomRefused`.** Needs an actual refusal — a join rejected by a room that exists — not merely
  an absent room, which produces `RoomGone` instead. Reaching it wants a started game plus a
  second identity, and both browser tabs here share one profile and therefore one stored identity.
  Same limitation as the React 19 pass.
- **`StaleClient`.** Needs a protocol-version mismatch between client and server. There is no way
  to provoke one without editing `PROTOCOL_VERSION`, which this branch must not touch.

Both are still exercised by their unit tests (`StaleClient.test.tsx` moved with them and passes).
What is unverified is only how they *look* after the move — and neither has any layout of its own
beyond the shared card, which `RoomGone` did exercise.

## Note on the preview fix

The branch's first commit exists because `npm run preview` could not serve this project's build at
all. Measured before and after on the same asset URL:

- **before:** `200`, **2636 bytes** — the SPA fallback returning `index.html`
- **after:** `200`, **358046 bytes** — the actual bundle

Fixed through Vite's `isPreview` in `vite.config.ts` rather than by adding `--base` to the preview
script. The script version was written first and reverted: it would have put a **second copy of the
base path** in `package.json`, and `basePath.ts` exists precisely because that path has already
lived in three places. `npm run dev` still serves at `/` — checked, not assumed.
