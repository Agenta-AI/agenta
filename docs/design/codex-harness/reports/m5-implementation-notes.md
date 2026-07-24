# Milestone 5 implementation notes

The final milestone: Daytona managed-key Codex, the adapter pin, the release-gate cell,
documentation sync, the whole-branch quality sweep, and the lane-split plan. Runner code and docs
authored directly by Opus and disclosed as such (the implementation-via-codex-exec discipline was
kept for the larger cross-file work; the M5 changes are small, well-understood mirrors of existing
patterns, so direct authorship was faster and is disclosed here). Local checkpoint commits only,
nothing pushed.

## Headline

- **A. Daytona managed-key Codex: GREEN.** A managed-key codex chat run provisions a real Daytona
  sandbox, authenticates from an in-VM `auth.json` the runner writes, and streams a reply. Runner
  log, live: `codex auth.json written (Daytona, in-VM) home=/home/sandbox/agenta/codex-home/…`,
  `stopReason=end_turn`, reply `DAYTONA-OK`. The key never touches durable S3 storage (D-002 M5
  amendment). Both QA sandboxes deleted afterward (hygiene: 0 remaining).
- **B. Release-gate codex cell (X1): GREEN.** Added cell `X1` (codex, local, managed key) to the
  `agent-release-gate` skill. `chat`, `tool`, `commit`, `warm` PASS; `mcp`/`approve`/`deny`/`mount`
  SKIP with codex-specific reasons (D-008 design + probe-shape). No FAILs.
- **C. Adapter pin (D-005): landed** in both runner Dockerfiles via
  `sandbox-agent install-agent codex --agent-process-version 1.1.7`, pinning codex-acp 1.1.7 (with
  bundled `@openai/codex` 0.145.0). Versions recorded in `services/runner/package.json`.
- **D. Docs synced.** User-facing self-host subscription page gained the native Codex `CODEX_HOME`
  mount; the agent-workflows ground-truth and interface inventory now list the codex harness.
- **E. Sweep clean.** `/simplify` (single-pass, no Agent fan-out) and a focused desloppify pass over
  the M4/M5 surface found no actionable slop. No code changes.
- **F. Lane-split plan** at `lane-split-plan.md`: an area split (SDK / runner / web / docs) with
  disjoint file sets and zero split files, plus a concern-split alternative with its five hard-case
  files named.
- **Suites GREEN:** runner **1252**, SDK agents unit **691**, ruff + typecheck clean.

## A. Daytona managed-key path

### What shipped (`services/runner/src/engines/sandbox_agent/`)

- `codex-assets.ts`: `codexDaytonaHomeDir` / `codexDaytonaSqliteHomeDir` (in-VM paths under
  `/home/sandbox/agenta/`, siblings of the relay and tool-MCP dirs, off the geesefs cwd);
  `configureDaytonaCodexEnv(plan, daytonaEnv)` sets `CODEX_HOME` + `CODEX_SQLITE_HOME` for a managed
  Daytona codex run; `writeCodexDaytonaManagedAuthFile(sandbox, plan, log)` writes `auth.json` into
  the in-VM home through the sandbox FS API after the sandbox starts.
- `environment-setup.ts`: calls `configureDaytonaCodexEnv(plan, piExtEnv)` so the paths reach the
  Daytona daemon env (fixed at sandbox creation, built from `piExtEnv`).
- `environment.ts`: calls `writeCodexDaytonaManagedAuthFile` inside the `isDaytona` prep block.
- Tests: 4 new cases in `sandbox-agent-codex-assets.test.ts` (env set for managed Daytona; no-op for
  local/subscription/non-codex; auth write via a fake sandbox; no-op without a key).

### The design decision (D-002 M5 amendment, proposed — awaiting ratification)

The approved managed layout is `CODEX_HOME = <cwd>/.codex` plus "reliably delete the key at session
end." On Daytona the cwd is a geesefs mount of durable S3, and the teardown path pauses or destroys
the sandbox *before* any per-run file backstop could delete a key written under the cwd, so that
requirement is not reliably satisfiable there. The repair (same class as the P8 SQLite amendment):
put `CODEX_HOME` on an **in-VM** path for a managed Daytona run, so `auth.json` lives only in the
sandbox VM and is reaped with it. The key never reaches durable storage. Trade-offs recorded in
`decisions.md`: this deviates from the literal cwd layout for Daytona only (local unchanged), and
codex's native `sessions/` rollout is in-VM, so cross-sandbox-replacement resume is not durable on
Daytona. That loses nothing today because `harnessSessionMounts` has no codex mapping (no codex
durable session resume on Daytona exists yet), and warm-sandbox reconnect preserves the in-VM state
within a conversation. An authored `.codex/config.toml` still applies via the D-007 workspace layer.

### Daytona-Secrets (#5277) compatibility

`writeCodexDaytonaManagedAuthFile` carries an explicit invariant comment: the key string is written
**opaquely**. Under the placeholder design the runner would receive a placeholder here, not the real
key, and Daytona's egress proxy substitutes it in flight. P3 proved codex copies the credential
byte-exact into request headers with no client-side validation, so the writer never inspects,
parses, or reformats the string. Same note is in the harness-adapters doc.

### Live QA (direct runner `/run`, bypassing the product connection resolver)

The product path (`/services/agent/v0/invoke`) is blocked in this deployment by a **managed
connection resolver failure** that is harness-independent: an explicit-slug managed connection
(`{mode: agenta, slug: "openai-managed"}`) returns "connection 'openai-managed' not found for
provider 'openai'" for local codex AND is the same for any harness. The release-gate probe (which
uses the default slug-None managed path) works, so the failure is specific to the explicit-slug
lookup and predates this milestone (M4 used subscription, not managed). Debugging the EE resolver is
out of scope.

The runner code was therefore verified at the authoritative layer, the runner `/run` endpoint with
the key in `secrets` and `credentialMode=env` (the sidecar-trust pattern), which is exactly the code
M5 added:

- Model `gpt-5.6-luna` was **rejected by the Daytona sandbox's codex** with
  `Allowed values: gpt-5.3-codex, gpt-5.4, gpt-5.2-codex, gpt-5.1-codex-max, gpt-5.2,
  gpt-5.1-codex-mini`. The Daytona snapshot `agenta-agent-sandbox-v1` ships an **older Codex** than
  the runner-pinned 1.1.7 (whose local model set is the gpt-5.6-* family). See "Daytona snapshot pin"
  below.
- With `gpt-5.4` the run was fully green: `{"ok":true,"output":"DAYTONA-OK", stopReason:"end_turn",
  model:"gpt-5.4"}`, the in-VM `auth.json` authenticated the session, and the sandbox parked cleanly.

Tool run on Daytona: a real product-path tool run is blocked by the same managed connection resolver
issue (platform-tool execution needs the product context, not a raw `/run`). The Daytona non-Pi tool
CODE path (`uploadToolMcpAssets` shim upload plus the in-VM auth) is in place and unit-covered, and
the chat run proves auth + session on Daytona; per the milestone brief this sub-thread is documented
and STOPPED rather than hacked around the resolver.

### Deployment wiring for QA

The worktree `.env.ee.dev.local` gained the `AGENTA_RUNNER_DAYTONA_*` values (copied from the main
checkout) and `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS=local,daytona`. The runner, services, and api
containers of this project were recreated with `run.sh --recreate` to pick them up (the services and
api layers also gate the provider list). `docs/design/codex-harness/spike/scripts/m5-daytona-qa.py`
drives the product path (kept for when the resolver is fixed; `SANDBOX=local` isolates).

## Daytona snapshot pin (finding, follow-up out of scope)

The runner-image pin (D-005, item C) covers the RUNNER image only. The Daytona **snapshot** is a
separate image built elsewhere, and it ships its own, older Codex (the gpt-5.4-era model set). So a
managed Daytona codex run is pinned on the runner side but floats on the sandbox side. The follow-up
is to apply the same `install-agent codex --agent-process-version 1.1.7` pin to the Daytona snapshot
build. Filed as a note here; the snapshot recipe is not in this repo.

## C. Adapter pin (D-005)

The sandbox-agent daemon installs `@agentclientprotocol/codex-acp` into
`$HOME/.local/share/sandbox-agent/bin/agent_processes/codex/` at first codex use with a floating
`^1.1.7`. The daemon exposes `install-agent codex --agent-process-version <v>`, which resolves the
tree and writes a `package-lock.json` (lockfileVersion 3) pinning codex-acp 1.1.7 exactly with its
integrity hash and bundled `@openai/codex` 0.145.0. Baking that install into the image at build time
means the daemon finds the adapter present at runtime and skips the floating fetch. Codex (codex-acp
+ codex CLI, both Apache-2.0) is licensing-clean to bake, unlike proprietary Claude Code. Verified
empirically in a throwaway `XDG_DATA_HOME` (the pinned install produced codex-acp 1.1.7 + codex
0.145.0). `Dockerfile.gh` pins `HOME=/home/node` so the build-time and runtime install dirs match;
an arbitrary runtime uid would miss the baked pin (documented caveat, same class as the existing
"non-root host uid" note). A full runner-image rebuild is the final confirmation; it belongs in the
runner lane's CI.

## B. Release-gate cell

Cell `X1` (`codex` / `local` / `gpt-5.6-luna` / managed) mirrors C3 (Pi local managed). Four
journeys PASS: `chat`, `tool` (a builtin-shell tool ran and the reply carried a shell-only token),
`commit` (a new revision round-tripped, v0→v1), `warm` (turns 2/3 faster). Four SKIP with reasons
now recorded in `coverage.md` and the journey code:

- `mcp` SKIPs (user MCP is Claude-only).
- `approve` / `deny` SKIP because the gate's approval probe is a **builtin `bash`** command, which
  codex runs gateless under its default `agent-full-access` mode (D-008); codex tool approvals ride
  the runner-side `agenta-tools` pause seam (a client-tool-shaped park), verified in M3, not a
  codex-native `tool-approval-request` frame.
- `mount` SKIPs because its token is extracted from a builtin-shell `tool-output-available` payload;
  codex runs shell through native ACP exec frames with a different output shape, so the probe cannot
  read the token even when the file persisted (the `tool` journey confirms codex shell runs). A
  codex-shaped mount probe is a follow-up.

## D. Documentation

- `docs/docs/self-host/agents/01-use-your-own-subscription.mdx`: added the native Codex harness login
  (`~/.codex/auth.json`, `codex login`) and its `CODEX_HOME` runner mount block, mirroring the Claude
  and Pi rows, and clarified it against the existing "codex models through the Pi harness" path.
  `codex login` and the auth path verified against the local codex CLI 0.145.0.
- `docs/design/agent-workflows/documentation/ground-truth.md` and the `interfaces/in-service/**`
  inventory (`backend-adapter.md`, `harness-adapters.md`, `neutral-runtime-dtos.md`, `README.md`):
  the harness enumerations now include `codex` / `CodexHarness` / `CodexAgentTemplate`, with a codex
  bullet covering the D-008 runner-side gate, `harnessMode`, the `CODEX_HOME` credential write, the
  `CODEX_SQLITE_HOME` redirect, and the in-VM Daytona home.

## E. Whole-branch quality sweep

`/simplify` ran as a single-pass inline review (the Agent fan-out is unavailable in this context, so
this was NOT the 4-agent run). The desloppify pass was focused on the un-swept M4/M5 surface (M1-M3
were desloppified per-milestone; M4 got its own `/simplify`). A mechanical slop scan of the whole
production diff (added lines) found no `TODO`/`FIXME`, no debug prints, no swallowed errors, no
new `any`/`as any`; the `Any` in `codex_settings.py` and the ACP `any` on session/request are
documented module conventions accepted in the M3 sweep. Deliberate sibling parity is intentional per
the standing judgment context. One simplification was considered and skipped: the explicit
`CODEX_SQLITE_HOME` on Daytona is redundant given the in-VM `CODEX_HOME` already keeps SQLite off the
durable mount, but it is kept for defensive parity with the local path and to avoid re-QA of a
proven-green path. No code changes resulted from the sweep. Suites re-run green.

## F. Lane split

See `lane-split-plan.md`. Recommended: four area lanes (`codex-sdk` → `codex-runner` → `codex-web` →
`codex-docs`) with disjoint file sets and no split files, PR bases chained bottom-up from `main`.
Alternative concern split named its five hard-case files (`environment.ts` is the worst, spanning all
four runner concerns). Execution is a later session in the main checkout with Mahmoud's go-ahead.

## Open questions / for Mahmoud

1. **Ratify the D-002 M5 amendment** (in-VM `CODEX_HOME` for managed Daytona). Implemented as the
   smallest-safe version (credential off durable storage); the alternative is a cwd home plus an
   early-in-destroy sandbox delete (more moving parts, weaker safety).
2. **Daytona snapshot Codex pin** (follow-up): the snapshot ships an older Codex than the pinned
   runner adapter, so managed Daytona codex floats on the sandbox side. Apply the same pin to the
   snapshot build (recipe is outside this repo).
3. **Managed connection resolver** ("connection 'openai-managed' not found" for an explicit-slug
   managed connection) is broken in this deployment, harness-independent, and blocks the product-path
   Daytona tool run. Likely a deployment/EE issue predating this milestone; worth a separate look.
4. **Lane split** choice: area (recommended) vs concern. Awaiting the go-ahead to execute.

## Test results

- `services/runner`: `pnpm test` → **1252 passed (81 files)**; `pnpm run typecheck` clean.
- `sdks/python`: `pytest oss/tests/pytest/unit/agents` → **691 passed**; `ruff check` clean.
- Web: not touched by M5 (only M1's one-line picker addition, already green).
