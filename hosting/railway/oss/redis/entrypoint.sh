#!/bin/sh

set -eu

# Ensure the persistent data dir exists and is writable before delegating
# to Redis' official entrypoint (which will drop privileges as needed).
mkdir -p /data
REDIS_UID="$(id -u redis)"
REDIS_GID="$(id -g redis)"
DATA_OWNER="$(stat -c '%u:%g' /data 2>/dev/null || true)"

if [ "$DATA_OWNER" != "${REDIS_UID}:${REDIS_GID}" ]; then
    chown -R redis:redis /data
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
