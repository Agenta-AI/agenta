#!/bin/sh
# Run against a built runner image: sh tests/integration/mount-namespace-container.sh IMAGE
set -eu
image="${1:?runner image required}"
scripts="$(cd "$(dirname "$0")/../../scripts" && pwd)"
# Match the published image's entrypoint while using the candidate scripts.
for capability in '' '--cap-add=SYS_ADMIN'; do
    docker run --rm --user root $capability \
        -v "$scripts:/app/scripts:ro" \
        --entrypoint /app/scripts/runner-entrypoint.sh "$image" node sh -ec '
        test "$(id -u)" = 1000
        echo server-uid-ok
    '
done
# Kernel-level isolation: the runner can see both drives, its child can only see its own.
docker run --rm --user root --cap-add SYS_ADMIN --security-opt apparmor=unconfined \
    -v "$scripts:/app/scripts:ro" --entrypoint sh "$image" -ec '
    chmod u-s /usr/bin/mount /usr/bin/umount
    mkdir -p /tmp/isolation-root/p/own /tmp/isolation-root/p/sibling
    chmod -R 777 /tmp/isolation-root
    echo sibling-data > /tmp/isolation-root/p/sibling/secret
    cat > /tmp/assert-isolation <<"EOF"
#!/bin/sh
set -eu
test "$(id -u)" = 1000
test -d /tmp/isolation-root/p/own
test ! -e /tmp/isolation-root/p/sibling/secret
echo own-data > /tmp/isolation-root/p/own/payload
for field in CapEff CapPrm CapAmb CapInh; do
    test "$(awk -v field="$field:" '\''$1 == field {print $2}'\'' /proc/self/status)" = 0000000000000000
done
if umount /tmp/isolation-root 2>/dev/null; then exit 1; fi
EOF
    chmod 755 /tmp/assert-isolation
    AGENTA_SESSION_MOUNT_ISOLATION=1 \
    AGENTA_SESSION_MOUNT_ROOT=/tmp/isolation-root \
    AGENTA_SESSION_MOUNT_KEEP_PATHS=/tmp/isolation-root/p/own \
    AGENTA_RUNNER_MOUNT_ISOLATION=required \
    AGENTA_SESSION_DAEMON_BINARY=/tmp/assert-isolation \
      /app/scripts/runner-entrypoint.sh node /app/scripts/session-mount-namespace.sh
    test "$(cat /tmp/isolation-root/p/sibling/secret)" = sibling-data
    test "$(cat /tmp/isolation-root/p/own/payload)" = own-data
    echo isolation-and-capability-removal-ok
'
