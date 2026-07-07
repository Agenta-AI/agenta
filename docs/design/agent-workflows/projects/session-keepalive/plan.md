# Session keep-alive: plan

- Status: plan drafted for review. Not implemented. Do not commit code from this workspace yet.
- Owner input: Mahmoud. Author: Claude, 2026-07-07.
- Read first: [architecture-notes.md](architecture-notes.md) (code-grounded research, built on here by reference, not repeated).
- Why this exists: [../approval-boundary/cold-replay-failure-report.md](../approval-boundary/cold-replay-failure-report.md) (Part 3, option 2).
- Complementary feature: [../harness-session-resume/plan.md](../harness-session-resume/plan.md) (option 3).

## What this feature is

Today the runner destroys the sandbox and the harness session at the end of every turn. Keep-alive changes one thing: when a turn ends, the runner keeps the session alive for a short time (a TTL). If the next message arrives inside that window, the runner continues the same live session and sends only the new user text. The harness keeps its full native memory because the process never died. If the window expires, or anything does not match, the runner falls back to today's cold replay. Nothing can get worse than today.

The feature is flag-gated and local-only first. It changes runner code only. There is no wire change, no SDK change, and no frontend change. With the flag off, behavior is byte-identical to today.

## Q&A: Mahmoud's questions, answered plainly

This section answers each question directly. Short sentences, plain language, technical terms where they are exact.

### Q1. How would it be implemented? (files, the acquireEnvironment/runTurn split, the pool)

Three pieces of work in the runner.

1. A new pool file: `services/runner/src/engines/sandbox_agent/session-pool.ts`. It holds a `Map<sessionId, LiveSession>`. A `LiveSession` record keeps the live sandbox handle, the live ACP session handle, the internal tool MCP server closer, the relay directory, the mounted cwd, the two fingerprints (config and history), a state (`busy`, `idle`, `awaiting_approval`, `destroyed`), and a TTL timer. The pool key is the conversation `session_id`, which already rides the wire from the frontend to the runner. The pool exposes: `get(sessionId)`, `park(sessionId, liveSession, ttl)`, `evict(sessionId)`, `destroy(sessionId)`, and an LRU cap check. Every teardown trigger calls one shared `destroy` path.

2. A split of `runSandboxAgent` in `services/runner/src/engines/sandbox_agent.ts` into two parts:
   - `acquireEnvironment(request)`: everything that is session-scoped and expensive to build. This is roughly today's lines 328 to 699: sign mount credentials, derive the durable cwd, build the run plan, start the sandbox, mount the durable cwd, prepare the workspace, probe capabilities, build the internal tool MCP server, and call `createSession`. The output is an environment object that can serve many turns. The internal tool MCP server must live as long as the session, because its URL is baked into `sessionInit`.
   - `runTurn(env, request, emit, signal)`: everything that is per-turn. This is roughly today's lines 712 to 986: start a fresh otel run, create a fresh `PendingApprovalLatch` and `ConversationDecisions`, attach `onEvent` and `onPermissionRequest` listeners (and detach the previous turn's), start the tool relay, send the prompt, resolve usage, and finish and flush the trace. On a continuation the prompt is just the new user text, so `buildTurnText` never runs.

3. A dispatch wrapper in `services/runner/src/server.ts`. On a session-owned request, when the flag is on, the wrapper checks the pool. On a hit where both fingerprints match and the tail is a fresh user message, it calls `runTurn` on the live environment. On a hit where the new content is an approval decision that matches a parked gate, it answers the parked permission request (slice 2). On a miss, a mismatch, a busy session, or a dead session, it acquires a new environment and runs today's path. A validation failure must never fail the turn. It degrades to cold replay.

Tests go through the existing seams: `SandboxAgentDeps` for the engine and `createAgentServer(run)` for the HTTP layer. No live harness is needed for the unit tests.

### Q2. How complex is it really? (honest size per slice, and the genuinely risky part)

Honest sizes and risk per slice:

| Slice | Files touched | Rough size | Risk |
|---|---|---|---|
| 1. Keep-alive across normal turns | new `session-pool.ts`; split in `sandbox_agent.ts`; dispatch in `server.ts`; tests | 350 to 500 lines | Medium |
| 2. Keep-alive across approval pauses | `pause.ts`; resume wiring in `sandbox_agent.ts`; client-tool seam; interaction ordering; tests | 200 to 300 lines | High on correctness |
| 3. Daytona | remove the `isDaytona` gate; verify cookie-fetch reuse and mounted cwd survival; tests | small code, real operational risk | Deferred until 1 and 2 have run in real use |

The map and the timer are the easy parts. They are a few dozen lines and carry almost no risk.

The genuinely risky parts are two, and neither is the pool:

1. **The teardown-deferral refactor (slice 1).** Today the whole cleanup lives in one `finally` block (`sandbox_agent.ts:1004-1047`). A `finally` runs on every exit, so teardown is guaranteed. Keep-alive removes that guarantee. It moves cleanup out of the `finally` and hands it to a timer and a pool. So every teardown trigger has to be re-proven to fire, and the shared `destroy` path has to be idempotent because the sandbox may already be gone. The exact cleanup steps that must survive are the ones added on the 2026-07-06 child-process-leak incident: graceful `session/cancel`, `mcpAbort.abort()`, `closeToolMcp`, `destroySession`, `destroySandbox`, `dispose`, unmount the durable cwd, and remove the temp dirs. Getting this wrong leaks sandboxes and reparented ACP child processes, which is the same class of bug that incident fixed.

2. **Listener re-attachment (slice 1, and again in slice 2).** The `sandbox-agent` package supports this cleanly: `onEvent` and `onPermissionRequest` both return an unsubscribe function (verified in the package types, `Session.onEvent`/`onPermissionRequest` return `() => void`). But the current runner code throws that return value away (`sandbox_agent.ts:749` and `acp-interactions.ts:51`). Each turn's listeners close over turn-scoped state (the otel run, the pause controller, the latch, the decisions, the responder). If turn N's listeners are not detached before turn N+1 attaches its own, both fire, and turn N+1's events reach turn N's dead emitter and the wrong decision map. So the refactor must capture those unsubscribe functions and call them at the start of each turn. The package makes this possible; the wiring is net-new work and is fiddly because of how many turn-scoped closures the listeners capture.

Slice 2's risk is correctness density, not size. It touches the pause path where several existing rules interact: the F-024 clobber rule, the pause-time sweep of orphaned tool calls, and the "a pause sends no harness reply" contract. Changing pause from "destroy the session" to "park and hold the permission request" has to preserve all three while adding a new `resume()` step.

### Q3. How do we keep it alive? (what "alive" means, what it costs while idle)

"Alive" means these processes and objects stay running between turns:

- the `sandbox-agent` daemon process,
- the ACP adapter subprocess it spawned (`claude-agent-acp` or `pi-acp`),
- the harness process the adapter drives,
- the ACP session object bound in the daemon's session registry,
- the internal tool MCP server (its URL is baked into `sessionInit`, so it must outlive the session),
- the relay directory, the mounted durable cwd, and the geesefs mount.

While idle, nothing is executing. No prompt is running, so there is no CPU cost beyond the idle footprint. The cost is memory:

- **Local: host RAM only.** A few hundred megabytes per parked session (the daemon plus the adapter plus the harness). No money is spent. The pool cap (about eight sessions) bounds the total.
- **Daytona: billed wall-clock time.** An idle remote sandbox costs money for as long as it is alive. This is why slice 3 is gated behind local success. The existing 15-minute auto-stop and ephemeral auto-delete backstops (`provider.ts`) still reap leaks, but they are a safety net, not the primary control.

### Q4. How do we auto-kill it? (TTL, LRU, all teardown triggers, SIGTERM, and the expired approval park)

Every teardown trigger calls the same idempotent `destroy(sessionId)` path, which runs the full cleanup listed in Q2.

Triggers:

- **Idle TTL expiry.** An idle session gets a timer (default 60 seconds). When it fires, destroy.
- **Approval TTL expiry.** A session parked on an approval gets a longer timer (default 10 minutes). When it fires, destroy the parked session and abandon the held permission request. This degrades, it does not fail: the frontend still holds the approval prompt, and when the human clicks, the frontend resends the conversation with the approval envelope, the request misses the pool, and today's cold decision-map path answers it. So an expired approval park falls back to exactly today's behavior.
- **LRU cap.** When the pool is full and a new session wants to park, evict the least-recently-used idle session. Never evict a busy or awaiting-approval session. If nothing idle can be evicted, do not park the new one. Tear it down as today. Parking is best-effort.
- **Fingerprint mismatch.** On the next request, if either fingerprint does not match, evict and destroy the parked session and run the cold path.
- **Explicit stop.** `POST /kill` drains the whole pool.
- **Runner shutdown (SIGTERM or SIGINT).** Keep parked sandboxes registered in `inFlightSandboxes` so the existing shutdown handler (`server.ts:444`, `destroyInFlightSandboxes`) reaps them before the process exits. On a hard `SIGKILL` or OOM the process dies with its local child processes; the Daytona auto-stop backstop covers the remote case the signal can never reach.
- **Client disconnect.** On abort, destroy, do not park. A session-owned run already survives disconnect during a turn (`server.ts:237-246`), but a disconnect means the turn is abandoned, so there is no reason to hold the session after it ends.
- **Runtime failures.** A rejected parked prompt promise, a sandbox that died mid-idle (detected by a liveness probe on the next acquire), or a continuation that throws mid-turn all evict and fall back to cold replay. A mid-turn continuation failure retries once cold.

### Q5. If we have keep-alive, how do sessions connect to it? (the pool key, and the relation to option 3)

The pool key is the conversation `session_id`. The frontend mints it once per chat tab and sends it on every request. It survives the whole journey without a wire change: frontend `agentRequest.ts` sends it, the SDK `handler.py` forwards it, and the runner receives it as `request.sessionId` (`protocol.ts:385`, resolved by `resolveRunSessionId`). So a follow-up message in the same conversation carries the same key, and the runner finds the parked session under that key.

Keep-alive and session resume (option 3) are different memories and they compose. Neither replaces the other:

- **Keep-alive is memory within the TTL window, on the same replica.** The live process still holds the full native context (tool calls, results, and thinking). It is the fast path. It costs idle resources while it holds the session.
- **Session resume is memory across restarts, long gaps, and replica moves.** It reloads the harness's own session files with `session/load` after the process is gone. It costs storage and a load per turn, but zero idle resources.

The two form a three-tier fallback keyed on the same `session_id`:

1. Pool hit inside the TTL: continue the live session (keep-alive). Highest fidelity, fastest.
2. Pool miss but a recorded harness session id and the files exist: reload with `session/load` (session resume). Full fidelity, medium cost.
3. Both miss: cold replay of the flattened transcript (today's path). Always available, always correct.

### Q6. Before or after option 3 (session resume)? (recommendation with reasons)

Build keep-alive before session resume. Order: keep-alive slice 1, then keep-alive slice 2, then session-resume slice A.

Reasons:

- Keep-alive removes the two production approval failures immediately. Both failures in the report (argument drift and task restart) come from destroying the session on approval. Slice 2 holds the session and its permission request open, so the tool runs with its original byte-exact arguments and the model never re-issues the call. That is the acute pain, and keep-alive kills it.
- Keep-alive is runner-only. It changes no wire field, no SDK, no frontend, and no storage. That is the smallest blast radius of the two features.
- Keep-alive has no upstream blocker. Session resume needs a `session/load` call that `sandbox-agent` 0.4.2 does not forward through its managed session API, so it needs a `pnpm patch` or the raw ACP passthrough first. Keep-alive needs none of that.
- Keep-alive establishes the seams session resume reuses: the config and history fingerprints, and the "skip `buildTurnText` on a continuation" branch. Session resume slice A reuses both.

Session resume is still the target architecture, because it is the only path that restores full fidelity across restarts, replica moves, and long gaps. Build it next, not first.

### Q7. How does it relate to human-in-the-loop approvals?

The human side does not change. The same approval request reaches the same UI. The human approves or denies the same way. What changes is what the runner does after the click.

Today, after the click: the runner destroyed the session when it paused, so it cold-starts a fresh session, replays a flattened transcript, and the approval waits in a decision map keyed on the tool name plus the canonical JSON of the exact arguments. A fresh model has to re-issue the tool call. If its regenerated arguments match the stored key, the call runs. If not, the gate parks again and the human sees a new prompt. This is where both production turns failed.

With keep-alive on the live path (inside the approval TTL): the parked `LiveSession` still holds the still-pending permission request and the suspended `prompt()` promise. The runner calls `session.respondPermission(parkedId, "once" | "reject")`. The original prompt continues. The tool executes with its original byte-exact arguments. The new turn's emitter streams the remaining events. No model re-issues anything, so argument drift and task restart cannot happen.

Both paths stay. The live path runs inside the approval TTL. The cold path runs when the approval TTL expired, the runner restarted, or the pool missed, and it uses today's decision-map machinery unchanged. So keep-alive makes the common case reliable and leaves the fallback exactly as correct as it is now.

Which approval phases change and which do not:

| Phase | Today | With keep-alive | Changed? |
|---|---|---|---|
| Model calls a tool, gate raised | `onPermissionRequest` / relay gate fires | same | No |
| Runner emits `interaction_request`, records the interaction, sends the approval part to the UI | as today | as today | No |
| Turn ends with `stopReason: "paused"`, egress emits `finish` | the pause race ends the turn | the pause race still ends the turn (the session parks instead of being destroyed) | No (turn still ends) |
| Human clicks approve or deny in the UI | as today | as today | No |
| Frontend resends the conversation with the approval envelope | as today | as today (no frontend change) | No |
| Runner acts on the decision | destroy, cold-start, replay, model re-issues the call, match on the decision map | live path: answer the parked permission request, original call runs with exact args; cold path: today's decision map | Yes (this is the whole win) |
| Tool executes, output streams, UI part flips to output-available | reached only after a possible re-park loop | reached in one round on the live path; cold path unchanged | Reliability improves; end state is the same |

The frontend approval part lifecycle (input-available, approval-requested, approval-responded, output-available) is unchanged. On the live path the transition from approval-responded to output-available becomes reliable and single-round. On the cold path it stays exactly as today, including the possible re-park. The durable interaction rows are unchanged too: create on pause (as today), resolve on the decision (the `onResolveInteraction` hook at `sandbox_agent.ts:850`). One new ordering rule is needed: on the live resume path, a new turn's `cancelStaleInteractions` (`server.ts:275`) must not cancel the interaction the runner is about to resolve on the same session.

### Q8. Daytona (slice 3)

Implement Daytona only after slices 1 and 2 are tested and have run in real use without problems. Enable local-only first.

The reason is cost and remote failure modes. A parked local session costs host RAM. A parked Daytona sandbox costs billed wall-clock time for as long as it is alive, and remote liveness adds failure classes the local path does not have (tunnel drops, cookie-fetch session reuse, mounted cwd survival across a park). The existing 15-minute auto-stop and ephemeral auto-delete backstops still reap leaks, but they are a safety net, not a reason to enable Daytona keep-alive early. Turn Daytona on only after the local path has run in real use with no problems.

## Could a minimal version work in about an hour?

Two different "minimal" versions, and the honest answers differ.

**A one-hour spike: yes, and it is worth doing.** The smallest thing that proves the idea is spike E5 from the failure report: in a test, drive one `sandbox-agent` `Session` with two sequential `prompt()` calls. Turn 1 runs a tool. Turn 2 asks "what did you just do?". Show that the harness remembers turn 1 natively and that the event stream re-attaches cleanly. That is about 50 lines and needs no refactor. It validates the core mechanic and de-risks slice 1. Spike E6 does the same for slice 2: raise a gate, hold the permission request for a minute, then `respondPermission(id, "once")`, and show the original prompt continues with the original arguments. Both spikes are legitimate stepping stones.

**A one-hour shippable feature: no, and trying it would create the complexity we want to avoid.** The irreducible core of slice 1 is not the map and the timer. It is the teardown-deferral refactor and the listener re-attachment (see Q2). You cannot get continue-on-match working without deferring teardown, and deferring teardown is exactly the risky part. A one-hour hack would either skip the idempotent shared `destroy` path (which reintroduces the 2026-07-06 process-leak class) or skip detaching the previous turn's listeners (which double-fires events and corrupts the decision map on turn two). Both are the failure classes this feature exists to remove. So a one-hour hack is not a smaller version of the feature. It is a broken version.

Recommendation: spend the first hour on spike E5 (and E6 if time allows). Then build slice 1 properly. The spike is a stepping stone. The hack is not.

## Slices (summary; full detail in architecture-notes.md)

1. **Keep-alive across normal turns.** Local only, flag off by default, runner-only. Pool, the acquireEnvironment/runTurn split, the dispatch wrapper, and the shared idempotent destroy path. Flag off means byte-identical behavior. Size 350 to 500 lines. Risk medium (the teardown-deferral refactor and listener re-attachment).
2. **Keep-alive across approval pauses.** Park mode in `pause.ts`, the `respondPermission` resume, the client-tool pause seam, and the interaction resolve ordering. Size 200 to 300 lines. Highest correctness value; highest correctness risk.
3. **Daytona.** Remove the `isDaytona` gate after slices 1 and 2 have run in real use with no problems. Verify cookie-fetch session reuse and mounted cwd survival across a park. Small code, real operational risk (billed idle time, remote liveness).

## Flags and defaults

- `AGENTA_RUNNER_SESSION_KEEPALIVE` (default off).
- `AGENTA_RUNNER_SESSION_TTL_MS` (default 60000).
- `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS` (default 600000).
- `AGENTA_RUNNER_SESSION_POOL_MAX` (default about 8).

Add these to the runner's config surface, not read ad hoc from `process.env` scattered across files. Requests without a `session_id` never park.

## Failure modes (detect, degrade, never fail the turn)

Carried from architecture-notes.md; unchanged here:

| Failure | Detection | Fallback |
|---|---|---|
| Sandbox dies mid-idle | parked promise rejection; liveness probe on acquire | evict, cold replay |
| Request after TTL | pool miss | cold replay |
| Two turns race one session | busy flag (single-threaded check-and-set) | supersede: destroy, cold-start new turn |
| Continuation throws mid-turn | try/catch in runTurn | destroy; retry once cold |
| Client disconnects | session-owned runs already survive | on abort: destroy, do not park |
| Approval reply after approval-TTL | pool miss | cold replay plus the existing decision-map path |
| Multi-replica miss (future) | pool miss | cold replay; later route via `owner:session` affinity |

## Verification plan

Before slice 1: run spike E5 (two prompts, one session) to confirm native memory and clean listener re-attach.
Before slice 2: run spike E6 (hold a permission request, then respond) to confirm the parked prompt continues with original arguments.
Per slice: unit tests through `SandboxAgentDeps` and `createAgentServer(run)`. Then a live check on the dev box against a real playground conversation, with the flag on and off, confirming flag-off is byte-identical.

## Out of scope

- No wire, SDK, or frontend change.
- No storage change (that is session resume, option 3).
- No multi-replica routing (a pool miss degrades to cold; affinity routing is future work).
- The option 1 text-replay fixes are a separate track and land regardless.
