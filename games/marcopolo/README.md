# Marco Polo

A same-room party game: everyone on their own phone, one player blind.
Marco shouts (a button), the polos are forced to shout back, and every
shout is a ripple that gives a position away. Catch someone and they're
Marco next. The pool shrinks, so nobody hides forever.

Design: `docs/superpowers/specs/2026-08-14-marco-polo-design.md`.

## Run it

    npm install
    npm run dev:all

The server prints a LAN URL (`http://<your-ip>:7933/marcopolo/`); phones on
the same Wi-Fi open it, one creates a pool, the rest scan the QR. 3–8 players.
Ports come from the cross-game registry in the sibling `game-host` repo's
PORTS.md — Marco Polo's slots are server 4003, dev client 7933.

Hosted: `npm run build && npm start` — one process on 4003 serves pages,
assets and sockets at `/marcopolo/` (and behind the game-host front door,
`http://<host>/marcopolo/`). Health answers at `/health` and
`/marcopolo/health`.

## Layout

    protocol/      game half of the wire — constants, tuning, message types
    server/sim/    pure simulation: movement, turbo, shrink, calls, catches
    server/        rooms, role-filtered snapshots, socket handlers, app
    client/        React + canvas: tile shader, swimmers, deck screens
    vendor/lobby   rooms/seats/tokens/presence — git submodule, compiled here

The look comes from the Claude Design project *Minimalist Marco Polo game*
(`Tile Concepts.dc.html`): a WebGL tile floor with four skins, ring-and-emoji
swimmers, and a tiled "pool deck" carrying the controls before the game
starts. The arena is still a circle drawn over the tiles; the tiles are only
ever scenery.

The one invariant to know: **Marco's phone is never sent polo positions.**
Filtering happens in `server/snapshot.ts` and is asserted both at unit level
and over a real socket in `server/wire.test.ts`.

## Tests

    npm test           # vitest: node project (sim/server) + jsdom project (client)
    npm run typecheck  # both tsconfigs (server half and client half)

The vendor submodule's own tests run inside this repo's vitest, per its README.

## Not built yet (deliberately)

Audio (first follow-up — the vibe needs it), obstacles, spectator screen
(the lobby's SPECTATE button is deliberately absent until there is one),
client prediction for remote play, persistent scores.
