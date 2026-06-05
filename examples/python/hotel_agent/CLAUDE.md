# Hotel Agent Example

End-to-end example demonstrating a realistic hotel concierge agent integrated with Agenta for prompt management, evaluation, observability, online evaluation, and annotation queues.

> **Start here:** `draft/README.md` is the operational guide (setup, how to run, troubleshoot). `draft/design/implementation-status.md` is the handoff report (what is done, what is deferred, next steps). This file is the high-level orientation.

## Current status (2026-06-03)

The example runs end to end. Read `draft/design/implementation-status.md` for detail.

- **Done:** core business layer, three vanilla runtimes (Pydantic-AI, OpenAI Agents SDK, LangChain/LangGraph), FastAPI server with one route per runtime, Next.js frontend with persona + runtime switchers, OpenTelemetry tracing into Agenta, 73 passing tests (no LLM).
- **Not started:** `with_agenta` runtime variants (prompt management), evals, the Claude Agent SDK runtime, prompt centralization.

## What we're building

A hotel booking agent that:
- Searches rooms, makes/cancels bookings, answers policy questions from a knowledge base
- Has a real SQLite database with real data (no mocks)
- Has a real knowledge base (hotel policies, FAQ)
- Has a frontend (Next.js + Vercel AI SDK)
- Is implemented in **four agent frameworks**: OpenAI Agents SDK, Claude Agent SDK, PydanticAI, LangGraph (3 of 4 built; Claude Agent SDK pending)
- Each framework has a **vanilla** version (no Agenta) and a **with_agenta** version (full integration). Only vanilla is built so far.
- Includes functional tests (no LLM in the loop)

## Key architectural decision: Inversion of Control

Tools are **injected** into the agent, not owned by it. The business logic lives in a shared service layer (`core/`). Each runtime writes thin adapter functions that call the service. This enables:
- Single-step tool tests (test service methods directly, no LLM)
- Cross-runtime portability (same logic, four different SDKs)
- Clean separation for the with/without-Agenta split

Read the full research: `draft/design/inversion-of-control.md`

## Folder structure

```
hotel_agent/
├── CLAUDE.md                  ← you are here
└── draft/                     ← working area (promotes to parent when ready)
    ├── design/                ← design docs (research, decisions, plans)
    │   ├── README.md          ← index of all design docs
    │   ├── inversion-of-control.md   ← IoC research (DONE)
    │   ├── scope.md           ← functional scope (DONE)
    │   ├── policy.md          ← hotel rules the agent reasons over (DONE)
    │   └── architecture.md    ← core layer RFC (in review)
    ├── core/                  ← framework-agnostic core
    │   ├── domain/            ← Pydantic types (Room, Reservation, Guest, ...)
    │   ├── integrations/pms/  ← PMS Protocol + SQLite-backed fake
    │   ├── retrieval/         ← vector retriever for KB docs
    │   ├── clock.py           ← Clock Protocol + System/Fixed impls
    │   ├── deps.py            ← AgentDeps container
    │   ├── container.py       ← composition root: build_default_deps()
    │   └── db/                ← SQLAlchemy schema + seed for the fake
    ├── runtimes/              ← per-framework agent implementations
    │   ├── pydanticai/vanilla/      ← BUILT
    │   ├── openai_agents/vanilla/   ← BUILT
    │   ├── langgraph/vanilla/       ← BUILT
    │   └── (claude_agent_sdk/, *_with_agenta/ ← not built yet)
    ├── server/                ← FastAPI; /api/chat/{runtime} + 3 stream translators
    │   ├── main.py            ← routes, startup tracing, pydanticai streamer
    │   ├── runtimes.py        ← RuntimeSpec registry (slug → kind → agent)
    │   ├── openai_agents_stream.py  ← OpenAI Agents SDK → Vercel v1 events
    │   ├── streaming_langgraph.py   ← LangChain → Vercel v1 events
    │   └── config.py          ← env-derived settings
    ├── frontend/              ← Next.js + Vercel AI SDK chat UI (persona + runtime switchers)
    ├── tests/                 ← functional tests: services/ (43) + adapters/ (30), no LLM
    └── scripts/               ← per-runtime CLI chat runners
```

The tool surface (11 tools) is identical across runtimes by name and docstring; only the DI mechanism differs per framework. See `draft/design/implementation-status.md`.

## What to read for context

| Topic | Read this |
|-------|-----------|
| How to set up and run it | `draft/README.md` |
| What is done / deferred / next steps | `draft/design/implementation-status.md` |
| Overall plan and doc index | `draft/design/README.md` |
| What the agent can accomplish, in scope vs out | `draft/design/scope.md` |
| The hotel rules the agent reasons over | `draft/design/policy.md` |
| Why tools are injected, how each SDK does DI | `draft/design/inversion-of-control.md` |
| Core layer: PMS integration, retrieval, clock, AgentDeps | `draft/design/architecture.md` |
| Agenta API architecture (for context on integration) | Root `AGENTS.md` §API Architecture Patterns |
| How Agenta does IoC (DTO/DBE/DAO/Service) | Root `AGENTS.md` §Layering and dependency direction |

## Decisions locked in

1. **PMS is an external integration.** We wrap it behind a Protocol; the demo runs against a SQLite-backed fake. A real Mews/Cloudbeds adapter could drop in alongside without touching anything else.
2. **Policy lives only in the agent system prompt.** The PMS does not enforce it. Agent reasoning over policy is exactly the eval surface we want to measure.
3. **The knowledge base is a retrieval primitive, not a service.** The agent decides what to query and how to use results.
4. **Three things injectable per request: PMS, Retriever, Clock.** Bundled in `AgentDeps`. Each runtime threads it via its own DI mechanism.
5. **No single tool decorator across SDKs.** Each runtime writes thin (~5-line) adapter functions over `AgentDeps`. We do NOT try to share tool code.
6. **Real data, no mocks.** SQLite with deterministic seed data. Real KB markdown. Real LLM calls in integration tests.
7. **Service layer is async; current user is an explicit param** in `AgentDeps.current_user_id`.

## What's next for another agent

Full detail and ordering live in `draft/design/implementation-status.md` §Next steps. In short:

1. **Write `draft/design/library-matrix.md`.** Three runtimes exist now; capture the side-by-side DI and streaming differences.
2. **Centralize the system prompt.** It is currently duplicated across the three `runtimes/*/vanilla/agent.py` files with a "keep in sync" note. Pull it into one shared source. This is a prerequisite for clean `with_agenta` variants.
3. **Build the first `with_agenta` runtime** (start with Pydantic-AI): pull the prompt and model config from Agenta's prompt registry instead of the hardcoded constant. Document in `agenta-integration.md`.
4. **Add evals.** `draft/design/policy.md` §13 already lists the edge cases (Gold + Advance inside cutoff, Platinum third modification, non-refundable + illness, pet weight/count refusals, Platinum resort-fee exclusion, and so on). Turn them into an Agenta test set and run them (SDK first, then UI). Policy lives only in the prompt, so the eval measures the agent's reasoning, which is the whole point.
5. **Add the Claude Agent SDK runtime** to complete the four-framework matrix.

## Decisions still open

- Whether to expose `AvailabilityAPI.search` raw to the agent or wrap in a higher-level "search rooms" tool.
- A real vector store (LanceDB / DuckDB-VSS / numpy flat) to replace `InMemoryRetriever`. The Retriever Protocol is the swap-in seam.
- Whether to build a `RecordingPMS` decorator for offline replay.
- Real auth for `current_user_id` (currently from the request body; the frontend is an internal playground).

## Conventions

- Use `uv run` with inline script dependencies (`# /// script`) for standalone scripts
- Run ruff before committing Python (`ruff format && ruff check --fix`)
- Design docs are living notes — use `> ❓ ...` for open questions inline
- When a design doc section grows past 3 files, promote it to a subfolder
