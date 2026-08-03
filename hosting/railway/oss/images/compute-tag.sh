#!/usr/bin/env bash

# Print the content-addressed image tag for a wrapper image directory.
#
# The tag is `content-<12 hex chars>`: the sha256 over every file's path and
# sha256 (paths sorted with LC_ALL=C, so the result is deterministic across
# machines and runs — no timestamps, no file modes, no tar metadata).
# Unchanged directory content always yields the same tag, which is how CI
# decides that a wrapper image is already in the registry and skips the build.
#
# Usage: compute-tag.sh <image-dir>
# Example: compute-tag.sh hosting/railway/oss/images/gateway
#
# Not covered by the hash (irrelevant to the built image): file modes
# (entrypoints are chmod'ed inside the Dockerfiles) and empty directories.

set -euo pipefail

dir="${1:?usage: compute-tag.sh <image-dir>}"

if [ ! -d "$dir" ]; then
    printf "Not a directory: %s\n" "$dir" >&2
    exit 1
fi

cd "$dir"

hash="$(find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum | sha256sum | cut -c1-12)"

printf 'content-%s\n' "$hash"
