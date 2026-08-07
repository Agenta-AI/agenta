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

The snapshot name is pinned, so Daytona keeps serving whatever was built under it. Whenever this
recipe changes, every Daytona account using it must rerun the build with --force; see README.md.

Licensing (see services/runner/docker/README.md):
    This script is the build recipe we ship, NOT a snapshot we distribute. Whoever
    runs it builds the snapshot in their own Daytona account: Agenta Cloud builds
    its own for internal use; self-hosters build their own. We never hand anyone a
    Claude-containing image, so this is compliant even though the `-full` base bundles
    Claude.

    Cleaner-provenance follow-up (needs a live Daytona build to verify): base on a
    daemon-only sandbox-agent image and install Claude from Anthropic at build, then
    pin that only after confirming the daemon-only tag also ships the ACP adapters.
"""

import base64
import json
import os
import sys
import time
from pathlib import Path

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
SANDBOX_AGENT_HOME = "/home/sandbox/.local/share/sandbox-agent"
PI_ACP_INSTALL_DIR = f"{SANDBOX_AGENT_HOME}/bin/agent_processes"
PI_ACP_PACKAGE_JSON = f"{PI_ACP_INSTALL_DIR}/pi/node_modules/pi-acp/package.json"

# Codex ACP adapter. The `-full` base image bakes SOME codex-acp, but an unpinned one: it served
# an older model set than the runner's pin, so the same agent saw different models depending on
# the sandbox it landed in. Pin it here to the SAME version the runner image pins (decision
# D-005, `services/runner/package.json` runtimeAgentPins), then apply the SAME approval patch the
# runner image applies (D-008 amendment). Both matter: without the pin, model sets diverge;
# without the patch, a Daytona Codex run silently keeps COLD tool approvals while a local run
# parks warm. Keep this version in agreement with the runner image.
CODEX_ACP_VERSION = "1.1.7"
CODEX_ACP_PACKAGE_JSON = f"{PI_ACP_INSTALL_DIR}/codex/node_modules/@agentclientprotocol/codex-acp/package.json"

# The approval-patch anchor is single-sourced with the runner image so the two can never drift.
PATCH_SPEC = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "src"
        / "engines"
        / "sandbox_agent"
        / "codex-acp-patch.json"
    ).read_text()
)
CODEX_ACP_BUNDLE = f"{SANDBOX_AGENT_HOME}/{PATCH_SPEC['bundlePath']}"


def codex_approval_patch_command() -> str:
    """A self-contained RUN that decouples approvals from the full-access sandbox preset.

    The Daytona image build has no build context from this repo, so the patch script is
    base64-embedded rather than copied. base64 is quoting-safe, which a regex full of quotes and
    backslashes is not: an earlier revision passed the same regex to an inline `node -e` and the
    build died on `/bin/sh: Syntax error: "(" unexpected`. Everything, including the post-write
    verification, therefore lives INSIDE this one script rather than in a second RUN line.

    The script fails loudly (exit 1) when the anchor is missing, so a base image whose codex-acp
    preset drifted breaks the snapshot build instead of silently shipping cold approvals. It
    re-reads the file after writing and fails if the patch did not take. It is idempotent, so a
    rebuild is a no-op.
    """
    script = f"""
import {{ readFileSync, writeFileSync }} from "node:fs";
const file = {json.dumps(CODEX_ACP_BUNDLE)};
const re = new RegExp({json.dumps(PATCH_SPEC["pattern"])});
const patched = {json.dumps(PATCH_SPEC["patched"])};
const source = readFileSync(file, "utf8");
const match = re.exec(source);
if (!match) {{
  console.error(
    "codex-acp approval patch: anchor missing in " + file +
    ". The base image's codex-acp preset changed: re-verify the approval/sandbox coupling and " +
    "update services/runner/src/engines/sandbox_agent/codex-acp-patch.json."
  );
  process.exit(1);
}}
if (match[2] === patched) {{
  console.log("codex-acp approval patch: already on-request");
}} else {{
  writeFileSync(
    file,
    source.slice(0, match.index) + match[1] + '"' + patched + '"' + match[3] +
      source.slice(match.index + match[0].length)
  );
  console.log("codex-acp approval patch: agent-full-access now sends on-request approvals");
}}
// Re-read and assert, so the snapshot can never ship cold approvals on a silent write failure.
const after = new RegExp({json.dumps(PATCH_SPEC["pattern"])}).exec(readFileSync(file, "utf8"));
if (!after || after[2] !== patched) {{
  console.error("codex-acp approval patch did not take in " + file);
  process.exit(1);
}}
console.log("codex-acp-approvals=" + patched);
"""
    blob = base64.b64encode(script.encode()).decode()
    return (
        f"RUN echo {blob} | base64 -d > /tmp/patch-codex-acp.mjs "
        "&& node /tmp/patch-codex-acp.mjs && rm /tmp/patch-codex-acp.mjs"
    )


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
FD_VERSION = "v10.4.2"
# amd64 only, matching this snapshot's base. The runner image arch-matches instead, because it
# is built for both architectures; this snapshot is x86_64 by construction.
FD_URL = (
    f"https://github.com/sharkdp/fd/releases/download/{FD_VERSION}/"
    f"fd-{FD_VERSION}-x86_64-unknown-linux-musl.tar.gz"
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
            # unzip/zip + python-is-python3 (symlinks /usr/bin/python -> python3): an agent
            # handed an archive reaches for `unzip` and plain `python`; without them every
            # such task burns failed bash calls and extra approval round-trips. The base is
            # Debian bookworm (node:22-bookworm), so python-is-python3 is the right package.
            # ripgrep/jq/procps/file/tree are the same bet on habit: `rg` and `fd` are
            # the first commands every harness reaches for when searching a tree. `fd` is
            # pinned below rather than taken from Debian, for the version reason recorded there.
            "RUN apt-get update && apt-get install -y --no-install-recommends fuse curl "
            "python3 python-is-python3 unzip zip ripgrep jq procps file tree "
            "&& rm -rf /var/lib/apt/lists/* && echo user_allow_other >> /etc/fuse.conf",
            # fd, pinned. Debian's `fd-find` is 8.6.0 on bookworm, and Pi's `find` builtin
            # passes `--no-require-git`, a flag fd only gained in 9.0, so every Pi `find` call
            # failed here exactly as it did in the runner image. The final `grep -q` is a
            # BUILD-TIME assertion: a pin that does not carry the flag fails the snapshot build
            # instead of shipping a sandbox whose `find` is quietly broken.
            f"RUN curl -fsSL -o /tmp/fd.tar.gz {FD_URL} "
            "&& tar -xzf /tmp/fd.tar.gz -C /usr/local/bin --strip-components=1 "
            "--wildcards '*/fd' && rm /tmp/fd.tar.gz && chmod +x /usr/local/bin/fd "
            "&& fd --version && fd --help | grep -q -- --no-require-git",
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
            # Same treatment for Codex: pin the adapter to the runner's version, then assert it.
            f"RUN sandbox-agent install-agent codex --reinstall "
            f"--agent-process-version {CODEX_ACP_VERSION}",
            f'RUN test "$(node -p "require(\'{CODEX_ACP_PACKAGE_JSON}\').version")" '
            f'= "{CODEX_ACP_VERSION}" '
            f"&& echo codex-acp-version={CODEX_ACP_VERSION}",
            # Patches AND verifies in one step; see the docstring for why it is not two.
            codex_approval_patch_command(),
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
