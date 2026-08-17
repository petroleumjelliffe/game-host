#!/bin/sh
# Start Rail Baron's game server with its saves in this repo's saves/
# directory rather than the game repo's working-directory-relative default —
# a service has no useful working directory, and save data is hosting state,
# not game source. See README.md ("Save data").
set -eu

RAILBARON="$HOME/Developer/railbaron"
GAMES_DIR="$HOME/Developer/game-host/saves/railbaron"
export GAMES_DIR

mkdir -p "$GAMES_DIR"
cd "$RAILBARON"
# `serve` builds the client then starts the server, which hosts pages,
# assets and sockets from port 4001 as one process.
exec npm run serve
