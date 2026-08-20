#!/bin/sh
# Start every game as one process: pages, assets, sockets and the generated
# menu, all on port 4000.
#
# Replaces start-railbaron.sh, start-acquire.sh and start-marcopolo.sh, which
# ran three servers on 4001-4003 against three separate clones. The games live
# in this repo now, so this script has one directory to be in.
set -eu

# Overridable only so these scripts can be rehearsed in a worktree before
# they are trusted on the machine everyone plays on. launchd hands agents a
# bare environment, so the agent always takes the default.
GAME_HOST="${GAME_HOST:-$HOME/Developer/game-host}"

# One directory for every game's saves; apps/host creates and allocates a
# subdirectory per game beneath it (railbaron/, acquire/ — Marco Polo persists
# nothing and gets none).
#
# Absolute, not relative, and that is the oldest lesson in this repo: a service
# has no useful working directory — it is wherever the plist says — so a
# relative path resolves somewhere nobody chose and every saved room appears to
# have vanished at once.
#
# The subdirectory names are the ones the three retired scripts already
# created, so this finds every existing room with nothing to migrate. (Render
# was not so lucky: its disk said games/, the pre-deploy mv meant to rename it
# could not see the disk at all, and its pre-cutover rooms were abandoned
# rather than moved -- 2026-08-20. Nothing on this machine was at risk.)
DATA_DIR="$GAME_HOST/saves"
export DATA_DIR

mkdir -p "$DATA_DIR"
cd "$GAME_HOST"

ARTIFACT="apps/host/dist/main.mjs"

# Building is deploy.sh's job now, not this script's, and moving it out is the
# entire point of compiling.
#
# This script used to run `npm run build` and only then start the server, so
# the build happened *after* the old process was already gone: 2.3s of measured
# downtime on every deploy and every unattended restart, against 0.6s for the
# start alone. The reasoning for putting it here was sound — "a service
# restarted after a `git pull` should serve the code that was pulled, not
# whatever dist happened to be lying around" — and it is served better by
# building *before* stopping anything, which is what deploy.sh does.
#
# What is left is a floor, not a build step: a fresh clone has no artifact, and
# an agent that crash-looped on a missing file would be a worse first
# experience than a slow first boot. It runs once, and never again on this
# machine.
if [ ! -f "$ARTIFACT" ]; then
	echo "No $ARTIFACT — building it once. Deploys should run ./deploy.sh instead."
	npm run build
fi

# `exec node`, not `exec npm run …`, and the difference is visible from
# launchd.
#
# Under `npm run start:host` the agent's process tree was sh -> npm -> tsx ->
# node, and launchd tracked the npm at the top. That mattered on 2026-08-20,
# when a `pkill -f "tsx apps/host/main.ts"` aimed at a worktree's test server
# matched the *agent's* tsx wrapper instead, and the front door served 502
# until somebody noticed: tsx treats SIGTERM as a graceful shutdown and exits
# 0, npm faithfully reports that 0, and `KeepAlive`/`SuccessfulExit: false`
# reads a clean exit and stays down. Reproduced under a scratch launchd agent
# rather than guessed at.
#
# There is now one process and no wrapper, so the PID launchd tracks is the
# server itself, and a `pkill -f tsx` cannot match it at all. A SIGKILL or a
# crash now restarts the agent — also verified. A SIGTERM still does not, and
# that is correct rather than a gap: `launchctl bootout` stops a service by
# sending SIGTERM, apps/host/main.ts handles it by draining and exiting 0, and
# nothing can tell a deliberate stop from a stray `kill` without breaking the
# deliberate one.
#
# --enable-source-maps costs 26ms of the ~180ms boot and buys stack traces that
# name the TypeScript that was written rather than offsets into a bundle.
exec node --enable-source-maps "$ARTIFACT"
