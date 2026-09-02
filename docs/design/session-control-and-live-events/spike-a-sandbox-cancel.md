# Spike A: cancelling a turn without losing the warm sandbox

> AGENT-GENERATED, low weight. Findings and a first implementation. Mahmoud makes final decisions.

Status: the six questions are answered, the runner change is written and unit tested, and the live
scenario passed on the local sandbox for two harnesses. The Claude harness is not tested, because
this stack has no Anthropic key.

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

The runner closes the transcript honestly. On `cancelled` it drains the queued ACP frames, keeps
any real tool completion that already arrived, and settles every still-open tool call with the
`INTERRUPTED_BY_USER` sentinel (`services/runner/src/engines/sandbox_agent/run-turn.ts:1305`,
verified). No orphaned running part and no invented success.

Live, the browser-visible stream for the cancelled turn ended:
`tool-input-available`, `tool-output-error`, `finish-step`, `finish`. The partial assistant text
that had already streamed stays in the stream.

These records reach the API: the turn's `message`, `tool_call` and `tool_result` rows, a `usage`
row, and the terminal `done` row. All were present in the live runs. The turn is NOT marked
complete in the turn ledger, and the runner drops the harness's continuity record, because a
cancelled turn is not a faithful resume point for a COLD rebuild
(`services/runner/src/engines/sandbox_agent/run-turn.ts:1429`). See the open issue below.

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
| `services/runner/src/engines/sandbox_agent/engine.ts:28` | `shouldPark` parks a settled Stop. `clientGone` moved above the abort check. |
| `services/runner/src/engines/sandbox_agent/teardown.ts:35` | New parkable teardown reason `cancelled`. |
| `services/runner/src/lifecycle/session-coordinator.ts:773` | Log line `park-cancelled` on both park paths. |
| `services/runner/src/protocol.ts` | `AgentRunResult.cancelSettled`. |
| `services/runner/patches/sandbox-agent@0.4.2.patch` | Adds `cancelSession(id)`. |

The rule is: only a CONFIRMED stop parks. A cancel that cannot be sent, a cancel that throws, a
prompt that rejects on the transport, and a harness that does not answer inside the budget all
report unsettled, and unsettled destroys. This keeps the teardown allowlist's discipline: a new
situation deletes until somebody proves its sandbox is safe to reuse.

Two deliberate non-changes:

- **`clientGone` still always destroys.** The check moved above the abort check so the disconnect
  verdict cannot be overridden by a settled cancel. One line, and it keeps today's behavior exactly.
- **The cancel does not abort `env.mcpAbort`.** That controller is the environment's, not the
  turn's. The approval-park path already skips it for the same reason
  (`services/runner/src/engines/sandbox_agent/run-turn.ts:491`). A teardown that does happen still
  aborts it through `teardownRuntimeInFlight`.

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

Stack `agenta-ee-dev-session-spike` on `http://144.76.237.122:8580`, built from the worktree
`/home/mahmoud/code/agenta-2-worktrees/spike-a-cancel`, local sandbox provider, EE, dev image.

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

`services/runner/tests/unit/harness-cancel-park.test.ts` (new) pins three rules: the cancel
helper's settled, timed-out, rejected, unpatched-client and throwing cases; `shouldPark` parking a
settled Stop, destroying an unsettled one, destroying a failed turn, and still destroying on client
disconnect; and the new teardown reason stopping rather than deleting the sandbox.
`services/runner/tests/unit/teardown.test.ts` gains the `cancelled` row.

Full suite: `cd services/runner && pnpm test` gives 159 files passed, 2642 tests passed.

## What is not done

- **Claude is untested.** This stack has no Anthropic key. The cancel is the same ACP notification
  for every harness and the runner branches on capabilities rather than harness name, so the
  expectation is that Claude behaves like the other two. It is an expectation, not a measurement.
- **Daytona is untested.** Every live run used the local sandbox provider. The Daytona park path is
  the one where park versus delete costs real money, so it belongs in the release gate.
- **A cancelled turn still drops its continuity record.** `invalidateContinuity` runs on the
  cancelled path, so a warm resume works only while the environment stays in the process pool. If
  the runner restarts, or the pool evicts on its TTL, the next turn rebuilds cold AND cannot load
  the native session by id, so it replays the conversation as text. That is correct today for a
  rebuild, and it is a real gap for the durable warm resume the RFC wants. It is a separate
  decision, not a line to change here.
- **The Stop still takes up to 30 seconds to reach the runner.** That is work package B.

## Live test plan for the release gate

Add one cell, run per harness and on both sandbox providers.

1. Start a turn that runs a long shell command, on a fresh session.
2. Wait until a `tool-input-available` frame for that command has arrived, then send the Stop.
3. Assert on the stream: the turn ends with `finish`, its open tool call settles as
   `tool-output-error`, and no `error` frame claims the run failed.
4. Assert on the runner log: `stage=harness_cancel sent=true settled=true`, then
   `prompt stopReason=cancelled`, then `park-cancelled`. Fail the cell on `no-park:cancelled`.
5. Send a second message on the same session, replaying the cancelled turn's assistant message.
6. Assert on the runner log: `hit-continue` for the same pool key, and NO `stage=sandbox_start`
   between the two turns. On Daytona, additionally assert the sandbox id is unchanged.
7. Assert the second turn's answer references something only turn 1 said.

The negative leg is worth keeping too: with `AGENTA_RUNNER_HARNESS_CANCEL_SETTLE_MS=1` the same
scenario must log `settled=false` and `no-park:cancelled`. That proves the guard still guards.

## Open questions for Mahmoud

1. **Ten seconds for the settle budget?** Recommendation: yes, ship it. The measured cost is
   14 to 31 ms, so the budget is not a latency cost in the normal case, and it only ever delays a
   Stop that is already going badly.
2. **Should a cancelled turn keep its continuity record so the warm resume survives a runner
   restart?** Recommendation: decide it with work package D, not here. Keeping the record means
   resuming a native session that holds a half-finished turn, which is exactly the case the record
   was dropped to avoid. The right answer probably depends on the immutable-history decision.
3. **Should the Stop also settle the turn ledger row, rather than leaving the turn incomplete?**
   Recommendation: yes, but as part of work package C's Stop map. Today a cancelled turn has a
   terminal `done` record and no ledger completion, so a reader cannot tell "stopped" from
   "crashed" without the runner log.
4. **Do we test Claude and Daytona before the RFC is accepted, or at the release gate?**
   Recommendation: at the release gate, with the cell above. Blocking the design on an Anthropic
   key tonight buys little, because the cancel is one protocol request shared by every harness.
5. **Should `clientGone` eventually park too?** Recommendation: leave it destroying for now. A
   disconnect is not a Stop, the RFC does not ask for it, and changing it would widen the blast
   radius of a change whose value is already proven.
