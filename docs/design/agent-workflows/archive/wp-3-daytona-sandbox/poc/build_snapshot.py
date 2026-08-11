# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "daytona",
# ]
# ///
"""
WP-3 step 1: bake Pi into a reusable Daytona snapshot so per-run cold start skips
`npm install`. Built from a Node base image with the Pi coding agent and the search
binaries (rg, fd) Pi expects pre-installed.

Idempotent: skips the build if the snapshot already exists, unless --force is passed
(which deletes and rebuilds it). Streams the build logs and prints the wall-clock
build time.

Run:
    DAYTONA_API_KEY=... DAYTONA_API_URL=... DAYTONA_TARGET=eu \
        uv run build_snapshot.py [--force]
"""

import os
import sys
import time

from daytona import (
    CreateSnapshotParams,
    Daytona,
    DaytonaConfig,
    Image,
    Resources,
)

SNAPSHOT_NAME = "agenta-pi-harness"
PI_PACKAGE = "@earendil-works/pi-coding-agent@0.79.4"


def client() -> Daytona:
    return Daytona(
        DaytonaConfig(
            api_key=os.environ["DAYTONA_API_KEY"],
            api_url=os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api"),
            target=os.environ.get("DAYTONA_TARGET", "eu"),
        )
    )


def snapshot_exists(daytona: Daytona, name: str) -> bool:
    page = daytona.snapshot.list()
    items = getattr(page, "items", page)
    return any(getattr(s, "name", None) == name for s in items)


def main() -> None:
    force = "--force" in sys.argv
    daytona = client()

    if snapshot_exists(daytona, SNAPSHOT_NAME):
        if not force:
            print(
                f"snapshot '{SNAPSHOT_NAME}' already exists; pass --force to rebuild."
            )
            return
        print(f"deleting existing snapshot '{SNAPSHOT_NAME}' to rebuild...")
        snap = daytona.snapshot.get(SNAPSHOT_NAME)
        daytona.snapshot.delete(snap)

    # Node base + Pi + search binaries. fd ships on Debian as `fdfind`; Pi looks for
    # `fd`, so symlink it. --ignore-scripts matches the Pi README's install guidance.
    image = (
        Image.base("node:22-bookworm")
        .run_commands(
            "apt-get update && apt-get install -y --no-install-recommends ripgrep fd-find && rm -rf /var/lib/apt/lists/*",
            "ln -sf $(command -v fdfind) /usr/local/bin/fd",
            f"npm install -g --ignore-scripts {PI_PACKAGE}",
            "pi --version || true",
        )
        .workdir("/home/daytona")
    )

    print(f"building snapshot '{SNAPSHOT_NAME}' (this builds + pushes an image)...")
    started = time.monotonic()
    daytona.snapshot.create(
        CreateSnapshotParams(
            name=SNAPSHOT_NAME,
            image=image,
            resources=Resources(cpu=2, memory=4, disk=8),
        ),
        on_logs=print,
    )
    elapsed = time.monotonic() - started
    print(f"\nsnapshot '{SNAPSHOT_NAME}' built in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
