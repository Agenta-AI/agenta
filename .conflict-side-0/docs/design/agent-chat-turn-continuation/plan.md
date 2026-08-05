# Plan: stable message id across approval resumes

Decision: option A from `fix-options.md`. The server echoes the inbound last
assistant message's id in the `start` frame; everything else keeps working as is.

## Slice 1: continuation id echo (streaming path)

All changes in `sdks/python/agenta/sdk/decorators/routing.py`:

1. In `apply_invoke_prelude` (`routing.py:189-228`), before the vercel-to-agenta
   projection at lines 220-228 drops the ids: when the request is vercel-format and
   `data.inputs.messages` ends with `{"role": "assistant", "id": <non-empty str>}`,
   stash that id on `req.state` (name it fully, for example
   `ag_continuation_message_id`).
2. Add a `message_id: Optional[str] = None` parameter to `_make_stream_response`
   (`routing.py:333-370`) and pass it through to `agent_stream_to_vercel_stream`
   (`routing.py:349-353`), which already accepts it (`stream.py:254-260`).
3. In `handle_invoke_success` (`routing.py:398-459`), read the stash and pass it to
   the vercel branch (`routing.py:449`). Other wire formats ignore it.

No changes to `stream.py`, the frontend, the service, or the runner. No wire-shape
change, so no golden fixture or `protocol.ts`/`wire.py` work.

## Slice 2: batch twin

`_make_vercel_json_response` (`routing.py:305-330`): stamp the same stashed id on
the last assistant message of the projected output, so the batch channel's replay
(`AgentChatTransport.ts:122-145`) keeps the id stable too. Small; can ride the same
PR or follow it.

## Slice 3: file the two adjacent bugs (do not fix here)

- Runner usage on resumed turns reports `0/0/~62k` (`otel.ts:1185-1197`). With the
  stable id this becomes the turn's displayed usage, so it gets MORE visible. File
  with a pointer to `research.md` section 7.
- Root cause 2 from the findings doc (dropped sibling approval gate + fake
  "can't handle" error) stays its own project.

## Test plan

### SDK unit tests (the real gate)

Home: `sdks/python/oss/tests/pytest/unit/agents/adapters/`, next to the existing
stream-projection tests (`test_vercel_stream_finish_reason.py`,
`test_vercel_stream_park.py`). Run with `py-run-tests` from `sdks/python`, or
`uv run --no-sync pytest oss/tests/pytest/unit/agents/adapters/ -x`.

New `test_vercel_stream_continuation.py` (or extend the park test), covering:

1. `agent_stream_to_vercel_stream(..., message_id="msg-abc")`: the `start` frame
   carries `msg-abc`, not `msg-{trace_id}`.
2. No `message_id`, with `trace_id`: `start` carries `msg-{trace_id}` (pin today's
   default so the change is visible as a delta).

Routing-level tests, following the `MagicMock` request style of
`sdks/python/oss/tests/pytest/unit/test_routing_negotiation.py:34-41` (or the
fuller app-based style in `test_invoke_header_semantics_routing.py`):

3. Prelude capture: vercel body whose messages end with an assistant message with an
   id: the stash is set. Ends with a user message: stash unset. Assistant message
   without an id, or non-vercel format: stash unset.
4. End to end through `handle_invoke_success`: a vercel stream response with a
   stashed continuation id yields an SSE `start` frame echoing that id; without a
   stash it yields `msg-{trace_id}`.

Replay-test tier check (per the agent-replay-test skill): this change is
stream-projection and routing behavior, not the `/run` wire, so the unit tier above
is the right pin. No golden fixture, no recorded-run replay needed.

### Frontend

No production change, so no new FE unit test is required. The relevant predicates
are already pinned (`web/packages/agenta-playground/tests/unit/agentApprovalResume.test.ts`,
`turnCapture.test.ts`). If slice 2 lands, add a case to the batch replay coverage
that a response message id survives into the replayed `start` chunk.

### Manual playground scenario (against the local stack)

Deploy per the repo dev loop (`load-env` + `run.sh`, same edition). Then:

1. Agent with a gated tool (`commit_revision` under an `ask` permission). One
   prompt, one approval: the turn must GROW in place. Exactly one assistant block,
   one Inspect-turn footer, before and after.
2. Two gated tools in one turn (the original repro): approve both prompts. Still one
   block. (The second tool's phantom-failure detour will still appear until root
   cause 2 is fixed; that is expected and out of scope.)
3. Deny path: deny the approval; the turn resumes with the denial and stays one block.
4. Client tool: trigger `request_connection`, settle it; the resume grows in place.
5. Controls: a normal multi-turn chat still renders one block per turn; Resend after
   Stop still creates a fresh block; a saved thread reloads without duplicates.
6. Inspect turn on the merged block: timeline shows the whole turn; Context/Raw tabs
   list every send (initial + resumes) for the trigger message.

## Rollout and docs

- One PR, SDK-only for slice 1 (+2). Title: `fix(sdk): keep the assistant message id
  stable across agent turn resumes`.
- Run `ruff format` and `ruff check --fix` in `sdks/python` before committing.
- keep-docs-in-sync pass: the vercel adapter's stream contract is described in the
  agent-workflows interface docs; update the `start`-frame description where it says
  the id is minted per request. Update
  `docs/design/agent-workflows/scratch/approval-turn-duplication-findings.md` with a
  pointer to this workspace.

## Open questions

- None blocking. The per-turn metrics/trace follow-up is now designed in
  `trace-continuation.md` (one trace per turn via traceparent propagation + FE usage
  sum); decide after the fix ships whether to schedule it.
