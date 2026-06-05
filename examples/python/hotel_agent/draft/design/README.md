# Hotel Agent — Design Docs

Working design docs for the end-to-end hotel agent example. Living documents — expect heavy iteration.

## How to use this folder

- **Starting fresh?** Read the parent `CLAUDE.md` first for the big picture, then come here for specifics.
- **Working on a specific area?** Jump to the doc from the index below.
- **Adding a new doc?** Add an entry to the index table and follow the conventions at the bottom.

## Reading order (recommended)

1. `inversion-of-control.md` — foundational decision, read first
2. `scope.md` → `policy.md` → `domain.md` — what we're building, the rules it must obey, and the data it lives on
3. `architecture.md` → `library-matrix.md` — how code is structured
4. `agenta-integration.md` — the Agenta overlay
5. `frontend.md` → `testing.md` → `rollout.md` — delivery concerns

## Index

| # | Doc | Status | What's in it |
|---|-----|--------|--------------|
| 1 | [scope.md](scope.md) | **Done** | What we're building functionally, what we're NOT |
| 2 | [policy.md](policy.md) | **Done** | Hotel rules the agent must reason over (tau-bench style) |
| 3 | [domain.md](domain.md) | TODO | Hotel domain model, SQLite schema, knowledge base sources |
| 4 | [inversion-of-control.md](inversion-of-control.md) | **Done (research)** | Tool injection contract, IoC patterns from prior art, per-library mappings |
| 5 | [architecture.md](architecture.md) | **Implemented** | Core layer: domain, PMS integration (Protocol + fake), retrieval, clock, AgentDeps. Landed in `core/`. |
| 6 | [library-matrix.md](library-matrix.md) | TODO (now worth writing) | Side-by-side of the three runtimes. Three exist to compare. |
| 7 | [agenta-integration.md](agenta-integration.md) | TODO (next big piece) | Prompt mgmt, eval (SDK + UI), observability, online eval, annotation queue |
| 8 | [frontend.md](frontend.md) | TODO | Vercel AI SDK surface, backend HTTP contract |
| 9 | [testing.md](testing.md) | TODO | Functional tests (no LLM), single-step tool tests |
| 10 | [rollout.md](rollout.md) | TODO | Promotion path: draft/ → parent folder |
| 11 | [implementation-status.md](implementation-status.md) | **Done (current handoff report)** | What is done, deferred, and the next steps. Read this first. |
| 12 | [runtime-pydanticai.md](runtime-pydanticai.md) | **Implemented** | First runtime port — Pydantic-AI vanilla. Tool surface, streaming model, server route, test layers. The other two runtimes followed this shape. |
| 13 | [evals-langgraph.md](evals-langgraph.md) | **Draft (plan)** | SDK-driven eval plan for the LangGraph runtime. Sourced from Agenta docs; verify against the installed SDK before relying on it. |

## Key decisions so far

| Decision | Rationale | Documented in |
|----------|-----------|---------------|
| Invert at the **service layer**, not the tool layer | Tool signatures are incompatible across SDKs; services are plain Python | `inversion-of-control.md` §5 |
| No single cross-runtime tool decorator | OpenAI wants RunContext, PydanticAI wants RunContext[Deps], Claude SDK wants closures, LangGraph wants InjectedState | `inversion-of-control.md` §4 |
| Tests target the PMS fake directly | No LLM needed; fast, deterministic; 90% of test coverage | `inversion-of-control.md` §7, `architecture.md` §Testing |
| Policy lives **only** in the system prompt; PMS does not enforce it | Code-enforced policy would test the code, not the agent. Eval surface requires the agent to make the calls. | `architecture.md` §Summary |
| PMS is treated as an external system, wrapped behind a Protocol | A SQLite-backed fake satisfies the same contract a future Mews/Cloudbeds adapter would. Demo stays honest about real PMS shape. | `architecture.md` §The integration layer |
| Three things injectable per request: PMS, Retriever, Clock | Bundled in `AgentDeps`. Snapshot/restore is a property of the SQLite file; recording is a Protocol decorator. | `architecture.md` §AgentDeps |
| Service layer is **async**; "current user" is an **explicit param** | Cross-runtime portability — every target SDK is async-native; explicit DI matches their tool-injection idioms | `scope.md` §Decisions |
| Policy *rules* embedded in system prompt; policy *rationales* RAG'd from KB | Authoritative numbers (low hallucination) plus a real RAG demo surface | `scope.md` §Decisions |
| Policy encoded as a Pydantic-validated dict, not a rules engine | Transparency and ease of A/B as prompt variants in Agenta; refactor if complexity outgrows the dict | `policy.md` §Decisions |

## Conventions

- Docs are working notes, not final spec — feel free to leave open questions inline as `> ❓ ...`.
- When a section grows past ~3 docs (e.g., one per runtime), promote it to a subfolder.
- Cross-link aggressively. Prefer one source of truth per concept; link from elsewhere.
- Update the index table status when a doc moves from TODO → In progress → Done.
