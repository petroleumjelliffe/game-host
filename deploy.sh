#!/bin/sh
# Deploy to the LAN: install, check, build, then restart — the tree as it
# stands. Updating the tree is not this script's job any more.
#
# It was, until 2026-08-20: this script opened with `git pull --ff-only`, and
# was the whole deploy command. The pull moved to hooks/post-merge (installed
# by install-services.sh), so on the game machine `git pull` *is* the deploy —
# the hook runs this script the moment the merge lands, and there is no second
# command to forget. Running this by hand still works and still means what it
# says: deploy whatever is checked out, e.g. to rebuild without new commits.
#
# The order is the rest of the design. Everything that can fail happens while
# the old version is still serving, and the only line that interrupts anyone
# is the last one. Before this script existed the agent built at boot, so a
# broken build was discovered by the front door returning 502 — the old
# process was already gone by the time anything could go wrong.
#
# Run it on the game machine, from the game machine's clone. Deploying to
# Render is a `git push`; the service rebuilds itself. See README's Deploying.
set -eu

# Overridable so the pull-install-build half can be rehearsed from a worktree.
# Note that it does not make this script safe to run there: the restart below
# names the one agent by label, and that agent serves production.
GAME_HOST="${GAME_HOST:-$HOME/Developer/game-host}"
cd "$GAME_HOST"


# Every deploy, not only when package.json changed: `npm install` is a no-op
# in a few hundred ms when nothing moved, and the failure it prevents — a
# lockfile that grew a dependency the build now needs — is a build failure
# with a confusing message.
echo "==> installing"
npm install

# Typechecks first (that is what the root build script does), so a type error
# fails the deploy instead of shipping. It could not live here until the build
# left the service start path: 9s of tsc in front of every restart would have
# turned a 2.3s outage into an 11s one. Here it costs nothing anyone can see.
#
# This does republish the clients before the server restarts, so a page loaded
# a moment ago can 404 on its next lazy chunk for a few seconds. That was
# already true — Vite deletes the old content-hashed assets either way — and
# the window is shorter now than when the build ran with the server down.
echo "==> building (typecheck, three clients, one server bundle)"
npm run build

echo "==> restarting"
launchctl kickstart -k "gui/$(id -u)/com.game-host"

# A deploy that says "restarting" and stops has told you nothing. Poll until
# the front door answers, so the last line of output is the answer to the only
# question anyone actually has.
echo "==> waiting for the front door"
i=0
while [ "$i" -lt 100 ]; do
	if curl -fsS -o /dev/null http://localhost/health 2>/dev/null; then
		echo "==> up:"
		curl -sS http://localhost/health
		echo
		exit 0
	fi
	i=$((i + 1))
	sleep 0.1
done

echo "==> STILL DOWN after 10s. What the agent said:" >&2
tail -n 30 /opt/homebrew/var/log/game-host.log >&2
exit 1
