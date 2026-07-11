# Warm and resumable Daytona sessions: implementation status

This file is the handoff record. A cold session (Codex or Claude) should be able to
continue the implementation from this file alone, with no other context. Update it after
every milestone, never letting it lag more than one step behind reality. Flat prose, no em
dashes.

## What this feature is

Make Daytona agent sandboxes reusable across turns instead of deleted at every turn end.
Two levels of reuse, built as one progressive sequence in the runner (services/runner):

- Park-to-stopped: at a clean turn end, stop the sandbox instead of deleting it; on the
  next turn, start the same instance and reload the harness session. Parked cost is disk
  only.
- Park-to-running: keep the sandbox running with its live session for a short window so the
  next turn is near instant. Parked cost is live compute, so it gets a time-to-live and a
  hard warm-slot cap.

The runner-side warm plumbing already exists at HEAD (park at turn end, reconnect by stored
id, native session reload, ephemeral:false idle timers). What is missing is the Daytona
provider pause/reconnect functions plus correctness fixes. Full detail is in plan.md in this
folder. Read plan.md first, then open-questions.md.

## Source of truth for WHAT to build

- Plan PR is #5214 (docs only, base big-agents, draft). Remote plan branch
  origin/docs/warm-daytona-sessions-plan, tip 03333b96. Working-tree copies under this
  folder match it (plan.md, research.md, context.md, open-questions.md, README.md,
  status.md).
- Decided parameters (from plan.md and open-questions.md Answered section, approved by
  Mahmoud): env-var controls only, no feature flags; TTL 0 is the off switch;
  AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS default 120000 (2 min); idle-warm cap
  AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM default 20 (bounds idle warm sandboxes only, never
  blocks active turns); stop timer DAYTONA_AUTOSTOP 15 min (env-overridable, resets on every
  turn's API activity); auto-archive REMOVED from the create call entirely (drop
  autoArchiveInterval and DAYTONA_AUTOARCHIVE); delete timer 30 min; overflow degrades to
  park-to-stopped (no queue, no reject); eviction is stop, never delete; typed teardown
  reasons; capacity admission permits taken before create/restart and released only on
  confirmed stop/delete; compatibility fingerprint derived from the resolved create spec (not
  the live pool's configFingerprint, which omits DAYTONA_SNAPSHOT/IMAGE/TARGET).

## HOW to build

Implement with Codex CLI, model gpt-5.6-sol at medium reasoning effort, slice by slice. The
orchestrator (Claude) reviews every codex diff before committing and owns correctness. See
.agents/skills/codex-onboarding/SKILL.md, the ask-codex skill, and
.claude/skills/implement-feature/SKILL.md for the flow. If codex output is off-plan, iterate
with codex rather than hand-writing large chunks.

## WHERE to build: GitButler lane

- Lane: feat/warm-daytona-sessions (ONE new parallel lane, off the base; runner-only changes).
  PR base must be big-agents, never main.
- but CLI only. No raw git commit/branch/stash/worktrees. Take the BUT-LOCK on
  docs/design/agent-workflows/scratch/agent-coordination.md before mutations (15-min expiry);
  release with a summary.
- Commit slice by slice; after each commit verify with git show --stat --name-only <branch>
  that exactly your files landed. Push with but push and VERIFY the SHA landed
  (git ls-remote --heads origin feat/warm-daytona-sessions vs git rev-parse
  feat/warm-daytona-sessions must match).

### Wedge safety (hard rules; UPDATED by Mahmoud 2026-07-11)

Mahmoud's direct instruction mid-run: "never ever use git. only gitbutler." This SUPERSEDES
the earlier plumbing-fallback instruction. All version-control mutations go through the but
CLI only. No git commit, no git push, no index or plumbing surgery, no stash, no worktrees,
under any circumstances. If any but command reports "Failed to merge bases while cherry
picking", "new head names do not match", grows an IdMap error, or silently no-ops: FREEZE all
but mutations immediately, record the exact state and error here, and STOP AND REPORT to
Mahmoud or the coordinator. Do not attempt recovery of any kind. NEVER but oplog restore,
NEVER but clean. Do not touch other lanes; keep the applied-lane count where it is. Read-only
git inspection (git show, git diff, git ls-remote for verification) remains fine; mutations
do not.

## Slice order and per-slice gate

Implement plan.md's five slices in order. After each slice: cd services/runner &&
pnpm run typecheck and pnpm test both green, then commit, then update this file.

- Slice 1 (correctness base, everything disabled): provider wrapper pause/reconnect; the two
  package-patch cleanup fixes (failed pause keeps handle so delete fallback works; failed
  reconnect stops the half-started instance); reconnect state machine over Daytona transitional
  states; teardown by typed reason; guarded+awaited pointer writes (compare-and-set); the
  compatibility fingerprint from the resolved create spec. Park path stays inert (default
  teardown stays delete). Unit tests, no live Daytona.
- Slice 2 (park-to-stopped): wire park path end to end, make stop the default teardown for
  clean resumable turns; timer defaults (stop 15 min, archive configured out entirely, delete
  30 min); conditional stale-id cleanup; mount-generation check on reattach.
- Slice 3 (provider-aware pool refactor): per-provider operator config, engine-owned lifecycle
  adapter with typed teardown reasons, one SessionPool instance per provider, dispatch by
  resolved provider in runWithKeepalive, local semantics preserved, Daytona pool present but
  disabled. Depends on Slice 1's teardown-reason contract, not on Slice 2.
- Slice 4 (park-to-running): warm-slot cap (slots counted for parked, reattaching, stopping
  entries; reconnect start takes a slot first; awaited evict-to-stop; finished turn with no
  free slot parks to stopped); one-time activity refresh at live park (no recurring pings);
  drain-to-stop on graceful shutdown, delete-in-flight on shutdown; credential-epoch bound on
  the window. Ships with the live window at zero until Slice 5 passes. Pending approvals take
  the cold path until F-018's file-transport parked-gate variant lands.
- Slice 5 (live verification, then defaults change): add missing duration log lines (Pi
  install, sandbox created, prepareWorkspace, probeCapabilities, createSession). One credit-
  controlled E3 pass: warm turn latency vs cold, zero sandbox leaks. Count sandboxes
  before/after every run and delete leftovers. Snapshot agenta-sandbox-pi. Then change the
  defaults (stop-not-delete teardown; the two-minute live window) as each gate passes.

## Environment facts

- Canonical sidecar env file: /home/mahmoud/.claude/jobs/3c9a7036/tmp/sidecar.env
- Runner container: agenta-claude-sub-sidecar. RESTART ONLY, never recreate except from that
  env file. It runs tsx over the bind-mounted src, so docker restart
  agenta-claude-sub-sidecar picks up src changes. The Pi extension needs
  node scripts/build-extension.mjs only if you touch src/extensions.
- Runner image rebuild is NOT needed for the sidecar.
- QA driver: docs/design/agent-workflows/projects/qa/scripts/run_matrix.py via uv run.
- Tests: cd services/runner && pnpm run typecheck && pnpm test.
- HARD RULE: never send or mount credential files into Daytona sandboxes.

## Mahmoud's minor comments (dispositions)

All mmabrouk PR comments are the coordinator posting as Mahmoud (shared account). The two
named open questions are both still genuinely open in open-questions.md, so per the task the
plan's proposals are adopted as assumptions (recorded here and to go in the PR body).

- Pointer-write guard mechanism (open-questions item 1): STILL OPEN. Plan must-fix item 3
  already phrases the fix as "a compare-and-set on the turn counter the session_states row
  already carries." ASSUMPTION ADOPTED: guard on the existing turn counter (no schema
  migration, simplest, matches the plan's own default wording). Also make the stale-id clear
  after failed reconnect conditional on the same counter. PR #5197's own continuity write has
  the same unguarded pattern; cover it with the same mechanism if cheap.
- Shutdown stop-vs-delete split (open-questions item 2): STILL OPEN. ASSUMPTION ADOPTED (plan's
  proposal): delete when a turn is in flight (partial transcript), stop when idle; /kill stays
  a hard delete.
- CodeRabbit 5 actionable comments (all on the plan doc, already reflected in plan.md): (1)
  auto-stop as a blocker resolved by the 15-min stop timer greater than the 300s max silent
  interval; (2) do not clear stored id on every reconnect failure, only on confirmed terminal
  cases (not-found/deleted/unrecoverable), retain on transient, implemented in reconnect +
  item 7 conditional clear; (3) bound and verify stop-before-replacement with a deadline and
  state poll, admit a replacement only after confirmed stopped/deleted, implemented in the
  capacity admission gate (Slice 4) and reconnect ownership cleanup; (4) qualify the ~1s resume
  estimate, doc-only, already recosted in research.md; (5) separate Tier 1/Tier 2 blockers,
  superseded by the no-flags single-line-slices reframe.
- Mahmoud 13:27 "where does this Project 3D come from / mount" question on research.md: a
  research-doc clarification about mount provenance after a refactor. Non-blocking for the
  runner implementation. To answer in a PR reply; does not change the code slices.

## Codebase findings (grounding for review)

- Runner files live under services/runner/src/engines/sandbox_agent/ (not the paths some plan
  prose implies): provider.ts (152 lines, builds the daytona create object + the three
  autostop/archive/delete env helpers, still defaults autostop 5 / archive 15 / delete 30 and
  still sets autoArchiveInterval), sandbox-reconnect.ts (readStoredSandboxId/writeSandboxId;
  writeSandboxId does NOT await and has no guard), session-pool.ts (701 lines, engine-agnostic
  SessionPool + configFingerprint at line 112, which omits DAYTONA_SNAPSHOT/IMAGE/TARGET),
  session-continuity.ts (in-memory turn counter, nextTurnIndex/latestTurn), and the big
  engine sandbox_agent.ts (1933 lines). server.ts (1046 lines) holds shouldPark and the park
  wiring at lines 226-577.
- The park/reconnect prototype is ALREADY in the working tree at HEAD, untested (matches the
  plan's "already built"). environment.destroy(opts.keepWarm) in sandbox_agent.ts lines
  793-879 already snapshots the provider handle before pauseSandbox and directly destroys on a
  failed pause (a runner-side mitigation of cleanup gap A). The reconnect path is
  sandbox_agent.ts lines 986-1015: it reconnects via SandboxAgent.start({sandboxId}) and does
  the un-awaited void writeSandboxId(...). Comments there explicitly say "PR #5214 adds real
  pause/reconnect."
- Vendored SandboxProvider interface (node_modules/sandbox-agent/dist/types-DdcvY5CI.d.ts):
  create(), destroy(id), reconnect?(id), pause?(id), getUrl?(id), ensureServer?(id). The
  daytona provider (sandbox-agent/daytona) implements create/destroy/getUrl/ensureServer only.
  Slice 1 adds pause(id) and reconnect(id) via a runner-side wrapper that decorates the daytona
  provider object and builds its own @daytonaio/sdk Daytona client (from the same DAYTONA_*
  env) to call sandbox.stop()/start() and read sandbox.state. SandboxAgent.pauseSandbox() calls
  provider.pause when present, else destroy; SandboxAgent.start({sandboxId}) calls
  provider.reconnect when present.
- The two package-patch cleanup fixes belong in patches/sandbox-agent@0.4.2.patch (currently
  only loadSession + killGroup). Note the runner already mitigates gap A from its side, so
  avoid double-teardown; codex should reconcile rather than duplicate.
- Sessions API (Python): session_states row carries data.latest_turn_index and a sandbox_id
  column. Endpoints in api/oss/src/apis/fastapi/sessions/router.py (SessionStatesRouter,
  set_session_state / set_sandbox_id), DAO api/oss/src/dbs/postgres/sessions/states/dao.py,
  acceptance tests api/oss/tests/pytest/acceptance/session_states/test_session_states_basics.py.

## Scope decision (pointer-write guard): lane is runner-plus-minimal-sessions-API

The plan's must-fix item 3 phrases the guard as "one conditional check on the sessions API," so
a faithful compare-and-set is NOT purely runner-only. DECISION (recorded as the adopted
assumption): implement the guard as (a) runner awaits the sandbox_id write, (b) runner sends its
turn index in the PUT, (c) the sessions API set_sandbox_id performs a backward-compatible
compare-and-set: overwrite sandbox_id only when the incoming turn index is >= the stored
data.latest_turn_index; when the turn index is absent, behave exactly as today. This adds a few
lines to the Python sessions service plus a test. The lane therefore touches api/ minimally; the
parallel-off-base rationale still holds (no dependency on another lane). Flag this in the PR body.

## Codex invocation (the coding engine)

Run from repo root so codex can touch both services/runner and api. IMPORTANT: in this
already-sandboxed environment codex's own bubblewrap sandbox fails (bwrap: loopback: Failed
RTM_NEWADDR: Operation not permitted) and blocks ALL file writes, so you MUST pass
--dangerously-bypass-approvals-and-sandbox (correct here: the environment is externally
sandboxed and the repo is trusted in ~/.codex/config.toml). Do NOT use -s workspace-write here.
  cat prompt.md | codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium \
    --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check \
    -C /home/mahmoud/code/agenta -
codex default model is already gpt-5.6-sol; effort overridden to medium per Mahmoud. Codex edits
the working tree directly; the orchestrator reviews git diff, runs pnpm typecheck + pnpm test in
services/runner, then commits to the lane via but. Codex prompts are saved under
/home/mahmoud/.claude/jobs/3c9a7036/tmp/ (git-ignored) for the record.

## Progress log (newest last)

- 2026-07-11: Orchestration started. Read plan.md, open-questions.md, all PR #5214 comments,
  codex-onboarding + implement-feature skills, and surveyed the runner + sessions-API code.
  Wrote this status file with comment dispositions, codebase findings, and the pointer-guard
  scope decision. Workspace confirmed HEALTHY (recovery note 2026-07-11T15:35Z), BUT-LOCK FREE.
  NEXT: drive Slice 1 via codex, review the diff, run tests, then take BUT-LOCK and create the
  lane + first commit.

## Shared-workspace / GitButler state (READ before any but mutation)

- The working tree carries the warm-daytona keepWarm/reconnect PROTOTYPE as uncommitted state:
  sandbox_agent.ts (the environment.destroy keepWarm gap-A mitigation, lines ~805-863),
  provider.ts, sandbox-reconnect.ts, session-continuity.ts, and
  tests/unit/vendored-pause-fallback.test.ts. This prototype is NOT in base (1666116fe5) but IS
  in the working tree. It is THIS feature's prior art, so it belongs in the feat lane together
  with the new Slice 1 code. It is NOT another session's work.
- INCONSISTENCY: git shows these runner files staged (git diff --cached), but `but diff` /
  `but status --json` do NOT list any services/runner or api/ file as an uncommitted/unassigned
  change (likely a residue of this morning's recovery: the files sit in git's index and in the
  rebuilt workspace commit, but but's projection does not surface them). This means
  `but rub <runner-file> <lane>` may report "Source not found" or no-op. Per Mahmoud's
  instruction (2026-07-11, "never ever use git. only gitbutler"): publish through but ONLY. If
  but cannot see or commit these files, FREEZE and report to Mahmoud or the coordinator with
  the exact symptom; do not work around it with raw git. NEVER oplog restore, NEVER but clean.
- There are 231 unassigned changes from many concurrent sessions (onboarding HTML, husky,
  write-template-playbooks skill, etc.). At commit/publish time include ONLY the warm-daytona
  feature files, never a blanket sweep.

## Baseline test failures (pre-existing, NOT ours)

tests/unit/sandbox-agent-qa-transcript-replay.test.ts has 2 failing tests (E2__smoke_chat_pi,
E2__builtin_bash_pi). Cause: the concurrent QA session recaptured
docs/design/agent-workflows/projects/qa/runs/E2__*.json in a NEW wire shape (harness: {kind},
llm: {model}, instructions: {agents_md}) at 13:30/15:30 today, while the test's
agentRunRequestFromTranscript (tests/utils/qa-transcripts.ts) still parses the old flat shape.
The matching loader update lives in the unapplied lane chore/qa-driver-wire-shape. Gate on "no
NEW failures": 842 passing + these 2 is the green bar. Do not touch the capture files (live
concurrent work).

## Lane entanglement (fix/sessions-continuity-review)

The lane fix/sessions-continuity-review (stack y50, 0 commits) holds 13 uncommitted ASSIGNED
files. Overlap with this feature: services/runner/src/engines/sandbox_agent.ts,
tests/unit/sandbox-lifecycle.test.ts, tests/unit/vendored-pause-fallback.test.ts (codex edited
all three on top of that lane's uncommitted hardening; the patch-level gap-A fix SUPERSEDES the
lane's runner-side snapshot mitigation). Its other 10 files (api sessions models/mappings/test,
3 self-host docs mdx, mount.ts, session-continuity.ts) are untouched by us so far. Board rule:
shared file = first committer owns it, mess is OK. At publish time re-assign the shared files
to feat/warm-daytona-sessions with but rub, commit, and post a board note so the review
session knows its hunks ride in this PR. Do not touch the other 10 files unless a later slice
needs them.

## Slice progress

- Slice 1a DONE (unverified live): Daytona provider wrapper with pause/reconnect
  (src/engines/sandbox_agent/daytona-provider.ts, wired in provider.ts), the two package-patch
  cleanup fixes (gap A: failed pause retains provider handles so destroySandbox still deletes;
  gap B: reconnected-then-failed-attach pauses the sandbox), runner teardown simplified to rely
  on the patch fix, unit tests tests/unit/daytona-provider.test.ts plus updated
  sandbox-lifecycle.test.ts / vendored-pause-fallback.test.ts. Typecheck green; tests 842 pass
  + 2 pre-existing baseline failures. IMPORTANT: codex's hand-edited patch file was malformed;
  regenerated canonically with pnpm patch --ignore-existing + pnpm patch-commit (this also
  bumped the patch hash in pnpm-lock.yaml, which is part of the change set). Verified the
  patch applies cleanly to pristine sandbox-agent-0.4.2.tgz and node_modules matches.
- Slice 1a deferred review item: wrapper pause() silently no-ops on transitional states
  (starting etc.), which can report park success on a sandbox that ends up running. Fix folded
  into Slice 1c: pause waits out transitional states bounded, then stops if running; timeout
  throws so the caller falls back to delete.

## Slice 1b design decisions (pointer guard + fingerprint)

- Fingerprint storage: NEW nullable String column session_states.sandbox_fingerprint via a
  small migration in the core_oss chain. Rationale: same writer and lifecycle as sandbox_id;
  storing it inside the continuity-owned data JSON would be clobbered by continuity's
  read-modify-write full-replacement PUT at turn end.
- Guard: SessionStateUpsert gains optional sandbox_turn_index (guard token). When present and
  sandbox_id is being set, the DAO updates sandbox_id+sandbox_fingerprint only when
  coalesce((data->>'latest_turn_index')::int, -1) <= sandbox_turn_index (SQL CASE inside the
  ON CONFLICT DO UPDATE). Token absent = exactly today's unconditional behavior.
- KNOWN LIMITATION (documented on purpose): two concurrent turns of the same conversation both
  carry the same next turn index (continuity assigns latest+1 to both), so the CAS cannot
  order THAT race; it closes the older-write-lands-last window (a turn older than the last
  COMPLETED turn can never overwrite). This is the plan's chosen mechanism (open-questions
  item 1, turn-counter option); the Redis owner claim remains the stronger future fix.
- Runner detects a rejected write by comparing the returned row's sandbox_id with its own (no
  extra wire field needed).

- Slice 1b DONE: sessions-API pointer guard + compatibility fingerprint.
  API: migration oss000000011_add_session_state_sandbox_fingerprint.py (nullable String
  column); SessionState/SessionStateUpsert DTOs + SessionStateUpsertRequest gain
  sandbox_fingerprint and sandbox_turn_index; DAO set_session_state applies sandbox_id and
  sandbox_fingerprint under a CASE CAS (coalesce((data->>'latest_turn_index')::int,-1) <=
  token) when the token is present, unconditional otherwise; dbes.py + mappings.py updated;
  acceptance tests extended (need a live stack; run in the QA phase).
  Runner: sandbox-reconnect.ts now readStoredSandboxPointer/writeSandboxPointer (awaited,
  outcome applied/rejected/failed, never throws); daytona-provider.ts gains deleteSandbox(id)
  and createSpecFingerprint (sha256 over snapshot/image/target/sorted env NAMES/network
  fields); provider.ts exports buildResolvedDaytonaCreate (mirrors the snapshot-suppresses-
  image rule); engine computes the fingerprint per Daytona request, reconnects ONLY on
  fingerprint equality (absent stored fingerprint = mismatch), best-effort deletes the old
  sandbox on mismatch, and the pointer write moved AFTER continuity hydrate +
  nextTurnIndex so the guard token is correct after a cold runner restart. Deps seams renamed
  (readStoredSandboxPointer/writeSandboxPointer).
  Gates: runner typecheck green, tests 851 pass + the 2 baseline failures; api unit
  session_states 14/14; ruff clean (codex ran it).

- Slice 1c DONE: typed teardown reasons + pause transitional fix. New
  src/engines/sandbox_agent/teardown.ts (TeardownReason 7 values, teardownDisposition,
  PARK_CLEAN_RESUMABLE_TURNS=false so every reason still deletes; Slice 2 flips the constant).
  environment.destroy({reason}) replaces {keepWarm}; default reason failed-turn. server.ts
  threads reasons at every call site (clean-resumable / aborted / failed-turn by context; /kill
  and pool-eviction closure = kill; SIGTERM drain = shutdown-in-flight with the idle split
  deferred to the pool-refactor slice). The in-flight registry now tracks environments and
  destroyInFlightSandboxes(timeout, reason) runs the full idempotent destroy. Wrapper pause()
  now waits out transitional states with the shared bounded helper, stops a settled running
  sandbox, succeeds on stopped/archived/destroyed/error/missing, throws on timeout (caller
  falls back to delete). Gates: typecheck green, 854 pass + 2 baseline.

Slice 1 is COMPLETE (runtime behavior unchanged, park inert). Next: commit Slice 1 to the lane
under BUT-LOCK, then Slice 2.

## Slice 1 file manifest (the commit set)

Runner: src/engines/sandbox_agent/daytona-provider.ts (new), teardown.ts (new), provider.ts,
sandbox-reconnect.ts, sandbox_agent.ts (SHARED with fix/sessions-continuity-review), server.ts,
patches/sandbox-agent@0.4.2.patch, pnpm-lock.yaml, tests/unit/daytona-provider.test.ts (new),
teardown.test.ts (new), sandbox-reconnect.test.ts, sandbox-lifecycle.test.ts (SHARED),
vendored-pause-fallback.test.ts (SHARED new file).
API: migrations/core_oss/versions/oss000000011_add_session_state_sandbox_fingerprint.py (new),
core/sessions/states/dtos.py, dbs/postgres/sessions/states/dao.py, dbes.py, mappings.py
(SHARED), apis/fastapi/sessions/models.py (SHARED),
tests/pytest/acceptance/session_states/test_session_states_basics.py.
Docs: docs/design/agent-workflows/projects/warm-daytona-sessions/implementation-status.md.
NOT ours (leave with fix/sessions-continuity-review): mount.ts (until Slice 2 touches it),
session-continuity.ts, sandbox-agent-acp-interactions.test.ts, sandbox-agent-mount.test.ts,
test_harness_sessions_mapping.py, the three self-host mdx docs.

## Current state

- Phase: Slice 1 complete, committing to lane feat/warm-daytona-sessions under BUT-LOCK.
- Lane feat/warm-daytona-sessions: being created now.

## Hard rules (do not relearn)

- but CLI only; no raw git mutations, no worktrees, no stash.
- Lane PR base is big-agents, NEVER main.
- Never send or mount credential files into Daytona sandboxes.
- Wedge safety: on any but wedge error, freeze and REPORT; no raw-git fallback of any kind
  (Mahmoud 2026-07-11: "never ever use git. only gitbutler"); never oplog restore, never but
  clean.
- Count Daytona sandboxes before and after every live run; delete leftovers; zero leaks.
- Verify every commit with git show --stat and every push by comparing SHAs.
