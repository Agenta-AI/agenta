# Context: parallel approval gates, one pause, one phantom failure

## The bug

In the agent playground (harness `claude` over ACP, runner `sidecar`, session
`67a00253-ac61-48ab-a907-4af49f059bd0`), the model called two approval-gated platform
tools in one turn: `mcp__agenta-tools__commit_revision` and
`mcp__agenta-tools__create_subscription`.

What the user saw:

1. An approval prompt for `commit_revision`. Fine.
2. A `failed` chip on `create_subscription` with the error
   `This app can't handle the "mcp__agenta-tools__create_subscription" request.`
   Nothing failed. Nothing even ran. The browser invented that error.
3. After approving `commit_revision`, a second approval prompt for
   `create_subscription`. Approving it worked.

So the flow recovers, but the user sees a bogus failure and pays two sequential
approval round-trips for one turn.

## Why it happens (short form)

The runner allows exactly one pause per turn (`PendingApprovalLatch`,
`services/runner/src/engines/sandbox_agent/acp-interactions.ts:78`). The first gate wins,
the runner pauses, and it tears the sandbox session down without replying to the harness
(the F-040 contract, `services/runner/src/engines/sandbox_agent/pause.ts:1-27`). The
second gate loses the latch and is dropped with no trace. But its tool call already
streamed to the client. The client is left holding a tool part with no approval, no
output, no error. When the turn ends, the frontend classifies that orphan as a "parked
unknown client tool" (`web/oss/src/components/AgentChatSlice/components/clientTools/meta.ts:52-66`)
and force-settles it with a synthetic browser-side error
(`web/oss/src/components/AgentChatSlice/components/clientTools/UnhandledClientTool.tsx:17-21`).

Full verified mechanics, with one correction to the earlier findings doc, are in
[research.md](research.md). Sequence diagrams are in [flows.md](flows.md).

## Decisions that frame this plan (from Mahmoud)

1. **The frontend must not special-case tool names.** No excluding
   `mcp__agenta-tools__*` from the unknown-client-tool path. The bug is created where
   the orphan is created: in the runner. The frontend has no responsibility for it.
   (We do flag, independently, that force-settling unsettled parts with a fake error
   is itself a questionable pattern. See [options.md](options.md), "Independent flag".)
2. **Explain the flow precisely.** What exactly does the harness send when two gated
   calls happen in one turn? Answered from source in [research.md](research.md) and
   drawn in [flows.md](flows.md).
3. **Explore both remedies with an honest complexity assessment.**
   - Option A: settle the losing sibling deterministically before teardown.
   - Option B: batch all pending approvals into one pause.
   Both are assessed in [options.md](options.md), including whether A is a stepping
   stone to B (it is).
4. **End with a recommendation and a phased plan.** [options.md](options.md) carries
   the recommendation; [plan.md](plan.md) carries the phases, files, and tests.

## Goals

- The playground never shows a fabricated failure for a tool the backend never ran.
- Every tool part the server streams gets a truthful terminal state.
- Reduce (Option B) or at least keep honest (Option A) the approval round-trips when
  one turn raises several gates.
- No frontend tool-name lists. No change to the F-040 pause contract's core rule
  (never reply to a harness gate that a human must decide).

## Non-goals

- Issue 1 from the same investigation (duplicate turn blocks from the
  `msg-{trace_id}` message-id churn). That is a separate fix with its own plan.
- Warm sessions / avoiding cold replay. The session still dies on every pause.
- Redesigning the frontend client-tool fallback surface (flagged as follow-up only).
- Pi relay parity beyond noting where the same latch drop exists
  (`services/runner/src/tools/relay.ts:255-263`); the incident harness is Claude and
  the fix seam we choose covers both paths at the pause controller.
