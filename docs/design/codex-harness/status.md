# Status

Last updated: 2026-08-02 (PR OPEN on `main`; rebased onto v0.107.0 with codex multimodality
enabled and live-QA'ed 8/8; awaiting Mahmoud review)

## 2026-08-02 — Rebased onto v0.107.0; codex multimodality enabled

Main merged release v0.107.0 (the attachment/multimodality pipeline, the Pi built-ins rework,
wire-contract changes). This branch was brought up to date and codex was wired into the new
attachment path. Pipeline: analysis → merge → implementation (gpt-5.6-sol via codex CLI) → dual
review (opus + gpt-5.6-sol high) → scoped live QA. Evidence:
`reports/107-rebase-multimodality-qa.md`.

- **Merge `9d0ba57a35`** (single merge commit, 0 behind main). Four textual conflicts resolved
  as unions; four semantic breaks fixed in the same pass: dead `builtin_names`/`log` code in
  `CodexHarness` (main deleted both), two dead tests, the 5th `toolCallId` argument through
  `executable-tools.ts` (out-of-band approval matching), and `harnessMode` added to
  `configFingerprint` (normalized: codex modes resolve via `resolveCodexMode`, non-codex
  fingerprints ignore the field).
- **Multimodality: codex was blocked by three independent gates, all fixed** — no `codex` row in
  `ADAPTER_NATIVE_SUPPORT` (attachments.ts), no codex arm in the SDK `model_input_modalities()`,
  and `codex_models.curated.json` declaring text-only. Landed data-first because codex-acp
  hard-fails a prompt whose image the catalog disclaims (`invalidRequest`), unlike Claude/Pi
  which degrade. Plus `CODEX_INLINE_BASE64_MAX_BYTES` (10 MiB) with the `provider_inline_cap`
  outcome, and the legacy inline-image path no longer assumes image capability on codex.
- **Dual review** found one MEDIUM each (the legacy-path hard-fail route; untested semantic
  fixes) and test gaps; all nine findings fixed (`f9064459c1`, `b5a7cf6615`). Merge audited
  against the pure auto-merge: only the eight intended files carry manual choices.
- **Live QA 8/8** on the rebuilt worktree stack: native codex image delivery (local AND
  daytona, model read the digits), over-cap downgrade, warm-turn workspace reuse, pi_core
  regression sanity, approval park/resume smoke, legacy-image degrade.
- **Incident: dev Daytona snapshot drift.** `agenta-agent-sandbox-v1` was rebuilt from main's
  recipe on 2026-08-02, silently reverting the codex pin AND the approval patch. Re-rebuilt from
  this branch (build asserts `codex-acp-approvals=on-request` in-image). The hazard recurs on
  every main-recipe rebuild until this PR merges.
- Suites after everything: runner 1477 (96 files) + tsc clean; SDK agents 731; ruff clean.

## 2026-07-31 — Warm approvals (D-008 amendment) + Daytona snapshot fix

Mahmoud rejected the cold-approval posture on the PR review thread and approved patching the
codex-acp bridge (option c). All landed on this branch and QA'd live:

- **Bridge patch, both images.** The runner image (`scripts/patch-codex-acp-approvals.ts`) and the
  Daytona snapshot (`images/sandbox/daytona/build_snapshot.py`) rewrite the `agent-full-access`
  preset from `approvalPolicy: "never"` to `on-request`, sandbox policy untouched. Anchor
  single-sourced in `codex-acp-patch.json`; both builds fail loudly on drift and are idempotent.
- **Grant handshake.** A Claude/Codex ACP gate that allows a runner-executed tool records an
  execution grant; the `agenta-tools` MCP seam consumes it, so one approval prompts once and an
  ungranted call still fails closed (`onExecutableGateAllowed` → `buildExecutableToolGate`).
- **Daytona was ungated, now fixed.** Before the snapshot fix, an `ask` tool on Daytona executed
  with NO approval (seam gate off remotely + relay guard passes `ask` + codex gated nothing). The
  rebuilt snapshot also pins codex-acp 1.1.7, closing the model-set gap (#5537).
- **QA matrix green** (`spike/scripts/codex-approval-matrix-qa.py`, evidence in
  `reports/warm-approvals-qa.md`): {local, daytona} × {allow, deny, ask-warm, ask-cold1,
  ask-cold2}. Local 20/20; warm resume keeps the parked tool-call id. Local cold2 correctly
  refuses via the single-owner guard; Daytona cold2 completes after the 120s owner TTL.
- **Found + filed, not fixed here:** a crashed replica makes a Daytona session unresumable for
  ~120s with a misleading shim error (pre-existing, harness-independent) — GH **#5611** with a
  candidate fix.
- **Merged with `origin/main`**, PR base retargeted `release/v0.106.1` → `main`. Suites: runner
  1359 (87 files), SDK agents 698, typecheck + ruff clean.
- **Deploy note:** the rebuilt snapshot (`agenta-agent-sandbox-v1`) exists only in the dev-box
  Daytona account. Cloud/self-host accounts must rerun the recipe to get warm approvals and the
  5.6 model set on Daytona.
- **Gap-closing round (same day):** (1) Subscription mode re-proved post-patch
  (`CONNECTION_MODE=self_managed`, warm park + same-id resume + deny, symlinked auth.json in the
  log). (2) The upstream decoupling change is STAGED IN THE PERSONAL FORK ONLY per Mahmoud's
  instruction — `mmabrouk/codex-acp#1` (draft, base and head both in the fork; `APPROVAL_POLICY`
  env override + tests, their suite 335 green): send it upstream whenever ready, referencing
  codex-acp#310. (3) The watchable UI proof is recorded (`reports/warm-approvals-ui-qa.mp4`).
  (4) The release gate's `approve`/`deny` journeys now RUN for codex with an MCP-shaped probe
  (X1 PASS live; non-codex branch re-verified on C3).

## Project state: SHIPPED AS ONE PR, awaiting Mahmoud review

PR: **https://github.com/Agenta-AI/agenta/pull/5509** — `feat(agents): add Codex as a first-class
harness`, base `main`, head `feat/codex-harness`. Opened per decision D-009 (single PR with inline
self-review comments, not stacked lanes; the lane-split plan is superseded). The branch was merged
up onto `origin/main` first (only `website/**` moved on main; zero overlap with our files, no
conflicts). Suites re-verified green after the merge: SDK agents 696, runner 1248 (81 files),
runner typecheck, ruff format + check, golden wire contract. Inline review comments are posted on
the PR covering every non-obvious file and seam. `@coderabbitai review` requested.

Do-not-merge stands — merging is Mahmoud's action. Open for Mahmoud: (1) review the PR; (2) ratify
the D-002 file-free managed-auth final ruling as implemented; (3) the untracked spike
transcripts/scenarios (`spike/scenarios-auth/`, `spike/scenarios-derisk/`, `spike/transcripts/`,
~1.5MB, placeholder credentials only) were intentionally NOT committed — decide whether they belong
in the public repo. The three QA recordings (m1/m3/m4 MP4s) ARE committed in `reports/`.

### Previously (before the D-009 single-PR ruling)

All five milestones are code-complete and green on `worktree-codex-harness`. The lane split
(`lane-split-plan.md`) is superseded by D-009. Do-not-merge stands.

## Now (Milestone 5 — Daytona, pin, release gate, docs, sweep, lane plan) — CLOSED

- Notes: `reports/m5-implementation-notes.md`. Final suites: runner **1252**, SDK agents unit
  **691**, ruff + typecheck clean; web untouched by M5.
- **A. Daytona managed-key Codex GREEN — now FILE-FREE (D-002 final ruling).** Managed auth writes NO
  `auth.json`; the SDK renders a custom `model_providers` block with `env_key = "OPENAI_API_KEY"`
  into `<cwd>/.codex/config.toml` and codex reads the key from the daemon env at request time.
  `CODEX_HOME` is the durable `<cwd>/.codex` on both local and Daytona (native resume durable);
  `CODEX_SQLITE_HOME` in-VM/off-mount. Both managed auth.json writers + the ordering-buggy destroy
  backstop DELETED. Placement: SDK seam (`codex_settings.py`), runner stays a dumb writer. RE-QA all
  four GREEN: (a) local managed durable multi-turn codeword recalled + NO auth.json on disk + config
  provider block + rollouts on mount + sqlite off-mount; (b) local managed tool; (c) Daytona managed
  chat (durable home, file-free, gpt-5.4); (d) subscription chat+tool green, symlink intact, host
  hash unchanged, no provider block. QA sandboxes deleted. (The earlier in-VM `CODEX_HOME` M5
  amendment was rejected + superseded.) Daytona snapshot still ships an older codex than the runner
  pin (model-set mismatch) — follow-up: pin the snapshot recipe too. (RESOLVED 2026-07-31: the
  recipe now pins codex-acp 1.1.7 + applies the approval patch; see the top entry.) The
  product-path explicit-slug managed-connection-resolver failure (harness-independent) is filed as
  GH #5499.
- **B. Release-gate cell X1 GREEN** (codex/local/managed). chat/tool/commit/warm PASS;
  mcp/approve/deny/mount SKIP with codex reasons (D-008 + probe-shape). Added to the tracked
  `agent-release-gate` skill (`qa_product.py`, `coverage.md`).
- **C. Adapter pin (D-005) landed** in both runner Dockerfiles (`install-agent codex
  --agent-process-version 1.1.7`); versions recorded in `services/runner/package.json`. Full
  image-rebuild confirmation belongs in the runner lane's CI.
- **D. Docs synced**: self-host subscription page (`CODEX_HOME` mount), agent-workflows ground-truth
  + interface inventory (codex harness rows).
- **E. Sweep clean**: `/simplify` (single-pass, no Agent fan-out) + focused desloppify over M4/M5;
  no actionable slop, no code changes.
- **F. Lane plan**: `lane-split-plan.md` (recommended area split, disjoint; concern-split
  alternative with hard-case files named).

## Milestone 4 — CLOSED (2026-07-25)

## Now (Milestone 4 — subscription auth)

- CODE COMPLETE and green. Notes: `reports/m4-implementation-notes.md`. Codex now authenticates
  from the operator's ChatGPT/Codex subscription: `~/.codex` is mounted read-write as `CODEX_HOME`
  (gitignored `hosting/.../docker-compose.dev.codex-sub.local.yml`); a local `runtime_provided`
  codex run requires that mount (run-plan mirrors the Claude `CLAUDE_CONFIG_DIR` branch);
  `CODEX_SQLITE_HOME` is redirected off the home in BOTH modes; managed auth-writing stays
  managed-only so the delete-backstop never touches the mount; the SDK `codex` harness now
  advertises `self_managed`. NO `CODEX_CONFIG` emitted (poison-combo invariant intact). Commit
  `e926a32` (+ the `test_capabilities.py` two-mode fix). Suites: runner 1242, SDK agents 691 +
  capabilities, typecheck + ruff clean.
- LIVE QA GREEN at the wire level: `POST /run` harness=codex credentialMode=runtime_provided (no
  key) → `{"ok":true,"output":"I'm running and ready."}`; container `OPENAI_API_KEY` empty; session
  uses ChatGPT auth; run SQLite lands off-mount; `~/.codex/auth.json` md5 UNCHANGED (no corruption).
  MP4: `reports/m4-subscription-qa.mp4`.
- **Item C RESOLVED (D-002 symlink-assembly amendment).** The subscription daemon's `CODEX_HOME` is
  now the runner-owned `<cwd>/.codex` (both modes); `auth.json` there is a SYMLINK to the mounted
  login, so refresh lands in the real login (P4) but the operator's `config.toml`/`plugins`/`apps`
  never load. Store-mode pin `CODEX_CONFIG={cli_auth_credentials_store:file}` for subscription
  daemons (single scalar, never sandbox_mode). Commit `4fb6483`.
- RE-QA all GREEN: (a) subscription chat `SYMLINK_OK`; (b) inverted leakage probe — the dummy
  `[mcp_servers.*]` does NOT spawn (leak closed); (c) `auth.json` md5 UNCHANGED + the symlink
  survived; (d) subscription + TOOLS on the product path (`m4-tool-qa.py`) — `list_connections` ran,
  no pause, no error. `/simplify` pass done; both suites green (runner 1248, SDK agents 691).

## Milestone 3 — CLOSED (2026-07-25)

- Milestone 3 is CLOSED: code complete + green, live wire QA green, the watchable MP4 recorded, and
  both close-out quality passes done. Both remaining deliverables are in.
- **MP4:** `reports/m3-approvals-qa.mp4` (real playground UI via chrome-devtools, 1280x900, ~16s).
  Shows: Codex agent + runner-executed tool configured; `Allow all` run executes with no pause;
  `Ask` policy renders a real Approve/Deny approval card; Approve resumes + executes; the reply
  preserves the planted codeword FLAMINGO-42; `Deny all` refuses cleanly. Frames in
  `~/.claude/jobs/fd72484c/tmp/qa-frames-m3/`.
- UI finding: the runner-side gate is driven in-product by the agent `Permissions` policy (Advanced
  -> Permissions: Allow reads / Allow all / Ask / Deny all) for RUNNER-executed tools (platform
  ops, workflow refs, MCP). A "schema-only / executed by your app" custom tool is a CLIENT tool that
  bypasses the gate (`not_handled`) — do not use it to QA the gate. Folded into LESSONS.md.
- **Quality passes:** `/simplify` (4 angles) and desloppify-code (scan/review/triage/execute) both
  find the M3 production diff clean — deliberate sibling-pattern parity, invariant-only comments,
  resume-key unwrap in the shared `storedDecisionKeyShape`, `any` on ACP session/request is module
  convention. No code fixes warranted. Suites re-run GREEN: SDK agents 691, runner 1248 (81 files);
  ruff clean. Checkpoint commit carries the close-out docs only.

## Milestone 3 — implementation detail (kept for reference)

- Milestone 3 CODE COMPLETE and green. Notes: `reports/m3-implementation-notes.md`. Six commits
  (local only, not pushed): A default ACP mode `agent-full-access` + per-agent `harnessMode`
  override; B runner-side executable-tool gate at the `agenta-tools` loopback MCP pause seam
  (allow/deny/ask-park, cold-replay resume); C Codex ACP gate classification; D `codex_settings.py`
  Layers 1/2 (Layer 3 tables DROPPED per the D-008 amendment — they crashed codex `session/new`);
  plus the resume-key fix (unwrap codex's MCP `{server,tool,arguments}` envelope). Item E holds by
  construction. Suites: runner 1243, SDK agents 691, typecheck + ruff clean, golden byte-identical.
- LIVE QA GREEN at the wire level (worktree :8180, self-contained `list_connections` tool):
  allow runs without pausing; deny refused cleanly + turn continues; ask parks; warm approve-resume
  executes the tool and preserves the codeword FLAMINGO-42; reject-resume declines; cold-replay
  resume preserves context (the pause tears the session down so every resume cold-creates on the
  owner); agent-mode wire sanity classifies + parks a Codex ACP gate. The runner-KILL cold variant
  is inapplicable to LOCAL sandboxes (single-owner guard, by design; cross-replica cold = Daytona/M5).
- DONE (2026-07-25): the chrome-devtools MP4 (`m3-approvals-qa.mp4`) is recorded in the real
  playground UI (see the CLOSED section at the top). Wire evidence in the notes already validated the
  same behavior via `m3-qa.py`.
- Root-cause correction: the earlier "deployment regression" was WRONG — it was Slice D's
  transport-less `[mcp_servers.*]` tables (the SDK is bind-mounted into the SERVICES container, so
  the M2-runner-rollback control never reverted Slice D). Fixed. Two design items approved by the
  coordinator: cold-replay resume; the typed `harnessMode` wire field.
- Coordination: M4 orchestrator concurrently active on this stack; its runner restarts errored
  in-flight resumes (re-run in stable windows), and a concurrent git op reverted the resume-key fix
  once (now committed).

## Earlier

- Milestone 2 CLOSED. Notes: `reports/m2-implementation-notes.md`. Agenta tools deliver and
  execute on Codex over the internal `agenta-tools` loopback MCP channel (proven live: a
  `discover_tools` call delivered as `mcp.agenta-tools.discover_tools`, relayed server-side,
  tool_call + tool_result traced). Run cost renders non-zero after the real fix (emit
  `gen_ai.response.model` on the Codex LLM span) — the M1 "curated catalog needs pricing"
  diagnosis was WRONG (run cost uses litellm keyed by the span model, not the catalog). Curated
  pricing added anyway (feeds the picker tooltip). Codex MCP dot naming (`mcp.<server>.<tool>`)
  handled on the execution path (`bareToolName`, `serverPermissionFor`). Codex user-MCP capability
  block + picker avatar added. One live tool run pinned as an offline replay test
  (`test_codex_tool_replay`). Suites: SDK agents unit 681, integration cost_free 8, runner 1222.
- OPEN (surfaced, not baked): D-008's approved `agent-full-access` default mode is NOT wired;
  tools work today under the default `agent` mode via runner auto-allow. Wiring it is intertwined
  with M3's runner-side gate + per-agent mode override, so it was kept in M3. Mahmoud to decide
  whether to pull it forward.
- Milestone 1 CLOSED. Report: `reports/m1-report.md`; recording `reports/m1-playground-qa.mp4`.

## Milestone 1 detail (closed)

- Milestone 1 (managed key, text only) implemented by Codex, reviewed by Opus. SDK +
  runner done; SDK agents unit suite 680 green, full runner suite 1218 green.
- Durable-mount blocker RESOLVED via the D-002 P8 amendment: keep `CODEX_HOME=<cwd>/.codex`
  and add `CODEX_SQLITE_HOME` (off-mount local dir) so codex's WAL SQLite state leaves the
  geesefs mount. Live QA on the real durable session path is multi-turn green: turn 1 sets
  codeword FLAMINGO-42, turn 2 (same session) recalls it, both finish=stop, no hang. On
  disk: no `*.sqlite` on the mount; all SQLite in `CODEX_SQLITE_HOME`; `sessions/` rollouts
  and the `.tmp/plugins` git clone on the mount are fine (git's `CreateLinkOp` warnings are
  benign, no wedge). Quality passes done (`/simplify`; desloppify applied manually because
  the worktree skill dirs are empty; final diff review). Details in
  `reports/m1-implementation-notes.md`.

## Earlier

- Milestone 0 done; Checkpoint 1 rulings are in: D-003 on-request, D-004
  danger-full-access, D-005 pin the bridge, D-002 managed half approved
  (`<cwd>/.codex`) with a Daytona-placeholder compatibility requirement, D-002
  subscription direction approved (mount as CODEX_HOME plus `CODEX_CONFIG` env
  channel; symlinks only as fallback).
- All derisk probes P1 through P7 are DONE (`spike/derisk-findings.md`). Outcomes:
  subscription delivery confirmed (mount plus `CODEX_CONFIG`, daemon-eviction makes
  it per-run); Daytona placeholder compatibility confirmed; symlink fallback safe
  but unneeded; P2/P6/P7 forced the D-008 pivot.
- **D-008 approved (Mahmoud, 2026-07-24): Posture 2.** Default mode
  `agent-full-access`; Agenta-tool approvals enforced runner-side at the
  `agenta-tools` pause seam; per-agent mode override for authors. Milestone 3
  rescoped accordingly (see plan.md). Upstream ask filed as a supporting comment on
  codex-acp issue #310 (decoupling approvals from full access).
- Milestone 1 implementation running (managed-key text-only slice); corrected
  mid-flight to not bake the withdrawn D-004 defaults and to observe the
  poison-combo constraint (never `sandbox_mode` inside `CODEX_CONFIG`).

## Environment

- Worktree `.claude/worktrees/codex-harness`, branch `worktree-codex-harness`, base
  main commit `7b971d8c10`.
- Deployment up at http://<dev-host>:8180 (compose project
  `agenta-ee-dev-codex-harness`, Postgres 5433).
- QA account, project, and API key created through the UI; credentials in the
  worktree `.env` (gitignored) together with the OpenAI experiment key.

## Next

- Milestone 2 finishes (tools + pricing), then Milestone 3 (runner-side tool gate
  per D-008), Milestone 4 (subscription), Milestone 5 (Daytona, docs, release gate,
  PR train).

## Blockers

- None. All rulings in; all probes answered.

## Checkpoint log

- 2026-07-24: plan approved by Mahmoud (worktree + own deployment, Codex gpt5.6-sol
  implements, Opus reviews, desloppify + simplify per milestone, per-milestone
  reports, no implicit decisions). Added the same day: maintain the `add-harness`
  playbook as a living skill, updated every milestone.
- 2026-07-24: Checkpoint 1 presented (D-002, D-003, D-004, D-005). Awaiting rulings.
