# Daytona Sandbox Snapshot

This folder contains the supported self-host recipe for building a Daytona snapshot for the
Agenta `sandbox-agent` runner path.

We ship the recipe, not a built snapshot. The operator runs it in their own Daytona account:

```bash
DAYTONA_API_KEY=... DAYTONA_TARGET=eu uv run build_snapshot.py --force
```

Configure the runner service with:

```bash
AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS=local,daytona
AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER=daytona
AGENTA_RUNNER_DAYTONA_API_KEY=...
AGENTA_RUNNER_DAYTONA_SNAPSHOT=agenta-agent-sandbox-v1
```

The SDK custom-code evaluator runner can share the built snapshot (it reads the separate
`DAYTONA_SNAPSHOT_CODE` / `DAYTONA_SNAPSHOT` variables), so the recipe also bakes its
runtimes (python3, typescript/ts-node).

## What is baked

The recipe bases on `rivetdev/sandbox-agent:*-full`. That base image already installs the
Claude, Codex, and OpenCode native binaries and ACP adapters. It also includes a Pi ACP
adapter, but its version can differ from the runner's adapter and it does not include the
standalone `pi` CLI that the adapter launches.

The snapshot recipe therefore:

- runs the shared tool recipe `services/runner/images/sandbox/install-agent-tools.sh` and its
  hash-pinned Python lock `agent-requirements.txt`, both embedded (gzip, base64, one `RUN`
  line each) because the Daytona build has no repo context. To change the Python set, edit the
  package list, then regenerate the lock with
  `uv pip compile --python-version 3.11 --generate-hashes --no-header --no-annotate requirements.in -o agent-requirements.txt`;
  the install runs with `--require-hashes`, so a hand-edited pin without a hash fails the build. The same file runs in both runner
  Dockerfiles, so the local sandbox and the Daytona sandbox ship one tool list: the everyday shell
  tools, `gh` from GitHub's apt repo, `uv`, `fd` 10.4.2 (Pi's `find` builtin needs a flag Debian's
  8.6 lacks), `ffmpeg`, poppler, tesseract, the node toolchain (`typescript` 5, `ts-node`,
  `prettier`, `eslint`, `bun`, the `playwright` CLI), a pinned Python package set for documents,
  data, and the web, and one headless Chromium installed by Playwright under
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and linked as `chromium`. Every section of the
  script asserts its own pin and fails the build otherwise; the pins live at the top of that file;
- installs `@earendil-works/pi-coding-agent@0.85.1`;
- fails the build unless `pi --version` succeeds;
- reinstalls the private Pi ACP adapter at `pi-acp@0.0.29` through
  `sandbox-agent install-agent`, rather than installing a global package that the daemon
  would not resolve;
- fails the build unless the private launcher exists and its installed package reports
  version `0.0.29`;
- reinstalls the Codex ACP adapter (`@agentclientprotocol/codex-acp`) pinned to the SAME
  version the runner image pins (D-005; the base image's copy floats and served an older
  model set — the #5537 gap), and fails the build unless the installed version matches;
- applies the codex-acp approval patch (D-008 amendment): the `agent-full-access` preset is
  rewritten from `approvalPolicy: "never"` to `on-request` so Agenta-tool calls raise
  codex-native gates that park warm. Without this, a Daytona `ask` tool executes with NO
  approval (the runner-side seam gate is off remotely). The anchor is single-sourced from
  `services/runner/src/engines/sandbox_agent/codex-acp-patch.json` (shared with the runner
  image build), the step verifies its own write, and the build fails loudly if the preset
  drifts;
- verifies that the Claude, Codex, and OpenCode binaries are still present; and
- installs the FUSE and geesefs dependencies used for durable remote working directories.

The Pi CLI and Pi ACP adapter are separate dependencies. Keep both pins explicit. The CLI
runs the agent; the adapter translates Pi events and dialogs onto ACP. In particular, the
adapter version must not be inherited implicitly from the base image because older versions
do not forward Pi extension dialogs as ACP permission requests.

## Refreshing an existing snapshot

The snapshot name is pinned, so Daytona keeps serving whatever you built under it. When this recipe
changes, rebuild it in each Daytona account that uses it:

```bash
DAYTONA_API_KEY=... DAYTONA_TARGET=eu uv run build_snapshot.py --force
```

`--force` is required: without it the script sees the existing snapshot and exits. Sandboxes already
running keep the old contents; only sandboxes created after the rebuild pick up the change.

## Pi installation

Harness availability is an image/runtime contract, not operator truth: before each session
the runner probes the expected Pi executable at its pinned in-sandbox path
(`/home/sandbox/.agenta-pi/node_modules/.bin/pi`). A snapshot built with this recipe bakes
the pinned Pi there, so the probe hits and no session-time install runs. If a custom image
or snapshot lacks Pi, the runner installs the pinned version before the session and logs the
repair; if that install fails, the run fails naming the missing executable and attempted
version. There is no "installed" environment flag.

The full base image includes Claude Code. We do not distribute the resulting snapshot. Agenta
Cloud builds its own internal snapshot, and self-hosters build their own.

Keep credentials out of the image and snapshot. Provider keys and self-managed login paths are
runtime concerns.
