# `@game-host/pwa`: one PWA machine, per-game apps

**Status:** designed 2026-09-01; planned and implemented 2026-09-07 via
[docs/plans/2026-09-07-shared-pwa.md](../docs/plans/2026-09-07-shared-pwa.md).
See "As built" at the end for deltas.
**Home:** this repo — the design extracts acquire's hand-rolled PWA into a
shared workspace package so every game gets install, offline shell, update
flow, and push with a config object rather than a reimplementation.
Companion to [2026-09-01-email-invites-and-seat-keys.md](2026-09-01-email-invites-and-seat-keys.md):
the seat key that spec introduces is what carries identity into installed
apps (see the iOS note below), and the key-landing moment is the natural
push-enrollment prompt. Soft dependency only — this package is useful
without it.

## The property being bought

Three games, three installable apps, **one implementation** of everything
that is not game identity: manifest generation, service worker build,
content-hash cache busting, update detection, the stale-client remedy, and
push handling. Backporting notifications to a game becomes configuration;
and once installed, an app is **never re-added to the home screen** — every
change ships through the service-worker update flow.

Per-game apps on one origin is exactly the platform's scoping model:
manifests and service workers scope by *path*. A manifest with
`scope: "/wordgame/"` and a worker registered at `/wordgame/sw.js` control
only `/wordgame/*`; acquire's live alongside untouched. Each game is
separately installable with its own icon and name, one game's worker can
never intercept another's pages, and — since each game already builds under
its base path and serves its own static assets — adding a PWA to a game
touches **no host, Caddy, or front-door configuration**, which is the
composition rule holding.

The identity layer splits the other way, and that is the sharing we want:
localStorage is origin-scoped, so `notify.key` and `lobby.name` are already
one profile across all games in a browser. Path-scoped apps, origin-scoped
person.

**No root-scoped PWA for the menu.** A worker at `/` would overlap every
game's scope (longest-match wins, but the overlap invites exactly the
cross-game confusion the isolation avoids), and the menu needs neither
offline nor push.

## Current state

Acquire's PWA is entirely hand-rolled — no `vite-plugin-pwa`, no workbox
(`games/acquire/docs/superpowers/specs/2026-08-08-pwa-by-hand-notes.md`
records why) — and already generic in all but a handful of literals:

- Two inline Vite plugins (`games/acquire/vite.config.ts`): placeholder
  substitution into `index.html` (theme color, base — with the load-bearing
  `order: 'pre'` workaround for Vite 7's dev HTML hook), and
  `sw-from-build`, which derives the precache list from the emitted files
  at `closeBundle` and names the cache from a **content hash of every
  precached file** — the upgrade check with no version string to maintain.
- `scripts/sw.template.js`: precache on install with **deliberately no
  `skipWaiting()`** — next-launch activation so a new worker never swaps
  assets under a live game; the user-initiated `SKIP_WAITING` message is
  the only override. Navigations network-first with cached-shell fallback;
  hashed assets cache-first; socket traffic untouched.
- `src/pwa/`: `register` (prod-only, `BASE_URL`-normalized),
  `useUpdateReady` (waiting-worker detection → "update ready" button),
  `forceUpdateAndReload` (the nuclear remedy: unregister, then delete
  caches, then navigate to app root — ordering documented and learned the
  hard way), `isInstalledApp`, `useOnline`.
- `scripts/generate-manifest.ts` at prebuild, currently importing acquire's
  tokens and base path directly.

The version-matching half needs **no extraction — it is already shared**:
`protocolVersion` stamping, the `versionMismatch` rejection, the `stale`
terminal state, and the conformance test all live in `@game-host/lobby`.
Games supply one constant. Acquire contributes only the SW-aware remedy
(`forceUpdateAndReload` wired into `StaleClient`) — that pairing is what
moves.

Wordgame has a different, minimal SW: push-only, no precache, committed by
hand, and it *does* `skipWaiting()`. Its `register.ts` is a near-verbatim
copy of acquire's. Railbaron has nothing. Acquire duplicates `useOnline`
locally in `ConnectionStrip` — fold that in while passing.

## The design

One new workspace package, `packages/pwa` (`@game-host/pwa`), two halves.

### Build half (consumed from each game's `vite.config.ts` and prebuild)

- The two Vite plugins, parameterized on: cache-name prefix, theme color,
  base path, precache filter, and the manifest config.
- `sw.template.js`, extended with **push and notificationclick handlers
  built in** — one scope gets one worker, so the shared worker must do
  both jobs. The handlers are inert in a game that never registers with
  notify, so they cost nothing to always include.
- The manifest generator, taking a config object (name, short name,
  description, colors, icons, display, orientation) instead of importing
  game tokens. Icon *generation* stays per-game — art is identity.

**The merge decision, ruled acquire's way:** no `skipWaiting()`. Wordgame
adopting the shared template gains the offline shell and gives up
insta-activation — the right trade for multi-day games, where a worker
swapping content-hashed assets under a live session is exactly the failure
the next-launch rule exists to prevent.

**Dropped in transit:** the GH Pages 404-redirect shim in acquire's
`index.html`. That hosting story is retired.

### Client half

`register`, `useUpdateReady`, `forceUpdateAndReload`, `isInstalledApp`,
`useOnline` move essentially as-is (they only touch `BASE_URL`), plus the
UI that pairs with them: `StaleClient` (copy already game-neutral, themed
via the existing `--lobby-accent` CSS-var seam) and an extracted
`UpdateReadyButton` (currently inline in acquire's HomePage, gated on
`isInstalledApp && update.ready` — in a tab it's noise; keep that gate).

### The install-identity invariant

"Never re-add to home screen" is bought by keeping each manifest's
**`scope`, `start_url`, and `id` stable forever** — the installed icon is
bound to those; everything behind them updates through the worker flow.
Treat these three fields as append-only configuration, on par with "Caddy
never strips the prefix." The generator should make changing them feel
deliberate (a comment in the config, not a hidden default).

### Push subscriptions are per-scope: tag them

A push subscription belongs to the service worker that minted it, so it is
inherently per-game per-device. Notify's `PushSubscriptionRecord` grows a
scope tag (the `gameId`), and the send loop routes each game's
notifications to matching-scope subscriptions. Without this, a wordgame
turn delivered through acquire's worker would open the room inside
acquire's app shell — precisely the isolation smear per-game apps exist to
avoid. (This is the one change this spec makes inside `packages/notify`.)
One deliberate exception: an *invite* prefers the target game's scope but
falls back to any subscription, because an invite is a doorway rather than
a turn and not arriving is the worse failure; see
[2026-09-02-friends.md](2026-09-02-friends.md), section 4.

### iOS, and the seat-key interlock

Two iOS facts shape the phone flow:

- Web Push works only from an installed (home-screen) app.
- **Each installed app gets its own storage bucket**, even same-origin:
  installed-wordgame, installed-acquire, and Safari cannot see each
  other's localStorage. The shared-profile assumption breaks; each
  installed app becomes its own `playerKey`, its own profile.

Under the companion spec this is fine rather than a bug: seat bindings are
a set, and the emailed `?key=` link re-establishes identity inside any
storage bucket. The flow to design toward: email link → play in browser →
"add to home screen for notifications" → open one emailed link from the
installed app once → that app's profile binds to the seat → subscribe.
The key-landing moment is also the right place for the push-enrollment
prompt on every platform: the device has just proven who it is, so "get
these as notifications on this device instead?" is one tap with context.

### Per-game adoption

Each game's footprint shrinks to: a manifest config object, its icons, two
plugin invocations, one `register()` call, and the `StaleClient`/update
button wiring. Migration order: acquire first (extraction proves itself
against the existing behaviour), wordgame second (replaces its push-only
worker — verify push still works under the combined template), railbaron
last (gains a PWA from pure configuration). Acquire's manifest gets checked
against the `/acquire` base path from the Pages-era rename while passing.

## Testing

- The package ships its own suite: template substitution, precache-list
  derivation and hashing (identical inputs → identical cache name), the
  update hooks against a mocked registration.
- Per-game: the existing build gates already boot compiled artifacts;
  extend the artifact-level pass to assert `sw.js` and the manifest exist
  under each game's base path with the right scope — the vitest/BASE_URL
  split has hidden a shipped 404 before, so this check runs against the
  built `dist`, not the dev server.
- Push routing: a scope-tagged subscription receives only its game's
  sends (fake webpush transport, record-state assertions).

## Out of scope, deliberately

- Offline *play*. The shell loads offline; a game without its socket is a
  spectator of its own cache. Nothing here pretends otherwise.
- A menu/root PWA (see above).
- Badging, background sync, periodic sync — nothing has asked for them.

## As built (2026-09-07)

Implemented as designed, with these deltas:

- **The plugins take no paths.** `swFromBuild` reads root, `outDir` and
  `base` from Vite's `configResolved` rather than a config option, so a
  game passes only `{ cachePrefix, appName }` and cannot hand the plugin a
  location that disagrees with its build.
- **`id` joined the append-only trio explicitly.** The manifests never
  declared it; the generator now requires it, set equal to `start_url` —
  the value browsers were already computing — so no existing install
  re-keys. The generator makes all three required fields rather than
  defaulting them, which is the "changing them feels deliberate" the
  design asked for.
- **StaleClient moved off tailwind.** The two games' copies differed only
  in neutral tokens a shared package can ride in neither game's tailwind
  config; the shared component is inline-styled on the `--lobby-*` var
  seam with the same fallbacks, and wordgame pins its linen surfaces via
  three variables in its own CSS.
- **The artifact-level check is each game's `postbuild`**
  (`@game-host/pwa/build/checkDist.mjs`): sw.js present with the right
  base and no surviving placeholder, the manifest trio equal to
  `<base>/`, index.html linking the prefixed manifest. It rides
  `npm run build`, which is what CI and both deploys run.
- **Untagged push subscriptions match every game** rather than being
  migrated: every pre-tag subscription was minted by wordgame's worker
  and wordgame was the only sender, so wildcard is the behaviour they
  were minted under. New enrollments are tagged (`enrollPush`,
  `syncSubscription` and `useEnrollPush` take the gameId; wordgame passes
  `'wordgame'`).
- **Railbaron's stale remedy** is its split-flap `staleClient()` screen's
  RELOAD row rerouted to `forceUpdateAndReload` — its board rows are not
  the shared React `StaleClient`, and redrawing them was not the point.
- **The key-landing enrollment prompt** already existed (`useEnrollPush`
  at wordgame's landing) and only gained the scope tag; the iOS
  install-flow copy the design sketches is untouched UI work.

An adversarial review of the first landing caught what the composition
changed underneath the moved code — code written when acquire was the
only precaching worker now shares one origin-scoped CacheStorage with
two more — and three smaller things, all fixed the same day:

- **Cache deletion is scoped by `cachePrefix`**, in the worker's
  activate prune and in `forceUpdateAndReload` alike. Unscoped, a
  wordgame deploy (or one player's stale-client recovery) deleted
  acquire's and railbaron's live precaches under their still-active
  workers, whose installs never re-run — offline shells broken until
  their next deploys. `swFromBuild` now fails the build unless the
  prefix equals the base path segment, which is what makes the client's
  BASE_URL-derived prefix sound; `checkDist` asserts it on the artifact.
- **`apple-touch-icon` is a real PNG** for wordgame and railbaron
  (acquire always had one): iOS ignores SVG for home-screen icons on
  exactly the platform where installing is the push prerequisite. The
  PNGs are committed, rendered from each game's SVG by the package's
  `rasterizeIcon.mjs`.
- **An unknown scope tag is stripped at `addSubscription`**, stored
  untagged (matches every game) with a log line — a typo'd tag would
  otherwise mint a subscription that reports enabled and receives
  nothing, ever. Wordgame's five `'wordgame'` literals became one
  `GAME_ID` constant.
- **`useUpdateReady` removes its `updatefound` listener** on unmount;
  the registration outlives every mount, so listeners must not stack.

The first live end-to-end run (2026-09-09, localhost, all three desktop
browsers) confirmed the whole send path and found the edges of one
platform:

- **Delivery and display verified everywhere**: turn pushes from the
  game reached Safari (web.push.apple.com), Chrome (FCM) and Firefox
  (Mozilla), once three environment truths were established — Apple
  rejects a placeholder `VAPID_SUBJECT` (FCM and Mozilla tolerate it),
  `tsx watch` never reloads `.env`, and macOS keeps a per-app
  notification toggle. The notify boot warning and per-send
  accepted/failed log lines added along the way are what made each
  diagnosable.
- **macOS Safari cannot open a window from a notification click** in
  the browser-tab service-worker context — a known, unresolved WebKit
  bug (their openWindow silently resolves with nothing, even called
  synchronously with the gesture fresh). The worker's click handler is
  therefore openWindow-first with a focus+navigate fallback: with any
  window of the game open, Safari lands the player in the room; with
  none, the click raises Safari and stops. Chrome and Firefox honour
  openWindow outright; the installed-app context is a different WebKit
  path expected to honour it as well.

One trigger change followed the live run (owner ruling, 2026-09-09):
**push is immediate and presence-blind; email keeps the debounce.** A
push to a player already looking at the board is a one-click way into
the tab — the same email is noise — so `turnChanged` now sends the push
leg at once (markers written there, same crash-skips discipline) and
arms the debounce for the email leg alone, which still re-checks
presence at fire time. The 24h reminder stays dual-channel and
presence-checked. *(2026-09-10: there is no 24h reminder any more; a
player's Nudge — dual-channel, not presence-checked — replaces it. See
[docs/plans/2026-09-10-turn-nudge.md](../docs/plans/2026-09-10-turn-nudge.md).)*
