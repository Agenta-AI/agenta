#!/bin/bash
# keepalive.sh <minutes>
#
# Pokes the daemon on a slow cadence so a long gate (a `pnpm lint-fix`, a dev-build recompile, a
# live agent run) doesn't end with the browser in one of its "running but not responding" windows
# and cost a minute of recovery. Run it BACKGROUNDED alongside the long thing.
#
# It only reads `url`; it never switches tabs, so it cannot steal the tab you are driving.
source "$(dirname "$0")/env.sh"
MINS="${1:-10}"
END=$(( $(date +%s) + MINS * 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  $B url >/dev/null 2>&1
  sleep 20
done
echo "keepalive done (${MINS}m)"
