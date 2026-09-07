# Plan: `@game-host/pwa`, and scope-tagged device notifications

**Status:** planned and implemented 2026-09-07.
**Spec:** [specs/2026-09-01-shared-pwa.md](../../specs/2026-09-01-shared-pwa.md) —
one PWA machine, per-game apps. This plan is the extraction the spec
designed, plus the one change it makes inside `packages/notify`
(scope-tagged push subscriptions), which is what makes device
notifications route to the right installed app.

## Shape of the change

One new workspace package, `packages/pwa` (`@game-host/pwa`), same
`./*` → `./*.ts` export map as lobby and notify. Two halves in two
directories, because they run in different worlds:

- `build/` runs under Node (a game's `vite.config.ts` and prebuild
  script): the two Vite plugin factories, the manifest writer, and
  `sw.template.js` next to them.
- `client/` runs in the browser (and jsdom): `register`,
  `useUpdateReady`/`forceUpdateAndReload`, `isInstalledApp`,
  `useOnline`, `StaleClient`, `UpdateReadyButton`.

React is a peer dependency exactly as in `@game-host/notify` — the
build half must import cleanly with no React installed at all.

## Task 1 — the build half

**`build/plugins.ts`.** Acquire's two inline plugins, parameterized:

- `pwaPlaceholders({ themeColor })` — substitutes `__THEME_COLOR__`
  and `__PWA_BASE__` (to a bare `/`, never the base path — Vite
  base-prefixes root-relative HTML URLs itself, and substituting the
  base here doubles it; acquire's config carries the full history).
  `order: 'pre'` and `replaceAll` move with it — both are load-bearing
  and both were learned the hard way.
- `swFromBuild({ cachePrefix, appName })` — reads root, `outDir` and
  `base` from `configResolved` rather than taking paths, so a game
  passes only its identity. Same derived precache list (everything
  emitted except `.map`, `sw.js`, `404.html`), same content-hash cache
  name, same `closeBundle` timing so `public/` copies are included.

**`build/sw.template.js`.** Acquire's template with wordgame's `push`
and `notificationclick` handlers appended — one scope gets one worker,
so the shared worker does both jobs; the handlers are inert in a game
nothing subscribes. The merge ruling is acquire's: **no
`skipWaiting()`** outside the user-initiated `SKIP_WAITING` message.
`__APP_NAME__` is the push fallback title (the server always sends a
title; the fallback is for a malformed payload, not a code path).

**`build/manifest.ts`.** `writeManifest(config, outFile)`, config
object only — no game imports. `id`, `scope` and `startUrl` are
**required, explicit fields**: the installed icon is bound to them, so
they are append-only configuration, and requiring them makes changing
one feel deliberate rather than a drifted default. `id` is set equal
to `start_url` for every game, which is the value browsers already
computed while the field was absent — so no existing install re-keys.

**Package tests:** placeholder substitution (including the
in-a-comment trap), precache derivation against a fixture dist,
identical inputs → identical cache name and any content change → a new
one, manifest field passthrough.

## Task 2 — the client half

`register.ts`, `update.ts`, `installed.ts`, `useOnline.ts` move
essentially as-is from `games/acquire/src/pwa/` (they only touch
`BASE_URL`). `StaleClient` is rewritten from tailwind classes to
inline styles on the **existing `--lobby-*` CSS-var seam with the same
fallbacks** — the two games' copies differed only in their neutral
tailwind tokens, and a shared component cannot ride two tailwind
configs; wordgame sets the three surface vars in its own CSS so the
screen keeps its linen look. `UpdateReadyButton` is extracted from
acquire's HomePage, keeping the `isInstalledApp() && update.ready`
gate inside it — in a tab it renders nothing.

Tests move with the code (`installed`, `StaleClient`) and
`useUpdateReady` gains one against a mocked registration.

## Task 3 — scope-tagged push subscriptions (the notify change)

A push subscription belongs to the worker that minted it, so it is
per-game per-device. Without a tag, a wordgame turn delivered through
acquire's worker opens the room inside acquire's app shell.

- `PushSubscriptionRecord` grows optional `gameId`. Optional because
  records already on disk lack it; the guard accepts absent.
- `POST /notify/subscriptions` accepts an optional `game` string and
  stamps it on the record.
- The send loop routes: **turns and reminders** go only to
  subscriptions tagged with the sending game — an **untagged (legacy)
  subscription matches any game**, because every subscription minted
  before this change is a wordgame one and wordgame is the only game
  that sends. **Invites** prefer matching-scope subscriptions and fall
  back to every subscription when none match (friends spec §4: an
  invite is a doorway; not arriving is the worse failure).
- Client half: `enrollPush`, `syncSubscription` and `useEnrollPush`
  take the gameId and pass it through; wordgame's two call sites name
  `'wordgame'`.

Tests: a scope-tagged subscription receives only its game's sends
(fake webpush transport); an invite falls back to an off-scope
subscription; an untagged record still receives turns.

## Task 4 — acquire (extraction proves itself)

Vite config drops ~90 lines for two factory calls; the prebuild
manifest script becomes a config object handed to `writeManifest`
(still reading `APP_COLORS` from tokens — the palette flow is the
point of generating). `src/pwa/` is deleted in favour of package
imports, `StaleClient` and the inline update button come from the
package. The GH Pages 404-redirect shim in `index.html` is dropped in
transit — that hosting story is retired. Behaviour must come out
identical: same placeholders substituted, same precache shape, same
manifest fields plus the now-explicit `id`.

## Task 5 — wordgame (the merge case)

`public/sw.js` and the hand-written `public/manifest.webmanifest` are
deleted. The vite config gains both plugins; a prebuild script writes
the manifest from a config object; `index.html` adopts the same
placeholder machinery as acquire (the substitution that failed here
before was Vite's *built-in* env replacement, not this plugin).
Wordgame gains the offline shell and precache, and gives up
`skipWaiting` — the right trade for multi-day games. Its RoomPage's
stale reload becomes `forceUpdateAndReload` (a plain reload behind a
precaching worker can loop on the same stale shell), and its entry
page gains `UpdateReadyButton`. Push must still work under the
combined template — the handlers are verbatim moves, and the package
test on the template asserts they are present in the emitted worker.

## Task 6 — railbaron (pure configuration)

Manifest config, new SVG icons (art is identity — a split-flap board
tile), the two plugins, PWA head links in `index.html`, one
`register()` call. Its stale screen is its own split-flap `staleClient()`
row whose action navigated home; with a worker now caching the shell,
that action runs `forceUpdateAndReload` instead.

## Task 7 — harness and gates

- `scripts/test-all.mjs`: `pwa` joins the light lane (no DOM-heavy
  suite).
- Each game's `check:bundle` (railbaron gains one) also asserts, on
  the built `dist`, that `sw.js` exists and the manifest carries the
  right `scope` — the artifact-level check the spec asks for, run
  against real build output, not the dev server.
- CLAUDE.md workspace counts and tables, README's adding-a-game
  checklist if touched, and the spec gets its As-built section.

## Out of scope, deliberately

Everything the spec's own out-of-scope list names: offline play, a
menu PWA, badging and background sync. Also the key-landing
push-enrollment *prompt placement* — `useEnrollPush` already renders
at wordgame's landing; moving that moment around is UI work the
invites checklist owns.
