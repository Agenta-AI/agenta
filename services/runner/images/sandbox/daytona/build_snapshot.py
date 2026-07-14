# /// script
# requires-python = ">=3.11"
# dependencies = ["daytona"]
# ///
"""Build a Daytona snapshot for the Agenta sandbox-agent runner.

The full sandbox-agent base image already bakes the Claude, Codex, and OpenCode
native binaries and ACP adapters. This recipe replaces its Pi ACP adapter with the
pinned version, adds the pinned standalone `pi` CLI that adapter launches, and verifies
the other baked harnesses so Daytona runs do not pay their installation cost for every
fresh sandbox. Set the runner service to use it:

    AGENTA_RUNNER_DAYTONA_SNAPSHOT=agenta-agent-sandbox-v1

The runner probes for its pinned Pi before each session; because this recipe bakes it, the
probe hits and no session-time install runs. The SDK code-evaluator runner can share the
built snapshot through its own DAYTONA_SNAPSHOT_CODE / DAYTONA_SNAPSHOT variables, so the
recipe additionally installs python3 and typescript/ts-node.

Run: DAYTONA_API_KEY=... DAYTONA_TARGET=eu uv run build_snapshot.py [--force]

Licensing (see services/runner/images/service/README.md):
    This script is the build recipe we ship, NOT a snapshot we distribute. Whoever
    runs it builds the snapshot in their own Daytona account: Agenta Cloud builds
    its own for internal use; self-hosters build their own. We never hand anyone a
    Claude-containing image, so this is compliant even though the `-full` base bundles
    Claude.

    Cleaner-provenance follow-up (needs a live Daytona build to verify): base on a
    daemon-only sandbox-agent image and install Claude from Anthropic at build, then
    pin that only after confirming the daemon-only tag also ships the ACP adapters.
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
from daytona.common.errors import DaytonaNotFoundError

SNAPSHOT_NAME = "agenta-agent-sandbox-v1"
SANDBOX_AGENT_IMAGE = "rivetdev/sandbox-agent:0.5.0-rc.2-full"
PI_VERSION = "0.80.6"
PI_PACKAGE = f"@earendil-works/pi-coding-agent@{PI_VERSION}"
PI_ACP_VERSION = "0.0.29"
PI_ACP_INSTALL_DIR = "/home/sandbox/.local/share/sandbox-agent/bin/agent_processes"
PI_ACP_PACKAGE_JSON = f"{PI_ACP_INSTALL_DIR}/pi/node_modules/pi-acp/package.json"
# Durable session cwd: geesefs (FUSE-over-S3) mounts the store prefix INSIDE the sandbox for
# remote runs. fuse provides fusermount + /etc/fuse.conf; geesefs is the static mount binary.
# amd64 is correct here regardless of the builder's local arch: the snapshot is built and run
# on Daytona's x86_64 cloud hosts, not on this machine. (The local/prod runner Dockerfiles, by
# contrast, arch-match via `dpkg --print-architecture` because they may build on arm64 Macs.)
GEESEFS_VERSION = "v0.43.0"
GEESEFS_URL = (
    "https://github.com/yandex-cloud/geesefs/releases/download/"
    f"{GEESEFS_VERSION}/geesefs-linux-amd64"
)


def main() -> None:
    force = "--force" in sys.argv
    daytona = Daytona(DaytonaConfig())

    try:
        existing = daytona.snapshot.get(SNAPSHOT_NAME)
    except DaytonaNotFoundError:
        existing = None

    if existing and not force:
        print(f"snapshot '{SNAPSHOT_NAME}' already exists; pass --force to rebuild.")
        return
    if existing:
        print(f"deleting existing snapshot '{SNAPSHOT_NAME}'...")
        daytona.snapshot.delete(existing)
        deadline = time.monotonic() + 120
        while True:
            try:
                daytona.snapshot.get(SNAPSHOT_NAME)
            except DaytonaNotFoundError:
                break
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    "Timed out waiting for the old Daytona snapshot to delete"
                )
            time.sleep(2)

    # Add Pi globally so it is on PATH for the non-root sandbox user. The full base
    # already bakes Claude, Codex, and OpenCode, so verify their native binaries
    # instead of reinstalling them.
    image = Image.base(SANDBOX_AGENT_IMAGE).dockerfile_commands(
        [
            "USER root",
            f"RUN npm install -g --ignore-scripts {PI_PACKAGE}",
            "RUN pi --version",
            "RUN test -x /home/sandbox/.local/share/sandbox-agent/bin/claude "
            "&& echo claude-baked-in-base-image",
            "RUN test -x /home/sandbox/.local/share/sandbox-agent/bin/codex "
            "&& echo codex-baked-in-base-image",
            "RUN test -x /home/sandbox/.local/share/sandbox-agent/bin/opencode "
            "&& echo opencode-baked-in-base-image",
            # Durable cwd: fuse + geesefs so the remote sandbox can mount its store prefix.
            "RUN apt-get update && apt-get install -y --no-install-recommends fuse curl "
            "python3 "
            "&& rm -rf /var/lib/apt/lists/* && echo user_allow_other >> /etc/fuse.conf",
            # Code-evaluator runtimes: this snapshot is shared with the SDK DaytonaRunner.
            # typescript@5: ts-node needs the JS compiler API; typescript 7+ is the Go
            # rewrite with no JS API (ts.sys undefined).
            "RUN npm install -g typescript@5 ts-node@10 "
            "&& python3 --version "
            "&& echo 'const v: number = 1; console.log(v)' > /tmp/v.ts "
            "&& ts-node /tmp/v.ts && rm /tmp/v.ts",
            f"RUN curl -fsSL -o /usr/local/bin/geesefs {GEESEFS_URL} "
            "&& chmod +x /usr/local/bin/geesefs",
            "USER sandbox",
            # Replace the base image's private Pi adapter. sandbox-agent resolves this launcher
            # before PATH, so a global pi-acp install would leave the stale adapter active.
            f"RUN sandbox-agent install-agent pi --reinstall "
            f"--agent-process-version {PI_ACP_VERSION}",
            # Assert the private launcher and its installed npm package, not a global package.
            f"RUN test -x {PI_ACP_INSTALL_DIR}/pi-acp "
            f'&& test "$(node -p "require(\'{PI_ACP_PACKAGE_JSON}\').version")" '
            f'= "{PI_ACP_VERSION}" '
            f"&& echo pi-acp-version={PI_ACP_VERSION}",
        ]
    )

    print(f"building snapshot '{SNAPSHOT_NAME}' from {SANDBOX_AGENT_IMAGE} (+ pi)...")
    started = time.monotonic()
    daytona.snapshot.create(
        CreateSnapshotParams(
            name=SNAPSHOT_NAME,
            image=image,
            resources=Resources(
                cpu=int(os.getenv("AGENTA_RUNNER_DAYTONA_SANDBOX_CPU", "2")),
                memory=int(os.getenv("AGENTA_RUNNER_DAYTONA_SANDBOX_MEMORY_GB", "4")),
                disk=int(os.getenv("AGENTA_RUNNER_DAYTONA_SANDBOX_DISK_GB", "5")),
            ),
        ),
        on_logs=print,
    )
    print(f"\nsnapshot '{SNAPSHOT_NAME}' built in {time.monotonic() - started:.1f}s")


if __name__ == "__main__":
    main()
