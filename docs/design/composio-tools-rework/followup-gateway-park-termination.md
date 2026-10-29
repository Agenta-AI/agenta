# Follow-up issue draft: a gateway approval park does not end the turn promptly

**Status:** draft, for filing outside the gateway-connection rework. Found during the live QA of
that rework on 2026-08-27. Unlike
[the approval wedge](followup-approval-wedge.md), this one **is** in the rework's seam — the
gateway gate parks at the relay execution seam, and no other tool does. It is filed separately
because fixing it properly needs a design decision about the pause machinery, not a patch, and
because D3 was closed by a client-side change that does not depend on it.

> **Superseded in part, 2026-08-27.** The dominant cause of a cold ask-tier park failing to end
> the turn was **not** the Pi relay block this document describes. It was terminalization waiting
> on the parked tool call itself, for the full 30-minute tool-call bound. That is measured,
> understood, and **fixed** — see
> [The measured mechanism](#the-measured-mechanism-closure-wait-conflation-not-a-relay-block)
> below, which takes precedence over
> [Why it is gateway-specific](#why-it-is-gateway-specific) for this case. The rest of the
> document is kept because the relay-block reasoning still applies to the `pi_core` shape it was
> measured on, and because the "what was tried" section remains a live warning.

## Title

Agent runner: a gateway `run_tool` approval park rides the relay timeout instead of ending the
turn

## What happens

When `run_tool` compiles to `ask`, the gateway gate parks the turn at the relay execution seam.
The approval card and the durable `session_interactions` row are emitted immediately. The turn
itself then does not end for 59–135 seconds.

The run's HTTP response stays open for that whole window. The client eventually gives up, logs
"agent run failed", and appends an empty assistant carrier message — which pushes the approval
part out of last position and, because the AI SDK's approval dispatch only reaches the last
message, makes Approve a no-op.

## The acceptance bar

F-040: **an unanswered approval must end the turn.** A park is a normal, expected outcome, not a
failure mode, and it must terminate the turn as promptly as the two pause kinds that already do.

## Measurements

Taken on the `agenta-ee-dev-toolkit` stack, harness `pi_core`, model `openai/gpt-5.6-sol`. The
runner logs `prompt stopReason=paused` when the turn actually ends and
`[sessions/interactions] ingest OK` when the card's row lands, so the gap between them is the
defect, measured directly.

| pause kind                 | order                        | gap                  |
| -------------------------- | ---------------------------- | -------------------- |
| client-tool park           | `paused` first, then the row | **+30 ms**           |
| built-in ACP approval park | `paused` first, then the row | **+48 ms**           |
| gateway `run_tool` park    | the row first, then `paused` | **+59 s and +135 s** |

The persisted event sequence is structurally identical in all three cases
(`tool_call → interaction_request → tool_result → done`). Nothing is missing and nothing is
unterminated — the terminal frames simply arrive two orders of magnitude late. The client-side
symptom follows entirely from that delay.

## Why it is gateway-specific

`run_tool` is the only tool that is both **relay-executed** and **compiles to `ask`**.

- A built-in approval is raised on the ACP permission plane; the harness ends the turn itself.
- A client tool is not delivered through the extension's relay-wait path at all (the run plan
  separates `toolSpecs` from `executableToolSpecs`; the difference is the client tools), so its
  park has nothing blocking behind it.
- A gateway call is executing **inside** the Pi extension's `relayToolCall`, which blocks on the
  response file. `pause.pause()` ends the turn logically, but the extension's tool promise stays
  pending, and the prompt cannot resolve until it returns.

## The measured mechanism: closure-wait conflation, not a relay block

Established on 2026-08-27 by instrumenting the teardown path with `[park-stage]` stage markers
(commit `3fda24a9c1`, reverted once the fix landed) and running one ask-tier park on the
`agenta-ee-dev-toolkit` stack, harness `claude`, model `claude-sonnet-5`.

A gateway run passes **two gates on one tool-call id**, 3 ms apart:

```
06:16:20.893833Z [HITL] gate toolName="run_tool" permission=allow outcome=allow
06:16:20.896926Z [HITL] gate toolName="run_tool" permission=ask  outcome=pendingApproval
```

The first is the ACP gate on the **outer** `run_tool`, whose spec permission is `allow`. It calls
`onAllowedExecution` (`acp-interactions.ts:444`), which marks the id an allowed execution. The
second is the gateway's **semantic** gate on the target action, which reads the policy, answers
`ask`, and marks the same id a paused call. Nothing un-marks the first: `pause.ts` keeps two
independent sets and has no un-mark.

Paused-turn terminalization then computed its wait set as every open **allowed execution**, which
included the parked call, and waited for a closure only a human can produce. The bound is
`resolvedRunLimits.toolCallMs`, defaulting to `DEFAULT_TOOL_CALL_TIMEOUT_MS` = 30 minutes
(`run-limits.ts`). The markers show the turn stopping dead after `waitForEventDrain returned` and
resuming exactly 30 minutes later:

```
06:16:20.901179Z [park-stage] waitForEventDrain returned
06:46:20.903076Z [park-stage] openAllowedExecutions settled     <- 30 min + 2 ms
06:46:21.690858Z [park-stage] server run() returned stopReason=paused
06:46:21.728225Z [sessions/alive] heartbeat OK ... running=false
```

Everything after the wait took 2 ms, which is what rules the rest of the teardown path out.

**Why this is worse than "ends late".** `run()` never returns inside the window, so its `finally`
never releases the alive watchdog and the stream row keeps reporting `running=true`. A resume
arriving meanwhile finds the session busy, is marked `INTERRUPTED`, aborted, and evicted as
`supersede-busy`. That is the wedge that made Approve appear to do nothing on the live stack.

**The fix**, in `run-turn.ts` where the list is computed:

```ts
const openAllowedExecutions = openToolCallIds().filter(
  (id) => pause.isAllowedExecution(id) && !pause.isPausedToolCall(id),
);
```

At the computation and not at the wait, because the same list also seeds
`parkedApprovedExecutions` on the Pi batch branch, where a parked call has no seed and would be
carried and re-announced next turn as an approved execution it never was. (That second path was a
correctness bug, not an approval bypass: `ApprovedExecutionGrants.grant` keys on
`approvedCallKey(toolName, args)` and returns early when the call is unkeyable, so a seed with an
undefined tool name grants nothing.)

The parked call is deliberately **left open** — its `interaction_request` is the last word for the
call this turn, and the resume answers that exact id. Regression coverage:
`services/runner/tests/unit/gateway-park-termination.test.ts`.

Before the gateway existed, "allowed execution" and "paused call" were disjoint by construction,
which is why the wait was safe to write.

### `settleOpenToolCalls` takes `isExcluded`, not `shouldSettle`

Read the first argument wrong and you misread all three call sites in `runTurn`. `otel.ts` skips
every id the predicate matches, so:

- `(id) => pause.isPausedToolCall(id) || pause.isAllowedExecution(id)` settles the ORPHANS and
  deliberately spares paused calls and allowed executions. It is not what closes a parked call —
  nothing closes a parked call, by design.
- `(id) => id !== toolCallId` settles ONLY `toolCallId`, which is what the Pi batch branch wants.

Both readings cost time during this fix: the design for it was written on "the settle below
already gives the parked call its terminal state", and the first version of the regression test
asserted a settlement that correctly never happens.

### The shared fake harness cannot see this bug — do not write a red-first test through it

`tests/utils/sandbox-agent-harness.ts`'s run stub answers `openToolCallIds()` with `[]`
unconditionally and makes `settleOpenToolCalls` a no-op. Every terminalization assertion driven
through `fakeHarness` alone therefore passes **vacuously**: the wait set is always empty, so no
wait can ever be observed and no settlement can ever be recorded.

This nearly produced a false green on this very fix. The first red-first attempt "passed" against
the unfixed code, which looks exactly like a fix that was never needed.

If you are writing a test about what terminalization does — waits, settlements, orphan sweeps —
you need a transcript that tracks open calls. Two ways:

1. Give the test its own tracking run object and inject it through `deps.createOtel`, as
   `gateway-park-termination.test.ts` does. Everything else stays production wiring.
2. Teach the shared stub to track calls for real.

This fix took route 1 and deliberately did **not** change the shared stub: a large number of tests
assert against its current shape, and widening it under a blocker fix would have mixed an
unreviewed fixture change into a one-line behavior change. Route 2 is still the better long-term
answer and is worth doing on its own.

The only shared-harness change here was additive: an optional `afterPromptGates` hook, called
after the permission gates and their follow-on events, which is the one window in which a test can
act on a tool call the harness has both gated and opened. A gateway park needs exactly that
window, because the ACP gate on the outer `run_tool` must be answered before the relay receives
the call the gateway then parks.

## What was tried, and why it regressed — do not repeat this

The obvious fix is to unblock the caller: have the relay write the same benign
`{ok: true, paused: true}` answer on a gateway park that the non-Pi shim already receives, so
`relayToolCall` returns at once instead of waiting out `RELAY_TIMEOUT_MS`.

That was built (`7d578916`, reverted in `755db4025`) and it made things **worse**:

- It did unblock the relay wait — `pickup_ms` dropped to 0.7–1.9 ms and no relay timeout fired.
- But the turn then **never terminated at all**. Across three parks on the post-fix build
  (sessions `d5f76fb1`, `15362824`, `9482304e`): zero `type=done` persisted, no
  `prompt stopReason=paused`, and the sessions kept heartbeating `running=true` indefinitely —
  one was still running three minutes after its park.
- The SSE therefore never closed either (QA wire capture: 237 frames ending at
  `tool-approval-request`, then only `: keepalive`; zero `finish-step`, zero `finish`, zero
  `[DONE]`, `streamClosedAtMs` null).

Trading "ends late" for "never ends" is strictly worse: it leaks a `running=true` session, and it
removes the late-but-real finish the client was at least eventually getting. Hence the revert.

**The suspected mechanism**, for whoever picks this up: with the answer written,
`relayToolCall` returns `RELAY_PAUSED`, `assertNotPaused` (`services/runner/src/tools/dispatch.ts`)
throws inside the Pi extension, and Pi appears to treat that tool error as a _continuable_ event —
so the harness turn neither completes nor resolves the prompt, while `destroySession` has already
run underneath it. This is a suspicion, not a confirmed finding: `unexpected paused relay answer`
never appeared in the runner log, though that is not disconfirming, because the throw becomes a
tool result inside Pi's process rather than a runner log line.

**The first thing the next person should do** is add logging inside the extension's `execute`
path (`services/runner/src/extensions/agenta.ts`) to see whether Pi receives the throw and what it
does with it. Everything above is inference from the runner side of the boundary; nobody has
observed Pi's side.

## Candidate directions

1. **Cancel the pending relay wait on pause**, rather than answering it. The extension already
   passes an `AbortSignal` from Pi down through `runResolvedTool` → `relayToolCall` →
   `waitForRelayResponse`, so the abort path exists — it just did not fire within 135 s. Worth
   understanding why `destroySession` does not reach it before designing anything new.
2. **Give the relay-seam approval a presence on the ACP permission plane**, so it ends the turn
   the way a built-in approval does. This is the "live resume" design deferred during the rework;
   it is the larger change and would also make the approval live-resumable rather than cold-only.
3. Answer the caller _and_ ensure the harness turn is torn down deterministically — i.e. option 1
   from the QA round, plus whatever makes Pi stop rather than continue. Only viable once the
   mechanism above is actually observed.

## Related

- [`followup-approval-wedge.md`](followup-approval-wedge.md) — a _different_, pre-existing defect
  found in the same QA session (a cold replay cancels the row while the card stays on screen).
  The two can look alike from the UI and should not be conflated.
- The client-side half of D3 was closed by keeping `liveGateInteractionRef` populated on error so
  the SDK's late re-evaluation can still dispatch. That works with the _current_ late-but-real
  stream close, which is another reason the naive fast-answer fix must not be re-applied without
  re-checking the client.

## Related hazard: a gate can be dropped silently before the responder is attached

Found while landing the durable-decision seed, and recorded here because the fix does not belong
to that change.

The session-lifetime `onPermissionRequest` registered in `acquireEnvironment` routes every gate
into `env.currentTurn.onPermissionRequest`. That property is `undefined` from the start of
`runTurn` until `attachPermissionResponder` wires it. A gate arriving in that span takes the
between-turns branch in `session-events.ts` (`routePermissionRequestToActiveTurn`) and is answered
**`reject` by policy** — so a legitimate gate becomes a refusal, and the user never sees a card for
it. It is logged as a between-turns request, which is exactly what it does not look like.

Nothing suspends there today, so it cannot happen. But that is an invariant held by luck: it is
enforced only by two test files noticing the symptom, not by anything in the code. Adding a single
unconditional `await` anywhere in the prefix reintroduces it, which is exactly what happened when
the seed read was first placed inside `runTurn` — ten approval-gate tests failed with the gate
never answered at all. The read now happens in the callers and arrives through
`RunTurnOptions.seededDecisions`, and `runTurn` carries the invariant as a comment.

Making it structural rather than incidental means queue-and-replay in the session-lifetime handler:
hold gates that arrive with no `currentTurn` responder and deliver them once one attaches. Worth
doing, and out of scope for a blocker fix.

Related smell: there are six ways to reach `runTurn` (`server.ts` twice,
`lifecycle/session-coordinator.ts` three times, `engine.ts` once). Six entry points is six chances for pre-turn setup to diverge —
the seed read only stays uniform today because the three coordinator paths funnel through one
adapter in `server.ts`. Consolidating them would make pre-turn work a single place to get right.
