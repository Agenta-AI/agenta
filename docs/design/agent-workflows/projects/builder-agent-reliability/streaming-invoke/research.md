# Research — the mechanism, with citations

All paths are from the repo root. Live evidence is from `bighetzner.agenta.dev`, project
`019f1a24-52d1-7253-a675-e569105bc0b5`, agent `019f1a84-b778-7c22-97ce-3816e5edbb09` (UC9 Repo
Digest).

## 1. Batch returns the final text; streaming yields the full turn

`services/oss/src/agent/app.py`, the `_agent` handler picks its shape from the `stream` flag
(`app.py:214`), which the HTTP edge negotiates from `Accept` (see §3):

- `stream = True` → `_agent_event_stream` (`app.py:282-300`): runs `harness.stream(...)` and yields
  **every** event as a neutral `{"type": event.type, "data": event.data}` dict.
- `stream = False` → `_agent_batch` (`app.py:303-321`): runs the **same** `harness.stream(...)`,
  drains it (`async for _ in run: pass`), takes `result = run.result()`, and returns:

  ```python
  return {"messages": [{"role": "assistant", "content": result.output}]}
  ```

So batch returns one synthetic assistant message holding only `result.output` (the final text). This
is by design and stays that way (see `plan.md`): batch is the single-final-message shape. Streaming is
the shape that carries the whole turn. The point of this workspace is to use streaming on every path
that needs the full turn, not to reshape batch.

## 2. `AgentResult` carries the full turn (what a drain consumes)

`sdks/python/agenta/sdk/agents/dtos.py:504-517`:

```python
class AgentResult(BaseModel):
    output: str = ""                    # the final assistant text (what batch returns)
    messages: List[Message] = []        # the full turn
    events: List[Event] = []            # every tool_call / tool_result / thought / message / usage
    usage: Optional[Dict[str, Any]] = None
    stop_reason: Optional[str] = None   # e.g. "tool_use" vs "end_turn"
    ...
```

`result_from_wire` (`sdks/python/agenta/sdk/agents/utils/wire.py:149-183`) parses the runner's `/run`
result and populates `messages`, `events`, and `stop_reason` from the wire (`data["messages"]`,
`data["events"]`, `data["stopReason"]`). So the runner emits the full turn and the SDK models it. This
matters for the platform-side drain (§5): a streaming platform caller drains these events and reads the
terminal result rather than the batch `output`.

## 3. Streaming is a first-class, already-supported format

`sdks/python/agenta/sdk/decorators/routing.py`:

- `STREAM_MEDIA_TYPES = {text/event-stream, application/x-ndjson, application/jsonl}`
  (`routing.py:117-119`).
- The invoke endpoint fills `flags.stream` from `Accept` when the body did not set it
  (`routing.py:551-554`): `_flags["stream"] = _accept in STREAM_MEDIA_TYPES`. An explicit body
  `flags.stream` wins; the header only fills an unset flag.
- `handle_invoke_success` (`routing.py:333-394`) returns a `StreamingResponse` for a stream Accept
  (`_make_stream_response`, `routing.py:268-305`): ndjson (`{...}\n` per event) or SSE
  (`data: {...}\n\n`). A batch response with a stream Accept → 406.

Live confirmation (tiny "hi" probe):
- `Accept: application/x-ndjson` → 200, `content-type: application/x-ndjson`, ndjson event lines.
- `Accept: text/event-stream` → 200, SSE frames.
- `Accept: application/jsonl` → 200, ndjson.
- body `flags.stream:true` + `Accept: application/json` → **406** "Runnable produced a stream
  response but Accept requested 'application/json'." (correct: you must ask for a stream Accept).

## 4. The event vocabulary

`Event` (`dtos.py:332-346`): `type` ∈ `message | thought | tool_call | tool_result | usage | error
| done`, `data` carries the rest verbatim. The live wire is finer-grained (the runner passes ACP
`session/update`s through): observed types include `message_start`, `message_delta`, `message_end`,
`thought_start`, `thought_delta`, `thought_end`, `tool_call`, `tool_result`, `usage`,
`interaction_request`, `done`. Field shapes captured live:

- `tool_call.data`: `{ type, id, name, input }` — `name` is the full
  `mcp__agenta-tools__<integration>__<ACTION>`.
- `tool_result.data`: `{ type, id, isError, output }`.
- `message_delta.data`: `{ type, id, delta }` — concatenate `delta` to assemble the reply.
- `interaction_request.data`: `{ type, id, kind, payload }` where `payload.toolCall.title` is the
  gated tool and `payload.toolCall.rawInput` is its arguments.

## 5. Where the platform invokes agents (batch vs streaming)

The platform (`api/`) invokes a deployed workflow/agent by HTTP `POST {service_url}/invoke`, and the
shape is chosen by the `Accept` header the platform sends. All invoke traffic funnels through two
methods on `WorkflowsService` (`api/oss/src/core/workflows/service.py`):

- `invoke_workflow` (2073) → `_post_service_json` (2101), Accept `application/json` (service.py:556),
  reads one JSON body. **Batch.** (Its return type names `WorkflowServiceStreamResponse`, but no code
  path produces it today — an aspirational placeholder at service.py:2084.)
- `invoke_workflow_detached` (2115) → `_stream_service_started` (2152), Accept `application/x-ndjson`
  (service.py:602), but `aiter_lines` returns on the **first** frame and closes (service.py:630, 643).
  **Fire-and-forget**, not a drained turn.

Result-consuming platform invoke sites:

| # | Site (file:line) | Invokes | Today |
| --- | --- | --- | --- |
| 1 | `api/oss/src/apis/fastapi/tools/router.py:1306` — **workflow/agent as a tool** | `invoke_workflow`, reads `response.data.outputs` (1320), serializes to `ToolResult.content` (1337) | **Batch** |
| 2 | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:296` — trigger/schedule (batch fallback) | `invoke_workflow`, reads `response.outputs` (317) | Batch fallback; **detached in production** |
| 3 | `api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:72` / `sessions/router.py:852` — session respond | `invoke_workflow` | Batch fallback; **detached in production** |
| 4 | `api/oss/src/core/evaluations/runtime/adapters.py:104, 508` — evaluation runtime | `invoke_workflow`, reads `response.outputs` (125, 539) | **Batch** |
| — | `api/entrypoints/routers.py:768` / `worker_interactions.py:103` — `_dispatch_detached_run` | `invoke_workflow_detached` | Detached (single frame) |

Note on sites 2/3: the dispatchers have a two-way switch — `if self._dispatch_fn is not None:` they take
the detached path (dispatcher.py:270-293; interactions_dispatcher.py:63-70). The real composition roots
supply `dispatch_fn=_dispatch_detached_run` (routers.py:807-811; worker_interactions.py:114), so
triggers/schedules and session-respond run **detached** in production; the `invoke_workflow` batch
branches are minimal/test-composition fallbacks. Detached does not synchronously consume a result, so it
does not surface the partial-output symptom the way the batch sites do.

**Key gap:** no platform call site drains the full agent event stream synchronously. `_stream_service_
started` reads one handshake frame and abandons the rest; every path that wants a *result* uses the
batch method and gets final text (agent) / terminal `outputs` (workflows). The proposed change (a
draining `invoke_workflow_streaming` variant) is in `plan.md`.

The only full drains of the stream in the tree are inside the deployed service, not the platform API:
`sdks/python/agenta/sdk/agents/utils/ts_runner.py:176, 188` (`deliver_http_stream`, harness → TS runner)
and the runner itself. The producers are `routing.py:290, 295, 298, 302` (`StreamingResponse`) and the
agent `_agent_event_stream`.

## 6. The approval boundary — corrected mechanism (full detail in `approval-boundary.md`)

An earlier draft of this research guessed that the headless `auto` policy answered the approval and ran
the terminal tool out of band after the stream closed. That guess was **wrong**. The correct mechanism,
pinned by a deeper investigation:

- The `auto` policy is never consulted. `HITLResponder.onPermission` returns `park` whenever
  `hasHumanSurface` is true (`services/agent/src/responder.ts:257`), **before** it looks at
  `basePolicy`.
- `hasHumanSurface` is just `!!sessionId` (`services/agent/src/engines/sandbox_agent.ts:511`), and the
  SDK normalizer mints a `sessionId` for every invoke (`sdks/python/agenta/sdk/middlewares/running/
  normalizer.py:302-308`, `sdks/python/agenta/sdk/models/shared.py:13-22`). So `hasHumanSurface` is
  always true and `auto` is dead code for a gating harness.
- Park sends no `respondPermission` (`permissions.ts:85-93`), calls `destroySession`
  (`sandbox_agent.ts:524-536`), and ends the turn with `stopReason: "paused"`
  (`sandbox_agent.ts:616-632`). The gated tool never runs this turn, so its `tool_result` is not in the
  stream. The span showing `SEND_MESSAGE` executed is from a resume or a relay/gate timing race, not an
  inline auto-approval — it is not statically provable from this repo.
- Only Claude gates (`permissions: false` for Pi), so the trace is a Claude run; the read-only `LIST_*`
  tools are allowlisted (no gate), `SEND_MESSAGE` gates and parks.

This is a bug for `auto` on any non-interactive path. The frontend hides it by auto-resending on the
park (`useChat` + `sendAutomaticallyWhen: agentShouldResumeAfterApproval`). It was introduced in commit
`b109cc51ef` (2026-06-25). The recommended fix is at `responder.ts:254-259`. Full report, git history,
frontend resume mechanism, and fix: `approval-boundary.md`.

## 7. What the lab kit did with these findings (already shipped, not in this PR)

`agent-creation-lab/kit/scripts/test-agent.sh` now invokes with `Accept: application/x-ndjson`,
parses the ndjson, and prints an `OUTPUT` line (assembled message deltas), a `TOOLS` line (every
`tool_call` in order + call/result counts), and an `APPROVAL` line (any `interaction_request`).
`BUILD-AGENT.md`'s "Verify" section was rewritten to read the `TOOLS` line as the reliable
"did it reach the terminal tool" signal and to mark `check-tools.sh` optional (a fallback only for
confirming a gated WRITE's `ok:true`, the approval-boundary gap). This is the client-side proof that
streaming everywhere is the right shape; the platform-side change extends the same drain to Agenta's own
internal invoke paths.
</content>
