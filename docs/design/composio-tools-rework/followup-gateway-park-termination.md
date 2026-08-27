# Follow-up issue draft: a gateway approval park does not end the turn promptly

**Status:** draft, for filing outside the gateway-connection rework. Found during the live QA of
that rework on 2026-08-27. Unlike
[the approval wedge](followup-approval-wedge.md), this one **is** in the rework's seam — the
gateway gate parks at the relay execution seam, and no other tool does. It is filed separately
because fixing it properly needs a design decision about the pause machinery, not a patch, and
because D3 was closed by a client-side change that does not depend on it.

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

| pause kind | order | gap |
| --- | --- | --- |
| client-tool park | `paused` first, then the row | **+30 ms** |
| built-in ACP approval park | `paused` first, then the row | **+48 ms** |
| gateway `run_tool` park | the row first, then `paused` | **+59 s and +135 s** |

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
throws inside the Pi extension, and Pi appears to treat that tool error as a *continuable* event —
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
3. Answer the caller *and* ensure the harness turn is torn down deterministically — i.e. option 1
   from the QA round, plus whatever makes Pi stop rather than continue. Only viable once the
   mechanism above is actually observed.

## Related

- [`followup-approval-wedge.md`](followup-approval-wedge.md) — a *different*, pre-existing defect
  found in the same QA session (a cold replay cancels the row while the card stays on screen).
  The two can look alike from the UI and should not be conflated.
- The client-side half of D3 was closed by keeping `liveGateInteractionRef` populated on error so
  the SDK's late re-evaluation can still dispatch. That works with the *current* late-but-real
  stream close, which is another reason the naive fast-answer fix must not be re-applied without
  re-checking the client.
