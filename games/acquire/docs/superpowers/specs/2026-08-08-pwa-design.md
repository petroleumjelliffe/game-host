# The PWA — install it, play offline, or be a client — design

**Date:** 2026-08-08
**Status:** designed, not built
**Asked for by:** the owner — *"a PWA that can handle local games at full screen even offline, or
act as a client for online games."*
**Plan:** [../plans/2026-08-08-pwa.md](../plans/2026-08-08-pwa.md)

## Why it can be built now

The roadmap staged this behind two prerequisites and both exist:

- **Pass-and-play persists** (Stage 2) — one game per device in `localStorage`, written at every
  segment close. Without it "offline" would mean a game that dies on the first refresh.
- **The wire is versioned** (Stage 1, now `PROTOCOL_VERSION = 3`) — and this is the one that
  matters. **Caching is what makes an old client durable.** Today a stale client fixes itself on
  the next reload; after a service worker it does not, and version skew presents as a game bug.

## What it is, stated as the honest target

Two modes, and the split is the whole design:

| | Offline | Online |
|---|---|---|
| **Pass & Play** | **Works completely.** Shell from cache, game from `localStorage`. | Works. |
| **Online rooms** | **Cannot work, and says so plainly.** The server is the authority (Phase 3a); there is no local rules engine to fall back on because the client deliberately does not hold one. | Works. |

The roadmap already put it well: the honest first target is *"pass-and-play works offline, online
tells you it is offline"* — not *"the app works offline"*. Anything else would be a lie the
architecture cannot back.

## Rulings (owner, 2026-08-08)

| Question | Ruling |
|---|---|
| Display mode | **`standalone`** — app window, no browser chrome, OS status bar kept. iOS ignores `fullscreen` and treats it as standalone regardless, so `fullscreen` would differ only on Android and only by hiding the clock. |
| Update activation | **Next launch, plus an explicit `Update now`.** New assets install in the background and take over when the app is next opened. Never mid-game. |
| The phone view | **Not in this plan.** The roadmap ruled they be planned together; that is superseded. The layout is already responsive to 768px and the phone view depends on the spectator seat, which is also unbuilt — bundling all three would make the deliverable three design passes wide. |

## The parts

### 1. Manifest and icons — with one rule

`display: standalone`, `start_url` and `scope` both `/acquire-startups-m1/` (the GitHub Pages base
path, which `vite.config.ts` already sets on build — get it from there, do not type it twice), and a
maskable icon set.

**Colours come from `tokens.ts`, generated, never transcribed.** This is not tidiness: the Aqua
Titanium reskin rewrites that palette, and a manifest carrying hand-copied hex would silently keep
the old theme colour after the reskin lands, on installed devices, where it is hardest to notice.
A generator makes the reskin's palette change flow through for free — and it is what keeps these
two workstreams from fighting over the same file. See "Working alongside the reskin" below.

### 2. A service worker for the shell

Precache the built shell: `index.html`, the main JS/CSS chunks, icons, manifest.

**`/catalog` and `/scenarios` are not in the deployed client at all** (owner, 2026-08-08: *"for
testing only — shouldn't be available in the deployed clients"*). They are already lazily routed;
the ruling upgrades that to **dev-only routes**, guarded by `import.meta.env.DEV`, which Vite
replaces with `false` on build — so the routes disappear *and their chunks are never emitted*,
golden data included. This is the client-side twin of the server's `/dev/rooms`, which already
registers only outside production, and it strengthens `npm run check:bundle`'s guarantee from
"not in the main chunk" to "not in the build". The precache question then answers itself: there is
nothing to exclude.

One consequence to accept knowingly: **the layout gate's waiting-panel checks read `/catalog`**, so
`verify-layout.mjs` must keep driving a dev server (it already does — it spawns `npx vite`, not a
preview of the build). And any future by-hand pass against *prod* loses `/scenarios` as a shortcut;
seeding a prod room stays possible only through means that never ship, which is the point.

Runtime strategy: **network-first for the document, cache-first for hashed assets.** Vite's hashed
filenames make cache-first safe for assets by construction.

Nice side effect the roadmap noted: the shell paints while the socket is still waking, which makes a
Render cold start less visible. Worth less than it did — the service is on `starter` and does not
sleep — but still true after a deploy restart.

### 3. Offline, and telling the truth about it

- `/pass-and-play` and its game route: fully functional offline. This should need **no new
  application code** — persistence already exists and the engine is local. That claim is a
  *prediction*, and the plan verifies it rather than assuming it.
- `/online`, `/online/join`, `/room/:id`: reachable, and honest. There is already correct wording
  for the device-offline case — `No network — waiting for this device to reconnect`, observed in
  the prod pass — so the offline story reuses it rather than inventing a second vocabulary.
- The mode chooser must not offer Online as though it will work. Disable it with a reason, rather
  than letting a player walk into a dead end.

### 4. The update path — the part that is not routine

A cached client is a *durable* client, so this is where the protocol version earns its place.

Two distinct events, and they must not be conflated:

1. **New assets available** (the service worker found a new build). Not urgent. Install in the
   background, activate on next launch.
2. **The protocol refuses this client** (`versionMismatch`). Urgent and terminal — `StaleClient`
   already exists for exactly this. Its reload must now get **past the worker**: an ordinary
   `location.reload()` can be served the cached shell again, which would loop.

`StaleClient` gains an `Update now` that unregisters the waiting worker, clears the shell cache and
reloads. **This is the single riskiest line in the feature** — get it wrong and an installed client
can wedge itself permanently, with no way back short of the user deleting the app. It gets its own
task and its own by-hand verification.

## What could go wrong, written down before it does

- **A wedged install.** The failure above. Verified by hand, on a real installed app, by shipping a
  protocol bump and taking the update.
- **A stale shell against a new server.** What the whole update path exists for.
- **iOS is not Chrome.** `apple-mobile-web-app-*` tags still matter, install is via Share → Add to
  Home Screen with no prompt, and `localStorage` in an installed iOS PWA has been evicted by the
  OS under storage pressure historically. Pass-and-play persistence resting on `localStorage` is
  therefore *less* durable on the platform most likely to install this. Worth knowing; not worth
  solving here.
- **Testing a service worker is not like testing a component.** jsdom has no worker. The gates that
  matter here are a real browser and a real install.

## Working alongside the Aqua Titanium reskin

Both are queued and may run in parallel. They overlap in exactly three places:

| File | PWA does | Reskin does | Resolution |
|---|---|---|---|
| `src/game/tokens.ts` | **reads** it to generate manifest colours | **rewrites** the palette | No conflict by construction — the PWA adds a generator, the reskin edits values. This is the reason for the "generated, never transcribed" rule above. |
| `src/game/online/StaleClient.tsx` | adds `Update now` | may restyle it in its Task 8 sweep | Real conflict, small. Whoever merges second reapplies. |
| `src/styles/index.css` | untouched | adds `@import './aqua.css'` | None. |

Everything else is disjoint: the PWA lives in `index.html`, `public/`, `vite.config.ts` and a new
`src/pwa/`; the reskin lives in `src/game/**` and `src/styles/`.

**Order, if they run one after the other:** reskin first is marginally better — the manifest
generator then picks up the final palette on its first run, and nobody has to remember to
regenerate. Neither order is blocking.
