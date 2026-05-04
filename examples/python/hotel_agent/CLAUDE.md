# Hotel Agent Example

End-to-end example demonstrating a realistic hotel concierge agent integrated with Agenta for prompt management, evaluation, observability, online evaluation, and annotation queues.

## What we're building

A hotel booking agent that:
- Searches rooms, makes/cancels bookings, answers policy questions from a knowledge base
- Has a real SQLite database with real data (no mocks)
- Has a real knowledge base (hotel policies, FAQ)
- Has a frontend (Next.js + Vercel AI SDK)
- Is implemented in **four agent frameworks**: OpenAI Agents SDK, Claude Agent SDK, PydanticAI, LangGraph
- Each framework has a **vanilla** version (no Agenta) and a **with_agenta** version (full integration)
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
    │   ├── openai_agents/{vanilla,with_agenta}/
    │   ├── claude_agent_sdk/{vanilla,with_agenta}/
    │   ├── pydanticai/{vanilla,with_agenta}/
    │   └── langgraph/{vanilla,with_agenta}/
    ├── server/                ← FastAPI backend exposing each runtime
    ├── frontend/              ← Next.js + Vercel AI SDK chat UI
    ├── tests/                 ← functional tests (PMS-level, adapter-level)
    └── scripts/               ← seed DB, ingest KB, dev runners
```

## What to read for context

| Topic | Read this |
|-------|-----------|
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

## Decisions still open

- Retrieval implementation choice (LanceDB vs in-memory FAISS-like vs DuckDB-VSS).
- Whether to expose `AvailabilityAPI.search` raw to the agent or wrap in a higher-level "search rooms" tool.
- Named seed-data scenarios for evals (Sarah-checks-in-tomorrow, Bob-cancels-late, etc.).
- How `current_user_id` reaches `AgentDeps` from the FastAPI auth layer.
- Whether to build a `RecordingPMS` decorator for offline replay (probably yes, after first runtime works).

## Conventions

- Use `uv run` with inline script dependencies (`# /// script`) for standalone scripts
- Run ruff before committing Python (`ruff format && ruff check --fix`)
- Design docs are living notes — use `> ❓ ...` for open questions inline
- When a design doc section grows past 3 files, promote it to a subfolder
