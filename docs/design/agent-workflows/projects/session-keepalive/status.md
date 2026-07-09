# Session keep-alive: status

Source of truth for progress. Keep this current.

## Current state (2026-07-08)

- Phase: implementation, PRs in review. Mahmoud approved the plan subject to the Codex xhigh review findings; all seven findings, plus a confirmation-pass correction, are folded into plan.md and architecture-notes.md.
- Codex xhigh confirmation pass over the amended plan: 5 of 7 folds confirmed outright; 2 material corrections found and folded the same day (the pool-key project scope comes from the mount-sign response since no project id rides the wire, with a hard no-mount-no-park rule; the credential epoch hashes resolved secret VALUES process-locally since no version identity exists on the wire), plus one stale park-mode sentence corrected to match the v1 gate scope.
- Slice 1 (`feat/session-keepalive-pool`) and slice 2 (`feat/session-keepalive-approvals`, stacked on slice 1) are being implemented as draft PRs based on `big-agents`.
- Research: [architecture-notes.md](architecture-notes.md) verified against the current runner code. See "Drift check" below.

## Documentation rewrite (2026-07-08)

Mahmoud reviewed PR #5153 and asked for a substantial rewrite for clarity, context, and reasoning: current-state before change, before/after flows with examples, every decision as problem/options/trade-offs/choice/why, plain language with no meta-provenance in the main text, and a solution story that covers both Claude and Pi. This pass rewrote:

- `architecture-notes.md` restructured into three parts (how the runner works today, what keep-alive changes with before/after examples, the design decisions each with trade-offs), plus a relations section (session resume + restart consequence, the interactions plane "state later" story, the memory-leak honest answer).
- `plan.md` Q&A deepened with measured numbers, the Daytona cost estimate, the Pi-vs-Claude approval story, the restart consequence, and the interactions-plane composition; all review-provenance wording ("amended after review", "confirmation pass", "Codex finding") removed from the main text and kept here.
- `open-questions.md` folded in Mahmoud's answers (idle TTL 60s lgtm, approval TTL 5 min and configurable, pool cap sized from measured RAM).
- The provenance of the amendments themselves lives only here, per Mahmoud's rule that meta stays out of the design text.

## Second review round (2026-07-08)

Mahmoud did a second pass on PR #5153 (13 inline comments on architecture-notes.md, plus "please address"). This round's changes, all provenance kept here rather than in the design text:

- **Decision 1 (project scope home).** Added the honest analysis of whether taking `project_id` from the mount mixes responsibilities. It does, partly. Verified in code: the live `/run` wire never populates the nominal `projectId` field and the runner never reads it, so the mount-sign response is the only server-verified scope the runner holds today; but the project id already exists one layer up (`RuntimeAuthContext.project_id`, from request state). Recorded the clean home (stamp it into `runContext`) as follow-up 5.
- **Decision 2 (config change).** Corrected the overstated "a running harness cannot be reconfigured in place." It is not impossible, just not built. v1 keeps evict-and-cold (option C); the in-place path is designed in `followups/in-place-reconfiguration/`.
- **Decision 2 (observability).** Added the warm-vs-cold visibility section: a silent all-cold regression is the real risk, so surface the path as a trace attribute (`ag.keepalive.path`) and optionally a stream meta event. Recorded as follow-up 6.
- **Decision 3 (stop button + supersede).** Documented the current stop-button reality (session-owned runs ignore the client disconnect; the harness runs to completion in the background; there is no per-turn cancel). Added supersede option (c), abort-the-turn-and-continue-on-the-same-session, as the better end state paired with a real per-turn stop. Recorded as follow-up 7.
- **Decision 3 (why not the backend lock).** Rewrote using verified code: the distributed Redis alive-lock (`api/oss/src/dbs/redis/sessions/locks.py`) already exists and the runner cooperates with it over the HTTP heartbeat; the busy flag is not a reimplementation, it guards an in-process pool of live warmed sandbox handles a Redis key cannot represent. Multi-replica layering recorded.
- **Decision 5.** Expanded with the concrete current-turn-sink shape and a two-turns-plus-stray-event worked example, per the request for more architectural detail.
- **Decision 6.** Removed the meta sentence ("the decision Mahmoud asked to be rewritten"); noted `RELAY_TIMEOUT_MS` is env-configurable and that raising it does not buy parkability; clarified that the park-mode-changes section is the Claude ACP permission gate, not the client-tool MCP pause; pointed the "future path" at `followups/parkable-gates/`.
- **Decision 9.** Removed the meta sentence ("Mahmoud asked for real numbers").
- **Decision 10 (Daytona).** Verified in code: the runner sets no cpu/memory/disk, so the sandbox comes up at the Daytona account default spec (the cost math assumes that spec); the image is the custom `agenta-sandbox-pi` snapshot; the 15-minute auto-stop is explicitly set (`DEFAULT_DAYTONA_AUTOSTOP_MINUTES`, tunable via `DAYTONA_AUTOSTOP`), overriding the upstream default of off.
- **Two new follow-up designs written and added to this PR**, both of the same standard as the main docs: `followups/parkable-gates/` (make the Pi relay, Pi builtin, and client-tool MCP gates parkable; recommends inverting the Pi relay to a runner-held handle and holding the client-tool MCP socket open) and `followups/in-place-reconfiguration/` (change a live session's config without a respawn).

## Invariant reframe + kill-and-resume experiments (2026-07-09)

Mahmoud reframed the parkable-gates follow-up in discussion: judge it by one invariant (whether
an approval is answered warm or cold, the sequence of LLM API calls should be identical: call N
ends with `tool_use`, call N+1 appends the real `tool_result`, nothing regenerated), not by
connection-keeping. Two experiments then tested whether a cold restart can meet that invariant
from the harness's own session file. Protocol and results:
`../harness-session-resume/experiments/` (protocol.md, report.md), run live on the dev box for
Claude Code (CLI `--resume` and ACP `session/load` with `_meta.claudeCode.options.resume`,
wire-verified through a logging proxy) and static-from-source for Pi.

Verdicts: rubric B everywhere. The pending `tool_use` survives `kill -9` on disk in both
harnesses (per-message flush), but no load path answers it: Claude ACP settles it with a
synthetic error `tool_result` and the model re-issues a NEW id; Claude CLI abandons it as a
no-op; Pi injects a synthetic "No result provided" error result and re-issues. Consequence,
folded into `followups/parkable-gates/`: warm parking is the only byte-exact tier; harness
session resume is faithful-context continuation with re-issue drift; the durable-decision cold
path stays the answer past the warm TTL. The parkable-gates design was rewritten around the
invariant the same day, and its ownership section now states that the Pi relay inversion and
client-tool hold-open must land on top of (or inside) JP's backend warm-session move and
harness-session-resume work.

## Measured costs and mechanism research (2026-07-08)

Recorded here as the source for the numbers now cited in the design docs.

**Per-session memory and CPU (measured on the Hetzner dev box, inside `agenta-claude-sub-sidecar`, `AGENTA_RUNNER_SESSION_KEEPALIVE=1`, against real parked Claude sessions).** Method: the image has no `ps`, so measurements read `/proc/<pid>/status` (VmRSS) and `/proc/<pid>/smaps_rollup` (Pss) directly, plus `docker stats`. Real playground traffic live-parked sessions (a bare self-managed `/run` carries no mount project scope and runs cold by design, so the app's own traffic was the parking source).

- Per parked Claude session: sandbox-agent daemon ~15.7 MB RSS / ~11.3 MB Pss; ACP adapter (`@zed-industries/claude-agent-acp`) ~82.4 MB / ~33.4 MB; Claude CLI ~246 MB / ~184.5 MB. Total ~336 MB RSS / ~224 MB Pss. Held stable across a 40s+ parked window and across 3 concurrent sessions.
- Baseline idle runner (no sessions): ~250 MB RSS / ~156 MB Pss.
- Idle CPU while parked: 0.45% quietest; 2.4 to 7% under light real traffic (node event loops and the esbuild watcher, not the parked sessions, which block on I/O at ~0%).
- `docker stats` MEM is a poor per-session signal here (2.5 GiB with zero sessions, page cache; 1.1 to 1.25 GiB with 3 to 7 sessions) because the cgroup counts shared text once while per-process RSS counts it repeatedly. Pss (~224 MB/session) is the honest marginal figure.
- Container was restored: running, `AGENTA_RUNNER_SESSION_KEEPALIVE=1`, health ok, app still pointed at it.

**Process model.** The runner spawns a fresh three-process tree per session (sandbox-agent daemon per `SandboxAgent`, one ACP adapter per agent-connection, one harness under it), not a shared pool. Confirmed against `sandbox-agent` 0.4.2 (`node_modules/sandbox-agent/dist/providers/local.js` spawns one daemon per instance; `pi-acp`/`claude-agent-acp` spawn the harness).

**Approval gates.** Only the Claude ACP permission gate leaves the runner holding an answerable promise (`pendingPermissionRequests` map plus the suspended `prompt()` held open by the disabled undici timeout in `acp-fetch.ts`). Pi custom-tool and builtin gates block on an in-sandbox file poll with a 60s `RELAY_TIMEOUT_MS` deadline (nothing runner-held). The client-tool MCP pause aborts its HTTP request (`tool-mcp-http.ts`, nothing held). This is the code basis for slice 2 parking Claude only.

**Daytona billing.** Per-second, per-resource: ~$0.0504/vCPU-hr, ~$0.0162/GiB-RAM-hr, ~$0.000108/GiB-disk-hr. Default sandbox 1 vCPU / 1 GiB / 3 GiB ~ $0.067/hr running; stopped bills disk only ~$0.0003/hr (~200x cheaper); cold start sub-90ms (negligible dollar cost). 5-min TTL ~ $0.0056/conversation at default size; ~$168/mo at 100 users x 10 conv/day; 24/7 ceiling ~$49/user/mo. Sources: Daytona pricing/billing/docs pages, Northflank and Blaxel 2026 comparisons (exact per-unit rates from the comparisons, consistent with Daytona's own ~$0.067/hr statement; confirm against a live invoice before a contract-grade estimate).

**Memory leak (2026-07-06 incident).** Killing the daemon does not cascade to the ACP adapter it spawned; the orphan reparents to PID 1. Fixed by sending `session/cancel` before `destroySandbox` (teardown step 4). Residual: a hard SIGKILL/OOM of the runner skips teardown and still leaks. The pool is neutral-to-slightly-helpful on graceful paths (all teardown routes through the same idempotent `destroy()`), slightly worse on the hard-kill path (more trees alive at once). The root fix is an OS-level process-group kill / reaper that does not depend on the `finally` (see follow-ups).

## Follow-ups recorded (out of scope for this design)

1. **Lower the implemented approval-TTL default to 5 minutes. DONE (2026-07-09, merged as PR #5178, lane `fix/keepalive-approval-ttl-default`).** The code default is now `DEFAULT_APPROVAL_TTL_MS = 300_000` in `session-pool.ts`; the doc and comment mentions were swept to match (`running-the-agent.md`, `server.ts`). The env var `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS` still overrides.
2. **`sandbox_agent.ts` structural cleanup.** The file is long; the acquire/run split is a good moment to break it into smaller modules. A structural refactor task, not part of this feature.
3. **OS-level orphan-process backstop.** A process-group kill or reaper for the daemon-adapter-harness tree that survives a runner SIGKILL/OOM, so a hard kill cannot leak parked trees. Addresses the residual 2026-07-06 leak class, independent of keep-alive.
4. **Frontend "setting up sandbox" phase.** The `/run` stream is silent during the acquire phase (sign mount, start sandbox, create session) before any agent event. A setup-phase event would let the frontend show "setting up" instead of an unexplained wait. Not designed here; a small side-note improvement worth filing.
5. **Move the pool's project scope off the mount and into `runContext`. IMPLEMENTED, parked as draft PR #5180 (2026-07-09).** The service stamps `runContext.project.id` server-side; the pool key prefers it and falls back to the mount's owning project id (`session-pool.ts:345-376`). Parked as a draft rather than merged because the backend warm-session move reshapes the same code; land or fold it there. Decouples the pool key from the mount signer (Decision 1).
6. **A warm-vs-cold run signal for the inspector.** Emit the keep-alive path taken on each run as a trace attribute (`ag.keepalive.path = hit | miss | park | cold`), so a silent regression where every run went cold is a query instead of an invisible slowdown. A stream meta event for a live "continuing vs starting fresh" indicator is a later nicety on the same surface as follow-up 4. The trace attribute should land with slice 1 (Decision 2).
7. **A real per-turn stop, and supersede-without-cold.** Today "stop" only drops the client stream; a session-owned run keeps executing in the background, and a superseding second turn cold-starts. A per-turn cancel that aborts the in-flight `prompt()` and keeps the session would make "stop" actually stop and let a superseding turn continue on the live session instead of going cold. One piece of work; the abort machinery exists but is not wired to a cancel call, and session-clean-after-abort is unproven (Decision 3).

## Decisions made

- Build order: keep-alive slice 1, then slice 2, then session-resume slice A. Keep-alive before session resume (see plan.md Q6).
- Local only first; Daytona (slice 3) only after slices 1 and 2 have run in real use with no problems (plan.md Q8).
- Flag-gated, default off. Flag off is byte-identical behavior.
- Pool key is `<projectId>:<session_id>` (project-scoped; the conversation id already rides the wire). Parks carry a credential epoch and evict on expiry or rotation.
- Slice 2 v1 parks Claude ACP permission gates only; Pi relay gates, Pi builtin gates, and client-tool MCP pauses stay cold (plan.md Q7 scope table), asserted by tests.
- Listeners attach once per session and demux into the active turn's sink; no per-turn detach/attach (drop/cancel window).
- The pool owns a complete idempotent destroy() per session, built incrementally in acquireEnvironment; the shutdown path drains the pool through it (`inFlightSandboxes` alone only destroys the sandbox).
- A resumed approval executes with the original turn's baked environment; the new turn owns streaming and tracing.
- The debug-local-deployment live loop (implement-feature Phase 3) is EXPLICITLY DEFERRED by Mahmoud; it is the recorded next step after PR review.

## Open questions

See [open-questions.md](open-questions.md). None blocks starting slice 1; they refine defaults and edge behavior.

## Drift check: architecture-notes.md vs current code (2026-07-07)

Verified against `services/runner/src`. The notes are accurate. Details:

- Confirmed: `runSandboxAgent` at `sandbox_agent.ts:321-1048`; the unconditional teardown `finally` at 1004-1047; the pause controller destroying the session (`pause.ts:24-29`, callback at `sandbox_agent.ts:737-747`); the prompt/pause race at 899-912; `shouldSuppressPausedToolCallUpdate` at 180; the `onResolveInteraction` hook at 850; `cancelStaleInteractions` at `server.ts:275`; session-owned runs surviving disconnect at `server.ts:237-246`; the SIGTERM handler and `destroyInFlightSandboxes`.
- Confirmed: `sandbox-agent` is 0.4.2. `Session.prompt`, `Session.onEvent` (returns `() => void`), `Session.onPermissionRequest` (returns `() => void`), `Session.respondPermission`, and the daemon's private `pendingPermissionRequests` all exist in the package types. `resumeSession` exists and is the lossy text-replay one (consistent with the report's Q4).
- Confirmed: `request.sessionId` at `protocol.ts:385`, resolved by `resolveRunSessionId` at 561.

Minor items to note (not blockers):

1. **Citation nudge.** The notes cite `sessions/alive.ts:32-36` for the `owner:session` affinity keys. Those lines are the `REPLICA_ID` constant. The affinity key is described in the file's header comment (lines 10-11, 30-31) and is driven by `REPLICA_ID`. The claim is correct; the line span points at the const, not the key literal.
2. **Load-bearing nuance for the risk estimate.** The notes say the listeners are "re-attachable ... detach the previous turn's" as if the seam is ready. The package supports it (both listeners return an unsubscribe function), but the current runner code discards those return values (`sandbox_agent.ts:749`, `acp-interactions.ts:51`). So capturing and calling the unsubscribe functions is net-new work, and it is the crux of the slice-1 risk. This is reflected in plan.md Q2. No correction to the notes is needed; it is an emphasis for whoever implements.

## Live QA notes (2026-07-08, dev box)

- Slice 1 verified end to end with the flag on: turn 1 cold 25.61 s, turn 2 hit-continue 3.12 s, TTL expiry at 60 s, post-expiry cold replay 22.6 s and still correct, credentials-mismatch eviction correct. Playground and programmatic paths both green. Observed log lines: `[keepalive] miss`, `park ... ttl=60000ms state=idle poolSize=1`, `hit-continue`, `expire ... (TTL 60000ms)`, `evict ... reason=expire`.
- Deployment footgun found during that test (NOT caused by any keepalive lane; `git diff origin/big-agents -- api/**/oss000000006*` is empty and no keepalive lane touches api/): the mounts migration `oss000000006_add_mounts.py` on big-agents now contains a `meta` column, but a dev DB that ran an OLDER revision of that same migration id never gets the column (alembic does not re-apply an applied migration), so mount signing 500s with "column meta of relation mounts does not exist". Keep-alive then silently runs all-cold BY DESIGN (no mount scope means never park), which masks the breakage. Lesson: never edit an already-applied migration; ship a new migration instead. The fix belongs to whoever edited oss000000006 on big-agents. Keep-alive QA must confirm mount signing works first: a `[keepalive] park` line proves it; an all-cold run with no park lines is the tell.

## Next steps

1. Land slice 1 (`feat/session-keepalive-pool`, PR #5156) and slice 2 (`feat/session-keepalive-approvals`) as draft PRs; Mahmoud does the final review on the PRs.
2. After review: run the deferred live-deployment loop (debug-local-deployment) for slice 2 (approval parking) with the flag on and off; slice 1's live loop already ran (see QA notes above).
3. Then consider Daytona (slice 3) and session resume (option 3) per the recorded order.
