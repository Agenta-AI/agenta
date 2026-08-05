# Runnables Plan Decomposition — Function Layer

## Purpose

This document decomposes the runnable migration plan at the **function layer**, meaning the actual code implementation surface.

This is the lowest design layer before and during code changes. The focus is:

- file-level implementation seams
- function- and method-level change targets
- ordered implementation slices
- code-level ownership

This document is derived from [plan.md](./plan.md).

## Function-layer implementation slices

## 1. Workflow type and request model changes

### Files

- `sdk/agenta/sdk/models/workflows.py`

### Likely function/class targets

- `WorkflowFlags`
- `WorkflowRequestFlags`
- `WorkflowServiceRequest`
- `invoke_*` function signatures
- `ApplicationServiceRequest`
- `EvaluatorServiceRequest`
- `ApplicationFlags`
- `EvaluatorFlags`

### Required code changes

- add new workflow service-flag fields needed by the plan on `WorkflowFlags`
  - `can_stream`
  - `can_evaluate`
  - `can_chat`
  - `can_verbose`
  - likely `is_verbose`
- add `WorkflowRequestFlags` as a new type for `WorkflowServiceRequest.flags`
- define workflow request-flag semantics on `WorkflowRequestFlags` for:
  - `flags.stream`
  - `flags.evaluate`
  - `flags.chat`
  - `flags.verbose`
  - `flags.remote`
- make `WorkflowServiceRequest.flags: WorkflowRequestFlags` explicit in the contract
- make the SDK consume `flags.remote` as the remote-forwarding selector
- ensure typed aliases for applications and evaluators inherit the new contract cleanly

## 2. SDK inspect, invoke, and OpenAPI discovery semantics

### Files

- `sdk/agenta/sdk/decorators/running.py`
- `sdk/agenta/sdk/middlewares/running/normalizer.py`
- `sdk/agenta/sdk/middlewares/running/resolver.py`
- `sdk/agenta/sdk/workflows/utils.py`

### Likely function/method targets

- `workflow.invoke()`
- `workflow.inspect()`
- `invoke_workflow()`
- `inspect_workflow()`
- `get_workflow_openapi()`
- `invoke_application()`
- `inspect_application()`
- `get_application_openapi()`
- `invoke_evaluator()`
- `inspect_evaluator()`
- `get_evaluator_openapi()`
- registry access helpers in `workflows/utils.py`
- request normalization code in `NormalizerMiddleware`

### Required code changes

- derive and expose new capability flags during inspect
- carry derived identity/classification fields where appropriate
- read request flags during invoke
- honor `flags.remote` at the SDK boundary and clear it on forwarded requests
- expose OpenAPI generation through SDK getters, not only HTTP routes
- implement verbose response shaping
- align `aggregate` with `stream`
- align the current internal `annotate` mechanism with the external `evaluate` request-flag semantics
- define default behavior when a command is unsupported
- ensure handler registration validates or captures explicit schemas for custom workflows

## 3. Runtime HTTP route isolation and per-workflow OpenAPI

### Files

- `sdk/agenta/sdk/decorators/routing.py`
- legacy reference: `sdk/agenta/sdk/decorators/serving.py`

### Likely function/class targets

- `class route`
- route construction inside `route.__call__()`
- `handle_invoke_success`
- `handle_inspect_success`

### Required code changes

- create isolated sub-application behavior per routed workflow
- keep `{path}/inspect` as the route-owned discovery surface
- ensure inspect reflects only one workflow namespace
- expose flags and schemas coherently in the route-owned discovery surface
- expose all runnable builtins through the runtime `/services` family
- review and standardize the runtime service URL shape
- preserve stream response handling and headers

## 4. API workflow-level invoke/inspect dispatch

### Files

- `api/oss/src/apis/fastapi/workflows/router.py`
- `api/oss/src/apis/fastapi/workflows/models.py`
- `api/oss/src/core/workflows/service.py`
- `api/entrypoints/routers.py`
- `api/oss/src/utils/env.py`

### Likely function/method targets

- `WorkflowsRouter.invoke_workflow`
- `WorkflowsRouter.inspect_workflow`
- `WorkflowsService.invoke_workflow`
- `WorkflowsService.inspect_workflow`

### Required code changes

- pass workflow request flags through without lossy translation
- expose richer inspect/retrieval truth where workflow DTOs are returned
- add canonical workflow catalog handlers and DTOs
- keep these methods as the central generic execution path used by domain wrappers
- classify runnable versus non-runnable targets before dispatch
- hand off runnable invoke requests toward the runtime `/services` surface instead of relying on long-running in-process execution in API as the target design
- use redirect for the API-to-services handoff and keep streaming/auth behavior correct
- make non-runnable custom invoke fail explicitly
- allow inspect to resolve from runtime services or persisted discovery truth depending on target kind
- define how workflow OpenAPI discovery is served for runnable versus non-runnable targets

## 5. Domain-level application and evaluator execution wrappers

### Files

- `api/oss/src/apis/fastapi/evaluators/router.py`
- `api/oss/src/apis/fastapi/evaluators/models.py`
- `api/oss/src/core/evaluators/service.py`
- `api/oss/src/apis/fastapi/applications/router.py`
- `api/oss/src/apis/fastapi/applications/models.py`
- `api/oss/src/core/applications/service.py`

### Likely function/method targets

- new router methods for:
  - `invoke_evaluator`
  - `inspect_evaluator`
  - `invoke_application`
  - `inspect_application`
- new service methods that delegate to workflow service counterparts

### Required code changes

- add thin wrapper endpoints
- resolve evaluator/application references into workflow references
- add filtered catalog endpoints that delegate to the canonical workflow catalog model
- preserve the same runnable/non-runnable dispatch behavior as generic workflow routes
- avoid duplicating runnable semantics that already exist in workflow service and SDK layers

## 6. Workflow/application/evaluator catalog refactor and schema-first creation

### Files

- `api/oss/src/apis/fastapi/workflows/models.py`
- `api/oss/src/apis/fastapi/workflows/router.py`
- `api/oss/src/apis/fastapi/evaluators/models.py`
- `api/oss/src/apis/fastapi/evaluators/router.py`
- `api/oss/src/resources/evaluators/evaluators.py`
- `api/oss/src/core/evaluators/utils.py`
- `api/oss/src/core/evaluators/service.py`
- any new application/workflow catalog files mirroring evaluator patterns

### Likely function/method targets

- `EvaluatorTemplate` and `EvaluatorTemplatesResponse`
- new workflow/application/evaluator catalog DTO classes
- `SimpleEvaluatorsRouter.list_evaluator_templates`
- `get_all_evaluators()`
- `build_evaluator_data()`
- evaluator creation/edit hydration paths in `EvaluatorsService`

### Required code changes

- add canonical workflow catalog DTOs and handlers
- make application/evaluator catalog handlers filtered views over workflow catalog entries
- replace mixed template DTOs with catalog-oriented DTOs
- define the simpler catalog DTO family rather than one mixed template shape:
  - catalog list response with `count` and `items`
  - catalog entry object with revision-like discovery fields: URI, optional precomputed URL, optional headers, categories, description, flags, and schemas
  - presets response with preset override bundles
- add separate preset accessors and endpoints
- add output schema support for custom code evaluators on parity with AI critique
- persist shared evaluator input schema explicitly
- support optional parameter schema
- keep `settings_template` as UI metadata only

### Expected handler / endpoint shape

- `GET /workflows/catalog/`
  - returns `count` plus `items`
- `GET /workflows/catalog/{entry_key}/presets/`
  - returns `count` plus preset `items`
  - each preset item is a reusable override bundle with `key`, `name`, `description`, `parameters`, optional `script`, optional `headers`, optional workflow fields such as flags, and optional other presettable workflow fields
- domain catalog routes for applications/evaluators
  - filtered over the same workflow catalog contracts
- normal workflow/application/evaluator create and edit handlers remain the write path
  - they may be populated from catalog data by clients, but there is no special catalog-write API

## 7. URI classification and persistence backfill

### Files

- `api/oss/src/core/workflows/service.py`
- evaluator utility and defaulting paths
- migration or data-hydration paths already using `build_evaluator_data()`
- `sdk/agenta/sdk/workflows/utils.py`

### Likely function/method targets

- URI parsing and classification helpers
- workflow fetch/query/revision assembly methods
- human evaluator default-data builders

### Required code changes

- backfill `agenta:builtin:human:v0` and `user:custom:{variant_slug}:v{N}` cases
- add computed classification fields
- align `user:custom` URI versioning with revision versioning where the backend defines the variant slug / revision version
- keep builtin URI key/version semantics tied to builtin handler identity and builtin version
- refresh builtin service URLs from URI on reads and writes
- refresh builtin input/output schemas from URI/inspect with caching
- avoid clobbering user-owned parameter schema during builtin refresh
- remove legacy `service` / `configuration` fields from workflow revision DTOs, API models, and generated SDK client types
- migrate evaluator builders, legacy adapters, and tests that still rely on those legacy fields
- preserve legacy compatibility fields during expand

## 8. Frontend schema-reading and invoke-request-flag changes

### Files

- `web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts`
- `web/packages/agenta-entities/src/legacyAppRevision/state/runnableSetup.ts`
- `web/packages/agenta-entities/src/runnable/bridge.ts`
- `web/packages/agenta-entities/src/runnable/utils.ts`
- evaluator catalog clients in:
  - `web/packages/agenta-entities/src/evaluator/api/api.ts`
  - `web/packages/agenta-entities/src/evaluator/state/store.ts`
  - `web/oss/src/services/evaluators/index.ts`
- playground state/rendering packages in `web/packages/agenta-playground*`

### Likely function/method targets

- schema parsing helpers that currently read `x-agenta.flags`
- atoms/selectors that compute `isChatVariant`
- invoke payload builders
- response rendering selectors
- evaluator template fetchers

### Required code changes

- switch primary flag source from legacy OpenAPI extensions to inspect or API responses
- add storage/selection for `can_verbose` and `is_verbose`
- send request `flags`
- render concise vs verbose chat outputs
- migrate evaluator template fetchers to new catalog endpoints

## 9. Passive incoming trace-context support in SDK runtime

### Files

- `sdk/agenta/sdk/decorators/routing.py`
- `sdk/agenta/sdk/decorators/running.py`
- tracing context helpers used by SDK invoke paths

### Likely function/method targets

- SDK invoke entrypoints
- routing entrypoints that accept incoming requests
- tracing-context initialization in execution path

### Required code changes

- accept incoming parent trace context when present at SDK routing/running boundaries
- preserve parent-child relationships for workflow-to-workflow execution
- do not add API-to-SDK propagation logic as part of this plan

## Suggested implementation order

1. types and request models
2. inspect/invoke semantics in SDK
3. route isolation, runtime `/services` surface, and per-workflow OpenAPI
4. API generic workflow dispatch updates
5. domain-level application/evaluator wrappers
6. catalog refactor and schema-first evaluator/application creation
7. frontend migration to new flag and request-flag sources
8. contract cleanup and legacy contraction

## Code-review focus at this layer

- no semantic duplication between API and SDK
- backwards compatibility during expand
- response-shaping semantics clearly defined
- persisted schema truth matches inspect truth
- catalog truth matches runtime truth
- frontend no longer depends on heuristics once the new source is available
