# Status: Evaluator Playground Migration

## Current Phase: PR 2 (Run) In Progress

**Last Updated:** 2026-02-13

---

## Chosen Approach

**Direct Migration (No Adapters)** - Split into two PRs:

1. **PR 1:** CRUD migration to `SimpleEvaluator` endpoints (draft PR)
2. **PR 2:** Run migration to native workflow invoke (in progress)

See [plan.md](./plan.md) for detailed implementation steps.

---

## Progress Summary

### Completed

- [x] Map current Evaluator Playground implementation
  - Identified all frontend components
  - Documented state management (atoms)
  - Mapped API endpoints used
  - Documented data flow

- [x] Analyze PR #3527 (backend migration)
  - Understood new `SimpleEvaluator` data model
  - Documented new endpoint shapes
  - Identified backward compatibility layer

- [x] Investigate native evaluator execution path
  - Confirmed `/evaluators/{key}/run` now resolves `agenta:builtin:{key}:v0` via SDK handler registry
  - Confirmed native workflow execution endpoint exists: `POST /preview/workflows/invoke`
  - Documented request structure used by batch evaluation tasks

- [x] Compare old vs new endpoints
  - Documented request/response differences
  - Identified URI-based evaluator identification
  - Noted response wrapper changes

- [x] Identify coupling and risk areas
  - State management coupling (MEDIUM risk)
  - Form initialization coupling (MEDIUM risk)
  - Service layer coupling (LOW-MEDIUM risk)
  - Created risk mitigation strategies

- [x] Finalize migration plan
  - Chose direct migration (no adapters)
  - Split into PR 1 (CRUD) and PR 2 (Run)
  - Documented all file changes needed

### Next Steps

- [ ] Finalize PR 1: CRUD migration (stacked on PR #3527)
- [ ] Finish PR 2: Run migration

---

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Direct migration (no adapters) | Avoids tech debt, aligns with new architecture | 2026-01-27 |
| Two-PR approach | Keeps changes reviewable, allows CRUD to stabilize first | 2026-01-27 |
| Internal shapes become `SimpleEvaluator` | Matches backend model, no translation layer | 2026-01-27 |

---

## Key Findings

### 1. The `/evaluators/{key}/run/` endpoint is a thin wrapper

PR #3527 refactored the legacy run endpoint to use the native handler registry internally:
- It builds a URI from the evaluator_key: `agenta:builtin:{key}:v0`
- Uses `retrieve_handler(uri)` to get the actual handler function
- Directly invokes the handler

### 2. Native workflow invoke path exists

There's a fully native way to run evaluators:
- Endpoint: `POST /preview/workflows/invoke`
- Uses `WorkflowServiceRequest` with URI in interface
- Same mechanism used by batch evaluations

### 3. URI-based handler registry

The SDK maintains a `HANDLER_REGISTRY` that maps URIs to handler functions:
- Format: `agenta:builtin:{evaluator_key}:v0`
- Supports custom evaluators: `user:custom:my_eval:latest`
- Enables version management of evaluator implementations

### 4. Key mapping changes

| Legacy | New |
|--------|-----|
| `evaluator_key` | derived from `data.uri` |
| `settings_values` | `data.parameters` |
| `EvaluatorConfig` | `SimpleEvaluator` |

### 5. Output schema ownership moved to frontend templates

Legacy config creation (`/evaluators/configs`) called `build_evaluator_data`, which generated
`data.schemas.outputs` and `data.service.format` for builtin evaluators.

The migrated frontend CRUD path uses `/preview/simple/evaluators` and initially sent only
`data.uri` plus `data.parameters`. That can create revisions without output schemas.

Frontend now receives `outputs_schema` in the evaluator template payload (`GET /evaluators`) and
sends `data.schemas.outputs` during create and edit.

Schema selection rules are now:
- fixed evaluators: use template `outputs_schema`
- `auto_ai_critique`: use `parameters.json_schema.schema`
- `json_multi_field_match`: derive schema from configured `fields`
- evaluators without template schema: send no output schema

Backend hydration still exists as a fallback path for builtin evaluators.

---

## Open Questions

1. **Slug uniqueness:** Backend enforces unique slugs per project; generate a short suffix client-side to avoid collisions.

2. **Output schemas:** Resolved. Frontend now sends known output schemas from evaluator templates and dynamic settings.

3. **Permission model:** Is `RUN_WORKFLOWS` the right permission for evaluator playground? Or should there be `RUN_EVALUATORS`?

---

## Effort Estimates

| PR | Effort | Dependencies |
|----|--------|--------------|
| PR 1: CRUD Migration | 4-5 days | Backend PR #3527 merged |
| PR 2: Run Migration | 3-4 days | PR 1 merged and stable |

**Total:** 7-9 days implementation

---

## Related Links

- [PR #3527: Migrate evaluators but keep legacy endpoints](https://github.com/Agenta-AI/agenta/pull/3527)
- [context.md](./context.md) - Background and goals
- [current-system.md](./current-system.md) - Current implementation details
- [new-endpoints.md](./new-endpoints.md) - New endpoint documentation
- [research.md](./research.md) - Handler registry and execution research
- [migration-options.md](./migration-options.md) - Why we chose direct migration
- [risk-analysis.md](./risk-analysis.md) - Coupling and risk analysis
- [plan.md](./plan.md) - Detailed implementation plan
