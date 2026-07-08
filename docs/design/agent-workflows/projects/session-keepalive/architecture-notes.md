# Session keep-alive: how the runner works today, what changes, and why

This is the deep, code-grounded companion to [plan.md](plan.md). It has three parts:

1. **How the runner works today.** The current flow, end to end, with the real process tree and the real teardown. A cold reader needs this before anything else makes sense.
2. **What keep-alive changes.** The same flows, before and after, with worked examples for the two cases that matter (a follow-up message when a live session exists, and when it does not).
3. **The design decisions.** Each one as a problem, the options we weighed, the trade-offs, the choice, and the reason.

The idea in one paragraph: today the runner destroys the whole agent process tree at the end of every turn, so the next message starts from nothing and the agent re-reads a flattened text copy of the conversation. Keep-alive holds that process tree alive for a short time after a turn ends. If the next message in the same conversation arrives inside that window, the runner sends only the new user text to the still-running agent, which still has its full native memory. If the window has passed, or anything about the request does not match, the runner falls back to today's cold path. Nothing can get worse than today.

Everything below is verified against `services/runner/src` as of 2026-07-08. Provenance, review history, and QA notes live in [status.md](status.md), not here.

---

# Part 1: How the runner works today

## The runner is one long-lived process

The runner is a Node service that stays running. It listens on port 8765 and answers one HTTP contract: a `/run` request comes in, a stream of events goes out (`src/server.ts`). Every deployment runs exactly one copy of it (one replica in both the docker-compose and the Helm defaults). It already keeps state in memory between requests: a set of in-flight sandboxes, a replica id, and session-affinity keys (`src/sessions/alive.ts`). So a per-process pool of live sessions is something the runner can hold today with no new infrastructure.

## What one turn builds today

Every `/run` request runs `runSandboxAgent` (`src/engines/sandbox_agent.ts`). For each request it builds a fresh agent environment from scratch, runs the turn, then tears the whole thing down. The build step (roughly today's lines 328 to 699) does a lot:

- signs short-lived mount credentials with the sessions API,
- derives a durable working directory for the conversation,
- starts a sandbox,
- mounts the working directory,
- prepares the workspace and skills,
- starts an internal tool server (a small MCP HTTP server the harness calls back into),
- and opens the agent session with `createSession`.

`createSession` is where the process tree comes to life. For a local (non-Daytona) run, three operating-system processes get spawned per session, one nested inside the next:

```
runner (the long-lived Node service)
└─ sandbox-agent daemon        (one per session, spawned by the local provider)
   └─ ACP adapter subprocess   (claude-agent-acp, or pi-acp for Pi)
      └─ the harness process    (the Claude Code CLI, or `pi --mode rpc`)
```

This is one full tree **per session**, not a shared pool. The daemon spawns a fresh adapter, and the adapter spawns a fresh harness, for every `createSession`. Nothing is reused between requests today. (Measured footprint of this tree is Decision 9 below.)

The harness process is the agent. It holds the real conversation memory: the tool calls it made, the results it saw, and its own thinking. That memory lives only inside that process.

## What one turn tears down today

`runSandboxAgent` ends in a `finally` block (`sandbox_agent.ts` lines 1004 to 1047 in the pre-refactor code) that runs on every exit, success or failure. It performs the full cleanup, in order:

1. stop the tool relay,
2. abort any in-flight calls into the internal tool server (`mcpAbort.abort()`),
3. close the internal tool server,
4. send a graceful `session/cancel` to the harness (`destroySession`),
5. destroy the sandbox,
6. dispose the daemon handle (this SIGTERMs then SIGKILLs the daemon),
7. unmount the durable working directory,
8. remove the temporary directories.

Step 4 exists because of a real incident (the 2026-07-06 child-process leak, covered in Decision 8). Killing the daemon does not cascade the kill to the adapter it spawned, so the adapter and harness would reparent to PID 1 and never exit. Sending `session/cancel` first lets them shut down cleanly.

The key fact for this whole design: teardown today is **guaranteed** because it lives in a `finally`. Every exit path runs it. Keep-alive removes that guarantee on purpose (it defers teardown to a timer), which is why the shared teardown path and its triggers are the riskiest part of the work.

## Why the agent has no memory across turns

Because the process tree dies at the end of every turn, the next turn has nowhere to continue from. The runner cold-starts a brand new tree and hands the harness the whole conversation as one flattened block of text (`buildTurnText`). The harness never sees its own structured history. It reads a transcript, the way a new employee reads a handover note.

Worked example (today, two normal turns):

- **Turn 1.** You ask the agent to read three files and summarize them. The runner builds a tree, the harness reads the files (real tool calls, real results in its memory), it answers, and the runner destroys the tree.
- **Turn 2.** You ask "now do the same for the fourth file." The runner builds a **new** tree. The new harness has no memory of turn 1. It receives a text transcript that says turn 1 happened. It has to reconstruct what "the same" means from that text. It cannot see the actual tool results it produced last time, because those lived in a process that no longer exists.

That loss is tolerable for a plain question. It is not tolerable for an approval, which is where it caused two production failures.

## How an approval works today

An agent sometimes wants to run a tool that needs a human's yes or no. The full permission model is in [../approval-boundary/how-approvals-work.md](../approval-boundary/how-approvals-work.md). What matters here is that the runner has **four different gate mechanisms**, and they pause in structurally different ways. This difference is the whole reason the approval fix (Part 3, Decision 6) applies to one harness first.

| Gate | Harness | How it pauses today |
|---|---|---|
| ACP permission gate | Claude | The harness sends the runner a blocking permission request over the protocol. The runner holds it as a pending promise and can answer it (`respondPermission(id, reply)`) at any later moment. |
| Custom-tool relay gate | Pi | The tool call blocks **inside the sandbox**, polling a file for a response, with its own 60-second deadline (`RELAY_TIMEOUT_MS`). |
| Builtin gate | Pi | A hook inside the Pi process blocks synchronously, inside the sandbox, waiting on the same relay. |
| Client-tool MCP pause | Claude (client tools) | The runner **aborts** the in-flight HTTP call to its internal tool server. The call is destroyed, not held. |

Only the Claude ACP gate leaves the runner holding something it could answer later. Keep that in mind for Decision 6.

Today, whichever gate fires, the runner reacts the same way: it destroys the session (`PendingApprovalPauseController.pause()`, `pause.ts` lines 24 to 29) and ends the turn with `stopReason: "paused"`. It has to end the turn, because a live Claude session never resolves its `prompt()` call while a gate is open; leaving it open would hang the run and leak the sandbox.

So the human clicks Approve, and now there is no session to resume. The frontend re-sends the whole conversation with the approval answer folded in. The runner cold-starts a fresh tree, replays the flattened transcript, and waits for the new harness to re-issue the same tool call. When it does, the runner matches the re-issued call against a stored decision, keyed by the tool name plus the exact JSON of the arguments.

Worked example (today, an approval):

- Turn 1: the agent wants to post a Slack message. The gate fires. The runner destroys the session, ends the turn paused. You see an Approve button.
- You click Approve. The frontend re-sends the conversation.
- Turn 2: the runner cold-starts a new harness, replays the transcript. The **new** harness must reconstruct the Slack call from text and re-issue it. If its regenerated arguments are byte-for-byte identical to what turn 1 produced, the stored decision matches and the tool runs. If the new harness phrases the message even slightly differently, the match fails, the gate re-fires, and you see a second Approve button for a call you already approved.

Both production failures came from this: the re-issued call drifted from the approved one, and in one case the whole task restarted. The root cause is that the session that made the original call no longer exists at approval time.

---

# Part 2: What keep-alive changes

## The core change

When a turn ends, the runner does not tear the tree down. It parks the environment in an in-memory pool for a short time (a TTL). The environment keeps running, so the harness keeps its full native memory. The next request in the same conversation looks up the pool by a key derived from the conversation. On a match, the runner sends only the new user text to the live harness. On any miss, it falls back to exactly today's cold path.

Two TTLs, because two situations need different windows:

- **Idle TTL** (recommended default 60 seconds): how long a session waits for the next normal message.
- **Approval TTL** (recommended default 5 minutes): how long a session parked on an open approval waits for a human to click. This is configurable; a Daytona deployment will likely use a smaller value (Decision 9).

## Before and after: a normal follow-up message

**The case where a live session exists (the win).**

- Today: turn 2 cold-starts a new tree and hands it a flattened transcript. The agent reconstructs context from text.
- With keep-alive: the runner finds the parked session under the conversation key, confirms the config and history still match (Decision 2), and calls `session.prompt(newUserText)` on the live harness. The harness already remembers turn 1 natively. No transcript is flattened. In live QA on the dev box this took the follow-up turn from about 25 seconds (cold) to about 3 seconds (continue).

**The case where no live session exists (the fallback).**

- The user waited longer than the idle TTL, or this is the first message, or the config changed. The pool lookup misses. The runner does exactly what it does today: cold-start, flatten, replay. The user notices nothing except the normal cold latency. This path is always available and always correct.

## Before and after: an approval

- Today: the pause destroys the session. After the click, a fresh harness must re-issue the call and hope its arguments match a stored key. This is where turns failed.
- With keep-alive (inside the approval TTL): the pause parks the session instead of destroying it. The session keeps holding the open permission request and the suspended `prompt()` promise. When the human clicks Approve, the runner answers the still-open request with `respondPermission(parkedId, "once")`. The original prompt continues. The original tool call runs, with its original byte-exact arguments. No new harness re-issues anything, so drift and task-restart cannot happen.
- Fallback: if the approval TTL expires before the click, the parked session is destroyed and the click lands on today's cold decision-map path. The result is exactly today's behavior, no better and no worse.

## The universal fallback

Every path in keep-alive degrades to cold replay. A miss, a mismatch, a dead session, a busy session, a raced second turn, an expired TTL, a validation failure: all of them fall through to the path the runner already runs today. A validation bug can only cost a cold restart. It can never produce a wrong continuation or fail a turn.

---

# Part 3: The design decisions

Each decision below states the problem, the options, the trade-offs, the choice, and why.

## Decision 1: key the pool on project plus session, not session alone

**Problem.** The pool needs a key that identifies "the same conversation." The obvious candidate is the conversation id (`session_id`) that the frontend already mints per chat tab and sends on every request (`protocol.ts`, resolved by `resolveRunSessionId`). But that id is supplied by the caller on the wire. Two callers in two different projects could send the same `session_id` string. If the key were the id alone, a request from project B could look up and continue a live agent that belongs to project A, running with project A's credentials and memory. That is a cross-project leak.

**Options.**
- (a) Key on `session_id` alone. Simplest, but unsafe for the reason above.
- (b) Key on a project scope plus `session_id`. Safe, but the runner needs a trustworthy project id, and no project id rides the `/run` wire for playground runs today (the Python adapter forwards none, and `server.ts` assumes its absence).
- (c) Add a project id to the wire. Safe, but it is a wire change, and the whole feature is meant to be runner-only.

**Choice: option (b), with the project scope taken from the mount-sign response.** When the runner signs mount credentials, the sessions API returns a mount object that includes `mount.project_id`. That value is server-verified, not caller-supplied, so it is a project scope the runner can trust. The mount helper (which today keeps only the credentials) is extended to surface it, and the pool key becomes `<projectId>:<sessionId>`.

**Consequence and why.** If mount signing is unavailable (the store is unconfigured, the request falls back to an ephemeral working directory, or signing returns an error), there is no trustworthy project scope, so **that session is never parked**. It runs fully cold, exactly as today. This is a deliberate safety default: no verified owner means no reuse. It also means keep-alive silently does nothing on a deployment where mount signing is broken, which is a real thing that happened during QA (see status.md); the tell is the absence of a `[keepalive] park` log line.

## Decision 2: the two fingerprints, and what problem they solve

**Problem.** A parked session is a frozen agent with a specific configuration and a specific history. The next request might not be a clean continuation of it. The config might have changed (the user edited the agent's model, prompt, or tools between messages). The history might not line up (a different client, or a resend of an older state). If the runner blindly continued the live session on a request that does not actually follow from it, the agent would answer with the wrong setup or the wrong memory. So before continuing, the runner has to prove the incoming request is a true continuation of the parked session. Two fingerprints do that.

**Fingerprint 1, config.** A hash over the config-bearing fields of the request: harness, sandbox, model, provider, deployment, endpoint, credential mode, the system prompts and `AGENTS.md`, tools, skills, custom tools, MCP servers, permissions, the workflow revision id and version, and the draft flag. It deliberately excludes the per-turn volatile fields (the messages, the turn id, trace propagation headers, rotating telemetry headers, and secret values). If the config fingerprint differs, the configuration changed, and the parked session is the wrong setup to continue.

**Fingerprint 2, history.** A hash over the ordered prior user-message texts plus the ordered tool-call ids, plus a count of prompts so far. These survive the round trip byte-stable, so they identify "this request continues exactly the conversation the parked session has lived through." If the history fingerprint differs, this request is not the next step of that session.

**What happens when the user changes the config mid-conversation.** This is a real case: the user sends a message, then edits the model or a tool in the playground, then sends another message in the same chat. The `session_id` is unchanged, so the pool lookup hits. But the config fingerprint now differs. Options here were: (a) mutate the live session to the new config, (b) continue with the old config and ignore the change, or (c) evict and cold-start with the new config. We chose **(c)**. A running harness cannot be reconfigured in place (its model, prompt, and tools were baked into the process at `createSession`), so (a) is not possible without tearing the process down anyway. Option (b) would silently ignore the user's edit, which is wrong. Option (c) evicts the parked session, destroys it, and cold-starts a fresh one with the new config. The user gets exactly what they configured, at the cost of one cold turn. A config change is a cold turn, by design.

**What happens on no match, in general.** Any fingerprint miss degrades to cold replay. The design never tries to force a continuation it is unsure about. The worst case of a fingerprint bug is an unnecessary cold restart, never a wrong answer. A unit test pins the history fingerprint to the exact message array the server receives (the frontend prunes answer-less assistant turns before sending), so a future change to the frontend's pruning rule trips a test instead of silently causing misses.

## Decision 3: what the runner does on each incoming request

**Problem.** On a request whose key hits the pool, the runner has to decide among several outcomes. It also has to handle two clients racing on the same conversation.

**The decision, in order:**
- **Continue a normal turn.** Both fingerprints match, and the tail of the request is a fresh user message. The runner calls `session.prompt(newUserText)`. No flattening.
- **Resume an approval.** Both fingerprints match, the parked session holds an open Claude permission request, and the new content is an approval answer whose tool-call id matches the parked gate. The runner answers the parked request (Decision 6).
- **Go cold.** Anything else: a miss, a fingerprint mismatch, a dead session, a busy session, or a gate shape the runner cannot answer. Evict, destroy, run today's path.

**Two clients racing the same conversation.** Suppose the user has two playground tabs open on the same conversation, or sends a second message while the first is still running. Both requests carry the same key. The parked session can only run one turn at a time (the harness is a single process). Options were: (a) reject the second turn with an error, or (b) supersede: destroy the busy session and cold-start the second turn fresh. We chose **(b), supersede**. It is simpler and it honors the rule "never fail a turn." The second turn runs; it just runs cold instead of continuing. The first turn's result is abandoned, which is the correct outcome when the user has moved on. A `busy` flag on the session (a single-threaded check-and-set, safe because Node runs the dispatch on one thread) makes the race detectable: if a request arrives for a session already marked busy, the runner supersedes.

**Why not a real lock, like the rest of the backend uses.** The backend has a locking facility (for example around sessions) that could serialize turns on a conversation. We considered using it. We chose not to, for two reasons. First, keep-alive is single-replica and single-threaded, so the only race is inside one process, and a `busy` flag settles it without any distributed machinery. Second, the desired behavior on a race is not "block the second turn until the first finishes"; it is "let the second turn win, cold." A lock would make the second caller wait for a turn whose result they no longer want. The long-term picture is different: once the runner is multi-replica, or once turns can be parked durably on the interactions plane (Decision covered in Part 4), a real cross-process lock or an affinity route becomes the right tool. For this single-replica, in-memory feature, the flag is the honest fit.

## Decision 4: split the turn into acquire and run

**Problem.** Today `runSandboxAgent` builds the environment and runs the turn in one function. To reuse an environment across turns, the expensive build has to be separable from the per-turn work.

**Choice.** Split it into two functions:
- `acquireEnvironment(request)`: the session-scoped, expensive build (today's lines 328 to 699). It returns an environment that can serve many turns. The internal tool server must live as long as the session, because its URL is baked into the session at creation.
- `runTurn(env, request, emit, signal)`: the per-turn work (today's lines 712 to 986). A fresh trace run, a fresh approval latch, a fresh decision set, then prompt, resolve usage, flush the trace. On a continuation, the prompt is just the new user text, so `buildTurnText` never runs.

**Incremental finalizers (why a half-built environment cannot leak).** `acquireEnvironment` registers a finalizer for each resource the moment it exists: sandbox started, working directory mounted, tool server up, session created, temp dirs made. If a later step throws, the environment's `destroy()` runs the finalizers registered so far, in reverse order. This is the same `destroy()` the pool uses later, so there is exactly one teardown path, and it is correct whether the environment is fully built or half built.

## Decision 5: attach the event listeners once, for the life of the session

**Problem.** Each turn's handlers close over turn-specific state (the trace run, the pause controller, the latch, the decisions). The naive way to reuse a session is to detach turn N's listeners and attach turn N+1's. That is a trap in this package.

**Why the naive way is wrong.** The `sandbox-agent` listener registries are plain sets. An event that fires with no listener attached is silently dropped. A permission request that arrives with no listener is **cancelled**. So any window between detaching one turn's listeners and attaching the next turn's is a window in which a dropped event or a cancelled approval can occur.

**Choice.** Attach `onEvent` and `onPermissionRequest` exactly once, in `acquireEnvironment`, for the whole life of the session. Those permanent listeners demux into a mutable "current turn" reference that `runTurn` swaps in at the start of a turn and clears at the end. There is no detach window, so there is no drop or cancel window. Events that arrive while no turn is active (between turns, or after a park) hit a small between-turns handler: a permission request parks (Decision 6) or is cancelled by an explicit policy, and a stray event is logged and dropped by decision rather than by accident. The risk moves from "did we detach in time" (a timing bug, hard to test) to "does every event route to the right turn" (a routing property, easy to test with a fake session).

## Decision 6: the approval win, for Claude today and Pi later

This is the decision Mahmoud asked to be rewritten to cover both harnesses. The full context is the four-gate table in Part 1. Here is what keep-alive does with each gate, why, and what it would take to extend it.

**The mechanism that makes a gate parkable.** A gate is parkable only if, after the turn ends, the runner still holds something it can answer to make the original tool call proceed. The Claude ACP permission gate is the only one that qualifies. When it fires, the runner is holding two things: the pending permission request (kept in the daemon's `pendingPermissionRequests` map, in the runner's own memory) and the suspended `prompt()` promise (the HTTP connection carrying it is held open by a disabled undici timeout in `acp-fetch.ts`, on purpose, so a paused human-timescale turn is not reaped). Both survive the turn ending. So the runner can park the session, and when the human clicks, call `respondPermission` on the still-open request and await the same suspended promise. The original call runs with its original arguments.

**Why the other three gates cannot park as built.**
- **Pi custom-tool relay gate.** The block is not in the runner. It is a file poll inside the sandbox, running on its own 60-second deadline (`RELAY_TIMEOUT_MS`). The runner holds no promise. By the time the turn ends, the Pi side is either still spinning on a file that will never appear or has already timed out. There is nothing in the runner to answer.
- **Pi builtin gate.** Same shape, one level in: a hook inside the Pi process blocks synchronously on the relay. A synchronous block inside the harness cannot survive a turn boundary, and again the runner holds nothing.
- **Client-tool MCP pause.** The runner actively **aborts** the in-flight HTTP request when the tool pauses (`tool-mcp-http.ts`). The request is destroyed on purpose (so the harness cannot clobber the pending widget). By turn end there is no held request to answer.

**Choice for v1: park Claude ACP permission gates only. The other three stay on the cold path, and stay exactly as correct as today.** A Pi approval, or a Claude client-tool approval, still destroys the session on pause and still resumes through today's decision-map replay. Those users get today's behavior, no better and no worse. The dispatch only takes the park-and-answer path when the parked gate is a Claude ACP permission id; any other gate shape on a parked session is treated as a mismatch and evicts to cold. Tests assert this.

**What it would take to make Pi parkable (the future path, not v1).** The Pi gates are unparkable because the wait lives inside the sandbox on a bounded file poll, not in the runner as an answerable promise. Two things would have to change. First, the in-sandbox wait would need to be unbounded or resumable, instead of a 60-second fail-closed deadline; a park can outlast 60 seconds, so the relay would have to hold (or re-establish) the pending state rather than time out and error. Second, the pending decision would have to move into a runner-held handle, the way the Claude ACP request already is, so the runner has something to answer after the turn ends. That is a relay redesign, not a keep-alive change, so it is out of scope for v1 and recorded as future work. The honest v1 statement is: keep-alive makes the Claude approval path reliable now, and leaves a clear, scoped path to do the same for Pi later. Until then, the consequence for a Pi user is spelled out plainly: their approvals keep working through the cold decision-map replay, with the same drift risk that path has always had.

**What park mode has to change in the code (Claude path).** On a park: do not fire the destroy callback (inject a park callback instead); do not abort the internal tool server (the environment stays alive); do not settle the paused call as "not executed" (it will actually run); and add a `resume()` that clears the paused tool-call ids so post-resume update frames stream again. The "a pause sends no harness reply" contract is unchanged; the reply just arrives later on the same session. The durable interaction row is created on pause as today and resolved on the decision as today, with one new ordering rule: a later turn's stale-interaction sweep must not cancel the interaction the runner is about to resolve on the same session.

**Whose context runs the resumed tool.** The original turn's baked environment executes the tool: its signed mount credentials, resolved secrets, tool-callback auth, harness env, and sandbox. The resume request cannot re-bake any of that, because the harness process already holds it. The new turn owns only the egress side: its trace run records the resumed events, its emitter streams them, and its hooks resolve the interaction row. The credential epoch (Decision 7) bounds how stale the baked credentials may be.

## Decision 7: the credential epoch

**Problem.** A parked session baked its credentials at acquire time: the signed mount credentials, the resolved secrets, and the tool-callback auth. If it parks for the full approval TTL and one of those rotates or expires in the meantime, resuming would run the tool with stale credentials.

**Why a plain identity check is not enough.** The wire carries raw secret values and no version identity. A secret could rotate to a new value under the same slug, and nothing on the wire would signal it. So the runner cannot detect a rotation by comparing an id or a version.

**Choice.** The park record stores the mount-credential expiry timestamp plus a process-local hash over the actual resolved secret values and callback auth. That hash lives in runner memory only. It is never logged, never persisted, and never put in any emitted event or error. On the next request, if the epoch has expired or the incoming request's value hash differs, the runner treats it as a fingerprint mismatch: evict, destroy, cold-start with fresh credentials. The idle TTL (60 seconds) is far shorter than any credential lifetime, so this mostly matters for the longer approval TTL.

## Decision 8: lifecycle and teardown safety

**The config surface.** Four flags, added to the runner's config module rather than read ad hoc from `process.env`:
- `AGENTA_RUNNER_SESSION_KEEPALIVE` (default off).
- `AGENTA_RUNNER_SESSION_TTL_MS` (recommended default 60000, the idle TTL).
- `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS` (recommended default 300000, the approval TTL; see Decision 9 for why 5 minutes and not 10).
- `AGENTA_RUNNER_SESSION_POOL_MAX` (recommended default about 8; see Decision 9 for the sizing math).

With the flag off, behavior is byte-identical to today. Requests without a `session_id` never park.

**Every teardown runs one idempotent `destroy()`.** This is the load-bearing safety property. Today teardown is guaranteed by a `finally`. Keep-alive defers teardown, so every trigger has to call the same complete, idempotent cleanup (the finalizers built up in `acquireEnvironment`, matching every step the old `finally` ran). The triggers are:

- **Idle TTL expiry.** An idle session's timer fires; destroy.
- **Approval TTL expiry.** A parked-approval session's longer timer fires; destroy and abandon the held request. This degrades: the frontend still shows the Approve button, and the click lands on today's cold path.
- **LRU cap.** When the pool is full and a new session wants to park, evict the least-recently-used idle session. Never evict a busy or awaiting-approval session. If nothing idle can be evicted, do not park the new one; tear it down as today. Parking is best-effort.
- **Fingerprint mismatch.** Evict and destroy, run cold.
- **Explicit stop.** `POST /kill` drains the whole pool.
- **Runner shutdown (SIGTERM or SIGINT).** The shutdown handler drains the pool through `pool.destroyAll()`, timeout-bounded. This matters: the existing `inFlightSandboxes` registry alone is not enough, because its shutdown path only destroys the sandbox and skips the relay stop, the tool-server close, `destroySession`, dispose, unmount, and temp-dir removal. The pool's per-session `destroy()` is the authoritative cleanup. On a hard SIGKILL or OOM the process dies with its local children, and (for Daytona) the auto-stop backstop covers the remote sandbox a signal can never reach.
- **Client disconnect.** On abort, destroy, do not park. A session-owned run already survives a mid-turn disconnect, but a disconnect means the turn was abandoned, so there is no reason to hold the session after it ends.
- **Runtime failures.** A rejected parked prompt promise, a sandbox that died mid-idle (caught by a liveness probe on the next acquire), or a continuation that throws mid-turn all evict and fall back to cold; a mid-turn failure retries once cold.

**The memory leak: does the pool help, hurt, or stay neutral.** There is a known leak class from the 2026-07-06 incident. Killing the daemon does not cascade the kill to the adapter subprocess it spawned; the orphaned adapter (and the harness under it) reparents to PID 1 and never exits. The fix was step 4 of teardown: send `session/cancel` before destroying the sandbox, so the adapter and harness shut down cleanly. That fix only runs on paths that reach `destroy()`. A hard SIGKILL or OOM of the runner skips it, and those local processes still leak.

Honest answer on the pool: it is **neutral to slightly helpful on the graceful paths, and slightly worse on the hard-kill path**, and not materially either way.
- Helpful: the pool routes every graceful teardown (TTL, LRU, supersede, shutdown drain) through the same idempotent `destroy()`, so the `session/cancel`-before-`destroySandbox` fix keeps its coverage. The pool does not bypass it.
- Slightly worse: a pool keeps up to `POOL_MAX` trees alive at once instead of one. On a hard SIGKILL or OOM, all of them leak at once instead of just the in-flight one. The TTL reaper only runs while the runner lives, so it does nothing for a killed runner.
- Net: the pool neither introduces nor cures the root cause (the daemon not cascading its kill). It raises the count exposed to the uncatchable kill path. The real fix for that class is an OS-level backstop (a process-group kill or a reaper) that does not depend on the runner running its `finally`. That is recorded as a follow-up in status.md; it is not part of this design.

## Decision 9: memory and CPU cost, measured, and how to size the pool

Mahmoud asked for real numbers, not guesses. These were measured on the Hetzner dev box, inside the runner sidecar, against genuinely parked Claude sessions (method and raw figures in status.md).

**Per parked Claude session (the three-process tree):**

| Process | RSS | Pss (shared-adjusted) |
|---|---|---|
| sandbox-agent daemon (node) | ~16 MB | ~11 MB |
| ACP adapter (node) | ~82 MB | ~33 MB |
| Claude CLI (the harness) | ~246 MB | ~185 MB |
| **Total per session** | **~336 MB RSS** | **~224 MB Pss** |

The harness process dominates. Pss (which counts shared library and binary pages once) is the honest marginal-cost figure, because the many node and claude processes share text pages; the true cost of each added session sits between the Pss sum and lower.

**Idle CPU is near zero.** A parked session's processes block on I/O and use about 0% CPU. The quietest whole-container reading with sessions parked and nothing running was 0.45%. There is no CPU cost to keeping a session alive; the cost is memory.

**Baseline (idle runner, no sessions):** about 250 MB RSS.

**Sizing the pool.** With about 330 MB per parked Claude session, a full pool of 8 costs roughly 250 MB + 8 x 330 MB = about 2.9 GB RSS (less on a Pss basis). So the pool cap is really a RAM budget knob: pick it from the runner container's memory. Eight is a reasonable default for a container with a few GB to spare.

**Is a cap of 8 too small, and what happens when the pool is full.** A small cap does not block anyone and does not fail any turn. When the pool is full and a new conversation wants to park, the runner evicts the least-recently-used idle session and parks the new one; a busy or awaiting-approval session is never evicted. If nothing idle can be evicted, the new session simply runs unparked (cold on its next turn), exactly as today. So the only thing a small cap costs is a lower cache hit rate: fewer conversations get the fast continue. It never sends a turn to an error, only to the cold path. Size the cap to the container's RAM, and raise it if the hit rate is low and RAM allows.

## Decision 10: Daytona (cost, and where the difference lives)

**Where the code difference lives.** The pool logic is provider-neutral. Local and Daytona runs use the same `SandboxAgent` and `Session` interface; only the provider construction differs (`local(...)` versus `daytona(...)` in `provider.ts`). Everything downstream (create, prompt, respondPermission, destroy, and the pool) is identical. So there is no Daytona-specific pool adapter. The pool holds opaque environments and one `destroy()` closure per session, and it does not care which provider built them.

The one Daytona-specific reconciliation is the sandbox's own auto-stop. A Daytona sandbox has a 15-minute idle auto-stop and ephemeral auto-delete (`provider.ts`) as a leak backstop. A parked session must not let the remote sandbox auto-stop out from under it. With a 5-minute approval TTL this is not a conflict (5 is well under 15). A longer TTL would need the auto-stop raised or disabled while parked, and the pool's own TTL becomes the primary reaper. That reconciliation lives in `provider.ts` and the TTL config, not in the pool.

**Cost.** Daytona bills per second for the resources a sandbox consumes (about $0.0504 per vCPU-hour, $0.0162 per GiB-RAM-hour, and a negligible per-GiB-disk-hour). A default sandbox is 1 vCPU, 1 GiB RAM, 3 GiB disk, which runs at about $0.067 per hour. Two facts drive the design:

- A **stopped** sandbox bills only for disk (about $0.0003 per hour), roughly 200 times cheaper than running. So the cost of keep-alive on Daytona is the cost of keeping a sandbox running instead of stopping it.
- Cold start is sub-100 milliseconds, so cold-starting the next turn costs almost nothing in dollars; its only cost is latency.

Back-of-envelope for a 5-minute idle TTL per conversation on the default sandbox size: about $0.0056 (half a cent) per conversation. At 100 active users running roughly 10 conversations a day, that is about $168 a month; at 1,000 users, about $1,680 a month. The ceiling, if a sandbox were somehow kept running 24/7 per user, is about $49 per user per month, which is why the auto-stop and a short TTL matter. The dominant cost lever is not the TTL length but making sure sandboxes actually stop rather than linger running. This is why Daytona keep-alive (slice 3) is gated behind local success, and why its TTL should be shorter than the local one.

---

# Part 4: Relations to the other features

## Relation to session resume, and the runner-restart consequence

**Runner restart during a deployment.** A redeploy restarts the runner, which drains and destroys every parked session (SIGTERM path, Decision 8). The consequence is contained: every parked conversation loses its live memory, and its next message runs cold. No turn fails, nothing corrupts, no sandbox leaks (the drain runs the full teardown). The user notices one slower turn. Keep-alive is a cache, and a cache is allowed to be cold after a restart.

**The long-term answer is session resume.** The companion design ([../harness-session-resume/plan.md](../harness-session-resume/plan.md), option 3) restores memory across restarts and long gaps by reloading the harness's own session files with `session/load`, with no idle process kept alive. The two features compose as a three-tier fallback on the same `session_id`:

1. Live pool hit inside the TTL: continue the running session (keep-alive). Fastest, highest fidelity, costs idle RAM.
2. Pool miss but the harness session file exists: reload it (session resume). Full fidelity, costs a load per turn, zero idle RAM.
3. Both miss: cold replay of the flattened transcript (today's path). Always available, always correct.

Build order is keep-alive first, then session resume: keep-alive is runner-only with no storage work and it removes the two production approval failures immediately, and it establishes the fingerprint and skip-flatten seams that session resume reuses.

## Relation to the interactions plane (durable human-in-the-loop, the "state later" story)

Today, an approval travels on the **messages plane**: the decision rides inside the conversation and takes effect when the frontend re-sends it. There is a second, newer **interactions plane** (a `session_interactions` table plus `/sessions/interactions` endpoints), described in [../approval-boundary/how-approvals-work.md](../approval-boundary/how-approvals-work.md). Its vision is durable approvals: a parked run leaves a pending record that anyone can answer later, from any surface, without a chat held open. The runner already writes rows to it (create on pause, resolve on decision) for committed revisions.

How the two planes compose with keep-alive once both are real:

- **Keep-alive is the fast, in-memory tier of the same idea.** It parks the live session for a short window so the answer, when it comes quickly, resumes the original call with no replay. The interaction row is the durable record of that same pending approval.
- **The interactions plane is the slow, durable tier.** When the answer comes after the approval TTL (hours later, from another surface), the live session is long gone. The answer settles the interaction row, and a resume replays the conversation with the decision available. That is the same settle-by-stored-decision mechanism the cold path already uses.
- **Together:** a pending approval leaves both a parked live session (fast lane, valid for the approval TTL) and a durable interaction row (slow lane, valid indefinitely). Whoever answers first wins: a quick click resumes the live call; a late answer settles the row and replays cold. The deferred piece is the resolver that reconciles the two, so an API-plane answer can feed back into a run. Keep-alive does not build that resolver; it makes the fast lane real and leaves the row untouched so the durable design can build on it.

---

# Slices

1. **Keep-alive across normal turns.** Local only, flag off by default, runner-only. The pool (project-scoped key, credential epoch), the acquire/run split with incremental finalizers, session-lifetime listeners demuxing into the current-turn sink, the dispatch wrapper, and the shared idempotent `destroy()` that the shutdown handler drains. About 350 to 500 lines. Medium risk (the teardown deferral and the turn demux). Flag off is byte-identical.
2. **Keep-alive across approval pauses, Claude ACP permission gates only.** Park mode in `pause.ts`, the `respondPermission` resume, and the interaction-resolve ordering. Pi relay gates, Pi builtin gates, and client-tool MCP pauses stay cold (Decision 6), asserted by tests. About 200 to 300 lines. Highest correctness value and highest correctness risk.
3. **Daytona.** Remove the `isDaytona` gate after slices 1 and 2 have run in real use. Reconcile the sandbox auto-stop with the approval TTL. Verify cookie-fetch session reuse and mounted-cwd survival across a park. Small code, real operational risk (billed idle time, remote liveness).
