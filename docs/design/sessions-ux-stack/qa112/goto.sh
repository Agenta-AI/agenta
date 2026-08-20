#!/bin/bash
# goto.sh <local|prod> <path fragment after the project base>
#
# Navigates by setting location from INSIDE the page, then polls for the landed path.
#
# Use this, NOT `browse goto`. `browse goto` blocks for a full document load and the local dev
# build routinely blows its 15s timeout, which kills the daemon connection and costs about a
# minute of recovery per navigation. Setting location in a detached task returns immediately, so
# the wait is ours to control.
#
# The SPA also aborts cross-route navigations (`net::ERR_ABORTED`) often enough that an early pass
# silently re-read the SAME playground page four times and produced a bogus "the nav differs"
# finding — hence the assert on the landed path rather than a blind sleep.
source "$(dirname "$0")/env.sh"
ENV="$1"; PATHFRAG="$2"
BASE=$(base_for "$ENV")
[ -z "$BASE" ] && { echo "usage: goto.sh <local|prod> <path>"; exit 1; }

use_tab "$ENV" || { echo "  !! no $ENV tab"; exit 1; }
$B js "setTimeout(function(){location.href='$BASE$PATHFRAG'},0);'nav'" >/dev/null 2>&1
for _i in $(seq 1 30); do
  sleep 2
  GOT=$($B js "location.pathname" 2>/dev/null | tail -1 | tr -d '"')
  case "$GOT" in *"$PATHFRAG") echo "  OK   $ENV $PATHFRAG"; exit 0 ;; esac
done
echo "  MISS $ENV wanted '$PATHFRAG', got: $GOT"; exit 1
