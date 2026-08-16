# Marco Polo

A same-room party game: everyone on their own phone, one player blind.
Marco shouts (a button), the polos are forced to shout back, and every
shout is a ripple that gives a position away. Catch someone and they're
Marco next. The pool shrinks, so nobody hides forever.

Design: `docs/superpowers/specs/2026-08-14-marco-polo-design.md`.

## Run it

    npm install
    npm run dev

The server prints a LAN URL (`http://<your-ip>:5173`); phones on the same
Wi-Fi open it, one creates a pool, the rest scan the QR. 3–8 players.

Production-ish: `npm run build && npm start` (serves the built client on 3001).

## Layout

    protocol/      game half of the wire — constants, tuning, message types
    server/sim/    pure simulation: movement, turbo, shrink, calls, catches
    server/        rooms, role-filtered snapshots, socket handlers, app
    client/        React + canvas: lobby, polo view, marco (sonar) view
    vendor/lobby   rooms/seats/tokens/presence — git submodule, compiled here

The one invariant to know: **Marco's phone is never sent polo positions.**
Filtering happens in `server/snapshot.ts` and is asserted both at unit level
and over a real socket in `server/wire.test.ts`.

## Tests

    npm test           # vitest: node project (sim/server) + jsdom project (client)
    npm run typecheck  # both tsconfigs (server half and client half)

The vendor submodule's own tests run inside this repo's vitest, per its README.

## Not built yet (deliberately)

Audio (first follow-up — the vibe needs it), obstacles, spectator screen,
client prediction for remote play, persistent scores.
