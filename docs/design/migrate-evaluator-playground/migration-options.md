# Migration Options

## Goal

Full migration of the Evaluator Playground to the new workflow-based evaluator APIs, including:
- CRUD on evaluator configs via `/preview/simple/evaluators/*`
- Running evaluators via native workflow invocation (`/preview/workflows/invoke`) instead of the legacy `/evaluators/{key}/run`

---

## Option A (Rejected): Adapter Pattern

Keep the UI/state assuming the legacy `EvaluatorConfig` shape and translate at the API boundary.

### Why it was considered

- Minimizes touching UI/atoms/forms initially
- Lets you swap endpoints quickly with limited regression surface
- Good when backend is still stabilizing schemas

### Why it was rejected

- Adds tech debt (adapter layer becomes permanent)
- Delays alignment with new architecture
- Makes future changes harder (two mental models)

---

## Option B (Chosen): Direct Migration

Change the frontend domain model to match the backend:
- "Evaluator config" becomes `SimpleEvaluator`
- Internal shapes use `data.parameters` instead of `settings_values`
- Internal shapes derive `evaluator_key` from `data.uri`

### Why it's better

- No translation debt
- Aligns with "evaluators are workflows" concept end-to-end
- Unlocks revision-aware runs and custom evaluator URIs
- Cleaner codebase long-term

---

## Execution Strategy

To keep changes reviewable while avoiding adapters:

### PR 1: CRUD Migration
- Migrate all CRUD operations to `/preview/simple/evaluators/*`
- Change internal types from `EvaluatorConfig` to `SimpleEvaluator`
- Update atoms, services, and components
- Keep legacy run endpoint temporarily

### PR 2: Run Migration
- Migrate run from `/evaluators/{key}/run` to `/preview/workflows/invoke`
- Add `WorkflowServiceRequest/Response` types
- Update `DebugSection.tsx` to use native invoke

This sequencing:
1. Isolates CRUD changes for easier review
2. Allows CRUD to stabilize before changing run
3. Avoids adapter layer entirely
4. Results in full migration with no legacy code

---

## Files Affected

### PR 1 (CRUD)

| Area | Files |
|------|-------|
| Types | `web/oss/src/lib/Types.ts` |
| Services | `web/oss/src/services/evaluators/index.ts` |
| State | `web/oss/src/state/evaluators/atoms.ts` |
| Playground State | `web/oss/src/components/.../ConfigureEvaluator/state/atoms.ts` |
| Playground UI | `web/oss/src/components/.../ConfigureEvaluator/index.tsx` |
| Registry | `web/oss/src/components/Evaluators/index.tsx` |
| Registry Hook | `web/oss/src/components/Evaluators/hooks/useEvaluatorsRegistryData.ts` |
| Columns | `web/oss/src/components/Evaluators/assets/getColumns.tsx` |

### PR 2 (Run)

| Area | Files |
|------|-------|
| Types | `web/oss/src/lib/Types.ts` (add workflow types) |
| Invoke Service | `web/oss/src/services/workflows/invoke.ts` (new) |
| Debug Section | `web/oss/src/components/.../ConfigureEvaluator/DebugSection.tsx` |

---

## Key Mapping Changes

| Legacy | New |
|--------|-----|
| `EvaluatorConfig` | `SimpleEvaluator` |
| `evaluator_key` | derived from `data.uri` |
| `settings_values` | `data.parameters` |
| `GET /evaluators/configs/` | `POST /preview/simple/evaluators/query` |
| `POST /evaluators/configs/` | `POST /preview/simple/evaluators/` |
| `PUT /evaluators/configs/{id}/` | `PUT /preview/simple/evaluators/{id}` |
| `DELETE /evaluators/configs/{id}/` | `POST /preview/simple/evaluators/{id}/archive` |
| `POST /evaluators/{key}/run/` | `POST /preview/workflows/invoke` |

See [plan.md](./plan.md) for detailed implementation steps.
