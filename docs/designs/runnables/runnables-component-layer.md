# Runnables Plan Decomposition — Component Layer

## Purpose

This document decomposes the runnable migration plan at the **component layer**.

At this layer, the focus is on concrete modules, domain types, services, routers, ports, adapters, and ownership boundaries. This is still design, but it is close to code shape.

This document is derived from [plan.md](./plan.md).

## Component groups

The plan decomposes into these component groups:

1. workflow model components
2. SDK execution components
3. SDK routing components
4. API workflow orchestration components
5. API evaluator/application catalog components
6. persistence and classification components
7. frontend runnable-state components

## 1. Workflow model components

### Main components

- `sdk/agenta/sdk/models/workflows.py`
- DTO aliases for workflow, application, evaluator request/response types

### Responsibilities

- define workflow service flags for identity and capability truth
- define request/response envelopes
- define inspect-compatible interface/configuration types
- carry a dedicated `WorkflowRequestFlags` type on the request model

### Required design changes

- extend `WorkflowFlags` with new capability and identity fields needed by the plan
- add a new `WorkflowRequestFlags` type for per-invocation behavior
- keep `WorkflowFlags` for static workflow identity/capability truth only
- align capability and request-flag naming to the evaluator domain (`can_evaluate`, `flags.evaluate`) while leaving trace internals free to keep annotation terminology
- define `WorkflowServiceRequest.flags` as `WorkflowRequestFlags` rather than a generic dict or overloaded `WorkflowFlags`
- ensure application/evaluator typed aliases stay aligned with workflow base types
- preserve backward compatibility for existing request payloads during expand

## 2. SDK execution components

### Main components

- `sdk/agenta/sdk/decorators/running.py`
- `sdk/agenta/sdk/middlewares/running/normalizer.py`
- `sdk/agenta/sdk/middlewares/running/resolver.py`
- `sdk/agenta/sdk/workflows/utils.py`

### Responsibilities

- register handlers and interface/configuration metadata
- inspect workflows
- invoke workflows
- normalize request shapes into handler kwargs
- resolve configuration and secrets

### Required design changes

- compute derived flags during inspect
- accept and honor request flags during invoke
- add SDK-side handling for `flags.remote` as the local versus remote forwarding selector
- define response shaping for concise vs verbose chat output
- keep stream aggregation and evaluate behavior connected to declared capabilities
- improve custom-workflow schema parity at registration time

## 3. SDK routing components

### Main components

- `sdk/agenta/sdk/decorators/routing.py`
- legacy comparison point: `sdk/agenta/sdk/decorators/serving.py`

### Responsibilities

- expose runtime invoke/inspect endpoints
- negotiate streaming transport
- produce runtime HTTP responses
- own the route namespace shape

### Required design changes

- isolate each workflow into its own namespace
- keep `/inspect` as the route-owned runtime discovery surface
- expose the runtime `/services` surface for all runnable builtins, not just the currently narrow subset
- review and standardize the service URL shape used by API handoff and direct runtime access
- preserve legacy path coexistence during expand

## 4. API workflow orchestration components

### Main components

- `api/oss/src/apis/fastapi/workflows/router.py`
- `api/oss/src/core/workflows/service.py`
- `api/oss/src/apis/fastapi/evaluators/router.py`
- `api/oss/src/core/evaluators/service.py`
- application router/service counterparts

### Responsibilities

- authorize requests
- parse API payloads
- resolve workflow references
- classify runnable versus non-runnable targets
- dispatch runnable invoke/inspect requests toward runtime services
- expose domain-specific API surfaces

### Required design changes

- keep runtime execution/discovery off the application and evaluator API router families
- keep workflow-facing runtime calls as control-plane behavior rather than first-class domain routes
- add workflow-level catalog routes and filtered catalog peers for applications/evaluators
- expose derived classification in retrieval/query responses
- route runnable targets toward the runtime `/services` surface instead of treating API as the execution container
- make non-runnable custom targets fail invoke while still allowing inspect
- use redirect for API handoff and keep streaming/auth behavior consistent
- keep inspect available for non-runnable targets from persisted discovery truth
- avoid turning API orchestration into an API-to-SDK trace propagation layer in this checkpoint
- maintain thin-wrapper behavior rather than reimplementing runnable semantics in domain services

## 5. API evaluator/application catalog components

### Main components

- `api/oss/src/apis/fastapi/workflows/models.py`
- `api/oss/src/apis/fastapi/workflows/router.py`
- `api/oss/src/apis/fastapi/evaluators/models.py`
- `api/oss/src/apis/fastapi/evaluators/router.py`
- `api/oss/src/resources/evaluators/evaluators.py`
- `api/oss/src/core/evaluators/utils.py`
- future workflow/application catalog peers

### Responsibilities

- expose the canonical predefined workflow catalog
- expose predefined runnable catalogs
- store or generate preset definitions

### Required design changes

- add canonical workflow catalog DTOs and routes
- expose application and evaluator catalog routes as filtered workflow views
- replace `EvaluatorTemplate` as the mixed contract with one catalog entry shape plus preset bundles
- make the catalog shape explicit:
  - list response with `count` and `items`
  - entry object with revision-like discovery fields: URI, optional precomputed URL, optional headers, categories, description, flags, and schemas
  - presets response with preset override bundles
- give custom code evaluators the same output-schema definition ability as AI critique evaluators
- declare shared evaluator input schema explicitly
- support optional parameter schema

### Target catalog shape at the component boundary

The catalog should stop being one mixed DTO and instead become a simpler read-only contract family:

- catalog list response
  - `count`
  - `items`
- catalog entry object
  - `uri`
  - optional `key` as a compatibility lookup alias
  - optional precomputed `url` for builtins
  - `name`
  - `description`
  - `categories`
  - optional `headers`
  - workflow flags
  - `schemas.inputs`
  - `schemas.parameters`
  - `schemas.outputs`
- presets response
  - `count`
  - `items`
- preset object
  - `key`
  - `name`
  - `description`
  - `parameters`
  - optional `script`
  - optional `headers`
  - optional workflow fields such as flags when relevant
  - optional preset-specific schema material when relevant
  - optional other presettable workflow fields when relevant

Important component rule:

- the catalog is read-only discovery data
- catalog entries are discovery-first and stay close to `WorkflowRevisionData` fields that define runnable identity and interface truth
- preset bundles are override-first and hold mutable configuration material such as parameters or script
- there is no separate `create from catalog` API contract
- clients still create workflows/applications/evaluators through the normal create/edit contracts, optionally using catalog entries and presets as source data

## 6. Persistence and classification components

### Main components

- workflow artifact / variant / revision DTOs and DB-facing mapping paths
- service logic that backfills or derives URI-based classification
- evaluator default/hydration utilities

### Responsibilities

- persist URI and revision data
- persist inspect-compatible schemas
- support derived `is_custom`, `is_runnable`, `is_builtin`
- remove legacy `service` and `configuration` fields from revision data and compatibility surfaces
- preserve legacy compatibility during expand

### Required design changes

- backfill URIs for human evaluators
- align URI key/version with variant/revision model
- update builtin service URLs from URI on reads and writes
- refresh builtin input/output schemas from URI/inspect with caching
- avoid blindly overwriting parameter schema when it carries user-owned truth
- persist full schemas when normal creation flows are populated from catalog data
- audit and migrate code paths still reading or writing `data.service` / `data.configuration`
- stop depending on partial `settings_template` truth for catalog/schema truth

## 7. Frontend runnable-state components

### Main components

- `web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts`
- `web/packages/agenta-entities/src/legacyAppRevision/state/*`
- `web/packages/agenta-entities/src/runnable/*`
- `web/packages/agenta-playground*/*`
- evaluator template consumers in `web/oss/src` and `web/packages/agenta-entities/src/evaluator/*`

### Responsibilities

- read runnable schemas and flags
- build invoke payloads
- render chat/completion modes
- render evaluator catalog choices
- render execution outputs

### Required design changes

- stop reading legacy `x-agenta.flags` as the primary truth source
- stop using chat heuristics where explicit flags are available
- send request flags
- render verbose and concise chat outputs distinctly
- move evaluator creation flows to catalog-first contracts

## Component-level ownership rules

1. Model components own the type contracts.
2. SDK execution components own runnable semantics.
3. SDK routing components own runtime HTTP namespace structure.
4. API orchestration components own auth, reference resolution, runnable classification, and dispatch.
5. Catalog components own predefined runnable truth, rooted in workflows and filtered into domain views.
6. Persistence components own long-lived runnable state.
7. Frontend state components own consumption, not derivation, of runnable truth.

## Component flow sequences

This section makes the intermediate contracts explicit for representative entry points. Each sequence shows:

- which components are traversed
- what contract moves between them
- the current path
- the target path
- the migration gap

### Sequence A: API `POST /workflows/invoke`

Entry point:
- workflows router

Current path:
- `WorkflowsRouter.invoke_workflow`
- `WorkflowsService.invoke_workflow`
- SDK execution in `running.py`
- batch or stream response back through the API router

Intermediate contracts:
- router -> service: API-shaped `WorkflowServiceRequest`
- service -> SDK execution: `WorkflowServiceRequest` plus auth/credentials
- SDK execution -> router: workflow batch or stream response

Target path:
- `WorkflowsRouter.invoke_workflow`
- `WorkflowsService.invoke_workflow`
- runnable classification and service URL resolution
- handoff to `Services` subsystem
- `Runtime HTTP routing` mounted handler
- SDK execution
- response returns through service handoff path

Gap:
- today the generic API path still executes in-process
- target path must make the service handoff explicit
- non-runnable targets must fail at the orchestration layer before execution handoff

### Sequence B: API `POST /workflows/inspect` and OpenAPI discovery

Entry point:
- workflows router

Current path:
- `WorkflowsRouter.inspect_workflow`
- `WorkflowsService.inspect_workflow`
- SDK execution inspect path
- inspect response returned directly

Target path:
- router/service resolve workflow identity and classify runnable versus non-runnable
- runnable targets:
  - hand off to `Services`
  - `Runtime HTTP routing`
  - SDK inspect or runtime-owned `openapi.json`
- non-runnable targets:
  - resolve from persistence and catalog-backed discovery truth
  - return inspect/OpenAPI without pretending there is an executable runtime

Intermediate contracts:
- router -> service: `WorkflowServiceRequest`
- service -> services or persistence: URI/reference identity plus discovery mode
- persistence -> router: persisted inspect/OpenAPI-compatible truth
- services -> router: runtime inspect/OpenAPI document

Gap:
- current inspect path is still described mostly as direct SDK delegation
- the discovery split between runnable and non-runnable targets needs to be explicit at the component boundary
- the source of `openapi.json` must be cleanly separated for runtime-backed versus persisted-backed cases

### Sequence C: SDK programmatic invoke, local mode

Entry point:
- `invoke_workflow` / `invoke_application` / `invoke_evaluator`

Current path:
- SDK caller constructs `WorkflowServiceRequest`
- SDK invoke path executes locally

Target path:
- SDK caller constructs `WorkflowServiceRequest`
- SDK caller leaves `flags.remote` absent or false
- SDK execution path runs locally when requested

Intermediate contracts:
- caller -> SDK invoke function: `WorkflowServiceRequest`, `WorkflowRequestFlags`
- SDK invoke function -> execution stack: normalized request plus resolved configuration/secrets

Gap:
- request flags are being clarified
- `flags.remote` forwarding behavior still needs to be wired and normalized

### Sequence D: SDK programmatic invoke, remote mode

Entry point:
- `invoke_workflow` / `invoke_application` / `invoke_evaluator`

Target path:
- SDK caller constructs `WorkflowServiceRequest`
- SDK caller sets `flags.remote=true`
- SDK client resolves configured API/services base URL
- SDK client clears or forces `flags.remote=false` on the forwarded request
- request goes through API control plane
- API dispatches to `Services`
- runtime route reaches SDK execution on the remote side

Intermediate contracts:
- caller -> SDK invoke function: `WorkflowServiceRequest`
- SDK invoke function -> remote transport: serialized request with `flags.remote` cleared plus auth/base URL context
- API -> Services: runnable handoff contract

Gap:
- remote SDK execution is not yet explicit in the current component contract
- the boundary between user-provided `flags.remote` and forwarded `flags.remote=false` must stay clean to avoid recursion

### Sequence E: Builtin persistence refresh on read/write

Entry point:
- workflow create/edit/read/query/retrieve paths

Target path:
- persistence/classification components read URI
- builtin URI maps to canonical service URL
- builtin URI maps to canonical input/output schema source
- cached refresh updates persisted builtin URL and input/output schema
- parameter schema remains guarded from blind overwrite

Intermediate contracts:
- persistence read/write path -> URI classification helper: URI
- URI helper -> persistence mapping: canonical service URL and builtin contract identity
- inspect/schema source -> persistence mapping: refreshed input/output schema

Gap:
- today builtins can drift from the runtime truth if persisted URL/schema data is not refreshed
- target behavior should keep builtin URL and input/output schema synchronized from URI/inspect with cache
- parameter schema should not be treated the same way as builtin input/output schema

### Sequence F: Frontend discovery and invoke

Entry point:
- frontend runnable-state components

Current path:
- frontend reads legacy OpenAPI extensions and heuristics
- frontend builds invoke payloads with incomplete flag support

Target path:
- frontend reads inspect/OpenAPI/API discovery truth
- frontend stores `WorkflowFlags`, `WorkflowRequestFlags`, and classification separately
- frontend builds invoke payloads with explicit request flags
- frontend handles stream/chat/evaluate/verbose modes from declared contracts

Intermediate contracts:
- frontend -> API discovery: inspect/retrieve/catalog requests
- API -> frontend: inspect truth, OpenAPI truth, catalog truth
- frontend -> API invoke: `WorkflowServiceRequest` with `WorkflowRequestFlags`

Gap:
- current frontend components still depend on legacy `x-agenta.flags`
- the new component contract must make the discovery source and invoke source explicit and non-heuristic

### Sequence G: Catalog entries and presets

Entry point:
- workflow/application/evaluator catalog routes

Current path:
- mixed template payload from evaluator resources
- frontend or service consumers unpack catalog identity, presets, UI hints, and runtime schema from one shape

Target path:
- list route returns catalog entries with URI, categories, flags, and schemas
- presets route returns override bundles that can include parameters and other presettable workflow fields
- clients continue to use existing create/edit contracts when they want to instantiate a workflow/application/evaluator from catalog data

Intermediate contracts:
- router -> catalog service: domain filter plus catalog lookup key
- catalog service -> resource/provider layer: canonical workflow catalog entry lookup
- catalog service -> caller: entry and preset response payloads

Gap:
- the catalog shape is still under-specified in current docs
- entry shape and preset shape still need clean separation
- catalog read contracts must stay separate from the normal create/edit workflow contracts

## Suggested component decomposition by plan checkpoint

### Checkpoint slice A: classification and flags

- workflow model components
- SDK execution components
- persistence/classification components
- frontend runnable-state components

### Checkpoint slice B: request flags and response shaping

- workflow model components
- SDK execution components
- API workflow orchestration components
- frontend runnable-state components

### Checkpoint slice C: route isolation and runtime OpenAPI

- SDK routing components
- SDK execution components

### Checkpoint slice D: catalogs and schema-first evaluator/application creation

- API evaluator/application catalog components
- persistence/classification components
- frontend runnable-state components

### Checkpoint slice E: domain wrappers and observability

- API workflow orchestration components
- SDK execution components
- tracing/telemetry-adjacent components

## Component-layer validation focus

- DTO completeness
- clear port ownership
- no duplicate semantic logic across components
- persistence/runtime/schema consistency
- frontend consumption aligned to explicit component-owned contracts
