# Implementation Status — Handoff Report

> **Last updated:** 2026-06-03
> **Scope:** The whole example. Core, three vanilla runtimes, server, frontend,
> observability, and tests. This is the document to read first if you are
> picking the project up to extend it.

## TL;DR

The example runs end to end. A user chats in a Next.js UI, picks a persona and a
runtime, and the FastAPI server drives one of three agent frameworks
(Pydantic-AI, OpenAI Agents SDK, LangChain/LangGraph) over a shared business
core. Every run streams to the browser as Vercel AI SDK v1 events and emits
OpenTelemetry traces to Agenta. **73 tests pass** with no LLM in the loop (43
service-level, 30 adapter-level).

What is NOT done yet: the `with_agenta` runtime variants (prompt management
pulled from Agenta), evals, the Claude Agent SDK runtime, and several design
docs. See "What is deferred" and "Next steps" below.

## What landed

```
draft/
├── README.md                  operational guide: setup, run, troubleshoot
├── .env.example               copy to .env
├── pyproject.toml             uv-managed; all 3 frameworks + server + tracing
├── core/                      framework-agnostic business core (unchanged since steps 1-8)
│   ├── domain/types.py        Pydantic types + enums (frozen)
│   ├── db/                    SQLAlchemy schema, async session, deterministic seed
│   ├── integrations/pms/      6 sub-API Protocols + typed errors + FakePMS (SQLite)
│   ├── retrieval/             Retriever Protocol + InMemoryRetriever (IDF keyword)
│   ├── clock.py deps.py container.py   Clock, AgentDeps, composition root
├── runtimes/                  per-framework agents, all vanilla (no Agenta)
│   ├── pydanticai/vanilla/    RunContext[AgentDeps]; @agent.tool; 11 tools
│   ├── openai_agents/vanilla/ RunContextWrapper[AgentDeps]; tools return JSON strings
│   └── langgraph/vanilla/     ToolRuntime injection; create_agent(context_schema=AgentDeps)
├── server/
│   ├── main.py                /api/chat/{runtime}; instruments all 3 frameworks; pydanticai streamer
│   ├── runtimes.py            RuntimeSpec registry (slug -> kind -> agent builder)
│   ├── openai_agents_stream.py  OpenAI Agents SDK -> Vercel v1 events
│   ├── streaming_langgraph.py   LangChain -> Vercel v1 events
│   └── config.py              env-derived settings
├── frontend/                  Next.js 15 + ai@6 + @ai-sdk/react@3 + ai-elements
│   └── app/page.tsx           persona switcher, runtime switcher, tool-call rendering
├── scripts/                   chat_pydanticai.py, chat_openai_agents.py, chat_langgraph.py
└── tests/
    ├── services/              43 tests, exercise FakePMS directly
    └── adapters/{pydanticai,openai_agents,langgraph}/   10 each, synthesize tool args, no LLM
```

## The three runtimes

The tool surface is identical across all three by name and docstring (11 tools:
search_availability, list_room_types, quote_stay, create_reservation,
view_my_reservations, modify_reservation, cancel_reservation, request_service,
answer_question, get_guest_profile, list_rate_plans). Only the dependency
injection mechanism differs:

| Runtime | Library | DI mechanism | Tool return |
|---------|---------|--------------|-------------|
| Pydantic-AI | `pydantic-ai-slim>=1.89` | `RunContext[AgentDeps]` via `@agent.tool` | domain DTO |
| OpenAI Agents SDK | `openai-agents>=0.2` | `RunContextWrapper[AgentDeps]`, `ctx.context` | JSON string |
| LangChain/LangGraph | `langchain>=1.0`, `langgraph>=1.0` | `ToolRuntime` injection, `runtime.context` | JSON string |

The server streams each with a dedicated translator chosen by the `kind` field
in `RuntimeSpec`. Pydantic-AI uses `run_stream_events` semantics (via
`event_stream_handler`), not `run_stream`, because of a known early-finish bug
on tool-using flows.

## Observability

`server/main.py` instruments all three frameworks once at startup. With
`TRACING_BACKEND=agenta`, `ag.init()` installs a global OpenTelemetry provider
exporting to the Agenta host. Pydantic-AI is instrumented natively through
`InstrumentationSettings(tracer_provider=...)`. The OpenAI Agents SDK and
LangChain are bridged with OpenInference instrumentors pointed at the same
provider. `TRACING_BACKEND=logfire` is the alternative path.

**Trace storage caveat (verified the hard way):** the Agenta OTLP receiver
returns HTTP 200 even when a span is later dropped, so a 200 does not prove
storage. Spans land in the project that the `AGENTA_API_KEY` belongs to. If you
do not see traces, confirm you are viewing that project, and query
`POST {AGENTA_HOST}/api/traces/query` with `Authorization: ApiKey <key>` to
confirm storage server-side.

## Architectural invariants (each has at least one test)

1. **PMS does not enforce policy.** Successive modifies succeed; cancel inside
   the cutoff succeeds; cancel is idempotent. The agent enforces policy; the PMS
   persists.
2. **Quote total = sum of line amounts**, across all rate types and tiers.
3. **Platinum waiver.** The resort-fee line renders at `$0` for Platinum, full
   for Gold and Standard.
4. **Time flows from the injected Clock**, never `datetime.now()`.
5. **Domain types are returned, not ORM rows.** Explicit DBE to DTO mappers.
6. **Typed errors.** Six exceptions inherit from `PMSError`.

## Seed data

`core/db/seed_data.py` is the single source of truth. Anchor is
`SEED_NOW = datetime(2026, 6, 1, 12, 0, 0)`; tests pin `FixedClock(SEED_NOW)`.
Coverage: 7 guests across all 3 tiers, 5 room types, 3 rate plans, ~20 rooms
(some pet-friendly), 9 service-catalog items, 8 reservations spanning
past/present/future, including fixtures for cancel-cutoff, in-stay, and
non-refundable scenarios.

## What is deferred

- **`with_agenta` runtime variants.** No `with_agenta/` folder exists. This is
  the next major piece: pull each runtime's prompt and config from Agenta's
  prompt registry instead of the hardcoded `SYSTEM_PROMPT`, so prompts can be
  versioned and A/B tested in the Agenta UI.
- **Claude Agent SDK runtime.** Planned as the fourth framework; not built.
- **Evals.** Nothing yet. `policy.md` §13 already enumerates edge cases that map
  directly to eval rows (Gold + Advance inside cutoff, Platinum third
  modification, non-refundable + illness, comp upgrade timing, pet weight/count
  refusals, Platinum resort-fee exclusion, and so on).
- **Prompt management.** The system prompt is currently hardcoded and duplicated
  across the three `agent.py` files with a "keep in sync" note. Centralizing it
  is a prerequisite for clean `with_agenta` variants.
- **A real vector store.** `InMemoryRetriever` (IDF keyword) is the v1. The
  Retriever Protocol is the swap-in seam.
- **`current_user_id` real auth.** It comes from the request body, set by the
  frontend persona switcher. There is no auth; the frontend is an internal
  playground by design.
- **Persistence.** The DB is in-memory by default and re-seeds on restart.
- **Replay / `RecordingPMS`.** Not built.

## Design docs status

Done: `scope.md`, `policy.md`, `inversion-of-control.md`, `architecture.md`
(the core RFC), `runtime-pydanticai.md` (first runtime port plan).

Draft: `evals-langgraph.md` (a plan for SDK-driven evals on the LangGraph
runtime, sourced from the Agenta docs; verify signatures against the installed
SDK before relying on it).

TODO: `library-matrix.md` (now worth writing: three runtimes exist to compare),
`agenta-integration.md` (prompt mgmt, eval, observability overlay),
`frontend.md`, `testing.md`, `rollout.md` (draft to parent promotion),
`domain.md`.

## Next steps (suggested order)

1. **Write `library-matrix.md`.** Three runtimes now exist. Capture the
   side-by-side DI and streaming differences while they are fresh.
2. **Centralize the system prompt.** Pull it out of the three `agent.py` files
   into one shared source so vanilla and `with_agenta` can both read it.
3. **Build the first `with_agenta` runtime** (start with Pydantic-AI). Pull the
   prompt and model config from Agenta's prompt registry. Write
   `agenta-integration.md` alongside.
4. **Add evals.** A draft plan exists in `evals-langgraph.md`. Turn `policy.md`
   §13 edge cases into a test set. Run them as an Agenta evaluation (SDK first,
   then wire the UI). This is the payoff of policy living only in the prompt: the
   eval measures the agent's reasoning.
5. **Add the Claude Agent SDK runtime** to complete the four-framework matrix.
6. Optional: online eval, annotation queue, a real vector store, persistence,
   replay.

## Pointers for whoever picks this up cold

Reading order to get oriented in under 30 minutes:

1. `draft/README.md` — how to run it and what works
2. `examples/python/hotel_agent/CLAUDE.md` — project overview and decisions
3. `draft/design/scope.md` — what the agent does
4. `draft/design/policy.md` — the rules (and the eval cases in §13)
5. `draft/design/architecture.md` — the core RFC
6. `draft/core/integrations/pms/protocol.py` — the contract every runtime sees
7. `draft/runtimes/pydanticai/vanilla/` — the cleanest runtime to read first
8. `draft/tests/services/` — the spec, executable
