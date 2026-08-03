# Milestone 1 implementation notes

Managed-key, text-only Codex harness vertical slice. Implementation written by Codex
(gpt-5.6-sol), orchestrated and reviewed by Opus. This file is the working record for the
milestone report.

## Headline

Milestone 1 is complete and green. Managed-key Codex streams a text answer end to end on
BOTH the ephemeral and the durable session-mount (playground) paths, including a multi-turn
run where a codeword set in turn 1 is recalled in turn 2. The durable-mount blocker found in
the first QA pass (Codex SQLite state wedging on the geesefs mount) is fixed with the approved
D-002 P8 amendment: keep `CODEX_HOME = <cwd>/.codex` and add `CODEX_SQLITE_HOME` pointing at a
local off-mount directory (codex's supported upstream knob). Both unit suites green
(SDK agents 680, runner 1218). Quality passes done. Full evidence below.

### Resolution of the durable-mount blocker (D-002 P8 amendment)

The first QA pass hung on durable sessions because codex writes WAL-mode SQLite state into
`CODEX_HOME`, and geesefs (S3 FUSE) cannot support it. P8 (`spike/derisk-findings.md`) proved
codex exposes `CODEX_SQLITE_HOME` (upstream `codex-rs/state/src/lib.rs:93`), which moves all four
SQLite families (state/goals/logs/memories, each with `-wal`/`-shm`) off `CODEX_HOME` while native
`session/load` resume rides the plain `sessions/` rollout jsonl that stays on the durable home. The
fix (runner `codex-assets.ts` `configureCodexHome`): keep `CODEX_HOME = <cwd>/.codex`, and set
`CODEX_SQLITE_HOME = <tmpdir>/agenta/codex-sqlite/<basename(cwd)>` (a local off-mount dir created
before the daemon starts, cleaned best-effort on destroy). The path is derived from `basename(cwd)`
(per-session-stable, like `relayDir`) so it does not enter the config fingerprint and warm daemon
reuse is preserved. This is parity-or-better with Claude (P8c: Claude keeps its SQLite-free state
off the geesefs cwd too).

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
- `codex-assets.ts` (new) — `configureCodexHome` (sets `CODEX_HOME` + `CODEX_SQLITE_HOME`),
  `codexSqliteHomeDir` (off-mount, per-session-stable), `writeCodexManagedAuthFile` (0700 dir /
  0600 file, create-if-absent, delete-only-if-created), `isManagedCodexRun`.
- `runtime-contracts.ts` / `environment.ts` also track and best-effort-clean `codexSqliteHome`.
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
  -> **1218 passed (78 files)** (includes the `CODEX_SQLITE_HOME` fix tests). `pnpm run typecheck`
  clean.

## Live QA (worktree deployment http://<dev-host>:8180, project 019f93b7-8660-...)

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
- **First durable session pass (before the fix) — HUNG.** Runner logs showed the managed resolve,
  `codex auth.json written`, ACP session created, a burst of codex SQLite writes into `.codex`,
  then `geesefs: *fuseops.CreateLinkOp error: function not implemented` and no completion (3+ min).
  OpenAI egress was fine (401 in 0.17s), so not network. This is what the D-002 P8 amendment fixed.

- **Durable session run, MULTI-TURN, after the fix — PASS.** Same product endpoint, harness `codex`,
  model `gpt-5.6-luna`, with a fixed `session_id` and the conversation history replayed each turn
  (the playground shape). Turn 1: "Remember this codeword: FLAMINGO-42. Reply with exactly: OK" ->
  frames `start -> ... -> text-delta -> ... -> finish` (`finish reason: stop`), text `OK`. Turn 2
  (same session): "What was the codeword I gave you?" -> `finish reason: stop`, text
  **`FLAMINGO-42`** (codeword survived turn to turn). No hang either turn.

  On-disk confirmation of the redirect (inside the runner container):
  - `.codex/` on the geesefs mount held ONLY geesefs-safe files: `auth.json`, `installation_id`,
    `sessions/` (the rollout jsonl), `shell_snapshots/`, `skills/`, `.tmp/`. NO `*.sqlite` files.
  - `CODEX_SQLITE_HOME` (off-mount, `<tmpdir>/agenta/codex-sqlite/<session>`) held all the SQLite
    families: `goals_1.sqlite`/`-wal`/`-shm`, `logs_2.sqlite`/`-wal`/`-shm`, `memories_1.sqlite`.
    Exactly the split P8a predicted.

### The `.tmp` / geesefs residual-risk observation (both directions)

The coordinator flagged two residual risks on the real mount; both were checked and neither wedges:
- **`sessions/` rollout appends on geesefs: fine.** The rollout jsonl was written on the mount and
  turn 2's native context worked (codeword recalled).
- **`.tmp/plugins-*` git clone on geesefs: benign, non-fatal.** Codex clones a plugins repo under
  `CODEX_HOME/.tmp/plugins` at session start. Git DOES trigger `geesefs: *fuseops.CreateLinkOp error:
  function not implemented` (git uses hardlinks), but it is non-fatal: git degrades, the
  `.tmp/plugins` dir plus `plugins.sha`/`plugins.sync.lock` were created, and both turns completed
  cleanly. So the geesefs-lethal case was ONLY the SQLite WAL (now redirected off-mount); the git
  hardlink attempts in `.tmp` fail harmlessly. No design response needed. (Separately, some
  `InvalidAccessKeyId` 403s appeared in the log window, but they belong to the ORPHANED mount of the
  earlier pre-fix hung session, whose temporary S3 credentials had expired, not to the fixed path.)

## Quality passes (milestone close)

- **`/simplify` (single-pass inline; the Agent fan-out was unavailable in this context).** Reviewed
  the milestone diff for reuse, simplification, efficiency, and altitude. Findings: the
  Claude/Codex identical `wire_tools` is real duplication but collapsing it into the base would
  touch Claude and break the deliberate mirror (skipped, out of scope); the `codex_settings`
  renderer and the `INTERNAL_TOOL_MCP_SERVER` constant are unused in M1 but are explicitly-requested,
  clearly-labeled forward-structure for Milestone 3 Layer 3, and keeping the constant preserves
  parity with `claude_settings.py` (kept). No code changes; the code was already clean.
- **Desloppify.** The `.agents/skills/desloppify-*` directories are present but EMPTY in this
  worktree (no `SKILL.md` or engine content materialized), so the skills could not be invoked as
  written. I applied the desloppify principles manually, scoped to the touched files: no
  narration/session-dialogue comments, no dead scaffolding beyond the noted intentional
  forward-structure, comment density matches the surrounding `pi-assets`/`claude_settings` norm
  (why/invariants only), naming consistent. No changes needed.
- **Final fresh-eyes diff review** (`git diff 7b971d8c10..HEAD`): correctness re-confirmed by the
  green suites; style parity with the adjacent Claude code holds; no debug artifacts, no `TODO`/
  `FIXME`, no em-dashes in prose. Clean.
- **Suites re-run after the passes:** SDK agents unit **680 passed**; runner full **1218 passed**.

## Open questions (none blocking)

The durable-mount blocker is resolved (see the headline and the D-002 P8 amendment). No open
questions block Milestone 1. Informational notes carried forward:
- The runner's `codex-acp` bridge was already installed in the container from an earlier session,
  so first-run install latency was not observed here. D-005 pinning still applies for a clean image.
- The `.tmp/plugins` git clone triggers benign `CreateLinkOp` warnings on geesefs (git degrades,
  no wedge). If a future codex version makes that git activity fatal, it has no upstream override
  knob today and would need a design response (noted, not currently a problem).

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

## Desloppify pass (proper run)

Ran the `desloppify-code` skill workflow (scan -> blind review -> triage -> execute -> rescan)
scoped to the milestone's touched files: `sdks/python/agenta/sdk/agents/**` and
`services/runner/src/engines/sandbox_agent/**` (merge-base `7b971d8c10`). Judgment context
applied per the pass brief: Claude-harness style parity is a goal (not slop), comments state
invariants only, forward-structure reserved for Milestone 3 is intentional, and cross-harness
generalization (e.g. deduplicating Claude/Codex `wire_tools`) is out of scope.

### Scan and review findings

The milestone code scans clean. Mechanical scan across the new production files found zero
slop signals: no `TODO`/`FIXME`, no debug `console.log`/`print`, no `any`/`as any`/`@ts-ignore`,
no bare `except`/`noqa`, no empty catches, no swallowed errors, no hardcoded secrets, no
copy-paste marker comments. Every new symbol is wired and reachable (`CodexHarness` in the
harness registry; `CodexAgentTemplate.wire_harness_files` -> `build_codex_settings_files`; the
codex model-catalog loaders via `model_catalog_entries`; `configureCodexHome` /
`writeCodexManagedAuthFile` from the environment setup/acquire path; `CODEX_SUBSCRIPTION_UNSUPPORTED_MESSAGE`
from `buildRunPlan`) — no dead exports. Data consistency holds: `data/codex_models.curated.json`
ids match `CODEX_MODELS` in `capabilities.py` exactly, and the golden `run_request.codex.json`
is asserted on both wire sides. New tests are genuine (real assertions, no skips/xfail,
tautologies, or placeholder bodies). Blind review scored the slice high across the dimensions
(contracts, type safety, design coherence, naming, logic clarity, AI-debt): the code is a
faithful, heavily-invariant-documented mirror of the Claude sibling.

### Fixed

One finding, applied:

- **Type-annotation parity drift** in `adapters/codex_settings.py`: `build_codex_settings_files`
  typed its reserved `permission_default` parameter as `Any`, while the sibling
  `build_claude_settings_files` types the same parameter `PermissionMode`. Since style parity
  with the Claude adapter is an explicit goal and Claude is the reference, aligned it: imported
  `PermissionMode` from `..tools.models` (the same top-level import `claude_settings.py` already
  uses) and changed the annotation. Near-zero risk (the parameter is reserved/unused in
  Milestone 1) and it strengthens the type for when Milestone 3 wires it. No behavior change.

### Consciously skipped

- **Reserved Milestone 3 forward-structure** — `build_codex_settings_files`'s unused
  `sandbox_permission` / `mcp_servers` / `tool_specs` / `permission_default` parameters, the
  `INTERNAL_TOOL_MCP_SERVER` constant, and the Layer-2/Layer-3 hooks in `codex_settings.py`.
  Explicitly reserved and documented for the permissions milestone; kept per the brief.
- **Claude/Codex parity duplication** — near-identical `wire_tools`, the `custom_tools` property,
  and the `CodexHarness`/`ClaudeHarness` bodies. Intentional mirror; deduplicating across
  harnesses is out of scope.
- **Prettier-reformatted unrelated import blocks** in `environment.ts`, `environment-setup.ts`,
  and `runtime-contracts.ts` (multi-line imports collapsed). Correct repo formatting, not slop;
  reverting would fail the prettier hook.
- **Double `isManagedCodexRun` guard** across `configureCodexHome` and `writeCodexManagedAuthFile`.
  Each is a separate public entry point that must guard itself; not redundant.

### Final suite results

- `sdks/python`: `ruff format --check` — 70 files already formatted; `ruff check` — all checks
  passed; `pytest oss/tests/pytest/unit/agents` — 680 passed.
- `services/runner`: `pnpm test` — 78 files, 1218 passed.

All green. The single fix is committed as one local checkpoint commit.
