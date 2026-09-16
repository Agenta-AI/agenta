#!/bin/sh
# Start the runner server as an UNPRIVILEGED user that nonetheless holds CAP_SYS_ADMIN.
#
# Why this exists. The runner starts each local session's agent daemon inside its own mount
# namespace (scripts/session-mount-namespace.sh) so that one session cannot reach another
# session's drive. Creating a mount namespace needs CAP_SYS_ADMIN. The compose files give the
# CONTAINER that capability, but an image that declares `USER node` hands its process no
# capabilities at all, so the runner could not use it.
#
# Running the server as root would supply the capability, at the price of making every directory
# the runner creates root-owned while the agent still runs as `node` — which breaks the agent's
# access to its own workspace, its skills, and its Pi agent directory. Ambient capabilities give
# the capability without the uid: they survive execve, so the server keeps CAP_SYS_ADMIN while
# running as exactly the same unprivileged user as before, and no file ownership changes.
#
# Usage: runner-entrypoint.sh <user> <command> [args...]
set -eu

target_user="$1"
shift

# A container that is already unprivileged cannot grant itself a capability. This is the ordinary
# case for the documented subscription self-host scheme, which overrides the compose `user:` with
# the operator's own uid. The session prelude detects the missing capability and says so, in full,
# before starting the session without mount isolation.
if [ "$(id -u)" != "0" ] || [ -z "$target_user" ]; then
    exec "$@"
fi

target_group="$(id -gn "$target_user")"

# --inh-caps is required for --ambient-caps: a capability can only be made ambient while it is in
# both the permitted and the inheritable set. Only SYS_ADMIN is carried; everything else is
# dropped by the uid change.
# Probe the exact grant in a disposable child. A root container may lack SYS_ADMIN.
if ! setpriv --reuid="$target_user" --regid="$target_group" --init-groups \
    --inh-caps=-all,+sys_admin --ambient-caps=-all,+sys_admin true 2>/dev/null; then
    exec setpriv --reuid="$target_user" --regid="$target_group" --init-groups \
        --inh-caps=-all --ambient-caps=-all "$@"
fi
exec setpriv \
    --reuid="$target_user" \
    --regid="$target_group" \
    --init-groups \
    --inh-caps=-all,+sys_admin \
    --ambient-caps=-all,+sys_admin \
    "$@"
