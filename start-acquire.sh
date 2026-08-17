#!/bin/sh
# Build Acquire's client, then start its server: one process serving pages,
# assets and sockets on 4002, saves under this repo's saves/acquire.
set -eu

ACQUIRE="$HOME/Developer/acquire-startups-m1"
GAMES_DIR="$HOME/Developer/game-host/saves/acquire"
export GAMES_DIR

mkdir -p "$GAMES_DIR"
cd "$ACQUIRE"
exec npm run serve
