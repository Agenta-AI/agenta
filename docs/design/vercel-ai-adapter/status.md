# Status: Vercel AI SDK Adapter

## Current State

**Branch**: `main` (uncommitted — ready for commit & PR)
**Last Updated**: 2026-02-27

---

## Progress Tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Adapter implementation (`vercelai_adapter.py`) | ✅ DONE |
| 2 | Registration in AdapterRegistry | ✅ DONE |
| 3 | Unit tests (`test_vercelai_adapter.py`) — 55 tests, all passing | ✅ DONE |
| 4 | E2E tests — standalone script, 28/28 passing | ✅ DONE |
| 5 | E2E tests — pytest-based (with corrected assertion paths) | ✅ DONE |
| 6 | Integration docs (overview + observability pages) | ✅ DONE |
| 7 | Example refinement | ✅ DONE |
| 8 | Live traces sent to deployed instance | ✅ DONE |
| 9 | Commit & PR | 🔜 PENDING |

---

## Completed Research

- [x] Vercel AI SDK semconv — complete attribute reference from source code
- [x] Verified `ai.*` spans arrive in Agenta (example runs, traces visible)
- [x] Confirmed no existing adapter handles `ai.*` attributes
- [x] Confirmed `gen_ai.*` on inner spans is handled by OpenLLMetry/Logfire adapters
- [x] Confirmed frontend only reads from `ag.*` — no frontend changes needed
- [x] Analyzed adapter interface (`BaseAdapter`, `CanonicalAttributes`, `SpanFeatures`)
- [x] Analyzed existing test infrastructure and patterns
- [x] Analyzed existing integration docs pattern (overview.mdx + observability.mdx)
- [x] Analyzed E2E test patterns (`authed_api`, `wait_for_response`, span ingest endpoint)
- [x] Discovered pipeline transform: `unit.tokens.*` → `tokens.incremental.*` (in `span_data_builders.py`)
- [x] Discovered pipeline transform: `ag.type.node` → `ag.type.span` (in `span_data_builders.py`)

---

## Decisions

### Decision 1: Option B — Only handle `ai.*`, let existing adapters handle `gen_ai.*`

**Rationale**: Inner/call spans emit both `ai.*` and `gen_ai.*`. Existing adapters already map `gen_ai.*` to `ag.*`. Adding duplicate mappings would be redundant and could cause conflicts. Adapters run sequentially and merge features.

### Decision 2: Parse JSON strings in the adapter

**Rationale**: `ai.prompt` and `ai.prompt.messages` are JSON strings. Parse them in the adapter (not rely on the generic JSON parsing in `initialize_ag_attributes`) because the adapter knows the expected structure and can extract the right sub-fields.

### Decision 3: All four test levels

**Rationale**: Unit tests are primary (fast, deterministic, test exact mapping logic). But E2E tests are also important — they verify the full pipeline including adapter registration, span ingestion, storage, and query. Live verification with real SDK proves it works end-to-end with real telemetry data.

### Decision 4: Docs follow existing integration pattern

**Rationale**: Existing integrations (OpenAI Agents, PydanticAI, etc.) use `overview.mdx` + `observability.mdx` + `_category_.json`. The Vercel AI SDK docs will follow the same structure. Since this is a TypeScript/JavaScript SDK, the setup is different (OTel provider, not `ag.init()`), but the doc structure is the same.

---

## Key Discovery: Pipeline Transforms

The E2E tests initially had 7 failures because of two downstream pipeline transforms that weren't accounted for in assertions:

1. **Token metrics path**: The adapter writes `ag.metrics.unit.tokens.prompt` which becomes `tokens.incremental.prompt` after `span_data_builders.py` applies `k.replace("unit.tokens.", "tokens.incremental.")`. Then `calculate_and_propagate_metrics()` creates `tokens.cumulative.prompt` by propagating up the span tree.

2. **Type path**: The adapter writes `ag.type.node` which becomes `ag.type.span` after `span_data_builders.py` renames it (lines 161-167).

Both transforms are correct and consistent with all other adapters — the E2E test assertions were simply checking the wrong paths.

---

## Test Results

### Unit Tests: 55/55 ✅
- Model info mapping (model ID, provider)
- Input/output mapping (prompt parsing, response text, tool calls)
- Token usage — both naming conventions (promptTokens vs inputTokens)
- Settings mapping (temperature, topP, topK, maxOutputTokens, etc.)
- Operation type mapping (generateText→task, toolCall→tool, embed→embedding)
- Finish reason wrapping
- Metadata extraction (user ID, session ID)
- JSON parsing edge cases (malformed JSON kept as string)
- Ignores unrelated attributes (gen_ai.*, llm.*, ag.*)
- Full realistic spans (generateText, streamText, toolCall)
- Registry integration (adapter registered, correct order)

### E2E Tests: 28/28 ✅
- generateText: inputs, outputs, model, provider, temperature, finish_reasons, tokens (incremental + cumulative), type, user ID
- streamText: model, provider, tokens (inputTokens/outputTokens naming)
- toolCall: inputs (name + args), outputs (result), type=tool, parent span model

---

## What's Left

1. **Create branch, commit, and create PR**
