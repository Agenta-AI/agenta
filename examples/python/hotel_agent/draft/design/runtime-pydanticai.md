# Runtime: Pydantic-AI (vanilla)

> **Status:** Plan, ready for implementation.
> **Implements:** RFC `architecture.md` §Implementation order, step 9.
> **Pairs with:** future `library-matrix.md` once two runtimes exist.

This doc captures decisions and concrete shapes for the first runtime adapter. It lifts the FastAPI + Next.js pattern from `examples/python/RAG_QA_chatbot/` and adds tool-call streaming.

## Summary

- Pydantic-AI v1.89 (stable). Pin `pydantic-ai-slim[openai,anthropic,logfire]>=1.89`.
- Adapter functions are 5-line shims over `RunContext[AgentDeps]`. 11 tools total.
- Streaming via `agent.run_stream_events()` — NOT `run_stream` (known early-finish bug on tool turns: pydantic-ai #1590).
- Tests via `agent.override(model=TestModel(), deps=fake_deps)`. Adapter-level tests synthesize tool args; no LLM in the loop.
- HTTP layer: FastAPI server emits Vercel AI SDK v6 UI Message Stream (`x-vercel-ai-ui-message-stream: v1`). Route per runtime: `POST /api/chat/{runtime}`.
- Frontend: Next.js with `@ai-sdk/react@^3` + `ai@^6` + `ai-elements`. Persona switcher writes `current_user_id` into transport body.

## Tool surface (11 tools)

Each tool is a thin async function in `runtimes/pydanticai/vanilla/adapters.py` decorated with `@agent.tool`. First arg is `RunContext[AgentDeps]`. Returns a domain DTO from `core.domain.types`.

### Discovery
1. **`search_availability`** → `deps.pms.availability.search(...)`. Args: `check_in`, `check_out`, `guests`, `room_type?`, `pet_friendly_only?`. Returns `list[Offer]`.
2. **`list_room_types`** → `deps.pms.inventory.list_room_types()`. No args. Returns `list[RoomType]`.

### Booking lifecycle
3. **`quote_stay`** → `deps.pms.rates.quote(guest_id=deps.current_user_id, ...)`. Args: room, rate plan, dates, guests, num_pets. Returns `Quote`. The guest_id enables tier-based fee waivers (Platinum waives resort fee).
4. **`create_reservation`** → `deps.pms.reservations.create(guest_id=deps.current_user_id, ...)`. Returns `Reservation`. Agent must `quote_stay` first; PMS does NOT enforce policy.
5. **`view_my_reservations`** → `deps.pms.reservations.list_for_guest(guest_id=deps.current_user_id, status?)`. Returns `list[Reservation]`.
6. **`modify_reservation`** → `deps.pms.reservations.modify(...)`. Returns `Reservation`. Agent enforces 2-modification cap and 48h free-modification window.
7. **`cancel_reservation`** → `deps.pms.reservations.cancel(...)`. Returns `Reservation`. Agent enforces tier cutoffs and rate-type refund rules.

### In-stay
8. **`request_service`** → `deps.pms.services.add_to_reservation(...)`. Returns `ServiceCharge`. Agent enforces tier-based late-checkout pricing.

### Q&A
9. **`answer_question`** → `deps.retriever.search(query, k)`. Returns `list[Chunk]`. Used for KB rationales and edge cases; the *rules* live in the system prompt.

### Profile
10. **`get_guest_profile`** → `deps.pms.guests.get(guest_id=deps.current_user_id)`. Returns `Guest`. Reveals tier for personalization.

### Rates
11. **`list_rate_plans`** → `deps.pms.rates.list_rate_plans(room_type?)`. Returns `list[RatePlan]`.

### Gaps surfaced (defer)
- `AvailabilityAPI.search` already accepts `pet_friendly_only`; the protocol is fine, just not currently exposed as a tool argument. (Including in `search_availability` above.)
- No `list_eligible_upgrades(guest_tier, current_room_type)`. Agent works around via `list_room_types` + `tier_rank` filter.
- No `list_available_services()` / service catalog tool. Agent uses retrieval against `policy/fees.md` and a fixed set of service codes embedded in the system prompt.

## Streaming model

Use `agent.run_stream_events(prompt, deps=request_deps)`. The events we care about:

| Pydantic-AI event | Mapped to Vercel AI SDK v1 stream |
|---|---|
| `PartStartEvent(part=TextPart)` | `{"type":"text-start","id":<text_id>}` |
| `PartDeltaEvent(delta=TextPartDelta)` | `{"type":"text-delta","id":<text_id>,"delta":<content_delta>}` |
| `FunctionToolCallEvent` | `{"type":"tool-input-available","toolCallId":<id>,"toolName":<name>,"input":<args>}` |
| `FunctionToolResultEvent` | `{"type":"tool-output-available","toolCallId":<id>,"output":<result>}` (or `tool-output-error` on raise) |
| (text part ends) | `{"type":"text-end","id":<text_id>}` |
| `AgentRunResultEvent` | (terminal — emit `{"type":"finish"}` then `data: [DONE]\n\n`) |

Each chat turn: `start` → (per-LLM-call: `start-step` → events → `finish-step`) → `finish`. We can elide `start-step`/`finish-step` for single-step turns; for multi-tool agentic loops we emit them per LLM call so the UI can show "Step 1", "Step 2", etc.

`toolCallId` must be stable from `tool-input-available` through `tool-output-available`. Pydantic-AI's `event.part.tool_call_id` is the right value to pass through.

## DI and the request boundary

The server builds a per-request `AgentDeps`:

```python
async def build_request_deps(current_user_id: str) -> AgentDeps:
    # uses build_default_deps but overrides current_user_id from the request body
    deps = await build_default_deps(current_user_id=current_user_id)
    return deps
```

Two consequences:
- `current_user_id` comes from the **request body** (`{"current_user_id": "guest_sarah"}`), NOT the env. Demo persona switcher in the frontend writes this field via `DefaultChatTransport({ body: { current_user_id } })`.
- Each request gets a fresh `AgentDeps` so concurrent requests don't share state. The PMS itself is process-scoped (single SQLite file, one engine). That's fine for a demo; tests use per-test in-memory DBs already.

## Server shape

`draft/server/main.py`:

```python
@app.post("/api/chat/{runtime}")
async def chat(runtime: str, request: ChatRequest):
    agent_factory = RUNTIME_REGISTRY[runtime]   # raises 404 if unknown
    agent, deps = await agent_factory(request.current_user_id)
    return StreamingResponse(stream(agent, deps, request), media_type="text/event-stream",
        headers={"x-vercel-ai-ui-message-stream": "v1", "cache-control": "no-cache"})
```

`draft/server/runtimes.py`:

```python
RUNTIME_REGISTRY = {
    "pydanticai_vanilla": pydanticai_vanilla_factory,
    # "pydanticai_with_agenta": ...,
    # "openai_agents_vanilla": ...,
    # ... fill in as runtimes land
}
```

`ChatRequest`:

```python
class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    current_user_id: str | None = None  # resolved against seed; defaults to a demo guest
    model_config = {"extra": "ignore"}
```

## Frontend shape

`draft/frontend/` mirrors `RAG_QA_chatbot/frontend/`. Diffs:

- **Persona switcher** in the header. Dropdown of seed guests (Sarah, Bob, Carla, Dan, Eve, Frank, Grace), each with their tier badge. Selected value is held in React state and threaded into `DefaultChatTransport`'s body so every send carries `current_user_id`.
- **Runtime switcher** in the header. Dropdown of available runtimes (only `pydanticai_vanilla` initially; expands as runtimes land). Determines the `/api/chat/{runtime}` URL the transport hits.
- **Tool-call rendering** in `message.parts` switch. Add a `case "dynamic-tool":` arm rendering with `Tool` / `ToolHeader` / `ToolContent` / `ToolInput` / `ToolOutput` from `ai-elements`. Tool calls are correlated by `toolCallId`; the SDK merges input/output events into one part automatically.
- **Source rendering** stays from RAG (`source-url` events). The agent emits these from `answer_question`'s retrieval results.
- **Trace URL** stays from RAG (`data-trace`). Only fires when the with_agenta runtime is active.

Pin: `ai@^6`, `@ai-sdk/react@^3`, `ai-elements@latest`. Drop the `-beta` tags from RAG.

## Testing strategy

Three layers, in order:

1. **Service tests (already done).** 43 tests in `draft/tests/services/` validate the PMS contract directly. No agent involvement.
2. **Adapter tests.** New: `draft/tests/adapters/pydanticai/test_tool_calls.py`. Uses `agent.override(model=TestModel(), deps=fake_deps)`. Synthesizes the JSON args an LLM would emit, asserts the right `deps.pms.*` method got called and the return value flows back. No LLM. Fast.
3. **Smoke test.** `draft/scripts/chat_pydanticai.py` — a CLI loop that talks to the agent against a fixed clock and a real LLM. Optional, run manually with `OPENAI_API_KEY` set. Useful for spotting prompt issues before wiring the server.

We deliberately do NOT add trajectory/replay tests in this pass. `RecordingPMS` from RFC §Testing strategy stays deferred until at least two runtimes exist (more value comparing them).

## Implementation order

1. **Agent + adapters.** Add deps to `pyproject.toml`. Write `runtimes/pydanticai/vanilla/{adapters.py, agent.py}`.
2. **Adapter tests.** `tests/adapters/pydanticai/test_tool_calls.py`. Run, get green.
3. **Smoke CLI.** `scripts/chat_pydanticai.py`. Talk to it once with a real key. Iterate on system prompt until it behaves.
4. **FastAPI server.** `server/{main.py, runtimes.py, config.py}`. Test with curl using a synthetic stream consumer.
5. **Frontend.** Copy RAG skeleton, persona switcher, runtime switcher, tool rendering. Test in browser.

Each step is a separate commit; we don't move forward until the prior step is green.

## Open issues and gotchas

- **Vercel AI SDK header is mandatory.** Without `x-vercel-ai-ui-message-stream: v1` the client falls back silently to text protocol and ignores all tool events.
- **Buffering kills streaming.** Behind nginx/Cloudflare, set `X-Accel-Buffering: no`. Local dev is fine.
- **`run_stream` early-finish bug.** Use `run_stream_events()` for tool-using flows. (pydantic-ai #1590)
- **Tool arg validation** raises before the tool sees args. We declare lenient types in adapters (`str` for dates) and validate inside if needed. (pydantic-ai #3008)
- **Cancellation on disconnect.** If we want to stop generation when the client closes the tab, we need to wire `request.is_disconnected()` into the stream loop. (pydantic-ai #1524) Defer until we see it matter.

## References

- Pydantic-AI docs: https://ai.pydantic.dev
- Pydantic-AI repo: https://github.com/pydantic/pydantic-ai
- Vercel AI SDK stream protocol: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- ai-elements Tool component: https://elements.ai-sdk.dev/components/tool
- Existing RAG reference: `examples/python/RAG_QA_chatbot/`
