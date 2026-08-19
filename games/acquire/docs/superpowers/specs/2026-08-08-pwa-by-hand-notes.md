# The PWA — what was actually driven, 2026-08-08

**Branch:** `revamp/pwa`. **Driven by:** Claude over CDP against a real Chrome, on a
GH-Pages-shaped mount (`dist/` symlinked under `/acquire-startups-m1/`, python http.server).
Not an installed app — see "Still owed".

## Driven and observed

**The dev routes are really gone from a production build.** `/catalog` on the built app renders
nothing and fetches nothing; the build dropped from four JS chunks to one; `check:bundle`'s new
golden-title grep went red when the `DEV` guard was removed and green when restored.

**The manifest is real and self-consistent.** Fetched from the page: `display: standalone`,
scope/start_url under the base path, `theme_color` equal to the token *and* to the meta tag, all
three icon srcs resolving relative to the manifest URL. The icon is the game's tile — looked at,
not assumed: the first render had a tiny serif "A1" from an invalid `font:` shorthand.

**The worker's ruled lifecycle, watched happen.** Register → 8 files precached under a
content-hash cache name. One shipped line changed and rebuilt → the new worker sat **waiting**
while the old controlled, both caches present. Leave and return ("next launch") → activated, old
cache pruned to exactly one.

**Offline, proven the honest way.** CDP's offline emulation turns out not to apply to the
worker's own fetches — the first "offline" pass was quietly fetching through the worker. The real
test **killed the static server**: a deep-link navigation was served the cached shell, the
Continue card rose from `localStorage`, and Continue resumed the exact saved game (same draw,
same hand). Offline pass-and-play needed **zero new app code**, as the design predicted — the
verification was of the prediction, not the code.

**Both update paths.** Background: the mode chooser showed "Update ready — restart the app" with
a worker waiting; pressing it reloaded via `controllerchange` and pruned to the new cache. Forced
(`StaleClient` → `forceUpdateAndReload`): unregister → clear caches → reload left a re-registered
worker, a fresh 8-file precache, and a live app.

## Found and fixed along the way

1. **Navigation fallback passed a host 404 through.** The handler only fell back on a *thrown*
   fetch; a static host with no SPA fallback answered a deep link with 404 and the worker shipped
   it to the player. Now falls back to the cached shell on non-ok responses too.
2. **Cache-clearing alone loses offline until the next deploy.** An active worker's `install`
   never re-runs, so clearing its cache left nothing and nobody to refill it — observed live:
   `caches.keys()` empty after the recovery reload. `forceUpdateAndReload` now **unregisters**,
   so the reload re-registers and a fresh install repopulates.
3. **`.replace()` vs template comments, twice in one day.** The theme-colour placeholder and the
   precache placeholder were each first substituted *in the comment that named them*, leaving the
   real site untouched. House rule now in CLAUDE.md: `replaceAll`, and prose never names
   placeholders.

## Still owed — the hard cutoff

**The update path on a real installed app against a real protocol bump.** Everything above ran in
a browser tab; installation changes the lifecycle (no tab to close, OS-managed relaunch) and iOS
differs again. Zero installs exist today, so nothing can wedge — but a broken updater is the one
bug that survives its own fix being deployed. That drive happens **before the app is handed to
anyone**, per the owner's recorded deadline. Also untested: a real phone (the offline drive used
desktop Chrome), and iOS's historical eviction of `localStorage` under storage pressure, accepted
as a known weakness in the design.

## Addendum: the protocol-bump update drama, driven locally (same day)

The owner asked for the version-bump path to be tested before any deploy, and it was — twice,
because the first run found a bug.

**The stage:** a production build served worker-style on the Pages-shaped mount, pointed at a
local game server (`VITE_SERVER_URL` override at build; the first attempt silently tested against
*real prod* because `.env.production` bakes the Render URL into every default build — worth
remembering). Client cached at protocol N, sitting in a real room it created.

**The drama, as it would happen in prod:** the server deploys N+1 → the restart drops the socket →
the reconnect offers N and is refused → `StaleClient` appears mid-room. The client fix deploys.
The player presses **Reload to update** once → lands on the mode chooser running the new client,
worker re-registered, all 8 files re-cached.

**What the first run found:** the recovery reloaded the *deep room URL* after unregistering the
worker — leaving nothing to serve an SPA route except the host's fallback. GH Pages has one
(404.html); the test mount did not, and the recovery landed on a bare 404. Fixed: the button now
navigates to the app root, which is a real file on any host. The player's seat survives in
localStorage; one join re-seats them.

**Still untested, unchanged:** the same drama on a *real installed app* (no tab to close,
OS-managed lifecycle, iOS) — that needs the deploy, and remains the cutoff before the app is
handed to anyone. The phone cannot test any of this from a LAN dev URL: no secure context, no
worker, no offline.
