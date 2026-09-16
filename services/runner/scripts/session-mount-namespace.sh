#!/bin/sh
# Start the sandbox-agent daemon with the least privilege a session needs, and — on the local
# sandbox provider — inside a mount namespace that shows it only its OWN session drive.
#
# Why this exists. On the local provider the runner geesefs-mounts EVERY session's drive under one
# shared root, in the runner's own mount namespace, and the harness runs as an ordinary descendant
# of the daemon. So one session's shell could read, write and delete every other session's drive,
# and on 2026-09-10 one did.
#
# This script is the daemon's entry point rather than the daemon binary itself, because the
# sandbox-agent library builds the daemon's argv itself and offers no hook to prepend a command.
# Everything session-specific arrives in the environment; the file is static and identical for
# every run. It execs, so the daemon keeps this PID and process group and the library's existing
# group-kill teardown is unaffected.
#
# TWO jobs, and the second one runs on every local session whether or not the first succeeds:
#
#   1. Build the private mount view (the `inside` stage below).
#   2. Drop every capability before handing over to the daemon. The runner holds CAP_SYS_ADMIN so
#      that it can do job 1; without this the agent would inherit it and could simply unmount the
#      cover that confines it. The uid is NOT changed here — see `drop_privileges_and_exec`.
#
# Deliberately NOT unshared: the network namespace (the runner reaches the daemon over loopback,
# and the daemon reaches the runner's tool-MCP server the same way) and the PID namespace. Under
# /tmp, the relay, telemetry, tool-MCP and codex-sqlite directories stay SHARED on purpose: they
# are the runner-to-harness IPC channel, written on one side and read on the other.
#
# `set -e`: once the second stage has begun mounting, a failure leaves a half-built view, so it
# aborts the daemon rather than continuing. Falling back there would hand the agent every sibling
# drive while the log said isolation was on. The fallbacks all live in the FIRST stage, before any
# namespace exists.
set -eu

: "${AGENTA_SESSION_DAEMON_BINARY:?session-mount-namespace: no daemon binary}"

# Hand the daemon the smallest privilege that still runs a session, then become the daemon.
#
# The uid and gid do NOT change. The agent keeps running as whoever the runner runs as, so every
# file it writes has exactly the ownership it had before this mechanism existed. What it loses is
# capabilities: the runner carries CAP_SYS_ADMIN (ambient, granted by runner-entrypoint.sh) purely
# to build the namespace above, and an agent holding it could `umount` the tmpfs cover and see
# every sibling drive again.
#
# Two different things make that stick, one per image, which is why all four flags are here.
# In the published image the agent is `node`: clearing the permitted, inheritable and ambient sets
# leaves it nothing, and --no-new-privs stops it earning any back through a setuid or
# file-capability binary. --bounding-set=-all is a no-op there (dropping bounding capabilities
# needs CAP_SETPCAP, which this process does not hold) and setpriv exits 0 rather than failing.
# In the dev image the agent stays uid 0, where an exec recomputes the permitted set FROM the
# bounding set — so there, emptying the bounding set is the flag that does the work. Measured:
# with it, a uid-0 agent cannot mount, unmount or unshare either.
drop_privileges_and_exec() {
    if command -v setpriv >/dev/null 2>&1; then
        exec setpriv \
            --inh-caps=-all \
            --ambient-caps=-all \
            --bounding-set=-all \
            --no-new-privs \
            "$AGENTA_SESSION_DAEMON_BINARY" "$@"
    fi
    echo "[session-mount-namespace] ERROR: setpriv is required to remove agent capabilities." >&2
    exit 1
}

# Arriving here means no namespace was created, so nothing is half-built and the daemon can still
# run exactly as it did before this script existed.
fail_open() {
    # Auto mode preserves compatibility with restricted hosts and reports the exposure.
    # Required mode refuses the downgrade, including a failure after the runner probe.
    if [ "${AGENTA_RUNNER_MOUNT_ISOLATION:-auto}" = "required" ]; then
        echo "[session-mount-namespace] ERROR: required isolation unavailable: $1" >&2
        exit 1
    fi
    reason="$1"
    shift
    echo "[session-mount-namespace] WARNING: starting WITHOUT per-session mount isolation: $reason" >&2
    echo "[session-mount-namespace] WARNING: every session's drive under ${AGENTA_SESSION_MOUNT_ROOT:-the shared mount root} stays visible to this session's agent, which can read, modify and delete drives it does not own." >&2
    drop_privileges_and_exec "$@"
}

# --- second stage: we are inside the new namespace, so build the view and hand over --- #
if [ "${AGENTA_SESSION_MOUNT_NAMESPACE_STAGE:-}" = "inside" ]; then
    unset AGENTA_SESSION_MOUNT_NAMESPACE_STAGE
    root="$AGENTA_SESSION_MOUNT_ROOT"
    keep="$AGENTA_SESSION_MOUNT_KEEP_PATHS"

    # Park this session's own mounts outside the root BEFORE covering it, because covering the
    # root makes their current paths unreachable. A bind is a second reference to the same
    # filesystem, not a copy: writes the runner makes through the original path stay visible here.
    holding="$(mktemp -d)"
    index=0
    for path in $keep; do
        index=$((index + 1))
        mkdir -p "$holding/$index"
        mount --bind "$path" "$holding/$index"
    done

    # One empty tmpfs over the shared root: every sibling session's drive disappears from this
    # namespace in a single operation, with no need to enumerate them or to race sessions that
    # start later. 1777 matches the root the images create, so the daemon can still make the
    # directories it expects to own.
    mount -t tmpfs -o mode=1777 tmpfs "$root"

    # Rebuild this session's own paths inside the tmpfs, so the agent sees the exact paths it saw
    # before and nothing else under the root.
    index=0
    for path in $keep; do
        index=$((index + 1))
        mkdir -p "$path"
        mount --bind "$holding/$index" "$path"
    done

    # Retract the holding binds so the drive is reachable at one path only. A namespace owned by a
    # NEW user namespace locks its inherited mounts against unmounting, so fall back to covering
    # the holding directory instead of failing the run.
    retracted=1
    index=0
    for path in $keep; do
        index=$((index + 1))
        umount "$holding/$index" 2>/dev/null || retracted=0
    done
    if [ "$retracted" = "1" ]; then
        rm -rf "$holding"
    else
        mount -t tmpfs -o mode=0700,size=1M tmpfs "$holding"
    fi

    drop_privileges_and_exec "$@"
fi

# --- first stage: pick a way into a private mount namespace --- #
# A run with nothing to isolate still goes through the capability drop: the runner holds
# CAP_SYS_ADMIN for every local session, so every local agent must be stripped of it.
if [ "${AGENTA_SESSION_MOUNT_ISOLATION:-0}" != "1" ]; then
    drop_privileges_and_exec "$@"
fi
if [ -z "${AGENTA_SESSION_MOUNT_ROOT:-}" ] || [ -z "${AGENTA_SESSION_MOUNT_KEEP_PATHS:-}" ]; then
    fail_open "the runner named no mount root or no session paths to keep" "$@"
fi
if ! command -v unshare >/dev/null 2>&1; then
    fail_open "unshare is not installed in this image" "$@"
fi

AGENTA_SESSION_MOUNT_NAMESPACE_STAGE=inside
export AGENTA_SESSION_MOUNT_NAMESPACE_STAGE

# The ordinary path in both published images. The runner holds CAP_SYS_ADMIN — ambient as the
# `node` user in the gh image, plainly as root in the dev image — so this is all it takes.
# `--propagation private` is what stops a drive mounted later, for a session that starts after
# this one, from appearing here.
if unshare --mount --propagation private true 2>/dev/null; then
    exec unshare --mount --propagation private "$0" "$@"
fi

# No CAP_SYS_ADMIN: the documented subscription self-host scheme overrides the compose `user:`
# with the operator's uid, and a container that starts unprivileged cannot be granted the ambient
# capability. A user namespace grants CAP_SYS_ADMIN inside that namespace instead.
# Map the current uid to ITSELF, never to 0: file ownership on the drive must not change, and
# Claude Code refuses --dangerously-skip-permissions when it believes it is root.
current_user="$(id -u)"
current_group="$(id -g)"
if unshare --user --keep-caps --map-user="$current_user" --map-group="$current_group" \
    --mount --propagation private true 2>/dev/null; then
    exec unshare --user --keep-caps --map-user="$current_user" --map-group="$current_group" \
        --mount --propagation private "$0" "$@"
fi

# Hosts that restrict unprivileged user namespaces land here. Ubuntu 23.10 and later do so by
# default (kernel.apparmor_restrict_unprivileged_userns=1), so this is the ORDINARY outcome for an
# operator-uid runner on a recent Ubuntu host, not an exotic one.
unset AGENTA_SESSION_MOUNT_NAMESPACE_STAGE
fail_open "this process holds no CAP_SYS_ADMIN and the host refuses unprivileged user namespaces (on Ubuntu 23.10+ see kernel.apparmor_restrict_unprivileged_userns)" "$@"
