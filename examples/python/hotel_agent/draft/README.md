# Hotel Concierge Agent — Demo

An end-to-end hotel concierge agent built three ways (Pydantic-AI, OpenAI Agents
SDK, LangChain/LangGraph) over one shared business core, with a FastAPI server
and a Next.js chat UI. It shows how to invert tool ownership so the same logic
runs across frameworks, and how to trace every run into Agenta.

This folder (`draft/`) is the working area. It promotes to the parent when ready.

---

## Status at a glance

| Area | State |
|------|-------|
| Core business layer (`core/`) | Done. Domain types, SQLite-backed fake PMS behind a Protocol, IDF retriever, clock, DI container. |
| Runtimes (vanilla, no Agenta) | Done for 3 of 4: `pydanticai`, `openai_agents`, `langgraph`. Claude Agent SDK is planned, not built. |
| Runtimes (`with_agenta`) | Not started. No `with_agenta/` folder exists yet. This is the next big piece. |
| FastAPI server (`server/`) | Done. One route per runtime, streams Vercel AI SDK v1 events. |
| Frontend (`frontend/`) | Done. Persona switcher, runtime switcher, tool-call rendering. |
| Observability | Done. All three runtimes emit OpenTelemetry spans to Agenta (or Logfire). |
| Tests | Done. 73 passing (43 service-level, 30 adapter-level, all no-LLM). |
| Prompt management via Agenta | Not started. Prompts are hardcoded in each runtime's `agent.py`. |
| Evals | Not started. `policy.md` §13 lists ready-made eval cases. |

For the full handoff detail, read `design/implementation-status.md`.

---

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/).
- Node 20+ and pnpm (the frontend lockfile was built with pnpm).
- An `OPENAI_API_KEY` (all three runtimes default to `openai:gpt-4o-mini`).
- Optional: an Agenta API key + host to see traces.

---

## Setup

```bash
cd examples/python/hotel_agent/draft

# 1. Python deps
uv sync

# 2. Environment
cp .env.example .env
# then edit .env and fill in at least OPENAI_API_KEY

# 3. Frontend deps
cd frontend && pnpm install && cd ..
```

### What goes in `.env`

| Var | Needed for | Default |
|-----|-----------|---------|
| `OPENAI_API_KEY` | All runtimes | none (required) |
| `ANTHROPIC_API_KEY` | Pydantic-AI with an `anthropic:` model | none |
| `LLM_MODEL` | Default model string | `openai:gpt-4o-mini` |
| `TRACING_BACKEND` | `agenta` or `logfire` | `agenta` |
| `AGENTA_API_KEY` | Sending traces to Agenta | empty |
| `AGENTA_HOST` | Agenta instance URL | `https://cloud.agenta.ai` |
| `LOGFIRE_API_KEY` | Sending traces to Logfire | empty |
| `HOTEL_DB_URL` | Override the SQLite URL | in-memory |
| `DEFAULT_PERSONA` | Fallback guest if the UI omits one | `guest_sarah` |

`.env` is gitignored at the repo root. `.env.example` is checked in.

---

## How to run

Two processes. Run them in separate terminals from `draft/`.

### Backend (FastAPI, port 8000)

```bash
uv run uvicorn server.main:app --port 8000
```

Health check: `curl http://localhost:8000/health` → `{"status":"healthy"}`
Available runtimes: `curl http://localhost:8000/api/runtimes`

### Frontend (Next.js, port 3000)

```bash
cd frontend && pnpm dev
```

Open http://localhost:3000. The frontend proxies `/api/*` to the backend on
`localhost:8000` (see `frontend/next.config.js`). If you open the app from a
remote host by IP, that IP must be listed in `allowedDevOrigins` in
`next.config.js`.

### Talk to a runtime without the browser

Each runtime has a CLI for quick prompt iteration:

```bash
uv run python scripts/chat_pydanticai.py --persona guest_eve
uv run python scripts/chat_openai_agents.py --persona guest_carla
uv run python scripts/chat_langgraph.py --persona guest_bob
```

---

## How it works

### One core, three runtimes

All business logic lives in `core/`. The agent never owns it. Each runtime
writes thin adapter functions that receive an `AgentDeps` (the PMS, the
retriever, the clock, and the current user id) and call into the core. The three
frameworks each inject `AgentDeps` their own way:

| Runtime | DI mechanism |
|---------|--------------|
| Pydantic-AI | `RunContext[AgentDeps]`, tools via `@agent.tool` |
| OpenAI Agents SDK | `RunContextWrapper[AgentDeps]`, `ctx.context`, tools return JSON strings |
| LangChain / LangGraph | `ToolRuntime` injection, `runtime.context`, `create_agent(context_schema=AgentDeps)` |

The tool surface (11 tools) is identical across runtimes by name and docstring,
so the frontend and prompts stay consistent. See `design/inversion-of-control.md`
for the reasoning and `design/runtime-pydanticai.md` for the first port.

### Server

`POST /api/chat/{runtime}` picks a runtime from the registry in
`server/runtimes.py`, runs it, and translates that framework's event stream into
Vercel AI SDK v1 stream events. Each framework has its own translator:

- Pydantic-AI: inline in `server/main.py` (`_stream_run`)
- OpenAI Agents SDK: `server/openai_agents_stream.py`
- LangChain: `server/streaming_langgraph.py`

The current guest comes from the request body (`current_user_id`), set by the
frontend persona switcher. There is no auth. The frontend is an internal
playground.

### Observability

At startup `server/main.py` instruments all three frameworks once. With
`TRACING_BACKEND=agenta`, `ag.init()` installs a global OpenTelemetry provider
that exports to your Agenta host. Pydantic-AI is instrumented natively; the
OpenAI Agents SDK and LangChain are bridged through OpenInference. Every chat
produces a trace with the agent run and tool spans.

---

## Testing

```bash
uv run pytest tests/        # 73 tests, ~4s, no LLM calls
uv run ruff format . && uv run ruff check .
```

- `tests/services/` (43): exercise the fake PMS directly. This is the bulk of
  coverage and the fastest signal.
- `tests/adapters/{pydanticai,openai_agents,langgraph}/` (10 each): synthesize
  the arguments an LLM would emit, invoke the tool, and assert the right core
  method was called. No LLM in the loop.

---

## Troubleshooting

- **"This page could not be found" in the browser.** You hit a stale path. Use
  the bare root URL (`/`). The app only serves `/`.
- **Frontend cannot reach the backend.** Confirm the backend is on port 8000 and
  that `frontend/next.config.js` rewrites `/api/*` there.
- **No traces appear in Agenta.** First confirm the run produced spans (the
  backend logs no OTLP export errors). Then confirm you are viewing the project
  that your `AGENTA_API_KEY` belongs to. Traces land in the key's project, so a
  key for one project will not show under another. The OTLP receiver returns 200
  even when a span is later dropped, so a 200 alone does not prove storage. Query
  `POST {AGENTA_HOST}/api/traces/query` with `Authorization: ApiKey <key>` to
  confirm storage.
- **Reservations reset.** The DB is in-memory by default and re-seeds on every
  restart. Set `HOTEL_DB_URL=sqlite+aiosqlite:///./hotel.db` to persist.

---

## What is here

```
draft/
├── README.md                 you are here
├── .env.example              copy to .env
├── core/                     framework-agnostic business core (done)
├── runtimes/                 per-framework agents (3 vanilla done)
│   ├── pydanticai/vanilla/
│   ├── openai_agents/vanilla/
│   └── langgraph/vanilla/
├── server/                   FastAPI, one route per runtime + 3 stream translators
├── frontend/                 Next.js + Vercel AI SDK chat UI
├── scripts/                  per-runtime CLI chat runners
├── tests/                    service-level + adapter-level (73, no LLM)
└── design/                   design docs and the handoff report
```

## Where to go next

If you are picking this up to extend it, read **`design/implementation-status.md`**
first. It lists exactly what is done, what is deferred, and the recommended next
steps (Agenta prompt management, the `with_agenta` runtime variants, and evals).
