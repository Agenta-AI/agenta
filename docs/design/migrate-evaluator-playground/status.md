# Status: Evaluator Playground Migration

## Current Phase: Research Complete

**Last Updated:** 2026-01-27

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

- [x] Propose migration plan
  - Adapter pattern approach
  - Feature flag integration
  - Phased rollout strategy

### In Progress

- [ ] Phase 1: Foundation - Not started

### Blocked

- [ ] Phase 3: Integration Testing - Blocked on PR #3527 merge

---

## Key Findings

### 1. The `/evaluators/{key}/run/` endpoint works but is now a wrapper

**Important Discovery:** PR #3527 refactored the legacy run endpoint to use the native handler registry internally:
- It builds a URI from the evaluator_key: `agenta:builtin:{key}:v0`
- Uses `retrieve_handler(uri)` to get the actual handler function
- Directly invokes the handler

**Implication:** The external interface is unchanged, but internally it uses the new architecture.

### 2. Native workflow invoke path exists

There's a fully native way to run evaluators:
- Endpoint: `POST /preview/workflows/invoke`
- Uses `WorkflowServiceRequest` with URI in revision data
- Same mechanism used by batch evaluations

**Recommendation:** Keep using legacy endpoint for now (simpler), consider native invoke for future custom evaluator support.

### 3. URI-based handler registry

The SDK maintains a `HANDLER_REGISTRY` that maps URIs to handler functions:
- Format: `agenta:builtin:{evaluator_key}:v0`
- Supports custom evaluators: `user:custom:my_eval:latest`
- Enables version management of evaluator implementations

### 4. Adapter pattern minimizes risk

By transforming data at the API boundary, we can:
- Keep internal data shapes unchanged
- Minimize code changes
- Enable easy rollback via feature flag

### 5. Output schema handling

The new `SimpleEvaluator` model includes explicit output schemas. The backend migration generates these from evaluator settings. For new configs:
- Built-in evaluators: Schema can be derived from evaluator type
- Custom evaluators: Schema should be provided by user

---

## Decisions Made

| Decision | Rationale | Date |
|----------|-----------|------|
| Use adapter pattern | Minimizes changes to internal code, enables gradual migration | 2026-01-27 |
| Feature flag approach | Allows gradual rollout and easy rollback | 2026-01-27 |
| Keep form structure as `settings_values` | Avoid cascading changes to form components | 2026-01-27 |

---

## Open Questions

1. **Run migration target:** For full migration, do we want the playground to invoke by:
   - built-in key -> URI (`agenta:builtin:{key}:v0`), or
   - evaluator revision URI stored on `SimpleEvaluator.data.uri` (preferred), or
   - a specific evaluator revision id (even more explicit)?
2. **Output Schema:** Confirm whether frontend must provide `data.schemas.outputs` on create/edit, or backend will derive defaults.
3. **Slug Generation:** Client-side or server-side?

---

## Next Steps

1. Wait for PR #3527 to be merged
2. Start Phase 1: Create type definitions and adapters
3. Add feature flag infrastructure
4. Test with new endpoints

---

## Related Links

- [PR #3527: Migrate evaluators but keep legacy endpoints](https://github.com/Agenta-AI/agenta/pull/3527)
- [context.md](./context.md) - Background and goals
- [current-system.md](./current-system.md) - Current implementation details
- [new-endpoints.md](./new-endpoints.md) - New endpoint documentation
- [risk-analysis.md](./risk-analysis.md) - Coupling and risk analysis
- [plan.md](./plan.md) - Migration execution plan
