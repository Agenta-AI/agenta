# Migration Options (Plan A vs Plan B)

## Goal

Full migration of the Evaluator Playground to the new workflow-based evaluator APIs, including:
- CRUD on evaluator configs via `/preview/simple/evaluators/*` (or the richer `/preview/evaluators/*` family)
- Running evaluators via native workflow invocation (`/preview/workflows/invoke`) instead of the legacy `/evaluators/{key}/run`

This doc lists two concrete migration strategies.

---

## Plan A (Transitional): Keep Internal Shapes Stable

This is the earlier approach: keep the UI/state assuming the legacy `EvaluatorConfig` shape and translate at the API boundary.

### Why it exists

- Minimizes touching UI/atoms/forms
- Lets you swap endpoints quickly with limited regression surface
- Good when backend is still stabilizing schemas

### Trade-offs

- Adds an extra abstraction layer (adapters)
- Can delay paying down legacy assumptions (`settings_values`, `evaluator_key`, etc.)

---

## Plan B (Preferred): Direct Migration (No Adapters)

This changes the frontend domain model to match the backend reality:
- “Evaluator config” becomes `SimpleEvaluator` (workflow artifact w/ latest evaluator revision data attached)
- Execution uses workflow invocation (`/preview/workflows/invoke`) using evaluator `data.uri`

### Why it’s better long-term

- Eliminates translation debt
- Aligns with “evaluators are workflows” concept end-to-end
- Unlocks revision-aware runs and custom evaluator URIs

### Initial Scope (not exhaustive)

#### 1) Data model and type changes

- Introduce TS types for `SimpleEvaluator*` and `WorkflowService*` (request/response)
- Replace usages of `EvaluatorConfig` in the evaluator playground path with `SimpleEvaluator`

Key places:
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms.ts`
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/index.tsx`
- `web/oss/src/components/Evaluators/hooks/useEvaluatorsRegistryData.ts`

#### 2) CRUD endpoint swap (configs)

Replace:
- `GET/POST/PUT/DELETE /evaluators/configs/*`

With:
- `POST /preview/simple/evaluators/query`
- `POST /preview/simple/evaluators/`
- `PUT /preview/simple/evaluators/{id}`
- `POST /preview/simple/evaluators/{id}/archive`

Key files:
- `web/oss/src/services/evaluators/index.ts`
- `web/oss/src/state/evaluators/atoms.ts`

Notes:
- `evaluator_key` is now derived from `simpleEvaluator.data.uri` (or carried separately in UI state)
- Settings are now `simpleEvaluator.data.parameters`

#### 3) Run endpoint swap (native invoke)

Replace:
- `POST /evaluators/{evaluator_key}/run`

With:
- `POST /preview/workflows/invoke`

What needs changing in the playground:
- `DebugSection.tsx` currently uses `createEvaluatorRunExecution(evaluatorKey, {inputs, settings})`
- New call should construct `WorkflowServiceRequest`:
  - `interface.uri` (or `configuration`+`interface`) derived from evaluator `data` / built-in key
  - `data.inputs` (merged testcase + prediction)
  - `data.outputs` (prediction/output)
  - `data.parameters` (settings)

Key file:
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx`
- plus a new service client, e.g. `web/oss/src/services/workflows/invoke.ts`

#### 4) Registry/list UI adjustments

The evaluators registry table expects legacy `evaluator_key` and `settings_values`. Under Plan B:
- The list source becomes `SimpleEvaluator[]`
- Table columns need to read from `data.uri` and `data.parameters`

Key files:
- `web/oss/src/components/Evaluators/index.tsx`
- `web/oss/src/components/Evaluators/assets/getColumns.tsx`
- `web/oss/src/components/Evaluators/hooks/useEvaluatorsRegistryData.ts`

#### 5) Permissions and error handling

Native invoke uses `RUN_WORKFLOWS` permission (backend check). Expect:
- Different 403 behavior for some users
- Different error shape: workflow service returns `status.code/message` in response

UI needs:
- Map workflow error status to `message.error` and output editor

---

## Practical Recommendation

If the objective is “duplicate all endpoints and fully migrate”, Plan B is the right destination.

To reduce risk while still avoiding adapters, a pragmatic sequencing is:

1) Migrate CRUD to SimpleEvaluator endpoints (Plan B)
2) Keep legacy run for 1-2 PRs while CRUD stabilizes
3) Migrate run to `/preview/workflows/invoke` (Plan B completion)

This keeps changes reviewable without introducing a permanent adapter layer.
