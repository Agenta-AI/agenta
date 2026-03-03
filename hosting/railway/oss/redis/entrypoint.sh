#!/bin/sh

set -eu

# Ensure the persistent data dir exists and is writable before delegating
# to Redis' official entrypoint (which will drop privileges as needed).
mkdir -p /data
chown -R redis:redis /data

exec /usr/local/bin/docker-entrypoint.sh "$@"
