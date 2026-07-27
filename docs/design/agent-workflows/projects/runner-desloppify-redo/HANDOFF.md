# Handoff: runner sandbox-agent decomposition (redo on current main)

This document is the running record for the overnight refactor that redoes the sandbox-agent
decomposition on current `origin/main`. It is written for a reader who is comfortable with the
product but does not write TypeScript. Every section uses plain sentences. The goal of the work
is to split one very large runner file into small, well-named files, and to draw three clean
seams (sandbox provider, harness, and tool delivery), without changing any behavior at all.

## What "no behavior change" means here

The runner is the service that runs an agent inside a sandbox. Its main file,
`services/runner/src/engines/sandbox_agent.ts`, has grown to about 2,477 lines. This work moves
code out of that one file into several smaller files, and groups those files into folders by
subsystem. It does not change what the code does. Every test that passed before must still pass,
the network messages the runner sends and receives must be identical, and the way it behaves at
runtime must be identical. If a real bug is found while moving code, it is written down in the
findings section below and the code is moved as-is, not fixed.

## Starting state (verified 2026-07-17)

- The main file `sandbox_agent.ts` is 2,477 lines.
- Main ALREADY has a `sandbox_agent/` folder with 30 smaller files from earlier work. What is
  still too large is `sandbox_agent.ts` itself and `sandbox_agent/session-pool.ts`.
- Baseline before any change, with the pi-openai lanes applied: typecheck passes, and all 1,190
  runner unit tests pass across 76 files.
- The reference for the target shape is a read-only worktree at
  `.worktrees/desloppify-sandbox-agent/`. It shows the same split done on month-old code. Its
  file names and module boundaries are the approved template. Its CONTENT is old and is not
  copied; today's code is extracted into files with those names.

## Decision: unapply the pi-openai lane for a clean base

The lane `feat/pi-openai-compatible-models` is applied in the workspace and changes four of the
files this refactor relocates: `sandbox_agent.ts` (73 added lines spread across the import block,
`shouldSuppressPausedToolCallUpdate`, the `SessionEnvironment` interface, and four regions inside
`acquireEnvironment`), plus `daytona.ts`, `pi-assets.ts`, and the new `pi-model-config.ts`.
Moving code inside a file that another applied lane also edits scrambles which change belongs to
which lane. Because that lane is already committed and pushed, unapplying it is safe and
reversible. The plan is to unapply it, do the decomposition on a clean base equal to
`origin/main`, and note that in the morning it is re-applied and its four-file diff is rebased
over the new file layout. Only the 73 lines inside `sandbox_agent.ts` need re-homing; the other
three files are barely touched by this refactor.

## Phase 1 extraction plan (all moves of existing code, dependency order)

`sandbox-ports.ts` from the template is NOT a Phase 1 move. Those port interfaces do not exist in
today's code; they are a Phase 3 design. Phase 1 only moves code that already exists.

Two decompositions:

Decomposition A, slim the session pool:
1. `session-identity.ts` — move the identity, fingerprint, credential-epoch, and pool-key
   helpers OUT of `session-pool.ts` (readKeepaliveConfig, resolvesToLocalProvider,
   configFingerprint, historyFingerprint, expectedNextHistoryFingerprint, priorConversation,
   approvalDecisionForToolCall, tailIsFreshUserMessage, KeepaliveConfig, CredentialEpoch,
   computeCredentialEpoch, mountCredentialsExpired, credentialEpochMismatch, credentialEpochValid,
   PoolScope helpers, poolKeyFor). Leaves `session-pool.ts` as just the SessionPool class and its
   directly related types.

Decomposition B, split the monolith `sandbox_agent.ts`:
2. `runtime-policy.ts` — the small pure policy functions (runCredential,
   serverPermissionsFromRequest, shouldSuppressPausedToolCallUpdate, applyClaudeConnectionEnv,
   modelResolutionStrict, defaultResolveLocalRunnerOwner, isTransportEndpointDisconnected,
   containsTransportEndpointDisconnected).
3. `runtime-contracts.ts` — the interfaces and types (SandboxAgentDeps, CurrentTurn,
   ParkedApproval, ResumeApprovalInput, RunTurnOptions, sendLastMessageOnly, SessionEnvironment,
   AcquireEnvironmentResult, the RUN_LIMIT_TRIPPED symbol).
4. `session-events.ts` — routeSessionEventToActiveTurn, routePermissionRequestToActiveTurn.
5. `environment-setup.ts` — the setup helper (prepareEnvironmentSetup), which the template
   carved out of the middle of `acquireEnvironment`. This is the one genuinely new boundary; it
   is a region extraction, guided by the template.
6. `environment.ts` — acquireEnvironment, destroyInFlightSandboxes,
   destroyInFlightSandboxesForSession, resolveKeepaliveMount, invalidateContinuity.
7. `run-turn.ts` — runTurn.
8. `engine.ts` — runSandboxAgent and shouldPark (the facade's brain).
9. `sandbox_agent.ts` — becomes a thin file that only re-exports the public surface.

After EACH extraction: run typecheck and the runner unit tests; both must pass; then commit that
one step to the lane with a clear message.

## Phase 2 grouping plan

After the flat extraction, group `sandbox_agent/` into subfolders: `environment/`, `session/`,
`turn/`, and `tools-delivery/`, with top-level facade, engine, runtime-contracts, runtime-policy,
and errors. Each subfolder gets an `index.ts` public entry, and imports from outside a subfolder
go through that index. Placement rationale is recorded here as it is decided.

## Phase 3 ports

Three seams become explicit interfaces with one dispatch point each: sandbox provider, harness,
and tool delivery. The full requirements from the coordinator, including the E2B and harness
credential details and the anti-goals, are in the "Phase 3 port requirements" section at the end.

## Milestone log

- 2026-07-17: Context gathered. Baseline green (typecheck, 1,190 tests). Template boundaries
  mapped. Decision recorded to unapply `feat/pi-openai-compatible-models` for a clean base.
  Phase 1 order fixed. Project docs created.


- 2026-07-17 (~21:24Z): PHASE 1 COMPLETE. Lane `refactor/runner-sandbox-agent-decomp`, 8 commits, each typecheck-clean with all 1158 runner unit tests passing:
  1. session-identity.ts out of session-pool.ts (f9d19abbea)
  2. runtime-policy.ts out of the monolith (c6eaf6e23e)
  3. runtime-contracts.ts out of the monolith (8bd1dc9135)
  4. session-events.ts out of the monolith (7c48302046)
  5. environment.ts (whole acquireEnvironment + destroy/keepalive helpers) out of the monolith (98b7369225)
  6. run-turn.ts (runTurn) out of the monolith (5e53a9ebd4)
  7. engine.ts (runSandboxAgent + shouldPark) and sandbox_agent.ts reduced to a 44-line re-export facade (4e676476f3)
  8. environment-setup.ts carved out of acquireEnvironment (prepareEnvironmentSetup returns a 21-key bundle; typecheck enforced completeness) (111d4c65ac)
  The monolith went from 2,477 lines to a 44-line facade. Public export surface unchanged (facade re-exports the same names). New-since-template behaviors survived verbatim (the subagents added today's newer fields/imports that the month-old template lacked: signAgentMountCredentials, agentMountCreds, seedForRun, toolSpecsByName, the 7 extra setup bundle keys, etc.).

- 2026-07-17 (~21:37Z): DRAFT PR #5369 opened (https://github.com/Agenta-AI/agenta/pull/5369), base main, lane refactor/runner-sandbox-agent-decomp, head d980dedf17 (remote==local verified). coderabbit review requested. Phase 1 shipped; Phases 2-3 deferred with designs (see below and port-design.md). Do-not-merge until the morning review. agent-release-gate not run tonight (would require a disruptive runner redeploy on the shared local stack); recommended pre-merge.

## Decisions

- Base for the new PR is `origin/main`.
- `sandbox-ports.ts` is Phase 3, not Phase 1, because its interfaces are new.
- pi-openai lane unapplied during the work, re-applied and rebased in the morning.

## Open questions

- None blocking yet.

## Findings: bugs seen but not fixed

None yet. Add file, line, what looks wrong, and why it was left alone. Do not fix inline. The
client-tools silent-drop in `run-plan.ts` is owned by the other orchestrator; do not touch it.

## Rebase map: where the moved code now lives (for PR #5363 and the pi-openai re-apply)

The public export surface of `engines/sandbox_agent.ts` is unchanged (the facade re-exports the
same names), so anything that imports FROM the facade needs no change. Only code that edited the
INTERNALS of the old monolith needs to point at the new file.

For JP's PR #5363 (Extend sessions):
- The reconnect-failure branch and the pointer-write-after-hydrate branch inside
  `acquireEnvironment` now live in `engines/sandbox_agent/environment.ts` (the acquire back-half of
  `acquireEnvironment`). If a change touches the setup prefix instead (ownership check, mount
  signing, buildRunPlan, daemon env), that is now `engines/sandbox_agent/environment-setup.ts`.
- The turn-completion sync call inside `runTurn` now lives in `engines/sandbox_agent/run-turn.ts`.
- The `SandboxAgentDeps` interface now lives in `engines/sandbox_agent/runtime-contracts.ts`.
- The rewrite of `sandbox-reconnect.ts` and the rewrite of `session-continuity-durable.ts` land on
  those same files — they were NOT moved (Phase 2 grouping is deferred), so those hunks apply as-is.
- Anything that imported identity/fingerprint/pool-key helpers from `session-pool.ts` (for example
  `configFingerprint`, `poolKeyFor`, `computeCredentialEpoch`) now imports them from
  `session-identity.ts`. The `SessionPool` class and `LiveSession`/`ParkInput`/`SessionState`
  stayed in `session-pool.ts`.

For the pi-openai lane (feat/pi-openai-compatible-models, PRs #5345/#5346), when it is re-applied and
rebased over this refactor, its four-file diff re-homes like this:
- Its `daytona.ts`, `pi-assets.ts`, and new `pi-model-config.ts` are unchanged locations (those files
  were not moved), so those apply as-is.
- Its 73 added lines in the old `sandbox_agent.ts` re-home by region: the import-block additions map
  to the module that now owns that symbol; its `shouldSuppressPausedToolCallUpdate` edit is now in
  `runtime-policy.ts`; its `SessionEnvironment` interface edit is now in `runtime-contracts.ts`; and
  its four edits inside `acquireEnvironment` are now in `environment.ts` (or `environment-setup.ts`
  if the edited lines fell in the setup prefix). This is the "small conflict to rebase over in the
  morning" the task anticipated.

## Phase 3 port requirements (captured from the coordinator; keep in spirit)

See the companion notes captured in the milestone log. The sandbox provider port must use two
axes (is-remote and provider-identity) expressed as declared capability flags, never scattered
booleans, and must cover: is-remote, working-directory-is-a-FUSE-mount, can-enforce-network-
policy, can-inject-runtime-credentials, and who-installs-the-harness-binary. Keepalive is a
declared trait (Daytona native autostop is a no-op; E2B-style needs a runner refresh loop keyed
on a stable sandbox id, plus a create-time self-reap backstop that fires even if the runner
dies). The port is a thin adapter over the sandbox-agent library, owning only extended lifecycle,
keepalive, typed create options (no `any`), and capability declaration. The filesystem part has
built-in path containment and path-flavor awareness; the process part runs an argument vector
with no shell. The harness port models credentials as environment keys plus an optional
credential file (path, render, required-in-managed-mode), uses strict per-file upload allowlists
(never a directory copy), renders per-run config that wins over uploaded files, dispatches asset
preparation in one place keyed on harness id, and keeps the daemon's credential-env blanking list
a superset of every harness's env keys. Anti-goals: boolean accretion on the run plan, cloned
per-cell files, informational-only env flags, and `any` casts.

## Verification status (Phase 1)

On lane `refactor/runner-sandbox-agent-decomp`, after all 8 extraction commits:
- `pnpm run typecheck` in services/runner: passes.
- `pnpm run test:unit`: 75 files, 1,158 tests, all passing.
- `pnpm run build:extension`: builds the Pi extension and the stdio tool shim, exit 0.
Each of the 8 commits was individually verified green before the next, so the history bisects cleanly.

## Decision: defer Phase 2 (subfolder grouping) and Phase 3 (ports) to a follow-up, ship Phase 1 now

This is a judgment call driven by three concrete findings. The task explicitly invited judgment on
edge cases, and behavior preservation is the absolute constraint.

1. A real, hard-to-verify-tonight behavior risk in grouping. `daemon.ts` computes its package root
   as `dirname(dirname(dirname(fileURLToPath(import.meta.url))))` — three directory levels up from
   the file's own location. That package root drives where the Pi and adapter binaries are found at
   runtime. Moving `daemon.ts` one level deeper into a subfolder silently changes that root and
   breaks binary resolution in a real deployment, and the unit tests do not exercise real binary
   resolution, so typecheck and the unit suite would BOTH stay green while the runtime broke. It is
   the only file with self-location path logic (verified by grep for import.meta.url / __dirname /
   fileURLToPath across the whole folder), but it means grouping is not the pure, test-gated
   mechanical change it appears to be.
2. Cross-lane friction, present tense. The other orchestrator is actively editing `run-plan.ts` in
   this same workspace. Moving that file now would hunk-lock against their in-flight change. So
   `run-plan.ts` cannot be grouped tonight at all.
3. Cross-lane friction, future tense. The pi-openai PRs (#5345 and #5346) are open and edit
   `daytona.ts` and `pi-assets.ts`. Renaming those into subfolders turns their eventual rebase into a
   rename-plus-edit conflict for no behavior benefit.

Grouping under those constraints becomes an exception-riddled half-move (daemon, run-plan, daytona,
pi-assets all stuck at top level) with large import churn across ~30 external importers, a real
runtime risk on daemon, and zero behavior improvement. The same risk profile applies to a large
Phase 3 port refactor: consolidating the currently-scattered provider, harness, and tool-delivery
logic into one dispatch point each is exactly where subtle runtime-behavior differences hide, and it
touches the same pi-openai-conflicting `daytona.ts`. The unit suite is strong but, as the daemon
case shows, not a full runtime guarantee.

Therefore Phase 1 (the decomposition redo — the primary ask, "redo #5264's shape on current main")
ships now as a clean, fully verified, behavior-preserving draft PR. Phases 2 and 3 are captured as
concrete designs below and in `port-design.md`, ready for a focused follow-up that can run the
agent release gate and a real end-to-end run to verify the runtime behavior the unit tests miss.
The recommended follow-up sequence: land pi-openai (#5345/#5346) and the run-plan fix first, then do
grouping and ports on a clean base with runtime verification.

## Phase 2 grouping plan (deferred; do after pi-openai and the run-plan fix land)

Target subfolders under `services/runner/src/engines/sandbox_agent/`, each with an `index.ts` public
entry; imports from outside a subfolder go through its index only.
- `environment/`: environment.ts, environment-setup.ts, provider.ts, daytona-provider.ts, mount.ts,
  agent-mount.ts, agent-mount-guidance.ts, workspace.ts, model.ts, capabilities.ts, acp-fetch.ts.
- `session/`: session-pool.ts, session-identity.ts, session-continuity.ts,
  session-continuity-durable.ts, session-events.ts, sandbox-reconnect.ts.
- `turn/`: run-turn.ts, transcript.ts, usage.ts, run-limits.ts, pause.ts, acp-interactions.ts,
  pi-error.ts.
- `tools-delivery/`: mcp.ts, tool-mcp-assets.ts, relay-guard.ts, pi-gate-envelope.ts, client-tools.ts.
- Stay at top level: sandbox_agent.ts (the facade), engine.ts, runtime-contracts.ts,
  runtime-policy.ts, errors.ts.
- Stay at top level as documented EXCEPTIONS, not because they belong there:
  - `daemon.ts` — location-dependent package-root path (see finding 1). If ever moved, add one
    `dirname(...)` per level of new depth and verify binary resolution against a real run.
  - `run-plan.ts` — actively edited by the other orchestrator; move it only after that lane lands.
  - `daytona.ts`, `pi-assets.ts` — edited by pi-openai (#5345/#5346); move them only after those land
    (they belong in `environment/`). `pi-assets.ts` could alternatively live in `tools-delivery/`
    since it prepares the Pi bundled extension; environment/ is the simpler home because
    environment-setup.ts drives it.
Grouping is behavior-safe for every file EXCEPT daemon.ts (path depth) once the cross-lane files can
move, and it is fully gated by typecheck plus the unit suite for the non-daemon files.

## Milestone: rebased onto v0.105.4 main (2026-07-18)

The lane was rebased from old main onto the released v0.105.4 main and is now conflict-free,
green, and pushed. PR #5369 flipped from CONFLICTING to MERGEABLE.

- **New base:** `80daf23257` (Merge #5368 release/v0.105.4). Reached via `but pull`, which also
  archived the three now-merged lanes it saw applied (feat/pi-openai-compatible-ui,
  feat-runsh-overrides-and-recreate, fix/runner-daytona-client-only-tools-gate) and cleanly
  rebased the two unrelated applied lanes (fix/claude-fable-model-id, qa-agent-release-gate).
- **Lane tip:** `db13a17add`. Remote == local verified after `but push -f`.

### Conflicts hit and how resolved

`but pull` left five of the nine extraction commits conflicted, each in `sandbox_agent.ts`, all
because a release fix touched a region the refactor was moving out of the monolith. Resolved
bottom-up with `but resolve <commit>` / `but resolve finish`:

1. **runtime-policy extraction** — the `shouldSuppressPausedToolCallUpdate` region. The only
   base-vs-ancestor difference was cosmetic type-union reformatting (no behavior). Accepted the
   refactor's deletion (functions live in `runtime-policy.ts`).
2. **runtime-contracts extraction** — the `AcquireEnvironmentResult` region; again only cosmetic
   union reformatting. Accepted the deletion (types live in `runtime-contracts.ts`).
3. **environment extraction** — two regions: the import block (took the refactor's minimal facade
   imports) and the whole `acquireEnvironment` body (accepted deletion — it moved to
   `environment.ts`). Main's #5345 delta to `acquireEnvironment` was extracted and set aside here,
   then re-homed (see below), so nothing was dropped.
4. **run-turn extraction, engine extraction** — cleared automatically once the lower commits were
   resolved (no residual markers).

### Re-homing the #5345 delta (the one real behavioral merge)

Main's #5345 added the OpenAI-compatible model-config plan inside `acquireEnvironment` (7 hunks).
Because the refactor split that function across `environment-setup.ts` (the setup prefix) and
`environment.ts` (the acquire body), the delta was threaded through the split in a dedicated
commit `db13a17add`:
- `prepareEnvironmentSetup` (environment-setup.ts) now builds `piModelConfig` / `piModelConfigError`,
  passes `piModelConfig` into `prepareLocalPiAssets`, computes `localModelConfigUnwritable`, and
  returns all three in its bundle. Imports `buildPiModelConfigPlan` / `PiModelConfigPlan`.
- `acquireEnvironment` (environment.ts) destructures those three, throws `piModelConfigError` /
  `PI_MODEL_CONFIG_WRITE_FAILED_MESSAGE` at the fail-loud/fail-closed gates, passes `piModelConfig`
  into `prepareDaytonaPiAssets`, and selects the fully-qualified `wantedModel`. Imports
  `PI_MODEL_CONFIG_WRITE_FAILED_MESSAGE`.
This is a faithful transcription of main's logic, verified below.

### No release code lost

Every unmoved release file in the lane tip is byte-identical to `origin/main` (0-line diff):
transcript.ts (#5364), run-plan.ts (#5366), daytona.ts, pi-assets.ts, pi-model-config.ts (#5345),
tracing/otel.ts (#5362), package.json, pnpm-lock.yaml.

### Verification

- `pnpm run typecheck`: clean (after `pnpm install` picked up the release's OTel 2.x / Daytona
  0.198 bump — the stale node_modules was the only typecheck failure and is not a lane change).
- `pnpm test`: 76 files, **1192 tests, all pass** (was 1158/75; the +34/+1 are the release's own
  new suites now running green on the rebased tree).
- `pnpm run build:extension`: pass.
- Runner runtime smoke test: booted the rebased runner with the new deps; `/health` -> 200 with the
  full harness list, `/run {}` -> correct structured validation error, no crash. Evidence in
  `debug/qa-refactor-rebase/` (runner-boot.log, health.json).
- Full product `agent-release-gate`: NOT run. It needs a rebuild + services-repoint on the shared
  custom-named EE-dev stack (whose product agent path is currently pointed at a dead sidecar). The
  v0.105.4 release is already product-gate-clean (`debug/qa-105.4/`) and this change is
  behavior-identical to it, so it is deferred as the recommended pre-merge step on a dedicated stack.

### State

Draft PR #5369, base main, head `db13a17add`, MERGEABLE. Do not merge (Mahmoud merges). The
morning re-apply of pi-openai (#5345/#5346) noted earlier in this doc is now moot — pi-openai is
merged into main and its runner delta is already in the rebased base; only the acquireEnvironment
re-home (commit db13a17add) was needed.
