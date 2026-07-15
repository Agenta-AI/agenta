# Session keep-alive: plan

Read [architecture-notes.md](architecture-notes.md) first. It explains how the runner works today, what keep-alive changes (with before/after examples), and every design decision with its trade-offs. This plan builds on it and does not repeat the deep detail. Provenance, review history, and QA results are in [status.md](status.md).

- Why this exists: [../approval-boundary/cold-replay-failure-report.md](../approval-boundary/cold-replay-failure-report.md) (Part 3, option 2).
- The complementary feature: [../harness-session-resume/plan.md](../harness-session-resume/plan.md) (option 3).

## What this feature is

Today the runner destroys the whole agent process tree at the end of every turn. The next message in the same conversation cold-starts a fresh tree and hands the agent a flattened text copy of the conversation, so the agent has no real memory of what it just did. Keep-alive changes one thing: when a turn ends, the runner keeps the tree alive for a short time (a TTL). If the next message arrives inside that window, the runner sends only the new user text to the still-running agent, which still holds its full native memory. If the window has passed, or anything does not match, the runner falls back to today's cold path. Nothing can get worse than today.

The feature is flag-gated and local-only first. It changes runner code only: no wire change, no SDK change, no frontend change. With the flag off, behavior is byte-identical to today.

## Q&A: Mahmoud's questions, answered

Each answer is direct. For the full reasoning behind a decision, the referenced section of architecture-notes.md carries the options and trade-offs.

### Q1. How would it be implemented? (files, the acquire/run split, the pool)

Three pieces of work, all in the runner. No new endpoint: keep-alive lives entirely behind the existing `/run` request. The dispatch that runs on every `/run` gains a pool lookup; everything else is internal.

1. **A new pool file, `services/runner/src/engines/sandbox_agent/session-pool.ts`.** It holds a `Map<poolKey, LiveSession>`. The pool key is the project scope plus the conversation id (`<projectId>:<sessionId>`), not the caller-supplied `session_id` alone. The project scope comes from the mount-sign response, because no project id rides the `/run` wire; a session with no mount scope is never parked. A `LiveSession` record keeps the live sandbox, the live session handle, the internal tool-server closer, the working directory, the two fingerprints (config and history), a credential epoch, a state (`busy`, `idle`, `awaiting_approval`, `destroyed`), a TTL timer, and one idempotent `destroy()` closure. Full reasoning: architecture-notes.md Decisions 1, 2, and 7.

2. **A split of `runSandboxAgent` in `services/runner/src/engines/sandbox_agent.ts`** into `acquireEnvironment(request)` (the expensive, session-scoped build, today's lines 328 to 699) and `runTurn(env, request, emit, signal)` (the per-turn work, today's lines 712 to 986). Acquire registers a finalizer per resource as it is built, so a half-built environment cannot leak. The event listeners attach once, for the life of the session, and demux into the active turn (architecture-notes.md Decisions 4 and 5).

3. **A dispatch wrapper in `services/runner/src/server.ts`.** On a session-owned request with the flag on, it checks the pool. A hit with matching fingerprints and a fresh user message continues the live session. A hit whose new content answers a parked Claude gate resumes the approval. A miss, a mismatch, a busy session, or a dead session runs today's cold path.

Tests go through the existing seams (`SandboxAgentDeps` and `createAgentServer(run)`), so no live harness is needed for unit tests.

### Q2. How complex is it really? (honest size per slice, and the genuinely risky part)

| Slice | Files touched | Rough size | Risk |
|---|---|---|---|
| 1. Keep-alive across normal turns | new `session-pool.ts`; the split in `sandbox_agent.ts`; the dispatch in `server.ts`; tests | 350 to 500 lines | Medium |
| 2. Keep-alive across approval pauses | `pause.ts`; the resume wiring in `sandbox_agent.ts`; interaction ordering; tests | 200 to 300 lines | High on correctness |
| 3. Daytona | remove the `isDaytona` gate; reconcile auto-stop with the TTL; verify cookie-fetch reuse and mounted-cwd survival; tests | small code, real operational risk | Deferred until 1 and 2 have run in real use |

The map and the timer are the easy parts, a few dozen lines with almost no risk. Two other parts are the real risk, and neither is the pool:

1. **Deferring teardown (slice 1).** Today the whole cleanup lives in one `finally` block, so it is guaranteed to run on every exit. Keep-alive moves cleanup out of the `finally` and hands it to a timer and a pool, which removes that guarantee. So every teardown trigger has to be re-proven to fire, and the shared `destroy()` has to be idempotent because the sandbox may already be gone. The exact steps that must survive are the ones the 2026-07-06 child-process-leak incident added: a graceful `session/cancel`, then abort the internal tool server, close it, `destroySession`, `destroySandbox`, dispose, unmount the working directory, and remove the temp dirs. Getting this wrong leaks sandboxes and orphaned harness processes, which is the class of bug that incident fixed. See architecture-notes.md Decision 8.

2. **Routing each event to the right turn (slice 1, and again in slice 2).** Each turn's handlers close over turn-specific state. The naive fix (detach turn N's listeners, attach turn N+1's) has a fatal window: the `sandbox-agent` listener registries are plain sets, an event with no listener is silently dropped, and a permission request with no listener is cancelled. So any gap between detaching and re-attaching is a window where an approval can be cancelled. The design avoids the gap entirely: attach the listeners once, for the life of the session, and demux into a mutable current-turn reference. The risk then is not a timing bug ("did we detach in time") but a routing property ("does every event reach the right turn"), which a fake session tests directly: two sequential turns must each see only their own events, and an event fired between turns must hit the between-turns handler. See architecture-notes.md Decision 5.

Slice 2's risk is correctness density, not size. It changes the pause path from "destroy the session" to "park it and hold the permission request," and it has to preserve the several existing rules that already interact there (the latch-loser sweep, the orphaned-tool-call sweep, and the "a pause sends no harness reply" contract) while adding a `resume()` step.

There is also a standing observation, not part of this design: `sandbox_agent.ts` is a long file, and the acquire/run split is a good moment to break it up further. That structural cleanup is recorded as a follow-up in status.md, not folded into this feature's scope.

### Q3. What does "keep alive" cost while idle? (measured memory and CPU)

"Alive" means one full process tree stays running between turns, per session:

```
runner (the long-lived service)
└─ sandbox-agent daemon        (one per session)
   └─ ACP adapter subprocess    (claude-agent-acp, or pi-acp)
      └─ the harness process     (the Claude CLI, or pi)
```

plus the session object, the internal tool server (its URL is baked into the session, so it must outlive the turn), the working directory, and the mount. This tree is built per session, not shared; the daemon spawns a fresh adapter and harness for every `createSession`.

While idle, nothing in this tree is executing. There is no prompt running, so CPU is near zero. The cost is memory. These are measured numbers from the dev box, against real parked Claude sessions (method and raw figures in status.md):

- **Per parked Claude session: about 336 MB RSS (about 224 MB Pss, shared-adjusted).** The harness process dominates (~246 MB), the ACP adapter is ~82 MB, the daemon ~16 MB. Pss is the honest marginal cost because the node and claude processes share library pages.
- **Idle CPU: near zero.** The parked processes block on I/O. The quietest whole-container reading with sessions parked was 0.45%.
- **Baseline idle runner (no sessions): about 250 MB RSS.**
- **A full pool of 8: about 250 MB + 8 x 330 MB = about 2.9 GB RSS** (less on a Pss basis).

Local keep-alive spends host RAM only, no money. Daytona spends billed wall-clock time (Q8). The pool cap bounds the total; see architecture-notes.md Decision 9 for sizing.

### Q4. How is it auto-killed, and how are edge cases handled? (TTL, LRU, teardown, SIGTERM, expired approvals)

Every teardown trigger calls the same one idempotent `destroy(sessionId)`, which runs the full cleanup from Q2. Destroying everything cleanly is the whole safety story, so it is worth being explicit that a leak here is the failure this feature must not introduce.

Triggers:
- **Idle TTL expiry** (default 60 seconds): the idle timer fires; destroy.
- **Approval TTL expiry** (default 5 minutes, Q on defaults below): the parked-approval timer fires; destroy and abandon the held request. This degrades to today's behavior: the frontend still shows the Approve button, and the click lands on the cold decision-map path.
- **LRU cap** (default about 8): when the pool is full, evict the least-recently-used idle session; never evict a busy or awaiting-approval one; if nothing idle is evictable, run the new session unparked. Parking is best-effort.
- **Fingerprint mismatch**: evict, destroy, run cold.
- **Explicit stop**: `POST /kill` drains the whole pool.
- **Runner shutdown (SIGTERM or SIGINT)**: the shutdown handler drains the pool through `pool.destroyAll()`, timeout-bounded. The `inFlightSandboxes` registry alone is not enough; it only destroys the sandbox and skips the relay, the tool server, `destroySession`, dispose, unmount, and temp dirs. The pool's `destroy()` is the authoritative cleanup. A hard SIGKILL or OOM skips all of it; the process dies with its local children, and the Daytona auto-stop backstop covers the remote sandbox a signal can never reach.
- **Client disconnect**: destroy, do not park.
- **Runtime failures**: a rejected parked promise, a sandbox that died mid-idle (caught by a liveness probe on the next acquire), or a mid-turn continuation failure all evict and fall back to cold; a mid-turn failure retries once cold.

On Daytona this matters more, because a leaked remote sandbox costs money, not just RAM. The same `destroy()` calls `destroySandbox()`, which deletes the ephemeral remote sandbox on eviction, and the 15-minute auto-stop plus ephemeral auto-delete are the backstop for anything a signal cannot reach. See architecture-notes.md Decisions 8 and 10.

### Q5. How do sessions connect to keep-alive? (the pool key, and the relation to option 3)

The pool key is the project scope plus the conversation `session_id`. The frontend mints the `session_id` once per chat tab and sends it on every request; it already rides the wire end to end with no change. The project scope comes from the mount-sign response, because the wire carries no project id (architecture-notes.md Decision 1). So a follow-up message in the same conversation, from the same project, finds the parked session under that key.

Keep-alive and session resume (option 3) are different memories, and they compose rather than replace each other. Keep-alive is memory within the TTL window, on the same live process: the fast path, costing idle RAM. Session resume is memory across restarts and long gaps: it reloads the harness's own session files after the process is gone, costing a load per turn but zero idle RAM. They form a three-tier fallback on the same `session_id`: a live pool hit, then a session reload, then cold replay (architecture-notes.md "Relation to session resume").

### Q6. Before or after option 3 (session resume)?

Build keep-alive first. Order: slice 1, then slice 2, then session-resume slice A. Keep-alive removes the two production approval failures immediately, it is runner-only with the smallest blast radius (no wire, SDK, frontend, or storage change), it has no upstream dependency (session resume needs a `session/load` bridge that `sandbox-agent` 0.4.2 does not yet expose), and it establishes the fingerprint and skip-flatten seams that session resume reuses. Session resume is still the target for full fidelity across restarts and long gaps; build it next, not first.

### Q7. How does it relate to human-in-the-loop approvals?

The human side does not change: the same request reaches the same UI, and the human approves or denies the same way. What changes is what the runner does after the click. Today it destroyed the session on pause, so it cold-starts, replays a flattened transcript, and waits for a fresh harness to re-issue the tool call and match a stored decision keyed on the exact arguments. That re-issue is where both production turns failed (argument drift, task restart). With keep-alive inside the approval TTL, the parked session still holds the open permission request and the suspended `prompt()`, so the runner answers the request and the original call runs with its original arguments. No harness re-issues anything. Both paths stay: the live path inside the TTL, the cold path when the TTL expired or the runner restarted. See architecture-notes.md Decision 6 for the mechanism.

**Which gates park, and which do not (the important part, covering Claude and Pi).** The runner has four approval-gate mechanisms, and only one leaves the runner holding something it can answer after the turn ends. Slice 2 v1 parks that one and leaves the other three on today's cold path, each for a structural reason.

| Gate | Harness | How it pauses today | Slice 2 v1 | What staying cold means |
|---|---|---|---|---|
| ACP permission gate | Claude | The harness sends the runner a blocking permission request; the runner holds it as a pending promise, answerable at any later time | **Parks.** The session holds the pending request and the suspended prompt; on a validated resume the runner answers it and the original call runs | This is the live path |
| Custom-tool relay gate | Pi | The tool call blocks inside the sandbox, polling a file, on its own 60-second deadline | **Stays cold.** The block is a file poll inside the sandbox, not a runner-held promise, so there is nothing to answer | Identical to today: the deadline expires, the turn ends paused, the approval resumes through the cold decision map |
| Builtin gate | Pi | A hook inside the Pi process blocks synchronously on the same relay | **Stays cold.** A synchronous in-process block cannot survive a turn boundary | Identical to today |
| Client-tool MCP pause | Claude (client tools) | The runner aborts the in-flight HTTP call; the request is destroyed, not held | **Stays cold.** There is no held request to answer | Identical to today |

**Why Claude and not Pi, stated plainly.** A gate is parkable only if the runner still holds an answerable handle after the turn ends. Claude's ACP permission request is exactly that: a promise in the runner's own memory, with the harness process kept alive. The Pi gates put the wait inside the sandbox on a bounded file poll, so the runner holds nothing; the client-tool pause actively destroys its request. To make Pi parkable, two things would have to change: the in-sandbox wait would need to be unbounded or resumable instead of a 60-second fail-closed deadline, and the pending decision would have to move into a runner-held handle the way the Claude request already is. That is a relay redesign, out of scope for v1, recorded as future work. Until then the Pi consequence is spelled out: Pi approvals keep working through the cold decision-map replay, with the same drift risk that path has always had. See architecture-notes.md Decision 6.

**Whose context runs the resumed tool, and why.** The original turn's baked environment executes the tool (its signed mount credentials, resolved secrets, callback auth, harness env, and sandbox), because the harness process already holds all of that and the resume cannot re-bake it. The new turn owns only streaming and tracing: its trace run records the resumed events, its emitter streams them, and its hooks resolve the durable interaction row. The credential epoch bounds staleness: if the baked credentials expired or rotated before the resume arrived, the session evicts and the cold path re-bakes everything fresh (architecture-notes.md Decision 7). One new ordering rule is needed: a later turn's stale-interaction sweep must not cancel the interaction the runner is about to resolve on the same session.

**The "state later" story (the durable interactions plane).** Today an approval travels inside the conversation (the messages plane). A newer interactions plane (a durable `session_interactions` table plus endpoints) is the future home for approvals answered hours later, from any surface, without a chat held open. Keep-alive is the fast, in-memory tier of that same idea, and the interaction row is the durable tier. A pending approval leaves both: a parked live session valid for the approval TTL, and a durable row valid indefinitely. Whoever answers first wins: a quick click resumes the live call; a late answer settles the row and replays cold. The resolver that reconciles the two planes is deferred; keep-alive makes the fast lane real and leaves the row untouched. Full detail: architecture-notes.md "Relation to the interactions plane."

### Q8. Daytona (slice 3): cost, and where the difference lives

Implement Daytona only after slices 1 and 2 have run locally in real use. The reason is cost and remote failure modes, not code complexity.

**Where the difference lives.** The pool logic is provider-neutral. Local and Daytona use the same `SandboxAgent` and `Session` interface; only the provider construction differs in `provider.ts`. There is no Daytona-specific pool adapter. The one reconciliation is the sandbox's own 15-minute idle auto-stop: a parked session must not let the remote sandbox stop out from under it, so with a longer TTL the auto-stop is raised or disabled while parked, and the pool's TTL becomes the primary reaper. That lives in `provider.ts` and the TTL config (architecture-notes.md Decision 10).

**Cost.** Daytona bills per second for the resources a sandbox consumes: about $0.0504 per vCPU-hour, $0.0162 per GiB-RAM-hour, and a negligible per-GiB-disk-hour. A default sandbox (1 vCPU, 1 GiB RAM, 3 GiB disk) runs at about $0.067 per hour. Two facts shape the design:

- A **stopped** sandbox bills only for disk, about $0.0003 per hour, roughly 200 times cheaper than running. So keep-alive's Daytona cost is the cost of keeping a sandbox running instead of stopping it.
- Cold start is sub-100 milliseconds, so cold-starting the next turn costs almost nothing in dollars. Its only cost is latency.

Back-of-envelope, a 5-minute idle TTL per conversation on the default size costs about $0.0056 (half a cent) per conversation. At 100 active users at roughly 10 conversations a day, that is about $168 a month; at 1,000 users, about $1,680 a month. The 24/7 ceiling per user is about $49 a month, which is why the auto-stop and a short TTL matter. The dominant lever is not the TTL length; it is making sure sandboxes actually stop rather than linger running. This is why Daytona uses a shorter TTL than local, and why slice 3 is gated behind local success.

## Could a minimal version work in about an hour?

There are two different "minimal" versions, with different honest answers.

**A one-hour spike: yes, and it is worth doing.** The smallest thing that proves the idea is to drive one `sandbox-agent` session with two sequential `prompt()` calls in a test. Turn 1 runs a tool. Turn 2 asks "what did you just do?". Show that the harness remembers turn 1 natively and that the event stream re-attaches cleanly. That is about 50 lines and needs no refactor; it de-risks slice 1. A second spike does the same for slice 2: raise a gate, hold the permission request for a minute, then answer it, and show the original prompt continues with the original arguments. Both are legitimate stepping stones.

**A one-hour shippable feature: no, and trying it would create the complexity we want to avoid.** The irreducible core of slice 1 is not the map and the timer. It is deferring teardown and routing events to the right turn (Q2). A one-hour hack would either skip the idempotent shared `destroy()` (which reintroduces the 2026-07-06 process-leak class) or skip the event routing (which double-fires events and corrupts the decision map on turn two). Both are the failure classes this feature exists to remove. So a one-hour hack is not a smaller version of the feature; it is a broken one. Spend the first hour on the spike, then build slice 1 properly.

## Flags and defaults

- `AGENTA_RUNNER_SESSION_KEEPALIVE` (default off).
- `AGENTA_RUNNER_SESSION_TTL_MS` (default 60000, the idle TTL).
- `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS` (default 300000, the approval TTL).
- `AGENTA_RUNNER_SESSION_POOL_MAX` (default about 8).

The approval TTL default is 5 minutes, not 10. A parked approval holds a live process (and, on Daytona, billed time), so the default trades a little cache lifetime for lower idle cost; a human who steps away longer than 5 minutes still gets a correct answer through the cold path. The value is configurable, and Daytona should use a smaller one. These flags go on the runner's config module, not read ad hoc from `process.env`. Requests without a `session_id` never park.

## Failure modes (detect, degrade, never fail the turn)

| Failure | Detection | Fallback |
|---|---|---|
| Sandbox dies mid-idle | parked promise rejection; liveness probe on acquire | evict, cold replay |
| Request after TTL | pool miss | cold replay |
| Two turns race one session | busy flag (single-threaded check-and-set) | supersede: destroy, cold-start the new turn |
| Continuation throws mid-turn | try/catch in runTurn | destroy; retry once cold |
| Client disconnects | session-owned runs already survive | on abort: destroy, do not park |
| Approval reply after approval-TTL | pool miss | cold replay plus the existing decision-map path |
| Config changed mid-conversation | config fingerprint mismatch | evict, cold-start with the new config |
| Multi-replica miss (future) | pool miss | cold replay; later route via session affinity |

## Verification plan

- Before slice 1: run the two-prompt spike to confirm native memory and clean event routing across turns.
- Before slice 2: run the hold-a-permission spike to confirm the parked prompt continues with the original arguments.
- Per slice: unit tests through `SandboxAgentDeps` and `createAgentServer(run)`, then a live check on the dev box against a real playground conversation, with the flag on and off, confirming flag-off is byte-identical.
- The history fingerprint is pinned by a unit test to the exact (pruned) message array the server receives, so a future frontend pruning change trips a test instead of silently causing cold-replay misses.

## Out of scope

- No wire, SDK, or frontend change.
- No storage change (that is session resume, option 3).
- No multi-replica routing (a pool miss degrades to cold; affinity routing is future work).
- No Pi-gate parking (Q7); that needs a relay redesign, recorded as future work.
- The option 1 text-replay fixes are a separate track and land regardless.
