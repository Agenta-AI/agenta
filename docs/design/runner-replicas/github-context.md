# GitHub context for runner replicas (option B)

Collected on 2026-10-05 from `Agenta-AI/agenta` with read-only `gh` calls. The pull request window is "merged on or after 2026-06-07, or still open". Counts and dates come from GitHub, not from the code in this worktree. Where a claim depends on the current code, the text says so, so the code research can confirm it.

## 1. The two anchor items

### Issue #7322, runner cannot run two replicas

- State: open. Created 2026-10-04. No labels. Link: https://github.com/Agenta-AI/agenta/issues/7322
- Linear link-back: AGE-4484 (comment by `linear-code`, 2026-10-04).
- Title: "Runner cannot run two replicas: no session routing, so Stop, Cancel and warm continuation can reach the wrong pod".

The issue says that on GKE the platform moves pods between nodes, and the runner runs one replica. A pod delete to ready took 48 seconds on a node with room, and one to three minutes during a node drain. Redis durable took 21 seconds in the same test. Two replicas would remove that gap, but the api and the services layer reach the runner through one Service (`http://agenta-runner:8765`) with no session affinity, and the runner keeps per-session state in pod memory. That state is the `keepalivePools` in `services/runner/src/server.ts`, each parked `LiveSession` (environment handle, fingerprints, teardown closure) in `services/runner/src/engines/sandbox_agent/session-pool.ts`, and the parked approval set that a live resume reads back.

The issue lists four failures with two pods:

1. A warm continuation that lands on the other pod finds nothing parked and cold-starts. About half of follow-ups lose the warm promise.
2. A parked approval can be tombstoned, because the other pod does not see the parked set and the api ownership bookkeeping can discard it (`api/oss/src/core/sessions/streams/service.py`, the departed-owner path).
3. A cancel on the wrong pod returns 404 (`server.ts`), and the api can settle the command as lost (`api/oss/src/core/sessions/commands/service.py`).
4. Kill returns 200 but destroys only the local pools, so the sandbox owned by the other pod keeps running.

It offers three options. A: route by session in the callers (headless Service, stable hash over a sorted ready-only pod list, in `api/oss/src/core/sessions/streams/runner_client.py`, `services/oss/src/agent/app.py` and the chart Service). The cost is a new failure mode when the pod set changes. B: make pods interchangeable by putting the handles and the parked approvals in the durable Redis, because on Daytona the warm process lives in the sandbox and the pod holds only a handle. The cost is the reconnect path, "the one that has had subtle bugs before", so it needs a careful test matrix. The benefit is that it also fixes the loss of warm sessions when a single pod restarts, which A does not. C: stay at one replica and reduce exposure (that is #7320). Recommendation: "B is the right design and A is the smaller step that unblocks two replicas. C is in place as of #7320." The issue also says production on GKE with C is "no worse than AWS production", which runs one runner container per region.

### #7320 is a pull request, not an issue

- `gh` resolves 7320 to a pull request: "[ops] feat(chart): disruption budgets, spread, shutdown and redis probes". State: merged 2026-10-04 12:14 UTC. Base: `release/v0.121.8`. Head: `ops/chart-availability-hardening`. It shipped in v0.122.0 (release PR #7328, merged to main 2026-10-05).
- It touches 18 files, all under `hosting/kubernetes/helm/` plus `.github/workflows/12-check-unit-tests.yml`. There is no Linear link-back on it.

The PR answers an independent review finding named F01 (blocker), after a stage was unreachable for about three minutes on 2026-10-03 when GKE Autopilot moved single-replica pods. It adds, on by default, a PodDisruptionBudget per workload (`maxUnavailable: 1` from two replicas; a single replica gets one only through `<workload>.pdb.protectSingleton`), topology spread constraints (one pod per node hard, even zones soft) for workloads with two or more replicas, rollout defaults (`Recreate` for the runner, cron and volatile redis, each with the reason written at the line), shutdown defaults (preStop delay and grace period, 300 s for the runner so a turn can finish), and a Redis startup probe. A measured drain with two replicas of the web apps and workers gave zero non-200 over 230 seconds. The text says the runner "still runs one replica and needs session routing in the api first, which is the review's finding F02 and a separate change". The F02 finding itself is in the private `agenta_cloud` repository and is not visible from here.

The runner template (checked on `origin/release/v0.122.1`) carries a comment that explains `Recreate`: with two runner pods, a Stop, Cancel or follow-up can reach the pod that does not own the session, the owner answers 404, and the api can settle the command as lost. It ends with "Revisit when the api routes by session id". The same file sets `AGENTA_RUNNER_REPLICA_ID` only when replicas equal 1 (see #5404 below).

Follow-ups on the same chart work, all open on 2026-10-05 and based on `release/v0.122.0`, a branch that already merged to main in #7328: #7338 (three defects in the availability work: an empty `topologySpreadConstraints: []` was ignored, a misspelled switch was accepted, the mobile app lost its budget when web was off; plus Redis probes that passed while Redis answered LOADING), #7335 (cron and worker liveness probes that could never run), #7337 (self-host docs for availability), #7332 (CA for an external durable Redis). Their base branch has already shipped, so check where they will land.

## 2. Other issues that bear on the design

All links are `https://github.com/Agenta-AI/agenta/issues/<n>`. Linear ids are in section 5.

Replica identity and ownership:

- #5611 open, created 2026-07-31. "A crashed runner replica makes a Daytona session unresumable for ~120s, with a misleading shim error". The most relevant prior evidence. After `docker kill`, the new replica reconnects to the Daytona sandbox, then the heartbeat answers `is_current_turn=false` because another replica owns the session, and the runner treats that boolean as a cancellation and aborts its own shim upload. The owner key lives `OWNER_TTL_SECONDS = 120` and `claim_owner` (`api/oss/src/dbs/redis/sessions/locks.py`) never steals from an owner that still looks live. The issue says the same failure reproduces with two live replicas when `AGENTA_RUNNER_INTERNAL_URL` is pointed at the second one. Its suggested fix: make `alive.ts` abort only when this replica is the reported owner, then either retry until the key lapses or fail with a clear "held by another runner" message, and optionally let the api hand over ownership once the old key has lapsed. It also notes that SIGTERM drains the pool with `pool.destroyAll`, so a normal deploy discards a pending approval card (observed 2026-07-31; confirm against current code).
- #6765 open, created 2026-09-10. "A refused duplicate Send sometimes aborts the running turn it was refused against". The heartbeat handler returns `is_current_turn=False` from three branches (an ownership release, and two others) that the runner cannot tell apart. The ownership release branch returns it unconditionally.
- #5539 closed 2026-09-30. Concurrent turns on one session were not gated at start. Heartbeat interval is 30 seconds, and a loser is reaped at its next beat.
- #5538 closed 2026-09-30. After a same-session takeover, the next turn can pick a pool entry that is being destroyed (`hit-continue` then `continuation-failed`).

Stop, cancel and kill delivery:

- #6634 open, created 2026-09-07. "An undeliverable Stop cancel kills a running turn after three retries". Three failed deliveries make the api declare the turn lost although the runner still heartbeats. The fix is #6780 (open). A wrong-pod 404 follows the same path.
- #6627 and #6629 closed 2026-09-09. The api needs `AGENTA_RUNNER_INTERNAL_URL` for Stop, not only the services layer.
- #6510 open, created 2026-09-03. "Parked: add runner-initiated long polling for session commands". Exit condition: start it "when a second runner deployment model or user-operated runners become real, or when direct routing becomes operationally insufficient". Required properties: lease each claim, apply a command once by command id, keep the heartbeat for health and ownership, not for Stop delivery.
- #6020 open (Stop then steer breaks the session), #6701 open (response stream left open with no owner), #6417 and #6418 closed (a message during a turn killed both turns and held the lock for 30 minutes).

Warm sessions, parking and approvals:

- #6511 open. Answering a connect prompt destroys the warm sandbox (`non-parkable-gate-no-park`, `evict reason=no-park:paused`).
- #7287 open, created 2026-10-02. A denied gateway approval is recorded as cancelled. Cause: a gateway approval has no ACP permission id, so the turn is not parked. `inBandAnswerTokens` reads only the pool's `parkedApprovals`, so with nothing parked the turn-start sweep cancels the gate the user just answered (`server.ts`, lines near 508 to 518 and 976 to 982 at the time of filing).
- #5384 open. Warm sessions should hold client tool calls open instead of replaying the turn. It says the native hold exists for approvals on warm sessions and that the cold replay path "must exist regardless because a cold session has no process to hold anything open".
- #5638, #5596, #5593, #5592, #5542 closed. A run of bugs where a mismatched or out-of-band approval answer evicted the parked session or never resumed the run.
- #6312 open (approval dock offers approvals the responder cannot reach), #6512 open (a paused turn never records an end time), #5907 open (second side-effecting call loses its result when the pause ends the turn), #6397 open (reopen the harness session on a config change instead of rebuilding the sandbox).

Restart, durability and per-pod leaks:

- #6438 open, created 2026-09-01. The runner tracks the Daytona Secrets it created in an in-memory map, so every runner restart orphans them (16 of 16 live allocations in a gate test). #6663 open is the same class without a restart.
- #5443 closed 2026-09-04. The runner rebuilds session context from records when a session cannot be resumed warm. This is the cold path that option B can lean on.
- #6103 open (a failed turn deletes the sandbox), #6153 open (trace export credential dies 15 minutes into a warm session), #6021 open (a rotated key keeps working on a live Daytona session).

GKE and in-process:

- #7318 open, created 2026-10-03. The runner drops its own OpenTelemetry spans ("trace export skipped, no credential") on AWS production and the GKE US test stack.
- #7198 closed 2026-09-30. On `inprocess`, an attachment copy was written to the runner pod disk while the tools read from the command sandbox. Fixed by #7202.
- #7167 open. Runner unit tests flake under CI load (relevant to the size of the test matrix).

I found no other open or closed issue that names "replica", "session routing", "session affinity" or "GKE" in connection with the runner besides #7322, #5611 and the items above. Searches covered: runner replica, session routing, GKE, keepalive, warm session, parked approval, cancel lost, session pool, runner restart, replica id, durable session, runner kill, sandbox reconnect, session affinity, runner Kubernetes.

## 3. Pull requests

Each entry: number, title, merged date, base, then what it did and why. "Touched" means the PR changed a file in the paths the brief named (checked from the file list). Links are `https://github.com/Agenta-AI/agenta/pull/<n>`. Entries without "touched" were found by title and body and are included because they shape the failure model.

### 3.1 Keepalive, session pool and parked approvals (July and August)

- #5156 "feat(runner): session keep-alive across turn boundaries (flag off by default)". Merged 2026-07-08, base `big-agents`. Touched `session-pool.ts` and `server.ts`. Two production conversations failed on 2026-07-07 because the runner destroyed the harness session at the end of every turn, so each turn cold-started a fresh agent from a lossy text summary. The PR created `session-pool.ts` (the pool, config and history fingerprints, credential epoch), split `runSandboxAgent` into `acquireEnvironment` (session scoped) and `runTurn` (per turn), and added continue-versus-cold dispatch in `server.ts` plus pool drains on `POST /kill` and on shutdown. The pool key is project scoped, so a missing project scope means no parking. First slice: local sandbox only, flag off.
- #5158 "hold approval gates open on the live session (Claude ACP gates)". Merged 2026-07-08, base `big-agents`. Touched `session-pool.ts`, `server.ts`. A Claude permission gate now parks the live session with the permission request and the suspended prompt still pending. The human answer goes to that parked request, so the call runs with its original bytes. The pool gained an `awaiting_approval` state with a TTL, `checkoutApproval` (removes the session from the map so a racing request cannot destroy a resume) and strict matching by tool call id. Anything that does not match falls back to the cold decision-map path, so "nothing gets worse than today".
- #5185 "[#5153] park Pi approval gates over the ACP permission plane". Merged 2026-07-10, base `big-agents`. Touched `server.ts`. Pi gates ride a `ctx.ui.confirm` dialog that the pi-acp bridge turns into a real ACP permission request, so Pi gates park the same way. A runner-side guard re-checks every relay record because the relay directory is writable from the sandbox.
- #5178 (merged 2026-07-09, base `big-agents`, touched `session-pool.ts`, `server.ts`) lowered the approval park default to 5 minutes. #5687 widened it to 30 minutes for phone answers. #5823 (merged 2026-08-09, base `release/v0.111.0`) set it to 10 minutes. It stays overridable through `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS`.
- #5225 "Reuse Daytona sandboxes across turns instead of deleting them every turn". Merged 2026-07-11, base `big-agents`. Touched the chart, `session-pool.ts`, `server.ts`. Park-to-running keeps a sandbox and its live harness session for `AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS` (default 120000 ms). Park-to-stopped stops the sandbox when the window ends, when the warm cap is full, or when the runner drains on SIGTERM while idle. The hard cap `AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM` defaults to 20 per runner process. The vendored Daytona provider got real `pause` and `reconnect` functions, and the sandbox pointer is trusted (version pinning per conversation).
- #5749, #5756, #5759 (merged 2026-08-07, base `release/v0.110.0`). #5749 touched `server.ts`; #5756 touched `server.ts`. They moved session decisions out of `server.ts` into `lifecycle/session-coordinator.ts`, normalized each request into eight facets with their own digests (`sandbox`, `runtime`, `workspaceFiles`, `prompts`, `harnessFiles`, `model`, `harnessSession`, `toolCatalog`), applied live changes to a warm environment, and rotated a credential in place by tracking a credential epoch instead of putting values in the create fingerprint. All of this reconciliation state is read from the in-memory environment.
- #6136 "balance the run deadline with the mount lease". Merged 2026-08-20, base `release/v0.112.3`. The coordinator reuses a warm sandbox only when its mount lease covers `now + total run deadline + 60 s`. The deadline went to 11 h and the lease to 12 h. Any pod that adopts a sandbox must pass the same check.

### 3.2 Continuity, reconnect and the durable pieces that already exist

- #5197 "Resume agent sessions across the sandbox lifecycle". Merged 2026-07-11, base `big-agents`. Touched `session-pool.ts`, `server.ts`, `api/oss/src/core/sessions/streams/` (dtos, service) and the runner Deployment. It defines five sandbox states (hot, warm, cold, dead, new) and a reconnect ladder. Continuity (`(sessionId, harness)` to `{agentSessionId, turnIndex}`) is mirrored into the API row `session_states.data`, and `session_states.sandbox_id` now holds the real Daytona instance id so a new process can reconnect by id and call ACP `session/load`. Each rung degrades to the next, and the worst case is a fresh sandbox with cold replay. So the durable handle for the "warm" and "cold" rungs already exists in Postgres. What stays in memory is the "hot" rung.
- #5292 "Persist Pi transcripts in session workspaces". Merged 2026-07-14, base `big-agents`. Pi writes its transcript to `<cwd>/agents/sessions/pi` in the durable workspace, so a cold load survives a new container. Its QA note records that "the existing 120-second local-runner ownership lease first rejected the replacement replica as designed".
- #5493 "fail the turn instead of answering with a lost conversation". Merged 2026-07-28, base `feat/sessions-storage-rework`. Touched `server.ts`. When the client sends only its last message and the record log is unreadable or has dropped records, the turn fails instead of guessing. Any cross-pod rebuild inherits this rule.
- #7243 "bound runaway output and preserve crash recovery context". Merged 2026-09-29, base `release/v0.121.6`. Cold replay now keeps persisted work from `execution_lost` turns and marks calls without results as unknown outcome. It also bounds retained output per turn (16 MiB, 50,000 updates), because one runaway stream could take down the shared runner process.

### 3.3 Replica id and ownership

- #5404 "default store region and pin runner replica id for self-host". Merged 2026-07-20, base `release/v0.105.7`. Touched `runner-deployment.yaml`. The runner mints a random replica id per process, and the owner key (Redis, about 120 s) made a restarted runner refuse its own sessions for two minutes. The fix pins `AGENTA_RUNNER_REPLICA_ID` in single-runner compose files and in Helm only when replicas equal 1, because "a shared id across pods would make every pod claim every session; local multi-replica is unsupported and should use Daytona".
- #5406 documents the replica id for self-host. Merged 2026-07-20, base `release/v0.105.7`.
- #6446 "say what a session pinned to another runner means, and that it clears". Merged 2026-09-03, base `release/v0.114.7`. Message only. A local sandbox keeps the session files on the owner's disk, so the guard `local sandbox requires a single runner: replica X is not the owner of session Y` must stay loud. It confirms `OWNER_TTL_SECONDS = 120`. Two external consumers match on the guard text (the release gate marker `is not the owner of session` and a Codex QA script matching `single runner`).
- #6862 (open, ready, base `fix/runner-mount-root-out-of-tmp`, created 2026-09-15) "isolate each local session in its own mount namespace". Touches `server.ts`. Local sessions geesefs-mount every drive under one root in the runner namespace. The PR adds a per-session mount namespace and an entrypoint that grants `CAP_SYS_ADMIN` without root. It shows the local provider is tied to one runner host by design.

### 3.4 Session control: Stop, durable commands, watchdog, approvals (September)

This was one design (RFC #6495, closed, AGE-4253) built as stacked PRs and shipped as three milestones. #6498 (merged 2026-09-10, base `release/v0.117.0`, docs only) "map the current Stop and ownership paths" traces every Redis key writer, reader and expiry for Stop, cancel, kill, attach and approval interruption, with sequence diagrams. It is the best written map of the ownership paths and is worth reading in full.

- #6496 "preserve the warm sandbox after Stop". Merged 2026-09-04, base `feat/session-control`. Touched `streams/dtos.py`, `streams/service.py`, `server.ts`. Stop sends a real harness cancel and parks the sandbox. A stopped turn writes the same continuity record as a completed turn, so a restart can hydrate. At shutdown the runner releases its Redis owner claims through a `release_owner` field on the heartbeat, so a restarted runner is admitted at once instead of after the 120 s lease. Its evidence table records that without this, after `docker restart` a runner was refused for 90 to 150 seconds (admitted at 123.6 s).
- #6503 "deliver durable Stop directly to the runner". Merged 2026-09-04, base `feat/session-control`. Touched `commands/*`, `streams/runner_client.py`, `streams/service.py`. It adds the `session_commands` table, `POST /sessions/{id}/cancel` with optional `expected_execution_id`, a control-delivery port, and runner `POST /cancel`. Delivery is direct api to runner. Long polling was designed (#6497, closed, design only) and parked as AGE-4253. Heartbeats stay a health and ownership signal.
- #6501 "settle executions after runner or sandbox loss". Merged 2026-09-04, base `feat/session-control`. Touched `commands/*`, `streams/*`, `server.ts`. A watchdog sweep every 60 s ends any turn whose heartbeat is older than 90 s with one `execution_lost` and one `done`. It is keyed on heartbeat age, not on the owner lease. Late output after that ending is kept but marked `quarantined_at`. A new core table `session_executions` enforces one terminal outcome per execution through compare-and-set, shared by the runner outcome route and the watchdog. A pending Stop whose runner is alive is redelivered with the same command id up to `max_deliveries`; if the runner is gone it settles `lost`.
- #6500 "reject a second turn before touching the sandbox" (touched `server.ts`), #6502 "acknowledge session records after Postgres commits", #6504 "guard Stop by execution and cancel pending approvals" (touched `commands/service.py`, `streams/*`), #6557 (warm park 600 s after a browser Stop). All merged 2026-09-04, base `feat/session-control`.
- #6553 "Session control milestone 1" (merged 2026-09-05, base `release/v0.115.0`, 253 files). It collects the PRs above. Migrations 022 to 026 on core and 005 on tracing, all additive.
- #6522 and #6524 (merged 2026-09-05, base `feat/session-live-events`) relay live frames to every reader and give each durable fact a per-session sequence, snapshot and replay, behind switches. #6522 touched `streams/dtos.py` and the chart. #6531 detaches the run from the request that started it (touched `server.ts`). #6572 is milestone 2.
- #6530 "make approval answers and continuation durable" and #6555 (queue then steer) (merged 2026-09-05, base `feat/session-approvals-queue`), shipped as #6575 milestone 3 (merged 2026-09-05, base `release/v0.115.2`). #6530 touched `commands/*`, `streams/service.py`, `server.ts`. The api commits the interaction response, the continuation execution and the continuation command in one core transaction and returns 202. The continuation reaches the runner through the same command port as Stop. The runner admits a durable continuation once per command id.
- #6592 (finish stopped turns before steered input), #6594, #6598, #6600, #6603, #6615 (merged 2026-09-06 and 2026-09-07, bases `release/v0.115.2` and `release/v0.115.3`): follow-ups that settle heartbeats, queue behind approvals, and keep active turns when watchdog checks fail.
- #7095 and #7097 (merged 2026-09-23, base `release/v0.121.0`; #7097 touched `commands/service.py`). They removed the flags `AGENTA_SESSIONS_DURABLE_APPROVALS`, `AGENTA_SESSIONS_DURABLE_STOP`, the direct send path, and the runner record switches. The watchdog default is now fixed at 90 s. There is no flag-off fallback any more, so a design cannot lean on a rollback switch.
- #6780 (open, ready, base `main`, created 2026-09-11) "[6634] Park undeliverable Stop cancels instead of killing the turn". Touches `commands/interfaces.py`, `commands/service.py`. After the delivery budget is spent, a still-heartbeating turn parks the cancel instead of being settled `lost`; a cancel whose target already ended settles `not_running`. Not merged yet. Without it, a wrong-pod 404 repeats the exact failure of #6634.

### 3.5 Runner hardening that shapes the failure model

- #7049 "Stop the runner freezing after a turn is cancelled". Merged 2026-09-22, base `release/v0.119.1`. A busy loop in the tool relay froze the whole runner process for fifteen hours after one Stop. It shows that one runner process serves every session, so one stuck session stops all of them. Replicas help here too.
- #7099 "fail an ACP request when its connection closes instead of hanging". Merged 2026-09-23, base `release/v0.121.0`. It patches `@agentclientprotocol/sdk` to reject pending requests when the transport closes. This matters for any reconnect from a second pod.
- #7217 "re-prompt a turn that stalled before its first response". Merged 2026-10-02, base `release/v0.121.7`. Touched `server.ts`. A time-to-first-byte trip is safe to replay once, only for a fresh prompt, never a resume, a continuation or an out-of-band approval reply.
- #5132 "Refuse unknown sandbox ids and stop cross-request env bleed in the runner". Merged 2026-07-07, base `big-agents`. Touched `server.ts` and the runner template. It made the API base request scoped through `AsyncLocalStorage` instead of writing `process.env`. This is an earlier case of a shared process leaking state between requests.

### 3.6 In-process runner (#7124) and its follow-ups

- #7124 "feat(runner): Run Pi in the runner and use a sandbox only for commands". Merged 2026-09-25, base `release/v0.121.2`. 178 files, +18,224 and -528. Touched `engines/inprocess/` (27 files, 5,139 lines), `server.ts`, `session-pool.ts` and shared runner code. It adds a third sandbox provider, `inprocess`: Pi runs as an SDK session inside the runner process, and a Daytona command sandbox starts only on the first tool call and runs every tool. A chat-only session uses no sandbox. The first model request left the runner after about 8 s on `daytona` and after 0.04 to 0.22 s on `inprocess`. Key facts for this design:
  - Pi's conversation file lives on the runner, then is saved to its own drive prefix, and "a turn ends only after its file is on the drive". The resume-point rule reads that file. The sandbox cannot reach that prefix.
  - Model keys live in the runner's memory, one store per session. In-process sessions of every organization share one process.
  - Memory per live Pi session is 1.6 to 3.3 MB. A load test of 100 concurrent cold turns in one runner had no failures.
  - The tests include a runner restart during a turn. Codex review round 10 found that a completed turn could vanish from the conversation file after a restart (fixed) and that an orphan command of a dead runner can still write to the drive until its lifetime ends (accepted by name: "last writer wins, with no conflict copy"; `daytona` has the same exposure).
  - "The simplify pass removed the owner-lease plane and 16 of the 22 in-process variables." So an ownership lease for in-process sessions was built and then removed in review.
  - Admission uses sandbox slots (`sandbox/sandbox-slots.ts`) and a pool eviction wait capped at 30 s.
- #7202 "[7198] make inprocess attachment copies readable". Merged 2026-09-27, base `release/v0.121.5`. Touched `engines/inprocess/harness-host.ts` and `workspace/attachment-files.ts`. The in-process host now writes attachment copies straight to the drive prefix through `DriveObjects`. It shows the rule that the runner pod disk is not shared with the tools, so runner-local files are not durable state.
- #7188 "bill sandbox seconds to the wallet". Merged 2026-10-02, base `wallets/usage-debug`, shipped through #6050 (merged 2026-10-05, base `release/v0.122.0`, in v0.122.0). Touched `engines/inprocess/*` and `server.ts`. The runner measures each Daytona sandbox from outside and reports one whole-second interval every minute; an unaccepted report is kept and resent. This is more in-memory per-pod state (the meter) plus a per-turn admission call. Related commits in the 2026-10-02 log: "an abandoned turn gives back its slot and closes its billing window" and "key the billing window on the session pool's resolved scope".
- #7344 (open, ready, base `release/v0.122.1`, created 2026-10-05) "give in-process Pi sessions their own gateway credential". Touches `harness-host.ts`, `pi/pi-session-factory.ts`. On production EU every in-process turn on a gateway custom route failed because Pi looked the credential up in `process.env`, which must not hold it. The fix stores the credential in the session's own credential store.

### 3.7 Helm chart work for managed Kubernetes

- #6690 "make the Helm chart deploy cleanly on a managed Kubernetes (GKE Autopilot)". Merged 2026-09-10, base `release/v0.117.0`. Touched `runner-deployment.yaml` and other templates. The runner never set `AGENTA_RUNNER_HOST`, so it bound 127.0.0.1 and failed its startup probe; it now binds `0.0.0.0`. It adds `agentRunner.fuse.enabled` to drop `SYS_ADMIN` and `/dev/fuse`, which Autopilot rejects (so the local sandbox cannot run there, and only Daytona or in-process can).
- #6788 "graceful rollouts and a NetworkPolicy for the bundled data stores". Merged 2026-09-16, base `release/v0.118.3`. Touched `runner-deployment.yaml` and other templates. It adds optional `lifecycle`, `terminationGracePeriodSeconds` and `strategy` keys on every workload, and fixes a pre-install migration hang. #6864 (merged 2026-09-16) made `worker-streams` handle SIGTERM.
- #7211 "keep the autoscaler from evicting the single-replica stateful pods". Merged 2026-09-27, base `release/v0.121.5`. It adds `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"` to redis volatile, redis durable and supertokens. On 2026-09-27 a scale-down removed the volatile redis, and the runner refused eight turns because "the platform did not answer the admission beat". It explains why the authors chose the annotation over a PDB (a one-replica PDB blocks every voluntary eviction). #7309 (merged 2026-10-03) documents what that does and does not guarantee.
- #7320: see section 1.

### 3.8 Open pull requests that touch the named paths (2026-10-05)

#7344 (in-process credential), #7343 (release v0.122.1 to main), #7338, #7335, #7332 (chart, base `release/v0.122.0`), #7282 (Codex bump, touches `values.yaml`), #6924 (draft; `server.ts`, seeds the pinned Codex adapter under HOME overrides and bounds ACP init), #6862 (local mount namespace), #6780 (undeliverable Stop), #6224 (reject wrapped or empty session header edits, touches `streams/dtos.py`), #4463 (draft since 2026-05-27, TLS).

Method note: I also ran a GitHub commits API sweep by path for the six path groups on `main`, `release/v0.122.0` and `release/v0.122.1`. It returned release PRs and the PRs listed above. I found no merged or open PR whose title says "session routing", "replica", or "sticky" for the runner other than #5404, #6446, #7320 and #7322.

## 4. Release branch state

- Highest `release/v0.*` branch on origin: `release/v0.122.1`.
- Open PR from it to main: #7343 "[release] v0.122.1", ready, created 2026-10-05, base `main`. Its body lists the version bump across web, services, api, sdks, clients and the chart.
- `release/v0.122.0` already merged to main through #7328 on 2026-10-05. Open PRs #7332, #7335, #7337 and #7338 still have it as their base.
- Open PR #7344 targets `release/v0.122.1`.

## 5. Linear link-backs (AGE ids next to GitHub issues)

Only #7322 shows a literal `linear-code` link-back comment in the thread I read in full. The other ids were read from the issue text and comments by pattern match. Pull requests carry few ids.

| GitHub issue | Linear id |
| --- | --- |
| #7322 runner cannot run two replicas | AGE-4484 |
| #5611 crashed replica, session unresumable for about 120 s | AGE-4038 |
| #6765 refused duplicate Send aborts the running turn | AGE-4331 |
| #5539 concurrent turns not gated at start | AGE-4009 |
| #5538 takeover then mid-teardown sandbox | AGE-4008 |
| #6510 parked: runner-initiated long polling | AGE-4253 |
| #6511 connect prompt destroys the warm sandbox | AGE-4254 |
| #6512 paused turn never records an end time | AGE-4255 |
| #6634 undeliverable Stop kills a running turn | AGE-4282 |
| #6627 Stop never reaches the runner on gh.local, gh.ssl | AGE-4280 |
| #6629 docs: api needs the runner URL for Stop | AGE-4281 |
| #6417 message during a turn kills the turn | AGE-4223 |
| #6418 sandbox dies, turn hangs 30 minutes | AGE-4224 |
| #6701 leaving a session mid-turn leaves the stream open | AGE-4309 |
| #6438 durable reconciliation of Daytona Secrets | AGE-4229 |
| #6663 Daytona Secrets not deleted | AGE-4292 |
| #5384 warm sessions hold client tool calls open | AGE-3967 |
| #5638, #5596, #5593, #5592, #5542 approval and parking bugs | AGE-4050, AGE-4035, AGE-4032, AGE-4031, AGE-4012 |
| #7287 denied gateway approval recorded as cancelled | AGE-4473 |
| #6312 approval dock offers unreachable approvals | AGE-4191 |
| #5443 rebuild context from records | AGE-3982 |
| #6153 trace export dies after 15 minutes | AGE-4166 |
| #6021 rotated key keeps working on a live session | AGE-4120 |
| #6103 failed turn deletes the sandbox | AGE-4153 |
| #6397 reopen the harness session on config change | AGE-4220 |
| #6020 stopping an agent kills the steer message | AGE-4119 |
| #5907 second side-effecting tool call loses its result | AGE-4088 |
| #7318 runner drops its own OTel spans | AGE-4483 |
| #7198 inprocess attachment copy unreadable | AGE-4464 |

Pull requests that name an id: #6503 and #6495 name AGE-4253 (long polling), #5520 names AGE-4000.

## 6. What this history tells the designer

1. Ownership already lives in Redis as `owner:session:<id>` with a 120 s TTL, claimed per replica id and never stolen from a live owner (#5611, #6446); the runner frees its claims at shutdown through `release_owner` on the heartbeat (#6496), so option B must replace or extend that lease, not add a second one.
2. The heartbeat answer `is_current_turn=false` means cancel, owner mismatch and ownership released, and the runner aborts its own turn on any of them (#5611, #6765), so a pod-to-pod handover needs a distinct signal or the adopting pod kills the turn it just took.
3. Part of the handle is already durable: `session_states.sandbox_id` (the Daytona instance id) and the continuity record are mirrored to the api (#5197, #6496), and the warm, cold and dead rungs with record-based rebuild already exist (#5443, #5493, #7243), so option B only has to make the hot rung (live harness session, held ACP request) cross-pod.
4. A parked approval is a pending ACP permission request plus a suspended prompt held in one runner connection (#5158, #5185), which cannot be written to Redis as plain data, and gateway approvals and client tools are already non-parkable and cold (#7287), so the design must say per gate kind whether another pod answers it warm or resumes it through `session/load`.
5. In-process sessions (#7124) keep the live Pi session and per-session credentials in runner memory and treat the drive file as the only durable record, an owner-lease plane for them was built and then removed in review, so their handle is the drive transcript and never a connection, and secrets must never move to `process.env` (#7344).
6. The local sandbox is bound to one host by its disk and mount root (#5404, #6446, #6862), the chart sets `AGENTA_RUNNER_REPLICA_ID` only at one replica because a shared id makes every pod claim every session, and Autopilot cannot run the local provider (#6690), so only Daytona and in-process sessions are candidates for interchangeable pods.
7. Stop and approval continuations go from the api directly to the runner Service URL as durable commands with three delivery attempts (#6503, #6530), a wrong-pod 404 repeats the #6634 failure until #6780 merges, and runner-initiated long polling was designed and parked with the exit condition "direct routing becomes operationally insufficient" (#6510, #6497), which is the ready alternative if B moves command delivery.
8. The watchdog settles by heartbeat age (90 s, sweep every 60 s), allows one terminal outcome per execution by compare-and-set in `session_executions`, and quarantines late output (#6501, #7097), so a takeover by a second pod must not look like a lost turn or produce a second ending, and the old flags are gone, so there is no rollback switch to lean on.
9. Other per-pod memory becomes a fleet question: the Daytona Secrets map that every restart orphans (#6438), the sandbox meter and slots (#7188, #7124), the warm cap of 20 sandboxes per process (#5225), run-limit timers, and the rule that a warm sandbox is reused only if its mount lease covers the run deadline (#6136).
10. The chart uses `Recreate` and a 300 s grace period for the runner because of #7322 (#7320), SIGTERM handling of pools and parked approvals changed more than once (#5225, #5611) and needs a check against current code, and the issue warns the reconnect path "has had subtle bugs before" (#5538, #6765, #7049, #7099), so the test matrix must cover takeover races, a dead owner and a held ACP request.
