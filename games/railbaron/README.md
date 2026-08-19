railbaron
=========

A destination-roller companion for the Avalon Hill board game *Rail Baron*. You play on
the physical board; the app rolls each baron's next destination and works out the payout.

```bash
npm install
git submodule update --init --recursive   # vendor/lobby, needed by the server

npm run dev        # client only, http://localhost:7931/railbaron/
npm run dev:all    # client + game server, for online mode
npm test
```

Online mode needs both halves running. Ports come from the cross-game registry in
the sibling `game-host` repo's `PORTS.md` — Rail Baron's slots are server 4001,
dev client 7931 — and live in exactly three places: that registry, the server's
boot default, and `vite.config.ts`. No client code names a host or port.

The client is origin-relative: pages, assets and sockets all ride the origin of
the page you loaded, with sockets mounted at `/railbaron/socket.io`. In dev,
Vite's proxy carries that one path to the game server on 4001; hosted (`npm run
serve`, or behind the game-host front door), the game server answers it itself.
A phone on the same wifi works for free — its origin is whatever page it loaded.
Health answers at `/health` and `/railbaron/health`.

A build that sets `VITE_SERVER_URL` wins outright: sockets go to that server at
socket.io's default path, because that server owns its whole origin. To move the
server port for a one-off, put `VITE_SERVER_PORT=<port>` in `.env.local`
(gitignored) and point `vite.config.ts`'s dev proxy target at the same port;
`PORT` still overrides.

Built for a tablet in landscape, and deployed to GitHub Pages on every push to
`main` — the suite and the typecheck gate the deploy, because a companion that
is wrong about a payout is worse than one that is down.

**v1.0.0 is the companion release.** You play Rail Baron on the physical board;
this rolls each baron's destination, works out what the journey pays, and shows
the network. It does not model movement, railroad ownership or cash — see
[ROADMAP.md](ROADMAP.md) for what comes next.
