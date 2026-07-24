# Milestone 1 implementation notes

Managed-key, text-only Codex harness vertical slice. Implementation written by Codex
(gpt-5.6-sol), orchestrated and reviewed by Opus. This file is the working record for the
milestone report.

## Headline

The SDK and runner code is complete, both unit suites are green, and a managed-key Codex
run streams a text answer end to end on an EPHEMERAL cwd. Live QA surfaced ONE blocker on
the durable session-mount path (the path the playground uses): Codex writes SQLite state
into `CODEX_HOME`, and with `CODEX_HOME = <cwd>/.codex` on the geesefs (S3-backed) durable
session mount the turn hangs. This invalidates the premise of approved decision D-002
Option A and needs a Mahmoud ruling before the playground check passes. Details in
"Open questions / blocker" below. I did not re-architect around it (surface-pivots rule).

## Scope recap

`HarnessType.CODEX`, the `CodexHarness` adapter + `CodexAgentTemplate`, `codex_settings.py`
(renders `.codex/config.toml`), capabilities + curated model catalog, golden wire fixture,
runner wiring (CODEX_HOME + managed `auth.json`, codex subscription rejection, daemon
config-dir inheritance), and tests both sides. Managed key only. No tools, no permissions UI,
no subscription, no Daytona.

## Mid-flight correction (from derisk probe P2, applied during the slice)

The coordinator relayed three changes after the SDK core landed, all now reflected:

1. **No baked D-004/D-003 defaults in `codex_settings.py`.** P2 (`spike/derisk-findings.md`)
   proved `codex-acp` sends `approvalPolicy`/`sandboxPolicy` per turn from its ACP `mode` preset,
   overriding any config-file `sandbox_mode`, so baking `danger-full-access` / `on-request` there
   is a no-op or misleading. `codex_settings.py` now renders ONLY authored options and emits no
   file when nothing is authored (same rule as `claude_settings.py`). Platform defaults are
   decision D-008 (pending), landing in Milestone 3. A text-only M1 run authors nothing (the
   permissions schema does not carry codex keys yet), so it renders no `config.toml` at all and
   runs under the adapter's default mode. This revision to the Codex-written `codex_settings.py`
   and the `dtos.py` docstring was applied by Opus (a targeted correction, not fresh feature work).
2. **Never emit `sandbox_mode` inside a `CODEX_CONFIG` env JSON.** M1 uses no `CODEX_CONFIG` at
   all; the poison-combo invariant is recorded as a standing comment in `codex-assets.ts`.
3. **Model still passed explicitly per run** (unchanged; rides the wire `model` field, applied by
   the runner on the session like Claude).

## Key implementation decisions made during the slice (not requiring a Mahmoud ruling)

- **auth.json is written in the post-mount workspace step, not `environment-setup.ts`.** The task
  brief placed the managed `auth.json` write beside `prepareLocalPiAssets` in
  `environment-setup.ts`. That runs BEFORE the local durable geesefs mount is applied over
  `plan.cwd` (the mount happens in `acquireEnvironment` before `prepareWorkspace`). Writing
  `<cwd>/.codex/auth.json` pre-mount would be shadowed by the mount on any session run. So
  `auth.json` is written by `writeCodexManagedAuthFile` right after `prepareWorkspace` (post-mount),
  and its created path is deleted by a `destroy` backstop mirroring `otlpAuthFilePath`. `CODEX_HOME`
  (a path string, safe pre-mount) is still set in `environment-setup.ts` via `configureCodexHome` so
  the daemon env carries it. This is an implementation-site choice forced by mount ordering, fully
  within the approved D-002 layout. (Note: the same mount is what the blocker below is about.)
- **No `codex` provider group in `PROVIDER_ENV_VAR_GROUPS`.** `CODEX_HOME` is a config-dir PATH,
  not a provider credential, so it belongs in the config-dir inheritance block of `buildDaemonEnv`
  beside `CLAUDE_CONFIG_DIR` / `PI_CODING_AGENT_DIR` (research.md 3.5), not a provider group. A
  managed codex run resolves provider `openai` (group `["OPENAI_API_KEY"]`), which already exists.
- **Codex advertises `connection_modes = ["agenta"]` (managed only) in Milestone 1.** Subscription
  (`self_managed`) is not implemented, so advertising it would surface a UI option that always
  fails; it is added in the subscription milestone. The runner rejection of a `runtime_provided`
  codex run is defense-in-depth for a direct API caller. Two pre-existing capability tests were
  updated to reflect codex being the managed-only exception.

## What was built (file list)

SDK (`sdks/python/agenta/sdk/agents/`):
- `dtos.py` — `HarnessType.CODEX`, `HARNESS_IDENTITIES` codex entry, `CodexAgentTemplate`.
- `adapters/harnesses.py` — `CodexHarness` (+ `_HARNESSES` registration).
- `adapters/codex_settings.py` (new) — renders `.codex/config.toml` from authored options only.
- `adapters/sandbox_agent.py` — `supported_harnesses` += CODEX.
- `adapters/__init__.py`, `__init__.py` — exports.
- `capabilities.py` — `CODEX_MODELS` + the `codex` connection-capability record.
- `model_catalog.py` — codex loader/cache/branch.
- `data/codex_models.curated.json` (new) — 5 curated models (sol/terra/luna/5.5/5.2).

SDK tests (`sdks/python/oss/tests/pytest/unit/agents/`):
- `golden/run_request.codex.json` (new), `test_wire_contract.py`, `test_harness_adapters.py`,
  `test_harness_identity.py`, `test_capabilities_codex.py` (new),
  `connections/test_capabilities.py` (two pre-existing tests updated for the managed-only codex).

Runner (`services/runner/src/engines/sandbox_agent/`):
- `codex-assets.ts` (new) — `configureCodexHome`, `writeCodexManagedAuthFile` (0700 dir / 0600
  file, create-if-absent, delete-only-if-created), `isManagedCodexRun`.
- `daemon.ts` — inherit `CODEX_HOME` as a config-dir path.
- `run-plan.ts` — `CODEX_SUBSCRIPTION_UNSUPPORTED_MESSAGE` + reject codex `runtime_provided`.
- `environment-setup.ts` — call `configureCodexHome`; init `codexAuthFilePath`.
- `environment.ts` — call `writeCodexManagedAuthFile` post-workspace; destroy backstop.
- `runtime-contracts.ts` — `SessionEnvironment.codexAuthFilePath`.

Runner tests (`services/runner/tests/unit/`):
- `sandbox-agent-codex-assets.test.ts` (new), `wire-contract.test.ts`,
  `sandbox-agent-run-plan.test.ts`, `sandbox-agent-daemon.test.ts`.

## Codex-exec tasks issued and how each fared in review

All driven with `codex exec -m gpt-5.6-sol --cd <worktree> --dangerously-bypass-approvals-and-sandbox`
(bypass flag required: codex's bubblewrap cannot init on this host). `codex exec` ran reliably.

1. **SDK core** (identity + adapter + dtos + exports). Faithful mirror of the Claude pair on
   first pass. Opus revised three docstrings only (backend list, the `wire_harness_files`
   "omitted when empty" wording, and a speculative `.codex/skills` comment).
2. **codex_settings.py.** First pass baked platform defaults (per the original brief); after the
   P2 correction Opus rewrote it to render authored-only / no-file-when-empty. Clean otherwise.
3. **Capabilities + curated catalog.** Opus authored the catalog JSON content (honest facts,
   null pricing); Codex wrote the file + `capabilities.py` record + `model_catalog.py` wiring.
   Faithful. Correctly left `HARNESS_CUSTOM_DEPLOYMENT_PROVIDERS` untouched.
4. **Python tests.** Faithful. Two pre-existing capability tests then failed on the new harness
   (a hardcoded harness-set and an "all harnesses support both modes" assertion); Opus updated
   both for the managed-only codex. Final agents unit suite: 680 passed.
5. **Runner standalone (codex-assets.ts + daemon.ts + run-plan.ts).** Clean, faithful to
   pi-assets/claude patterns and the file-mode discipline. Typecheck passed.
6. **Runner wiring (environment-setup / environment / runtime-contracts).** Clean; correct
   post-mount write site and destroy backstop. Prettier reformatted some unrelated import blocks
   in the touched files (canonical output; the runner has no enforced prettier hook on these paths).
7. **Runner tests.** Faithful; new `sandbox-agent-codex-assets.test.ts` covers file mode 0600,
   dir 0700, create-if-absent, delete-only-if-created, and the no-op guards.

## Test results (exact commands + counts)

- Full SDK agents unit suite:
  `cd sdks/python && uv run --no-sync python -m pytest oss/tests/pytest/unit/agents/ -q`
  -> **680 passed**.
- Full SDK suite: `cd sdks/python && uv run --no-sync python run-tests.py`
  -> **2320 passed, 4 skipped, 10 xfailed; 97 errors** — every error is
  `AGENTA_API_URL must be set` (pre-existing acceptance/integration tests that require a live
  backend; unrelated to this change; the unit layer is fully green).
- Full runner suite: `cd services/runner && pnpm test`
  -> **1217 passed (78 files)**. `pnpm run typecheck` clean.

## Live QA (worktree deployment http://144.76.237.122:8180, project 019f93b7-8660-...)

Setup performed:
- Restarted the api and runner containers to load the mounted source (runner runs `tsx src/server.ts`
  with no `--watch`, so it needed a restart; the api process had imported the SDK before the change).
- Created the managed OpenAI vault secret via
  `POST /api/vault/v1/secrets/` (kind `provider_key`, `{kind: openai, provider: {key}}`, slug
  `openai-managed`). The project vault had been empty; the earlier pi_core baseline had passed only
  via the mounted Pi subscription login (`/pi-agent`), not a vault key.

Evidence (product endpoint `POST /services/agent/v0/invoke`, harness `codex`, model
`gpt-5.6-luna`, provider `openai`, connection `{mode: agenta}` = managed):

- **Ephemeral cwd (no session id) — PASS.** Request body: one user text part
  "Reply with exactly: PONG". First streamed frames:
  `start -> start-step -> text-start -> text-delta -> text-end -> finish-step -> finish`,
  `finish reason: stop`, assistant text `PONG`. Runner logs confirm the managed path:
  `resolved model=gpt-5.6-luna provider=openai deployment=direct secretKeys=[OPENAI_API_KEY]`
  and `codex auth.json written home=<cwd>/.codex`.
- **Durable session run (with session id) — HANGS (blocker below).** Runner logs show the
  managed resolve, `codex auth.json written`, `probe_capabilities ms=12` (the ACP session was
  created), then a burst of codex SQLite state writes into `.codex`, then
  `geesefs stderr: *fuseops.CreateLinkOp error: function not implemented` and the turn never
  completes (heartbeats `running=true` for 3+ minutes, I/O flat at 0).

OpenAI egress from the runner is fine (`api.openai.com` -> HTTP 401 with a bad key in 0.17s), so
the hang is not network. The `.codex` dir on the mount contained `auth.json` (my write, 185 bytes),
`goals_1.sqlite` + `-shm` + `-wal`, `installation_id`, `logs_2.sqlite`.

## Open questions / blocker (needs a Mahmoud ruling)

**BLOCKER — D-002 Option A premise invalidated: Codex SQLite state on the geesefs durable
session mount wedges the run.** Codex keeps its own state as SQLite databases in `$CODEX_HOME`.
With the approved `CODEX_HOME = <cwd>/.codex` and `<cwd>` being the geesefs (S3-backed) durable
session mount, geesefs cannot provide the filesystem operations SQLite-WAL needs (no hardlinks:
`CreateLinkOp: function not implemented`; WAL shared-memory over S3 FUSE), and the turn hangs.
An ephemeral (non-session) run, which uses a plain tmp cwd, works perfectly. The Milestone 0 spike
ran the daemon with `CODEX_HOME` on a local tmp dir, so this failure mode was never exercised. The
playground drives session runs, so this blocks the Milestone 1 headline check on that path.

Options (for Mahmoud; I did not pick one, per the surface-pivots rule):
- **Option 1 — put CODEX_HOME on a per-run EPHEMERAL dir off the geesefs cwd** (the pi-agent-dir
  pattern). For Milestone 1 this is clean because no `config.toml` is rendered (authored-only, and
  the schema carries no codex keys yet), so there is nothing to co-locate on the cwd. The cost is
  the Milestone 3 config.toml delivery: `config.toml` currently rides the `harnessFiles` seam into
  `<cwd>/.codex` (cwd-relative, blind runner writer); an off-cwd CODEX_HOME reopens exactly the
  D-002 Option B tradeoff (the runner would have to write config.toml itself, or use `CODEX_CONFIG`
  which the P2 poison-combo constraint restricts). Codex cross-session memory also resets per run
  (already listed as acceptable in design.md).
- **Option 2 — keep CODEX_HOME on the cwd but relocate only codex's STATE off geesefs** (for
  example symlink `<cwd>/.codex` state subpaths, or a codex flag to move its state dir if one
  exists). Unproven; geesefs symlink support (CreateSymlinkOp) is untested and codex may not expose
  a state-dir override separate from CODEX_HOME.
- **Option 3 — do not use a durable session mount for codex runs** (ephemeral cwd always). Loses
  cross-turn workspace persistence for codex; needs a runner branch that suppresses the mount by
  harness.

My recommendation to evaluate first is Option 1 for Milestone 1 (it makes the headline check pass
immediately and is the smallest change), with the Milestone 3 config.toml delivery reopened as a
D-002 follow-up. But this is an approved-decision reversal, so it waits for your ruling.

Secondary open question (informational, not blocking M1):
- The runner's `codex-acp` bridge was already installed in the container from an earlier session,
  so first-run install latency was not observed here. D-005 pinning still applies for a clean image.

## Deferred

- **Daytona managed Codex** (auth.json write into the remote sandbox, delete-only-if-created there):
  Milestone 5. `writeCodexManagedAuthFile` no-ops for `isDaytona` today.
- **Codex subscription (`runtime_provided`, CODEX_HOME mount):** Milestone 4. Rejected up front in
  Milestone 1 with `CODEX_SUBSCRIPTION_UNSUPPORTED_MESSAGE`.
- **Authoring `approval_policy` / `sandbox_mode`:** the permissions schema does not carry codex
  keys yet (Milestone 3). `build_codex_settings_files` reads them defensively so the pass-through
  activates when the schema grows; a direct test pins the rendering.
- **Platform default posture (D-008):** deferred to Milestone 3 per the P2 correction.
- **TS wire-contract cross-check of the codex golden:** the runner side already loads and asserts
  `run_request.codex.json` (added in this milestone); no further deferral.
