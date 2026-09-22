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
recipe runs the shared tool recipe (install-agent-tools.sh), which includes python3 and
typescript/ts-node.

Run: DAYTONA_API_KEY=... DAYTONA_TARGET=eu uv run build_snapshot.py [--name NAME] [--force]

Daytona keeps serving whatever was built under a name. Whenever this recipe changes, rerun the
build with --force in every Daytona account that uses it; see README.md. --force first builds a
trial snapshot under a temporary name, so a recipe that fails one of the assertions below never
costs the live snapshot. Only after the trial passes is the live one deleted and rebuilt.

Licensing (see services/runner/docker/README.md):
    This script is the build recipe we ship, NOT a snapshot we distribute. Whoever
    runs it builds the snapshot in their own Daytona account: Agenta Cloud builds
    its own for internal use; self-hosters build their own. We never hand anyone a
    Claude-containing image, so this is compliant even though the `-full` base bundles
    Claude.

    2026-09-22: the Claude ACP adapter is reinstalled at build time on top of the
    -full base, pinned to the runner's claude-agent-acp version (same treatment as
    Codex, D-005), so the Daytona sandbox serves the same Claude model set as the
    runner. The snapshot remains a private artifact built in the operator's own
    Daytona account, so this stays a build recipe we ship, not an image we distribute.
"""

import base64
import gzip
import json
import os
import sys
import time
import uuid
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
PI_VERSION = "0.85.1"
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

# Claude ACP adapter. Same disease and cure as Codex: the `-full` base bakes an unpinned,
# stale Claude adapter (its bundled @anthropic-ai/claude-agent-sdk model table predates
# Opus 5.5). Pin it to the SAME @agentclientprotocol/claude-agent-acp version the runner
# pins (`services/runner/package.json`), so local and Daytona sandboxes serve the same
# Claude model set. Keep this version in agreement with the runner.
CLAUDE_ACP_VERSION = "0.81.0"
CLAUDE_ACP_PACKAGE_JSON = f"{PI_ACP_INSTALL_DIR}/claude/node_modules/@agentclientprotocol/claude-agent-acp/package.json"

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

# The shared tool recipe: one file installs everything an agent calls (gh, uv, fd, ripgrep, the
# pinned Python set, node tools, ffmpeg, poppler, tesseract, ONE Chromium) in the runner images
# AND this snapshot, so the local and the remote sandbox cannot drift. The Daytona build has no
# context from this repo, so the script is embedded base64, the same way the codex patch is.
SANDBOX_IMAGES_DIR = Path(__file__).resolve().parents[1]
INSTALL_SCRIPT = (SANDBOX_IMAGES_DIR / "install-agent-tools.sh").read_bytes()
AGENT_REQUIREMENTS = (SANDBOX_IMAGES_DIR / "agent-requirements.txt").read_bytes()
PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers"


def _embed_file(content: bytes, dest: str) -> list[str]:
    """RUN lines that write `content` to `dest` inside the build: gzip, base64, split.

    Two limits shape this. Daytona rejects a Dockerfile line over 65535 bytes, and Docker runs a
    RUN line as `sh -c "<line>"`, one argv string capped at 128 KiB by Linux. The hashed
    requirements lock alone is 150 KB, so it is gzipped (about 4x smaller) and the base64 is
    appended to a staging file across as many RUN lines as it takes, each well under both caps,
    then decoded once.
    """
    blob = base64.b64encode(gzip.compress(content, 9)).decode()
    staging = f"{dest}.b64"
    lines = [
        f"RUN printf '%s' '{blob[i : i + 48_000]}' >> {staging}"
        for i in range(0, len(blob), 48_000)
    ]
    lines.append(f"RUN base64 -d {staging} | gzip -dc > {dest} && rm {staging}")
    for line in lines:
        if len(line) > 60_000:
            raise ValueError(f"embedded line for {dest} too long: {len(line)}")
    return lines


def install_agent_tools_commands() -> list[str]:
    return [
        *_embed_file(INSTALL_SCRIPT, "/tmp/install-agent-tools.sh"),
        *_embed_file(AGENT_REQUIREMENTS, "/tmp/agent-requirements.txt"),
        "RUN sh /tmp/install-agent-tools.sh "
        "&& rm /tmp/install-agent-tools.sh /tmp/agent-requirements.txt",
    ]


# A snapshot in one of these states never served a sandbox, so replacing it cannot break a run.
FAILED_SNAPSHOT_STATES = frozenset({"error", "build_failed"})


def parse_args(argv: list[str]) -> tuple[str, bool]:
    """`--name NAME` (default: the runner's pinned name) and `--force`."""
    name = SNAPSHOT_NAME
    force = False
    args = iter(argv)
    for arg in args:
        if arg == "--force":
            force = True
        elif arg == "--name":
            name = next(args, "")
            if not name:
                raise SystemExit("--name needs a snapshot name")
        elif arg.startswith("--name="):
            name = arg.removeprefix("--name=")
            if not name:
                raise SystemExit("--name needs a snapshot name")
        else:
            raise SystemExit(f"unknown argument: {arg}")
    return name, force


def trial_name(name: str) -> str:
    # The random suffix keeps two concurrent refreshes from cleaning up each other's trial.
    stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
    return f"{name}-candidate-{stamp}-{uuid.uuid4().hex[:6]}"


def plan_build(name: str, force: bool, existing_state: object | None) -> str:
    """What to do with `name`: "build", "skip", "replace-failed", or "trial-then-replace".

    A usable snapshot is replaced only after a trial build of the same recipe has passed every
    assertion: runners may be starting sandboxes from it, and deleting it first would leave
    them with no snapshot at all if the new recipe fails.
    """
    if existing_state is None:
        return "build"
    if not force:
        return "skip"
    if str(getattr(existing_state, "value", existing_state)) in FAILED_SNAPSHOT_STATES:
        return "replace-failed"
    return "trial-then-replace"


def wait_until_deleted(daytona: Daytona, name: str) -> None:
    deadline = time.monotonic() + 120
    while True:
        try:
            daytona.snapshot.get(name)
        except DaytonaNotFoundError:
            return
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Timed out waiting for snapshot '{name}' to delete")
        time.sleep(2)


def delete_snapshot(daytona: Daytona, name: str) -> None:
    daytona.snapshot.delete(daytona.snapshot.get(name))
    wait_until_deleted(daytona, name)


def discard_snapshot(daytona: Daytona, name: str) -> None:
    """Best-effort cleanup of a snapshot no runner uses; a leftover is only clutter."""
    try:
        delete_snapshot(daytona, name)
    except DaytonaNotFoundError:
        pass
    except Exception as exc:  # noqa: BLE001
        print(f"could not delete snapshot '{name}' ({exc}); delete it in Daytona.")


def main() -> None:
    name, force = parse_args(sys.argv[1:])
    daytona = Daytona(DaytonaConfig())

    try:
        existing = daytona.snapshot.get(name)
    except DaytonaNotFoundError:
        existing = None

    action = plan_build(name, force, existing.state if existing else None)
    if action == "skip":
        print(
            f"snapshot '{name}' already exists (state: {existing.state}); pass --force to "
            "rebuild it (a trial build runs first, so a failing recipe leaves it untouched)."
        )
        return
    if action == "replace-failed":
        print(f"deleting failed snapshot '{name}' (state: {existing.state})...")
        delete_snapshot(daytona, name)
        build_snapshot(daytona, name)
        return
    if action == "build":
        build_snapshot(daytona, name)
        if name != SNAPSHOT_NAME:
            print(f"Point the runner at it: AGENTA_RUNNER_DAYTONA_SNAPSHOT={name}")
        return

    trial = trial_name(name)
    print(f"'{name}' is live; building a trial snapshot '{trial}' first...")
    try:
        build_snapshot(daytona, trial)
    except Exception as exc:
        discard_snapshot(daytona, trial)
        raise SystemExit(
            f"trial build failed ({exc}); the live snapshot '{name}' was not touched."
        ) from exc

    print(f"trial passed; replacing '{name}'...")
    try:
        delete_snapshot(daytona, name)
        build_snapshot(daytona, name)
    except Exception as exc:
        raise SystemExit(
            f"replacing '{name}' failed ({exc}); it may be gone. The trial snapshot "
            f"'{trial}' passed every check and was kept. Point the runner at it and restart "
            f"the runner:\n    AGENTA_RUNNER_DAYTONA_SNAPSHOT={trial}"
        ) from exc
    discard_snapshot(daytona, trial)


def build_snapshot(daytona: Daytona, name: str) -> None:
    """Build `name` from the recipe; raises when any build step or assertion fails."""
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
            # Everything an agent calls comes from the shared recipe (see INSTALL_SCRIPT).
            # This includes python3 and typescript/ts-node for the SDK code-evaluator runtimes.
            f"ENV PLAYWRIGHT_BROWSERS_PATH={PLAYWRIGHT_BROWSERS_PATH}",
            # ts-node 10 + typescript 5.9 picks `module: NodeNext` without a tsconfig and fails
            # (TS5109) on newer node; same setting as the runner images, see the recipe.
            'ENV TS_NODE_COMPILER_OPTIONS="{\\"module\\":\\"commonjs\\",\\"moduleResolution\\":\\"node\\"}"',
            *install_agent_tools_commands(),
            # Durable cwd: fuse + geesefs so the remote sandbox can mount its store prefix.
            "RUN apt-get update && apt-get install -y --no-install-recommends fuse "
            "&& rm -rf /var/lib/apt/lists/* && echo user_allow_other >> /etc/fuse.conf",
            f"RUN curl -fsSL -o /usr/local/bin/geesefs {GEESEFS_URL} "
            "&& chmod +x /usr/local/bin/geesefs",
            "USER sandbox",
            # The recipe's checks ran as root. Assert the tools as the sandbox user too.
            "RUN gh --version >/dev/null && uv --version >/dev/null && fd --version >/dev/null "
            "&& tsc --version >/dev/null && bun --version >/dev/null "
            '&& python3 -c "import pandas, playwright" '
            "&& chromium --headless=new --no-sandbox --disable-gpu --dump-dom about:blank 2>/dev/null "
            "| grep -q '<html'",
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
            # Same treatment for Claude: replace the base's stale adapter with the
            # runner's pinned claude-agent-acp, then assert version and model table.
            f"RUN sandbox-agent install-agent claude --reinstall "
            f"--agent-process-version {CLAUDE_ACP_VERSION}",
            f'RUN test "$(node -p "require(\'{CLAUDE_ACP_PACKAGE_JSON}\').version")" '
            f'= "{CLAUDE_ACP_VERSION}" '
            f"&& echo claude-acp-version={CLAUDE_ACP_VERSION}",
            # The bundled SDK binary must actually carry Opus 5.5 and Fable 5.1 (both in the
            # published Claude catalog); fail the build otherwise.
            f"RUN BIN=$(find {PI_ACP_INSTALL_DIR}/claude -type f -name claude | head -1) "
            '&& test -n "$BIN" && grep -aq claude-opus-5-5 "$BIN" '
            '&& grep -aq claude-fable-5-1 "$BIN" '
            "&& echo claude-model-table-has-opus-5-5-and-fable-5-1",
        ]
    )

    print(f"building snapshot '{name}' from {SANDBOX_AGENT_IMAGE} (+ pi)...")
    started = time.monotonic()
    daytona.snapshot.create(
        CreateSnapshotParams(
            name=name,
            image=image,
            resources=Resources(
                cpu=int(os.getenv("AGENTA_RUNNER_DAYTONA_SANDBOX_CPU", "2")),
                memory=int(os.getenv("AGENTA_RUNNER_DAYTONA_SANDBOX_MEMORY_GB", "4")),
                disk=int(os.getenv("AGENTA_RUNNER_DAYTONA_SANDBOX_DISK_GB", "5")),
            ),
        ),
        on_logs=print,
    )
    print(f"\nsnapshot '{name}' built in {time.monotonic() - started:.1f}s")


if __name__ == "__main__":
    main()
