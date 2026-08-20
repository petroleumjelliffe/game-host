#!/bin/sh
# Start every game as one process: pages, assets, sockets and the generated
# menu, all on port 4000.
#
# Replaces start-railbaron.sh, start-acquire.sh and start-marcopolo.sh, which
# ran three servers on 4001-4003 against three separate clones. The games live
# in this repo now, so this script has one directory to be in.
set -eu

GAME_HOST="$HOME/Developer/game-host"

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

# Build then serve, as start-railbaron.sh did with `npm run serve`: a service
# restarted after a `git pull` should serve the code that was pulled, not
# whatever dist happened to be lying around. Costs a few seconds at boot.
npm run build
exec npm run start:host
