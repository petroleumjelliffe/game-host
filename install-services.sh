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
  # ...and it returns before launchd has finished tearing the job down. A
  # bootstrap landing in that window fails with "Input/output error" (5) and
  # installs nothing, which on a machine with one agent means every game is
  # down until someone notices. Ran that way on the game machine 2026-08-20:
  # the front door served 502 until the bootstrap was retried by hand.
  #
  # So wait for the label to actually disappear. `launchctl print` on an
  # absent label exits non-zero, which is the only reliable signal launchctl
  # offers — `list` greps are prefix-matchy and lie about near-neighbours.
  waited=0
  while launchctl print "gui/$UID_N/$name" >/dev/null 2>&1; do
    waited=$((waited + 1))
    if [ "$waited" -gt 100 ]; then
      echo "warning: $name still loaded after 10s; bootstrap may fail" >&2
      break
    fi
    sleep 0.1
  done
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
