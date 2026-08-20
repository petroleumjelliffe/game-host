#!/bin/sh
# Install (or reinstall) the game servers as launchd user agents, so every
# game survives reboots and crashes the way the Caddy service does.
# Run again after editing a plist; `./install-services.sh remove` uninstalls.
set -eu

AGENTS="$HOME/Library/LaunchAgents"
UID_N="$(id -u)"

# No dot before the wildcard: the pattern used to be com.game-host.*.plist,
# back when every agent was com.game-host.<game>. The composed host's plist is
# com.game-host.plist with no middle segment, and that pattern does not match
# it — a `remove` would have retired three agents and installed nothing.
for plist in "$(dirname "$0")"/launchd/com.game-host*.plist; do
  name="$(basename "$plist" .plist)"
  target="$AGENTS/$name.plist"
  # bootout is idempotent-ish but chatty; ignore "not loaded" failures.
  launchctl bootout "gui/$UID_N/$name" 2>/dev/null || true
  if [ "${1:-}" = "remove" ]; then
    rm -f "$target"
    echo "removed $name"
    continue
  fi
  # Copied, not symlinked: launchd reads the file at bootstrap and symlinked
  # agents have a history of being silently skipped.
  cp "$plist" "$target"
  launchctl bootstrap "gui/$UID_N" "$target"
  echo "installed $name"
done
