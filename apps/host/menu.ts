// apps/host/menu.ts
// The front page, generated from whatever is mounted.
//
// The static menu at `menu/index.html` — the one Caddy serves on the game
// machine today — is a hand-maintained list of three links. This is the same
// page with the list derived, so adding a game becomes "write the package,
// add one import to host.ts" rather than "and remember to edit the menu".
//
// The styles are copied from that file rather than imported from it: it lives
// behind the /opt/homebrew/etc/game-host symlink on the host machine, reading
// it at runtime would make this page depend on a path that exists on exactly
// one computer, and the two are meant to look the same on cutover day, not to
// share a file. If you restyle one, restyle the other.

import type { MountedGame } from '@game-host/host/contract.js';

/** Text that will sit inside HTML, from a title we control but should not trust blindly. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One link per mounted game, in mount order.
 *
 * The href keeps its trailing slash: `/railbaron` without one makes the
 * browser resolve the client's relative asset URLs against `/`, and every
 * asset 404s.
 */
export function renderMenu(games: readonly MountedGame[]): string {
  const links = games
    .map((game) => `  <li><a href="${escapeHtml(game.basePath)}/">${escapeHtml(game.title)}</a></li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game Night</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, sans-serif;
    max-width: 28rem; margin: 4rem auto; padding: 0 1.5rem;
  }
  h1 { font-size: 1.4rem; letter-spacing: 0.04em; }
  ul { list-style: none; padding: 0; }
  li { margin: 0.75rem 0; }
  a {
    display: block; padding: 1rem 1.25rem; border-radius: 0.5rem;
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    text-decoration: none; font-size: 1.1rem;
  }
  a:hover { border-color: currentColor; }
</style>
</head>
<body>
<h1>GAME NIGHT</h1>
<ul>
${links}
</ul>
</body>
</html>
`;
}
