# Runnables Plan Decomposition — System Layer

## Purpose

This document decomposes the runnable migration plan at the **system layer**.

At this layer, the system is treated as a black box and the focus is on:

- external system interfaces
- interface contracts
- point-like interaction behaviors
- black-box validation dimensions

This intentionally skips product framing and user-value decomposition. The source plan is [plan.md](./plan.md).

## System interfaces in scope

The runnable plan affects these external system interfaces:

1. API interface
2. SDK programmatic interface
3. Runtime HTTP workflow interface
4. Frontend-to-API runnable consumption interface
5. Observability interface

## Common identification modes

Across the system interfaces, runnable identity can appear in a few distinct ways:

1. Stored reference mode
   - the caller identifies an already-persisted backend entity
   - identity is carried by artifact / variant / revision references
   - typical examples:
     - `workflow_ref`
     - `workflow_variant_ref`
     - `workflow_revision_ref`
     - application / evaluator reference equivalents

2. URI mode
   - the caller identifies the runnable by runtime identity rather than backend storage identity
   - identity is carried by `interface.uri`
   - typical example:
     - `agenta:builtin:echo:v0`

3. Inline revision mode
   - the caller provides the revision-like payload directly in the request body
   - this is the most stateless form because the body carries the material to inspect or resolve
   - typical example:
     - `workflow_revision` embedded directly in a resolve request

4. Runtime namespace path mode
   - the runnable is identified by the routed HTTP namespace itself
   - the path selects the runnable; the body only supplies invocation inputs, parameters, or overrides
   - typical example:
     - `/summarize/invoke`

These modes are not interchangeable everywhere:

- generic API and SDK interfaces primarily use stored reference mode, URI mode, or inline revision mode
- runtime HTTP primarily uses namespace path mode
- retrieve is primarily stored-reference based
- resolve can be stored-reference based or inline-body based

## 1. API interface

### Current contract family

The API already exposes workflow CRUD and workflow execution surfaces:

- `/workflows/invoke`
- `/workflows/inspect`
- per-runnable `{path}/openapi.json` is missing from the new family and must be added beside `inspect`
- `/workflows/revisions/*`
- `/workflows/catalog/*` is the missing canonical catalog family
- `/evaluators/*`
- `/applications/*`
- `/preview/simple/evaluators/templates`

### Target system-level changes

The plan expands the API contract with one canonical workflow contract family and filtered domain projections:

- canonical workflow execution and discovery contracts
  - `POST /workflows/invoke`
  - `POST /workflows/inspect`
  - per-runnable `{path}/openapi.json`
- domain-level execution contracts as filtered workflow projections
  - `POST /applications/invoke`
  - `POST /applications/inspect`
  - `POST /evaluators/invoke`
  - `POST /evaluators/inspect`
- catalog contracts for predefined runnables
  - `/workflows/catalog/*`
  - `/applications/catalog/*`
  - `/evaluators/catalog/*`
- richer inspect and retrieval payloads carrying derived runnable discovery truth
  - URI-derived classification
  - schema-derived chat/message affordances
  - optional materialized revision metadata derived from URI, schemas, registry truth, and trace heuristics
- richer invoke payloads and runtime routes using HTTP content negotiation
  - `Accept: application/json`
  - `Accept: text/event-stream`
  - `Accept: application/x-ndjson`
  - `Accept: application/jsonl`

### System-level contract decisions

- Checkpoint 1 is mixed expand/contract, not fully backward compatible.
- Legacy endpoints may still exist during migration, but intentional breaks must be covered by migration work or explicit no-migration decisions.
- The workflow family becomes the canonical contract family for execution, discovery, and catalog.
- Applications and evaluators expose the same surfaces as filtered projections over workflows.
- Catalog responses must stop mixing catalog entry discovery, preset bundles, and UI-only template metadata into one shape.
- Catalog entry fields should stay close to persisted `WorkflowRevisionData` discovery truth:
  - base entry data: `uri`, optional precomputed `url`, optional `headers`, `schemas`, derived/materialized revision metadata, and catalog metadata such as `name`, `description`, `categories`
  - preset data: reusable override material such as `parameters`, optional `script`, optional `headers`, and other presettable workflow fields
- Legacy `WorkflowRevisionData.service` and `WorkflowRevisionData.configuration` should be treated as removal targets, not part of the target runnable contract.
- Persisted revision/query data is the primary discovery truth when it already exists locally.
- `/inspect` is the runtime discovery fallback when the caller has no local revision truth yet or explicitly needs live discovery.
- The external runnable contract no longer treats identity flags, capability flags, or command flags as the primary authored interface.
- Streaming and batching are selected through HTTP content negotiation rather than request flags.
- If a caller asks for a response media type the runnable cannot produce, the request fails explicitly.
- If a caller needs batched behavior on top of a streaming response, batching is a caller-side utility concern.
- `is_custom` and `is_feedback` are derived from URI families.
- chat behavior is derived from schemas, primarily through explicit `x-` schema parameters marking `message` / `messages` fields.
- evaluator identity and evaluator capability are derived differently:
  - builtins derive from URI family / registry truth
  - custom families may still materialize user-authored evaluator metadata
- workflow revision flags remain only as materialized metadata:
  - never the primary authored execution/discovery contract
  - always derivable from some other source of truth or explicitly user-owned custom metadata
- lower-level tracing still uses `annotation` vs `invocation`; trace ingestion should infer `annotation` from the presence of trace links.

### API execution dispatch decision

At subsystem boundaries, the API should be treated as a control plane, not the long-running execution engine:

- runnable builtins should be reachable through the runtime `/services` surface rather than executed inside the API process as the target architecture
- runnable custom workflows only invoke if there is a reachable engine behind them
- non-runnable custom workflows remain discoverable through inspect-style responses, but invoke must fail
- `openapi.json` must come from the same provenance as `inspect` for a given target
- API-to-services handoff for runnable targets uses redirect; the redirect contract must preserve auth, streaming, and runnable identity semantics
- API-originated runnable invoke requests should preserve the negotiated media-type semantics when redirecting to `/services`

### API interface I/O

At the system layer, the main API request/response shapes are:

| Operation family | Request carries identity through | Request shape | Response shape | Stateful vs stateless |
|---|---|---|---|---|
| `POST /workflows/invoke` | request body + HTTP headers | `WorkflowServiceRequest` with `interface.uri`, `references`, `configuration`, and `data`; response mode selected by `Accept` | batch or streaming workflow service response, or explicit non-runnable / unsupported-media-type failure | can be reference-driven or URI-driven |
| `POST /workflows/inspect` | request body | `WorkflowServiceRequest` with enough identity/configuration to inspect | inspected request enriched with derived discovery truth and materialized revision metadata | can be reference-driven or URI-driven |
| `POST /workflows/revisions/retrieve` | request body | reference triplet plus optional `resolve` flag | revision envelope, optionally with `resolution_info` | primarily stateful |
| `POST /workflows/revisions/resolve` | request body | either references to a stored revision or inline `workflow_revision` plus resolve options | resolved revision plus `resolution_info` | supports both stateful and inline stateless resolution |
| `/workflows/catalog/*` | path plus optional query/body filters | catalog lookup / list / preset selection | catalog entries / presets / metadata | neither stateful revision lookup nor raw runtime inspect; it is predefined runnable discovery |
| application/evaluator invoke/inspect | request body | same family of request shapes, filtered to application/evaluator identity | same response families as workflows | filtered wrappers over workflow I/O |

Important API contract clarification:

- `POST /workflows/invoke` and `POST /workflows/inspect` do not identify the runnable in the URL path
- the path selects the contract family (`workflows`, `applications`, `evaluators`)
- the runnable identity itself travels in the request body
- project / tenant scope is orthogonal; it scopes lookup and authorization but is not itself the runnable identifier
- that identity may come from:
  - stored references
  - `interface.uri`
  - both, during migration or mixed cases
- for invoke specifically:
  - runnable targets are candidates for API handoff to `/services`
  - non-runnable targets are inspectable but not invocable

### API examples

1. Stored revision retrieval with optional resolve:

```json
POST /workflows/revisions/retrieve
{
  "workflow_revision_ref": {"id": "<revision-id>"},
  "resolve": true
}
```

2. Generic inspect using URI-driven identity:

```json
POST /workflows/inspect
{
  "interface": {"uri": "agenta:builtin:echo:v0"},
  "configuration": {"parameters": {"prompt": "hello"}}
}
```

3. Generic invoke using reference-driven identity plus HTTP content negotiation:

```json
POST /workflows/invoke
{
  "references": {"workflow_revision": {"id": "<revision-id>"}},
  "data": {"inputs": {"text": "hello"}}
}
```

4. Inline stateless resolve:

```json
POST /workflows/revisions/resolve
{
  "workflow_revision": {
    "data": {"parameters": {"prompt": "..."}, "references": {}}
  },
  "max_depth": 10
}
```

5. Domain-filtered inspect:

```json
POST /applications/inspect
{
  "references": {"application_revision": {"id": "<revision-id>"}}
}
```

This stays the same inspect family as workflows, but the domain route constrains the interpretation to application identity.

## 2. SDK programmatic interface

### Current contract family

The SDK exposes programmatic workflow execution and inspection:

- `invoke_workflow`
- `inspect_workflow`
- no programmatic OpenAPI getter yet
- `invoke_application`
- `inspect_application`
- `invoke_evaluator`
- `inspect_evaluator`

### Target system-level changes

- Programmatic invocation accepts explicit response-mode / media-type selection instead of authored command flags.
- Programmatic inspection exposes derived classification and materialized revision metadata.
- Programmatic discovery also exposes OpenAPI getters:
  - `get_workflow_openapi`
  - `get_application_openapi`
  - `get_evaluator_openapi`
- Builtins and custom workflows converge on the same interface contract model.
- Evaluator and application creation from catalogs produces persisted schemas that the SDK can inspect consistently.

### System-level invariants

- The same workflow identity should inspect the same way whether reached through generic workflow APIs or domain APIs.
- The same workflow identity should produce the same OpenAPI document whether fetched through SDK getters or HTTP runtime routes.
- The same workflow identity should resolve to the same OpenAPI discovery surface whether reached through a workflow path or a filtered domain path.
- The same runnable should advertise the same derived metadata and schemas through SDK inspect and HTTP inspect.
- Workflow catalog entries are the source of truth; application and evaluator catalogs are filtered views over that same source.
- media-type negotiation must mean the same thing across SDK and HTTP surfaces.
- Trace-level `annotation` and `invocation` remain lower-level execution concepts, separate from the external application/evaluator contract.

### SDK programmatic I/O

At the system layer, the SDK programmatic interface is intentionally close to the runtime contract:

| SDK call family | Input shape | Output shape | Identity mode |
|---|---|---|---|
| `invoke_*` | `WorkflowServiceRequest` plus explicit media-type / response-mode selection | batch or stream workflow service response | references, URI, or mixed |
| `inspect_*` | `WorkflowServiceRequest` | inspected `WorkflowServiceRequest` | references, URI, or mixed |

The main contract decision here is:

- SDK programmatic discovery should not invent a second identification system
- programmatic discovery should go through `inspect_*`
- invoke should expose the same media-type choices as runtime HTTP and fail when the runnable cannot satisfy the requested response mode

### SDK examples

1. Inspect a builtin by URI:

```python
await inspect_workflow(
    WorkflowServiceRequest(
        interface={"uri": "agenta:builtin:echo:v0"},
    )
)
```

2. Invoke an evaluator by stored reference:

```python
await invoke_evaluator(
    WorkflowServiceRequest(
        references={"evaluator_revision": {"id": "<revision-id>"}},
        data={"inputs": {...}},
    )
)
```

3. Invoke a builtin locally from the SDK process versus remotely through the API/services path:

```python
await invoke_workflow(
    WorkflowServiceRequest(
        interface={"uri": "agenta:builtin:echo:v0"},
        data={"inputs": {"text": "hello"}},
    ),
    execution_mode="local",  # default still to be confirmed
)
```

## 3. Runtime HTTP workflow interface

### Current contract family

The runtime interface currently mixes:

- legacy `/run`, `/test`, `/generate`, `/openapi.json`
- new `{path}/invoke`, `{path}/inspect`

### Target system-level changes

- every workflow namespace exposes:
  - `{path}/invoke`
  - `{path}/inspect`
- the runtime contract carries derived discovery truth and supported response media types
- the runtime contract uses HTTP headers rather than request flags for stream/batch selection

### System-level invariants

- one workflow namespace must not leak other workflow contracts into its inspect response
- inspect must agree with persisted revision truth when both describe the same runnable
- response media-type support is part of the runtime contract
- callers are responsible for client-side aggregation/batching when they want batched semantics on top of a streaming-capable runnable

### Runtime HTTP I/O

The runtime HTTP interface differs from the generic API and SDK interfaces because identity is path-bound:

| Runtime route | Runnable identity lives in | Request shape | Response shape |
|---|---|---|---|
| `{path}/invoke` | path namespace | runtime invoke body with data/config plus HTTP content negotiation | batch JSON or stream transport |
| `{path}/inspect` | path namespace | no separate runnable identifier beyond the path | inspected runnable contract |

Important runtime clarification:

- at runtime HTTP level, the path itself identifies the runnable
- this is different from `POST /workflows/invoke`, where the path only selects the contract family
- query parameters should not be the primary runnable identifier in the new runtime family
- the invoke body is for inputs, parameters, secrets, and overrides, not for choosing which runnable path was meant

### Runtime HTTP examples

1. Path-bound invoke:

```http
POST /summarize/invoke
Content-Type: application/json

{
  "data": {"inputs": {"text": "hello"}}
}
```

2. Path-bound inspect:

```http
GET /summarize/inspect
```

3. Path-bound OpenAPI:

```http
GET /summarize/openapi.json
```

## 4. Frontend-to-API runnable consumption interface

This is still a system interface because the frontend consumes the system externally through API contracts.

### Current contract family

- frontend reads legacy `x-agenta.flags`
- frontend uses heuristic chat detection
- playground does not yet negotiate response media types explicitly

### Target system-level changes

- frontend reads runnable truth from inspect or API revision/query responses
- frontend renders based on derived metadata, URI families, schema heuristics, and OpenAPI-derived affordances
- frontend sends the right `Accept` header for the response type it wants
- frontend supports:
  - JSON vs SSE vs NDJSON/JSONL response handling
  - chat/message-aware rolling conversation behavior derived from schemas
  - explicit failure handling when the requested media type is unsupported
  - client-side batching / aggregation utilities where needed

### System-level invariant

The frontend must be able to operate from the new system contracts without relying on legacy OpenAPI extensions.

### Frontend-to-API I/O

From the system perspective, the frontend participates in two main request/response loops:

| Frontend activity | API request family | Identity mode | Response shape |
|---|---|---|---|
| discovery | inspect / retrieve / resolve / catalog | stored refs, URI, or inline resolve body depending on the operation | runnable truth, revision truth, or catalog truth |
| execution | invoke | stored refs or URI in request body | batch or stream execution response |

The main system-layer distinction is:

- discovery may be stateful or stateless depending on which API family the frontend calls
- execution through generic API routes identifies the runnable in the body
- execution through runtime HTTP routes identifies the runnable in the path

### Frontend examples

1. Frontend loads a saved application revision for editing:
   - calls `POST /applications/revisions/retrieve`
   - body carries `application_revision_ref`
   - response returns stored revision data and optionally resolved configuration

2. Frontend wants full resolved configuration truth:
   - calls `POST /applications/revisions/resolve`
   - body may carry stored refs or an inline revision
   - response returns revision plus `resolution_info`

3. Frontend invokes a saved runnable:
   - calls `POST /workflows/invoke` or a domain wrapper
   - body carries stored reference plus `data` and request `flags`

4. Frontend invokes an ad-hoc or URI-identified runnable:
   - body carries `interface.uri` and enough configuration/data to run
   - this is stateless from the backend persistence perspective even if the runtime still resolves additional references

This is why retrieve and resolve matter at system level:

- retrieve answers "which stored revision do you mean?"
- resolve answers "what fully materialized configuration should execution or UI use?"
- invoke answers "run this identified or inline-described runnable now"

## 5. Observability interface

### Current contract family

- workflow tracing can already exist inside runnable execution, but incoming parent context handling is not yet a formalized SDK runtime contract
- runtime responses already expose trace headers in some paths

### Target system-level changes

- SDK routing/running can honor incoming trace context when present
- workflow-to-workflow calls can preserve parent-child relationships inside runnable execution
- no API-to-SDK propagation work is implied by this plan

### System-level invariant

If runnable execution receives parent trace context, it must be able to preserve it through workflow-to-workflow execution.

### Observability I/O

At this layer the observability interface is narrow:

| Input | Output |
|---|---|
| optional incoming parent trace context at SDK routing/running boundaries | child trace / span linkage plus any exposed trace identifiers in responses |

### Observability example

1. Workflow A invokes Workflow B:
   - Workflow B receives parent context from Workflow A through SDK routing/running
   - Workflow B continues the trace rather than starting an unrelated one

2. Direct API invocation without any upstream parent context:
   - this plan does not require the API to originate or forward new context
   - SDK runtime simply starts its own trace if no parent context is present

## System-layer contract matrix

| Interface | Current gap | Target contract |
|---|---|---|
| API execution | only generic workflows have invoke/inspect and current implementation runs in-process | workflows are canonical, applications and evaluators expose filtered execution/discovery views, and runnable execution is treated as a handoff to runtime services while non-runnable targets fail invoke |
| API catalogs | evaluator templates are a mixed payload | canonical workflow catalog with revision-like catalog entries and separate preset bundles, plus filtered application/evaluator views |
| SDK inspect/invoke | media-type negotiation and derived metadata semantics incomplete | unified URI/schema-derived discovery plus explicit media-type selection |
| Runtime HTTP | runtime discovery semantics are still mixed with legacy history | isolated per-workflow `invoke` / `inspect` plus explicit content negotiation |
| Frontend consumption | relies on legacy `x-agenta.flags` | relies on persisted revision/query truth first, `/inspect` as fallback discovery, and HTTP media-type negotiation |
| Observability | incoming parent context handling is underspecified in SDK runtime | passive workflow-to-workflow trace continuity when parent context is present |

## Black-box validation dimensions

At the system layer, the runnable plan should be validated as a black-box contract across these dimensions:

- functional
  - inspect returns the expected schemas and derived metadata
  - invoke honors supported response media types and fails clearly on unsupported ones
  - catalog endpoints expose correct entries and presets
- compatibility
  - intentional checkpoint-1 breaks are tracked with migration handling
  - additive and migrated fields remain internally consistent
- consistency
  - generic workflow routes and domain routes expose consistent runnable truth
  - inspect and persisted revision truth agree when both exist
- observability
  - incoming parent context is honored when present inside runnable execution
- security
  - authorization remains enforced on new domain and catalog routes
- performance
  - inspect and catalog endpoints do not regress unacceptably
- testability
  - point-like interactions can be checked independently of full product flows

## System-layer design decisions implied by the plan

1. Execution and discovery move toward one canonical contract family.
2. Domain-specific routes are additive filtered wrappers, not separate behavior stacks.
3. Workflow catalog is the canonical system interface; application and evaluator catalogs are filtered system views.
4. Inspect becomes the runtime discovery surface; persisted revision data stays the first choice when already available locally.
5. HTTP content negotiation, URI/schema-derived classification, and materialized revision metadata are separate concerns.
6. Chat/message behavior is inferred from schemas rather than authored as primary flags.
7. Passive incoming trace-context support belongs in SDK routing/running, not as an API-to-SDK integration commitment in this plan.

## Out of scope at this layer

- product rationale
- user journeys
- implementation-level function edits
- storage model details beyond contract implications
