#!/bin/sh
# Build Marco Polo's client, then start its server: one process on 4003.
# No GAMES_DIR — Marco Polo persists nothing server-side.
set -eu

MARCOPOLO="$HOME/Developer/marco-polo"

cd "$MARCOPOLO"
npm run build
exec npm run start
