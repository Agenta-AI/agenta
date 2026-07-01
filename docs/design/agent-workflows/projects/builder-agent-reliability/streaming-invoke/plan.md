# Plan — direction, platform-side change, decisions, tests

Design only. No code in this PR.

## The direction, in one line

Use **streaming everywhere** the full turn matters. Batch stays exactly as it is (single final
message). The client side already streams (the lab kit). The new work is to make the **platform's own
internal invoke paths stream and drain the event stream**, so a run driven from inside Agenta is
complete and self-describing the same way a streaming client call is. Separately, the approval boundary
is a confirmed runner bug tracked in `approval-boundary.md`.

## Batch is unchanged

`_agent_batch` (`services/oss/src/agent/app.py:303-321`) returns only the final assistant text, and it
keeps doing that. We are not coalescing the full turn into the batch response and not touching the
`flags.history` knob. Batch is the right shape for callers that want one final message. The answer to
"the multi-tool output is unreliable" is not to reshape batch; it is to use streaming on the paths that
need the whole turn.

## Streaming everywhere — the two sides

### Client side (already shipped, not in this PR)

Streaming already returns the full event stream today. A client gets a reliable, self-describing result
by sending `Accept: application/x-ndjson | text/event-stream | application/jsonl` (or `flags.stream:
true`). This is already implemented in the lab kit: `agent-creation-lab/kit/scripts/test-agent.sh`
streams, parses the ndjson, and prints the assembled `OUTPUT`, the ordered `TOOLS` list, and any
`APPROVAL`; `BUILD-AGENT.md`'s "Verify" section reads the `TOOLS` line as the reliable signal and marks
`check-tools.sh` optional (research §6). No platform change is needed for a client to stream.

### Platform side (the change this PR proposes)

When Agenta invokes an agent **from inside the platform**, the invoke goes over HTTP to the deployed
workflow service, and the shape is chosen by the `Accept` header the platform sends. Today every
result-consuming platform path sends `Accept: application/json` and reads a single batch body, so it
gets the same final-text-only response — the identical empty/mid-sentence problem, now server-side.

All platform invoke traffic funnels through two methods on `WorkflowsService`
(`api/oss/src/core/workflows/service.py`):

- `invoke_workflow` (2073) → `_post_service_json` (2101), which sends `Accept: application/json`
  (service.py:556) and reads one JSON body. **Batch.**
- `invoke_workflow_detached` (2115) → `_stream_service_started` (2152), which sends
  `Accept: application/x-ndjson` (service.py:602) but reads only the **first** frame and closes the
  connection (service.py:630, 643). **Fire-and-forget**, not a drained turn.

No platform call site drains the full agent event stream synchronously. The result-consuming sites:

| Platform invoke site | File:line | Today | Note |
| --- | --- | --- | --- |
| **Workflow/agent as a tool** (an agent invoking another app/agent as a tool) | `api/oss/src/apis/fastapi/tools/router.py:1306` → `invoke_workflow`, reads `response.data.outputs` (1320) | **Batch** | The real one. An agent-as-tool gets only the callee's final text, so a multi-tool callee returns the same partial output. |
| Trigger / schedule dispatch | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:296` (batch fallback) vs `api/entrypoints/routers.py:768` `_dispatch_detached_run` (production) | **Detached in production**; batch only in the minimal/test composition | Production wires `dispatch_fn=_dispatch_detached_run` (routers.py:807-811), so a fired trigger runs detached (runner owns the run, persists out of band). It does not synchronously consume a result, so it does not surface the partial-output symptom the same way. |
| Session respond-via-invoke | `api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:72` / `sessions/router.py:852` (batch fallback) vs `worker_interactions.py:103` detached (production) | **Detached in production**; batch fallback | Same two-way switch as triggers. |
| Evaluations runtime | `api/oss/src/core/evaluations/runtime/adapters.py:104, 508` → `invoke_workflow`, reads `response.outputs` | **Batch** | The workflow-under-test runs batch; the adapter reads only the terminal `outputs`/`status`. |

The Accept→`flags.stream` negotiation that makes this work is
`sdks/python/agenta/sdk/decorators/routing.py:551-554` (`STREAM_MEDIA_TYPES` at 117-119), consumed at
`services/oss/src/agent/app.py:214`. So the platform-side change is a header change plus a drain.

### The proposed platform-side change

Add a draining streaming variant on `WorkflowsService`, e.g. `invoke_workflow_streaming`, that:

1. Reuses the `_prepare_invoke` prelude (service.py:2086) for auth and ref resolution.
2. Sends `Accept: application/x-ndjson` and opens `client.stream("POST", .../invoke, ...)` like
   `_stream_service_started` (service.py:614), but **drains all frames** with `aiter_lines`
   (accumulating the `{"kind":"event"}` records and the terminal `{"kind":"result"}`) instead of
   returning on the first frame (service.py:643).
3. Produces the already-declared-but-unused `WorkflowServiceStreamResponse` (service.py:2084) carrying
   the full turn plus the terminal result.

Then, per site:

- **Workflow/agent as a tool (`tools/router.py:1306`) — highest value.** Switch to the draining
  variant so the tool result reflects the callee's full turn (every tool call/result, the terminal
  action), not just its final text. The router already has an events channel (`_emit_data_event`,
  tools/router.py:1365) it can forward intermediate events onto, and it still emits the terminal
  `ToolResult` on the terminal record.
- **Evaluations (`adapters.py:104, 508`).** Switch to the draining variant, keep the last result, and
  map its terminal `outputs`/`status`/`trace_id` to `WorkflowExecutionResult` exactly as today. The
  change is internal to the runner method; the adapters already read only the terminal fields. Optional
  per-event progress callbacks give live token/step visibility.
- **Triggers / schedules / session respond.** Production already streams via the detached path. If we
  want *inline* drain-to-completion (with intermediate persistence) rather than fire-and-forget, swap
  the batch fallback for the draining variant and write incremental delivery rows as events arrive
  (dispatcher writes one terminal row today at dispatcher.py:343). Otherwise leave as-is.

## The approval boundary (tracked as a bug, see `approval-boundary.md`)

Streaming fixes observability of the turn, but a related runner bug means an auto-approved run still
stops at the tool gate. `HITLResponder.onPermission` parks on any "human surface" before it consults
the `auto` policy (`services/agent/src/responder.ts:257`), and the SDK mints a `sessionId` for every
invoke, so `hasHumanSurface` is always true and `auto` never auto-approves in-band. The turn ends at the
gate with `stopReason: "paused"`; the terminal tool's `tool_result` never streams. The playground hides
this by auto-resending on the park (resume); a one-shot invoke has no resume. This is a bug. The full
investigation, the git history (introduced in `b109cc51ef`, 2026-06-25), the frontend resume mechanism,
and the recommended fix at `responder.ts:254-259` are in `approval-boundary.md`. Streaming everywhere
depends on this fix to carry the terminal gated tool's result all the way through.

## Decisions

1. **Batch unchanged.** Decided. No coalescing, no history-default change.
2. **Streaming everywhere the full turn matters.** Client side done; platform side is the
   `invoke_workflow_streaming` drain above.
3. **First platform site to convert:** workflow/agent-as-tool (`tools/router.py:1306`) — it is the one
   result-consuming batch path that visibly reproduces the partial-output problem. Evaluations second.
   Triggers/sessions already stream via detached; convert to inline drain only if we want live
   persistence.
4. **Approval boundary is a bug** (`approval-boundary.md`), fixed at `responder.ts:257` with the
   `ask`-disposition follow-up. Streaming everywhere is only fully reliable once this lands.

## Test matrix (for the implementation PR, not this one)

- Streaming client, multi-tool run: full event stream, all tool calls/results in order — regression
  guard (unchanged today, must stay unchanged).
- Batch, single-tool and multi-tool: unchanged, one final assistant message (batch is untouched).
- Platform workflow-as-tool, multi-tool callee: after the drain, the `ToolResult` reflects the callee's
  full turn and terminal action, not just its final text.
- Evaluations runtime, multi-tool workflow-under-test: terminal `outputs`/`status`/`trace_id`
  unchanged after switching to the draining variant (behavior-preserving for the adapter).
- Approval boundary (once the `responder.ts` fix lands): an `auto` run streams past the gated terminal
  tool and emits its `tool_result`; the playground still surfaces an approval prompt when the
  disposition is `ask`. Capture a live pass as an agent replay test (per the `agent-replay-test` skill).
- `keep-docs-in-sync`: update the agent-workflows invoke docs and the interface inventory to state that
  the full-turn path is streaming (client and platform), that batch returns only the final message by
  design, and the approval-boundary fix.
</content>
