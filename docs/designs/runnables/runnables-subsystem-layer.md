# Runnables Plan Decomposition — Subsystem Layer

## Purpose

This document decomposes the runnable migration plan at the **subsystem layer**.

At this layer, the system is broken into interacting subsystems and boundaries. The focus is on:

- subsystem responsibilities
- interfaces between subsystems
- data in transit
- sync vs async behavior
- architectural tradeoffs

This is derived from [plan.md](./plan.md).

## Subsystems in scope

The runnable plan spans these main subsystems:

1. SDK runnable definition and execution subsystem
2. Services subsystem
3. Runtime HTTP routing subsystem
4. API runnable orchestration subsystem
5. Workflow persistence and classification subsystem
6. Evaluator/application catalog subsystem
7. Frontend runnable consumption subsystem
8. Tracing and observability subsystem

## 1. SDK runnable definition and execution subsystem

### Responsibility

Defines runnable identity, interface, configuration, handler registration, inspection, and programmatic invocation.

### Main boundary objects

- `WorkflowServiceRequest`
- `WorkflowServiceRequestData`
- `WorkflowServiceBatchResponse`
- `WorkflowServiceStreamResponse`
- `WorkflowFlags` as the static workflow flag type
- `WorkflowRequestFlags` as the per-invocation request flag type
- `WorkflowServiceRequest.flags: WorkflowRequestFlags`
- interface/configuration registry entries

### Key subsystem changes

- extend the workflow service-flag model with `can_verbose` and derived identity/capability separation
- add `WorkflowRequestFlags` with `stream`, `evaluate`, `chat`, `verbose`
- add an SDK invoke-time execution-location argument so SDK callers can choose local versus remote execution
- derive richer capabilities from handler metadata and explicit interface declarations
- ensure builtin and custom workflows converge on explicit schema contracts

### Important interface decision

This subsystem remains the source of runnable execution truth. API and frontend subsystems should consume its contracts rather than invent parallel heuristics.

## 2. Services subsystem

### Responsibility

Owns the runtime `/services` surface as the execution-facing service subsystem for runnable workflows.

### Current boundary

- partially exposed `/services/*` runtime URLs
- service-mounted runnable handlers
- limited builtin exposure

### Target boundary

- standardized `/services/{runnable_path}/*` runtime URLs
- all runnable builtins exposed through the services surface
- service-backed runtime discovery and execution for runnable targets

### Main boundary objects

- runtime service URLs under `/services`
- service-mounted runnable identities
- service-backed invoke/inspect/OpenAPI requests
- streaming HTTP responses
- runtime OpenAPI documents

### Architectural decision

Services is a subsystem in its own right. It is the runtime-facing service layer the API dispatches to for runnable targets.

### Main subsystem changes

- expose runnable builtins through the `/services` URL family
- expand the surface beyond the currently exposed chat/completion subset so all Agenta builtins are reachable
- converge on one clear URL shape for service-routed builtins and runtime custom handlers
- preserve `invoke`, `inspect`, and `openapi.json` coherence for any runnable that is actually mounted

## 3. Runtime HTTP routing subsystem

### Responsibility

Owns route composition and per-workflow HTTP namespace structure for the runtime service layer.

### Current boundary

- shared app registration
- `{path}/invoke`
- `{path}/inspect`

### Target boundary

- isolated sub-application per workflow
- `{path}/invoke`
- `{path}/inspect`
- `{path}/openapi.json`

### Main boundary objects

- routed workflow namespace paths
- HTTP invoke/inspect/OpenAPI handlers
- mounted sub-applications and routers

### Architectural decision

Per-workflow namespace isolation belongs here, not in the API subsystem. This subsystem owns runtime route composition and runtime discovery surface generation.

## 4. API runnable orchestration subsystem

### Responsibility

Receives authenticated API requests, resolves workflow references, classifies runnable versus non-runnable targets, dispatches runnable requests toward runtime services, and shapes API responses.

### Main interfaces

- workflows router and service
- applications router and service
- evaluators router and service
- runtime services URL selection and handoff

### Main boundary objects

- authenticated API invoke/inspect requests
- resolved workflow references and URIs
- `WorkflowRequestFlags`
- runnable versus non-runnable classification
- runtime services target URL or route identity
- API-shaped invoke/inspect/OpenAPI responses

### Key subsystem changes

- add domain-level execution/discovery routes
- keep workflows as the canonical execution/discovery family and map applications/evaluators as filtered wrappers
- pass workflow request flags through cleanly
- expose derived classification and flag truth in fetch/query/revision responses
- keep external evaluate/evaluator vocabulary separate from internal trace-level annotation terminology
- decide one runnable-service handoff strategy for invoke/inspect/openapi on runnable targets:
  - redirect
  - gateway/proxy
  - or another explicit dispatch pattern
- make non-runnable custom targets fail invoke while still supporting inspect from persisted discovery truth
- keep open the possibility that inspect/OpenAPI for runnable targets come from services, while non-runnable inspect/OpenAPI are synthesized from API-side stored truth

### Boundary rule

The API subsystem should not own runnable semantics independently from the SDK subsystem. It should translate, authorize, filter by domain, classify runnable versus non-runnable, and dispatch.

### Dispatch rule

- if the target is runnable and has a reachable engine, API invoke should hand off to the runtime `/services` surface
- if the target is not runnable, API invoke should fail explicitly rather than pretending the API can execute it
- inspect should continue to work for both runnable and non-runnable targets
- OpenAPI discovery may need two backing modes:
  - runtime-backed for runnable targets
  - persisted-schema-backed for non-runnable targets

## 5. Workflow persistence and classification subsystem

### Responsibility

Stores artifacts, variants, revisions, revision data, and derived or persisted classification inputs.

### Main boundary objects

- workflow artifact / variant / revision DTOs
- revision `data`
- URIs
- workflow service flags persisted or derivable from revision truth
- persisted schemas

### Key subsystem changes

- backfill URIs for human evaluators
- align URI key/version with variant/revision model
- persist richer revision schemas
- derive and refresh builtin service URLs from URI on reads and writes
- derive and refresh builtin input/output schemas from URI or inspect on reads and writes, with caching
- treat parameter schema more carefully than input/output schema because it may carry user-owned truth
- make derived classification available without requiring live re-inspection

### Architectural decision

This subsystem is where long-lived runnable truth must live:

- `uri`
- inspect-compatible interface data
- persisted schemas
- enough flag/classification material to avoid heuristic reconstruction
- enough stored discovery truth for inspect/OpenAPI on non-runnable targets

## 6. Evaluator/application catalog subsystem

### Responsibility

Owns the predefined runnable catalog for applications and evaluators.

### Current state

- evaluator templates are static resource data exposed through one mixed endpoint
- applications do not have a symmetric catalog surface

### Target state

- shared workflow catalog primitives
- canonical workflow catalog routes
- domain-specific catalog routes for evaluators and applications as filtered workflow catalog views
- one catalog entry shape that already includes schemas
- separate preset data as reusable override bundles

### Boundary objects

- catalog list response
- catalog entry object with revision-like discovery fields
  - `uri`, optional precomputed `url`, optional `headers`, schemas, flags, and catalog metadata
- preset list response
- preset object
  - `parameters`, optional `script`, optional `headers`, and other presettable workflow fields

### Architectural decision

Catalog is a subsystem, not just a helper file. It becomes a reusable source of predefined runnable truth for:

- workflow-level discovery and creation
- API creation flows
- frontend selection flows
- SDK and inspect coherence

## 7. Frontend runnable consumption subsystem

### Responsibility

Reads runnable definitions, configures invocation mode, and renders responses.

### Current boundary

- legacy schema parsing
- legacy `x-agenta.flags`
- no command transport

### Target boundary

- inspect-driven or query/revision-driven runnable truth
- workflow-request-flag-capable invoke transport
- rendering support for:
  - stream vs batch
  - chat vs completion
  - verbose vs concise chat payloads

### Architectural decision

The frontend subsystem should consume declared runnable truth and stop deriving execution semantics from legacy schema heuristics.

## 8. Tracing and observability subsystem

### Responsibility

Carries telemetry across API and SDK execution boundaries.

### Main interface

- incoming parent trace context, when present
- SDK tracing context
- runtime response headers / trace IDs

### Key subsystem changes

- allow SDK routing/running to accept incoming parent trace context
- preserve parent-child relationships for workflow-to-workflow execution
- do not require API orchestration to originate or forward trace context in this plan

## Main subsystem interfaces

| From | To | Interface | Object(s) in transit |
|---|---|---|---|
| Frontend | API orchestration | invoke / inspect / query / retrieve / catalog | JSON request/response payloads |
| API orchestration | Services | runnable handoff for invoke / inspect / openapi | `WorkflowServiceRequest`, `WorkflowRequestFlags`, target service URL or runnable path |
| Services | Runtime HTTP routing | mounted runtime execution and discovery routes | invoke/inspect/OpenAPI handlers, mounted sub-applications |
| API orchestration | Persistence | artifact / variant / revision CRUD and retrieval | workflow DTOs and revision data |
| Catalog | API orchestration | workflow catalog and filtered domain catalog views | catalog DTOs and filters |
| SDK execution | Services | executable runnable semantics exposed to runtime services | invoke/inspect/OpenAPI capabilities |
## Transport and execution properties

- most interactions here are synchronous request/response
- inspect and catalog are synchronous discovery calls
- invoke may return batch or stream
- verbose vs concise response shaping occurs in the invoke path
- no new async worker topology is required by the current plan
- redirect versus gateway/proxy remains an open transport tradeoff at the API-to-services boundary

## Subsystem-layer design decisions implied by the plan

1. Execution truth lives in the SDK execution subsystem.
2. Services is a first-class runtime subsystem.
3. Runtime route isolation lives in the SDK routing subsystem.
4. API orchestration becomes a control plane and domain wrappers stay filtered over workflow truth.
5. Persisted runnable truth lives in the workflow persistence subsystem.
6. Predefined runnable truth is elevated into a real catalog subsystem rooted in workflows.
7. Frontend semantics must consume subsystem-declared truth, not infer it.
8. Passive incoming trace-context support is a first-class interface inside SDK routing/running.
9. Non-runnable custom entries are inspectable but not invocable.

## Main risks at this layer

- API wrapper semantics drifting from SDK semantics even though API reuses SDK logic
- service handoff semantics regressing back into API-owned long-running execution
- service URL shape drifting across builtins and custom runtimes instead of being canonicalized from URI
- catalog discovery metadata drifting from inspect/OpenAPI discovery truth
- builtin input/output schemas in persistence drifting from runtime truth instead of being refreshed from URI/inspect with cache
- parameter schema refresh accidentally overwriting user-owned parameter truth
- persisted non-runnable discovery truth drifting from the stored revision/catalog source that defines it
- frontend continuing to depend on legacy OpenAPI heuristics instead of new inspect/OpenAPI contracts
- route isolation work accidentally remaining partial

## Validation focus at this layer

- subsystem interface consistency
- transport object completeness
- correct placement of responsibilities
- absence of duplicate semantic sources of truth
- observability continuity across subsystem boundaries
