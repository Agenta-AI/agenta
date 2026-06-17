# /// script
# requires-python = ">=3.11"
# dependencies = ["daytona"]
# ///
"""Build a Daytona snapshot for the WP-8 rivet agent runtime.

Bakes the `pi` CLI into rivet's `-full` image (which already ships the sandbox-agent
daemon, the Claude CLI, and CA certs) so Daytona runs don't pay a ~150s per-invoke
`npm install pi`. Set the agent service to use it:

    AGENTA_RIVET_DAYTONA_SNAPSHOT=agenta-rivet-pi
    AGENTA_RIVET_DAYTONA_INSTALL_PI=false

Run: DAYTONA_API_KEY=... DAYTONA_TARGET=eu uv run build_rivet_snapshot.py [--force]
"""

import sys
import time

from daytona import (
    CreateSnapshotParams,
    Daytona,
    DaytonaConfig,
    Image,
    Resources,
)

SNAPSHOT_NAME = "agenta-rivet-pi"
RIVET_IMAGE = "rivetdev/sandbox-agent:0.5.0-rc.2-full"
PI_PACKAGE = "@earendil-works/pi-coding-agent@0.79.4"


def main() -> None:
    force = "--force" in sys.argv
    daytona = Daytona(DaytonaConfig())

    try:
        existing = daytona.snapshot.get(SNAPSHOT_NAME)
    except Exception:
        existing = None

    if existing and not force:
        print(f"snapshot '{SNAPSHOT_NAME}' already exists; pass --force to rebuild.")
        return
    if existing:
        print(f"deleting existing snapshot '{SNAPSHOT_NAME}'...")
        daytona.snapshot.delete(existing)

    # Base on rivet's -full image (daemon + claude + certs) and add the pi CLI globally
    # so it is on PATH for the sandbox user the daemon runs as. The image's default user
    # is the non-root `sandbox`, so switch to root for the global install, then back.
    image = Image.base(RIVET_IMAGE).dockerfile_commands(
        [
            "USER root",
            f"RUN npm install -g --ignore-scripts {PI_PACKAGE}",
            "RUN pi --version || true",
            "USER sandbox",
        ]
    )

    print(f"building snapshot '{SNAPSHOT_NAME}' from {RIVET_IMAGE} (+ pi)...")
    started = time.monotonic()
    daytona.snapshot.create(
        CreateSnapshotParams(
            name=SNAPSHOT_NAME,
            image=image,
            resources=Resources(cpu=2, memory=4, disk=8),
        ),
        on_logs=print,
    )
    print(f"\nsnapshot '{SNAPSHOT_NAME}' built in {time.monotonic() - started:.1f}s")


if __name__ == "__main__":
    main()
