# Spike A: cancelling a turn without losing the warm sandbox

> AGENT-GENERATED, low weight. Findings and a first implementation. Mahmoud makes final decisions.

Status: the six questions are answered, the runner change is written and unit tested, and the live
scenario passed on the local sandbox for two harnesses. The Claude harness is not tested, because
this stack has no Anthropic key.

**One finding needs a decision before this ships: a stopped Codex turn leaves its shell command
running inside the parked sandbox.** Pi kills its child; Codex does not. Before this change the
sandbox was deleted, which killed the orphan, so parking is what makes it survive. Measured, both
directions, in "What happens to the in-flight tool" below.

## The answer in one paragraph

A user Stop can keep the sandbox warm today, and the change to do it is small. The runner already
receives the Stop through its heartbeat and already ends the turn as `cancelled` rather than as an
error. Two things were missing. First, nothing told the harness to stop: the abort only made the
runner stop waiting, so the harness kept an open prompt and a running tool, and only the teardown
that was already deleting the sandbox ever stopped it. Second, `shouldPark` answered `false` for
every aborted run, so a Stop always deleted the sandbox. The fix sends the ACP `session/cancel`
notification, waits for the harness to answer its open prompt, and parks when it does. Live, Pi
answered in 14 ms and Codex in 22 ms, and the next message reused the same sandbox and the same
native harness session.

## What was tested, and on what

One table for the whole spike, so nobody has to infer coverage from the prose. "Live" means the
scenario in "The live test" ran against a real deployment; everything else is a code read.

| Harness | Live test | What `session/cancel` does to the in-flight tool | Evidence |
| --- | --- | --- | --- |
| Pi (`pi_core`) | yes, local sandbox | harness answers the prompt in 14 to 31 ms, and the shell child is GONE | live, process probe returned `NO_SLEEP_PROCESS` |
| Codex | yes, local sandbox | harness answers the prompt in 22 ms; the runner reaps the shell child before parking | live process tree captured the leak; the runner reap is covered at the turn boundary |
| Claude Code | no, this stack has no Anthropic key | not measured | expected to match, from code: the runner branches on capabilities, never on harness name, and sends the same ACP notification to all three |

| Sandbox provider | Live test | Note |
| --- | --- | --- |
| local | yes, every run | The "sandbox" is a process tree in the runner container. |
| Daytona | no | The park-versus-delete decision costs real money here, so it belongs in the release gate. No snapshot rebuild is needed for the runner-side cancel; a Codex bridge fix would need one. |

Before this change, the abort sent NO cancel to Claude Code or Codex at all: it resolved a local
promise and left the harness working (`services/runner/src/engines/sandbox_agent/run-turn.ts`, the
cancel race). Only Pi sent one, and only as a side effect of its trace-flush path calling
`destroySession`. All three now get a real cancel.

## The six questions

### 1. Which request cancels a running prompt, and where is the guard?

The request is the ACP `session/cancel` notification. It is the same request for all three
harnesses, because the runner talks to every harness through the same Agent Client Protocol
adapter. There is no per-harness cancel.

The guard is in the vendored TypeScript client only. `sandbox-agent`'s `SandboxAgent` refuses a
caller-sent cancel:

```js
var MANUAL_CANCEL_ERROR = "Manual session/cancel calls are not allowed. Use destroySession(sessionId) instead.";
...
async sendSessionMethodInternal(sessionId, method, params, options, allowManagedCancel) {
    if (method === SESSION_CANCEL_METHOD && !allowManagedCancel) {
      throw new Error(MANUAL_CANCEL_ERROR);
    }
```

`services/runner/node_modules/sandbox-agent/dist/chunk-TVCDKGSM.js:561` and `:1550` (verified).
The public `rawSendSessionMethod` passes `allowManagedCancel: false`; only `destroySession` passes
`true` (`:1407`).

The guard is NOT in the daemon. The daemon is a Rust binary
(`@sandbox-agent/cli-<platform>`, resolved at `services/runner/src/engines/sandbox_agent/daemon.ts:26`)
that proxies ACP over HTTP. The client sends the cancel as a plain notification with no response
envelope (`services/runner/node_modules/acp-http-client/dist/index.js:115`), and the runner already
sends exactly this notification on every teardown through `destroySession`
(`services/runner/src/environment/harness-session-lifecycle.ts:163`). Verified live: the new
cancel reached the adapter and both harnesses answered.

`destroySession` is misleadingly named. It sends the cancel, resolves the client's pending
permission requests, and stamps `destroyedAt` on its own local record. It does not tell the daemon
to drop the session, and `resumeSession` clears `destroyedAt` again
(`node_modules/sandbox-agent/dist/chunk-TVCDKGSM.js:1364`).

### 2. Does the cancel preserve the native harness session?

Yes, verified live for Pi and Codex. ACP requires the agent to end the open `session/prompt` with
`stopReason: "cancelled"` after a cancel, and both harnesses did: the runner logged
`prompt stopReason=cancelled` in every run. The ACP session stays bound, so the next turn on the
same environment prompts the same native session with no reopen. The live proof is the second
turn recalling a codeword from the first, with no `create_session` stage in the log.

What the harness reports is the prompt's own answer, not a separate frame. The runner reads the
settlement as "the prompt promise resolved", which is the harness saying it is idle again.

### 3. What happens to a running tool call and a partial message?

**In the transcript, the same on every harness.** The runner closes it honestly: on `cancelled` it
drains the queued ACP frames, keeps any real tool completion that already arrived, and settles
every still-open tool call with the `INTERRUPTED_BY_USER` sentinel
(`services/runner/src/engines/sandbox_agent/run-turn.ts:1305`, verified). No orphaned running part
and no invented success. Live, the browser-visible stream for the cancelled turn ended
`tool-input-available`, `tool-output-error`, `finish-step`, `finish`, and the partial assistant text
that had already streamed stayed in the stream.

**In the sandbox, the harnesses differ, and this is the finding that needs a decision.** The
transcript says the tool was interrupted. Whether the PROCESS actually stopped is a separate
question, and the answer is not the same for both harnesses. Measured by cancelling a running
`sleep`, then asking the next turn to run `ps -eo pid,etimes,args | grep '[s]leep '`:

| Harness | Cancel answered | Shell child after the Stop |
| --- | --- | --- |
| Pi (`pi_core`) | 14 to 31 ms | gone (`NO_SLEEP_PROCESS`) |
| Codex | 22 ms | still running |

The Codex reading is unambiguous. One probe returned two leftovers at once, `sleep 120` at 84
seconds elapsed and `sleep 300` at 31 seconds elapsed, which are the cancelled turns of two
different sessions, so the child survives its own turn AND the session that spawned it.

**Parking made the original leak survive.** Running the same Codex scenario with the settle budget
forced to 1 ms destroyed the environment and left no leftover. The runner now closes that gap in
`reap-exec.ts`: after the cancelled prompt settles, it finds the `codex app-server` below this
sandbox's daemon, selects only descendants started during the stopped turn, and checks that
`kill -9` exits successfully before reporting them reaped. The turn-boundary test pins the order as
cancel, process scan, reap, then park. The app server and older session processes remain alive, so
the native session survives without a Daytona snapshot rebuild.

**What reaches the API.** The turn's `message`, `tool_call` and `tool_result` rows, a `usage` row,
and the terminal `done` row, all present in the live runs. The terminal record now carries
`stopReason: "cancelled"` (see below). The turn is still NOT marked complete in the turn ledger, and
the runner drops the harness's continuity record, because a cancelled turn is not a faithful resume
point for a COLD rebuild (`services/runner/src/engines/sandbox_agent/run-turn.ts:1429`). See the
open issues.

### 3b. A stopped turn is now distinguishable from a completed one

The runner used to drop `stopReason` from the terminal `done` record unless it was exactly
`"paused"`, so nothing downstream could tell a Stop from a normal finish. The record now carries
`"cancelled"` too (`services/runner/src/tracing/otel.ts`, an explicit two-value allowlist rather
than passing the harness's reason through, so `end_turn` cannot start appearing there by accident).

Verified in Postgres on the live stack, one stopped turn and one completed turn of the same session:

```
 record_index | record_type |                       attributes
            4 | done        | {"type": "done", "traceId": "a278...", "stopReason": "cancelled"}
            3 | done        | {"type": "done", "traceId": "65b4..."}
```

### 4. Does the runner park or destroy on every cancellation path today?

Before this change: it destroyed on every one of them. `shouldPark` opened with
`if (signal?.aborted) return false`, and every Stop reaches the runner as an abort. The path is:

1. The API Stop tears the `alive` and `running` locks off the turn
   (`api/oss/src/core/sessions/streams/service.py:169`, `:288`).
2. The runner's next heartbeat reads `is_current_turn: false` and calls the interrupt callback
   (`services/runner/src/sessions/alive.ts:100`, `:205`).
3. The callback aborts the run signal, the turn races to `CANCELLED`, and the result carries
   `stopReason: "cancelled"` with `ok: true`.
4. `shouldPark` answered `false`, so the session coordinator evicted with
   `no-park:cancelled` and the teardown reason `aborted`, which deletes
   (`services/runner/src/engines/sandbox_agent/teardown.ts`, `aborted` is not in the parkable set).

The keepalive pool never saw a cancelled turn park. Verified live in the negative control run:
`evict key=... reason=no-park:cancelled`, then a cold rebuild on the next message.

Other teardown reasons are unaffected. A failed turn still destroys, a pause still parks under its
own approval path, and a client disconnect still destroys.

**The park decision now asks WHY the run aborted, not just whether it did.** Reading
`signal.aborted` cannot tell a cooperative Stop from any other abort, and inferring the Stop from
`stopReason === "cancelled"` would be worse than it looks: the turn sets that value whenever the
signal aborts, whatever aborted it. Any future `controller.abort()` anywhere in the runner would
then silently start parking sandboxes nobody had checked, which is exactly the failure the teardown
allowlist exists to prevent. So the one call site that means a Stop labels its abort
(`server.ts`, the heartbeat interrupt) and `shouldPark` requires that label. The mechanism is the
standard `AbortController.abort(reason)`, so nothing new is threaded through the engine, the
coordinator or the turn. See `services/runner/src/sessions/stop-signal.ts`.

Today only one call site could have produced a false park, and it is guarded another way: a
non-session run aborts on client disconnect (`server.ts`), but such a run is never `resumable`, so
`runSandboxAgent` would not have parked it. The label is what keeps that true tomorrow.

**Cancel, steer and kill are indistinguishable to the runner today**, because all three reach it as
the same "you lost the alive lock" heartbeat. That is safe rather than merely tolerable. A steer
WANTS the warm environment for the turn it starts, and a kill separately calls the runner's `/kill`,
which destroys the pool entry by key whether or not it was parked first
(`services/runner/src/server.ts`, the `/kill` route). Naming the actual operation needs the durable
command plane, which is work package B.

### 5. Is a sandbox-agent patch needed?

Yes, and it is eight lines. The guard is client-side, so the patch adds one method that sends the
managed cancel without stamping the session record destroyed. It is appended to the existing
`services/runner/patches/sandbox-agent@0.4.2.patch` through the normal pnpm patch flow:

```js
  async cancelSession(id) {
    this.cancelPendingPermissionsForSession(id);
    await this.sendSessionMethodInternal(id, SESSION_CANCEL_METHOD, {}, {}, true);
  }
```

plus the matching line in `dist/index.d.ts`.

Calling `destroySession` instead would also work at the wire level, and would need no patch. It is
the wrong call for two reasons. It marks the session destroyed when it is not, and on the Pi path
it aborts `env.mcpAbort`, which belongs to the ENVIRONMENT rather than the turn, so a parked
environment would come back with a dead tool-MCP server. The runner therefore uses `cancelSession`
and treats a client without it as "cannot cancel cleanly, so destroy".

### 6. Does Daytona need a rebuilt snapshot?

No. The daemon is baked into the snapshot
(`services/runner/images/sandbox/daytona/build_snapshot.py:53`, base image
`rivetdev/sandbox-agent:0.5.0-rc.2-full`, snapshot name `agenta-agent-sandbox-v1`,
selected by `AGENTA_RUNNER_DAYTONA_SNAPSHOT`). The change touches only the client library, which
lives in the runner image, and the daemon needs no new behavior: it already forwards this exact
notification on every teardown. Reported, not verified live, because this stack ran the local
sandbox provider. See the release-gate plan below.

## What the change does

Five files, one new module, one patch.

| File | Change |
| --- | --- |
| `services/runner/src/engines/sandbox_agent/cancel-turn.ts` | New. Sends the cancel, waits for the harness, reports whether it settled. |
| `services/runner/src/engines/sandbox_agent/run-turn.ts:1271` | On `cancelled`, cancel the harness first, then record `cancelSettled`. |
| `services/runner/src/sessions/stop-signal.ts` | New. Labels the Stop abort so the park policy can tell it from every other abort. |
| `services/runner/src/server.ts` | The heartbeat interrupt aborts WITH that label. |
| `services/runner/src/engines/sandbox_agent/engine.ts:28` | `shouldPark` parks a labelled, settled Stop. `clientGone` moved above the abort check. |
| `services/runner/src/tracing/otel.ts` | The terminal `done` record carries `stopReason: "cancelled"`. |
| `services/runner/src/engines/sandbox_agent/session-identity.ts` | New `stoppedTtlMs` park window. |
| `services/runner/src/engines/sandbox_agent/teardown.ts:35` | New parkable teardown reason `cancelled`. |
| `services/runner/src/lifecycle/session-coordinator.ts:773` | Both park paths use the stopped window and log `park-cancelled`. |
| `services/runner/src/protocol.ts` | `AgentRunResult.cancelSettled`. |
| `services/runner/patches/sandbox-agent@0.4.2.patch` | Adds `cancelSession(id)`. |

The rule is: only a CONFIRMED stop parks, and three separate things must be true. The abort must
carry the user-Stop label, the turn must have ended `cancelled`, and the harness must have answered
its prompt inside the budget. A cancel that cannot be sent, a cancel that throws, a prompt that
rejects on the transport, an unlabelled abort, and a harness that stays silent all fail at least one
of the three, and every one of them destroys. This keeps the teardown allowlist's discipline: a new
situation deletes until somebody proves its sandbox is safe to reuse.

Two deliberate non-changes:

- **`clientGone` still always destroys.** The check moved above the abort check so the disconnect
  verdict cannot be overridden by a settled cancel. One line, and it keeps today's behavior exactly.
- **The cancel does not abort `env.mcpAbort`.** That controller is the environment's, not the
  turn's. The approval-park path already skips it for the same reason
  (`services/runner/src/engines/sandbox_agent/run-turn.ts:491`). A teardown that does happen still
  aborts it through `teardownRuntimeInFlight`.

## The park window for a stopped session

A Stop asks a different question from an ordinary idle park. The ordinary window asks how long a
conversation might keep going by itself. A Stop is a button the user just pressed, so the answer is
known: they are about to type. On the 60 second local idle window the sandbox can be thrown away
while they are still writing, which is the cold start this change exists to remove. Mahmoud decided
on 2026-09-05 that a settled Stop uses the same 600 second window as an approval card on both
providers. A stopped Daytona sandbox can therefore remain billed for up to ten minutes.

Current windows, all from `services/runner/src/engines/sandbox_agent/session-identity.ts`:

| Window | Local | Daytona | Env override |
| --- | --- | --- | --- |
| Idle (a clean finished turn) | 60 s | 120 s | `AGENTA_RUNNER_SESSION_TTL_MS`, `AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS` |
| Awaiting approval | 600 s | 120 s | `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS` |
| Stopped by the user (new) | 600 s | 600 s | `AGENTA_RUNNER_SESSION_STOPPED_TTL_MS` |

The stopped window has its own environment override so operators can choose a different retention
and billing trade-off without changing the ordinary idle or approval windows. The 600 second value
was exercised live and logged `park-cancelled key=... ttl=600000ms`.

## The settlement timeout (RFC D-016)

**Recommendation: 10 seconds, overridable with `AGENTA_RUNNER_HARNESS_CANCEL_SETTLE_MS`.**

Measured settlement, local sandbox, both cancelling a running `sleep 90`:

| Harness | Time from cancel sent to prompt answered |
| --- | --- |
| Pi (`pi_core`) | 14 ms, 31 ms |
| Codex | 22 ms |
| Claude | not measured, no Anthropic key on this stack |

Ten seconds is about three hundred times the measured cost, which leaves room for a harness that
has to kill a child process, flush a partial turn, or answer over a Daytona network hop. It is
also short enough that a Stop which genuinely wedges gives up before a user gives up. Raise it only
against a measurement, because every extra second is a second the Stop looks unfinished. Do not
lower it below about one second: the budget also absorbs a slow network to a remote sandbox.

The timeout is not the user-visible Stop latency. That is dominated by the 30 second heartbeat
interval, which work package B replaces with long polling.

## The live test

An isolated EE development stack built from the spike branch used the local sandbox provider and
development images.

Protocol, driven by `spike_cancel_live.py` in the evidence folder:

1. Mint an account through `POST /admin/simple/accounts/` and stock the vault with an OpenAI key.
2. Create a workflow, a variant and a revision. The agent config sets
   `runner.permissions.default = "allow"`, so no approval gate can end the turn before the Stop
   lands.
3. Turn 1: ask the agent to run `sleep 90` through its shell tool, streamed over SSE.
4. At 30 seconds, send the Stop: `POST /api/sessions/streams/` with `{"session_id": ..., "force": false}`.
   The API answers `{"mode":"cancel", ...}`.
5. Turn 2: same session, replay the cancelled turn's assistant message, then ask for the codeword
   from turn 1.

Results:

| Harness | Cancel settled | Sandbox after Stop | Turn 2 | Turn 2 wall clock | Recalled turn 1 |
| --- | --- | --- | --- | --- | --- |
| Pi (`pi_core`) | yes, 14 ms | parked | same sandbox, `hit-continue` | 2.3 s | yes |
| Codex | yes, 22 ms | parked | same sandbox, `hit-continue` | 12.2 s | yes |
| Pi, budget forced to 1 ms | no, timeout | destroyed | new sandbox, cold | 8.0 s | yes, from replay |

The negative control is also the "before" picture: with the cancel unable to settle, the log reads
`evict key=... reason=no-park:cancelled` and the next turn pays a full rebuild. That is what every
Stop did before this change.

The scenario was re-run after the review changes landed, and the park now shows the stopped window:
`park-cancelled key=... ttl=600000ms`, then `hit-continue` on the next turn.

Codex's 12.2 second second turn is the model, not a cold start: the log shows `hit-continue` and
no `sandbox_start`, and the turn spent its time on reasoning tokens and two file reads.

Log lines and raw run output: `~/agenta-qa-evidence/2026-09-02-spike-a-sandbox-cancel/`.

**One trap worth writing down.** The first attempt looked like a failure and was not. The keepalive
pool matches a warm session on a fingerprint over the prior user texts AND the tool-call ids the
previous turn emitted (`services/runner/src/engines/sandbox_agent/session-identity.ts:436`). A
resume that omits the cancelled turn's assistant message therefore mismatches on history and
rebuilds cold, no matter how well the cancel worked. The browser sends that message, so the product
path is fine, but any test driver must replay it.

## Unit tests

`services/runner/tests/unit/harness-cancel-park.test.ts` (new) pins four rules:

- The cancel helper's settled, timed-out, rejected, unpatched-client and throwing cases.
- The Stop label: only the labelled abort counts, and a look-alike value cannot forge it.
- `shouldPark` parking a labelled settled Stop, destroying an unsettled one, destroying an
  UNLABELLED abort even when the cancel settled, destroying a failed turn, and still destroying on
  client disconnect.
- The park windows, their env override, and the teardown reason stopping rather than deleting.
- The terminal `done` record: a Stop carries `cancelled`, a pause still carries `paused`, and a
  completed turn plus every harness-reported reason carry nothing. The last case is the point of
  the two-value allowlist.

`services/runner/tests/unit/teardown.test.ts` gains the `cancelled` row, and
`services/runner/tests/unit/session-pool.test.ts` gains the new config field.

On the frontend, `web/packages/agenta-chat/tests/unit/assets/transcriptToMessages.test.ts` pins that
a cancelled `done` closes the turn like a completed one and does not mark it paused. Reconstruction
reads only `"paused"` (`transcriptToMessages.ts`), so the new value is inert there, which is a claim
worth a test rather than a comment.

Full suite: `cd services/runner && pnpm test` gives 159 files passed, 2651 tests passed. The
agenta-chat transcript suite gives 52 passed.

## What is not done

- **Claude is untested.** This stack has no Anthropic key. The cancel is the same ACP notification
  for every harness and the runner branches on capabilities rather than harness name, so the
  expectation is that Claude behaves like the other two. It is an expectation, not a measurement.
- **Daytona is untested.** Every live run used the local sandbox provider. The Daytona park path is
  the one where park versus delete costs real money, so it belongs in the release gate.
- **A settled Stop preserves the continuity record.** The durable row carries the native session
  ID and an end time, so a runner restart can load the same native conversation from its mounted
  transcript instead of discarding the Stop as an invalid resume point.
- **The Stop still takes up to 30 seconds to reach the runner.** That is work package B.
- **The Codex orphan is reaped by the runner.** Live Daytona verification remains part of the
  pair-level release gate; the runner-side fix needs no vendored bridge or snapshot rebuild.

## Live test plan for the release gate

Add one cell, run per harness and on both sandbox providers.

1. Start a turn that runs a long shell command, on a fresh session.
2. Wait until a `tool-input-available` frame for that command has arrived, then send the Stop.
3. Assert on the stream: the turn ends with `finish`, its open tool call settles as
   `tool-output-error`, and no `error` frame claims the run failed.
4. Assert on the runner log: `stage=harness_cancel sent=true settled=true`, then, for Codex,
   `stage=harness_reap killed=...`, then `prompt stopReason=cancelled`, then `park-cancelled`. Fail
   the cell on `no-park:cancelled` or any reap skip except `skipped=nothing-to-reap`.
5. Send a second message on the same session, replaying the cancelled turn's assistant message.
6. Assert on the runner log: `hit-continue` for the same pool key, and NO `stage=sandbox_start`
   between the two turns. On Daytona, additionally assert the sandbox id is unchanged.
7. Assert the second turn's answer references something only turn 1 said.
8. Assert the stopped turn's terminal `done` record carries `stopReason: "cancelled"` and the
   completed turn's does not.
9. Assert no leftover process from the cancelled command survives into the second turn. A failed
   or unknown Codex reap makes the Stop unsettled for parking and destroys the environment.

The negative leg is worth keeping too: with `AGENTA_RUNNER_HARNESS_CANCEL_SETTLE_MS=1` the same
scenario must log `settled=false` and `no-park:cancelled`. That proves the guard still guards.

## Open questions for Mahmoud

1. **How should a failed Codex reap affect parking?** Decision: do not park. A successful kill or a
   clean inspection that finds nothing to reap preserves the warm session; every unknown cleanup
   state falls back to deletion.
2. **Ten seconds for the settle budget?** Recommendation: yes, ship it. The measured cost is
   14 to 31 ms, so the budget is not a latency cost in the normal case, and it only ever delays a
   Stop that is already going badly.
3. **Should the Stop also settle the turn ledger row, rather than leaving the turn incomplete?**
   Recommendation: yes, in work package C. The terminal record now says `cancelled`, so a reader can
   tell a Stop from a completion, but the ledger row still looks like a turn that never finished.
4. **Do we test Claude and Daytona before the RFC is accepted, or at the release gate?**
   Recommendation: at the release gate, with the cell above. Blocking the design on an Anthropic key
   tonight buys little, because the cancel is one protocol request shared by every harness, and the
   Codex result shows the interesting variation is in what the harness does with it, not whether it
   accepts it.

Settled and safely reaped Stops preserve the continuity row and native session. Unsettled cancels,
including unknown Codex cleanup, invalidate continuity and fall back to cold replay. A plain
`clientGone` still destroys because a disconnect is not a Stop.
