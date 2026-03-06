# Runnables (Workflows) — Initial Exploration

> Status: exploration / audit
> Date: 2026-03-05

## 1. Conceptual Model

A **runnable** is a black box with:

- A **predefined interface** — input schema, output schema, parameter schema
- **Predefined expectations about its runtime** — capability flags, execution mode
- **Side-effects** — primarily tracing

In the backend the term used is **workflow**. The SDK exposes `workflow`, `application`, and `evaluator` as decorator classes that all share the same underlying `workflow` machinery.

### 1.1 Hierarchy

```
workflow (base)
├── application   (is_evaluator=False)
└── evaluator     (is_evaluator=True)
```

Both `application` and `evaluator` are thin subclasses that preset flags and reference namespaces. See `sdk/agenta/sdk/decorators/running.py:563-706`.

---

## 2. Two Parallel Systems

There are **two coexisting systems** for serving workflows over HTTP. They share some types but have distinct execution paths.

### 2.1 Legacy Serving System (`serving.py`)

**File:** `sdk/agenta/sdk/decorators/serving.py`

Uses the `@ag.route()` / `@ag.entrypoint` decorators. Creates FastAPI endpoints directly:

| Endpoint | Purpose |
|----------|---------|
| `POST {prefix}/run` | Deployed invoke (config from API) |
| `POST {prefix}/test` | Playground invoke (inline config) |
| `POST {prefix}/generate` | Legacy alias for `/test` |
| `POST {prefix}/generate_deployed` | Legacy alias for `/run` |
| `GET {prefix}/openapi.json` | OpenAPI spec with `x-agenta` extensions |
| `GET {prefix}/health` | Health check |

**Key characteristics:**
- Function signature IS the schema (parameters extracted from Python signature)
- Config schema derived from Pydantic model passed to `config_schema=`
- Middleware stack: CORS -> OTel -> Auth -> Config -> Vault -> Inline -> Mock
- Flags exposed in OpenAPI via `x-agenta.flags` extension on each path operation (`serving.py:904-935`)
- Streaming support: detects `AsyncGenerator`/`Generator` return types and returns SSE

### 2.2 New Running System (`running.py` + `routing.py`)

**Files:**
- `sdk/agenta/sdk/decorators/running.py` — core workflow/invoke/inspect logic
- `sdk/agenta/sdk/decorators/routing.py` — HTTP endpoint creation

Uses `@ag.workflow()` / `@ag.application()` / `@ag.evaluator()` decorator classes for the core logic, plus `route` from `routing.py` for HTTP exposure:

| Layer | Method | Signature |
|-------|--------|-----------|
| Programmatic | `invoke(request=...)` | `WorkflowServiceRequest` -> `WorkflowServiceBatchResponse \| WorkflowServiceStreamResponse` |
| Programmatic | `inspect()` | `() -> WorkflowServiceRequest` |
| HTTP | `POST {path}/invoke` | JSON body as `WorkflowServiceRequest` -> JSON or NDJSON/SSE stream |
| HTTP | `GET {path}/inspect` | -> `WorkflowServiceRequest` as JSON |

**HTTP routing details** (`routing.py`):
- `route` class creates a FastAPI app with middleware: CORS -> Vault -> Auth -> OTel
- Stream format negotiation: checks `Accept` header for `text/event-stream` (SSE) vs default (NDJSON)
- Response headers: `x-ag-version`, `x-ag-trace-id`, `x-ag-span-id`
- Error handling: domain `ErrorStatus` -> `WorkflowServiceStatus` with type URL, code, stacktrace

**Key characteristics:**
- Schema comes from `WorkflowServiceInterface.schemas` (explicit JSON Schema)
- Handler registered in `HANDLER_REGISTRY` by URI (`provider:kind:key:version`)
- Running middleware pipeline: Vault -> Resolver -> Normalizer
- Flags passed as `dict` in `WorkflowServiceRequest.flags`

### 2.3 How They Relate

| Aspect | Legacy (`serving.py`) | New (`running.py` + `routing.py`) |
|--------|----------------------|----------------------------------|
| HTTP endpoints | `/run`, `/test`, `/generate`, `/generate_deployed` | `{path}/invoke`, `{path}/inspect` |
| Schema source | Python function signature + Pydantic model | Explicit JSON Schema in `WorkflowServiceInterface` |
| Flags in OpenAPI | `x-agenta.flags` on path operations | Not in OpenAPI; returned by `GET /inspect` |
| Streaming | Detected from return type | `WorkflowServiceStreamResponse` + Accept header negotiation (SSE/NDJSON) |
| Tracing | OTel middleware + `TracingContext` | `TracingContext` via context manager |
| Config resolution | Middleware chain (Config -> request.state) | Resolver middleware |
| Error model | HTTPException with detail dict | `WorkflowServiceStatus` with type URL, code, stacktrace |

---

## 3. Types & Contracts

### 3.1 Core Types (`sdk/agenta/sdk/models/workflows.py`)

```
WorkflowFlags
  is_custom: bool = False
  is_evaluator: bool = False
  is_human: bool = False
  is_chat: bool = False

JsonSchemas
  parameters: Optional[Schema]
  inputs: Optional[Schema]
  outputs: Optional[Schema]

WorkflowServiceInterface
  version: str = "2025.07.14"
  uri: Optional[str]
  url: Optional[str]
  headers: Optional[Dict]
  schemas: Optional[JsonSchemas]

WorkflowServiceConfiguration
  script: Optional[Data]
  parameters: Optional[Data]

WorkflowRevisionData = WorkflowServiceInterface + WorkflowServiceConfiguration

WorkflowServiceRequestData
  revision: Optional[dict]
  parameters: Optional[dict]
  testcase: Optional[dict]
  inputs: Optional[dict]
  trace: Optional[dict]
  outputs: Optional[Any]

WorkflowServiceResponseData
  outputs: Optional[Any]

WorkflowServiceRequest (the main request envelope)
  version: str
  interface: Optional[WorkflowServiceInterface]
  configuration: Optional[WorkflowServiceConfiguration]
  references: Optional[Dict[str, Reference]]
  links: Optional[Dict[str, Link]]
  secrets: Optional[Dict]
  credentials: Optional[str]
  # from Metadata base:
  flags: Optional[dict]
  tags: Optional[dict]
  meta: Optional[dict]
  # data:
  data: Optional[WorkflowServiceRequestData]

WorkflowServiceBatchResponse
  version: str
  status: Optional[WorkflowServiceStatus]
  trace_id / span_id (from TraceID, SpanID bases)
  data: Optional[WorkflowServiceResponseData]

WorkflowServiceStreamResponse
  version: str
  status: Optional[WorkflowServiceStatus]
  trace_id / span_id
  generator: Callable -> AsyncGenerator
```

### 3.2 Domain Aliases

The SDK provides typed aliases to give domain-specific names:

| Base | Application Alias | Evaluator Alias |
|------|------------------|-----------------|
| `Workflow` | `Application` | `Evaluator` |
| `WorkflowVariant` | `ApplicationVariant` | — |
| `WorkflowRevision` | `ApplicationRevision` | `SimpleEvaluatorRevision` |
| `WorkflowRevisionData` | `ApplicationRevisionData` | `EvaluatorRevisionData` |
| `WorkflowFlags` | `ApplicationFlags` (is_evaluator=False) | `EvaluatorFlags` (is_evaluator=True) |
| `WorkflowServiceRequest` | `ApplicationServiceRequest` | `EvaluatorServiceRequest` |
| `WorkflowServiceBatchResponse` | `ApplicationServiceBatchResponse` | `EvaluatorServiceBatchResponse` |

### 3.3 Legacy Types (`sdk/agenta/sdk/types.py`)

Used by the legacy serving system:

- `BaseResponse` — wrapper with `data`, `trace_id`, `tree_id`
- `StreamResponse` — SSE streaming wrapper
- `FuncResponse` — `{message, usage, cost, latency}`
- `MessagesInput` — `List[Dict[str, str]]` (triggers `is_chat=True`)
- `TextParam`, `FloatParam`, `BinaryParam`, `MultipleChoiceParam` — typed config params

---

## 4. Handler Registry

**File:** `sdk/agenta/sdk/workflows/utils.py`

Handlers are registered by URI: `provider:kind:key:version`

```
HANDLER_REGISTRY[provider][kind][key][version] = callable
INTERFACE_REGISTRY[provider][kind][key][version] = WorkflowServiceInterface
CONFIGURATION_REGISTRY[provider][kind][key][version] = WorkflowServiceConfiguration
```

Builtin handlers (under `agenta:builtin:*:v0`):
- **Evaluators:** exact_match, regex_test, field_match_test, json_multi_field_match, webhook_test, custom_code_run, ai_critique, starts_with, ends_with, contains, contains_any, contains_all, contains_json, json_diff, levenshtein_distance, similarity_match, semantic_similarity
- **Applications:** echo, hook, completion, chat

Each builtin has a triple: handler function, interface definition (JSON Schemas), and default configuration.

Custom handlers are registered as `user:custom:{module}.{name}:latest`.

---

## 5. API Layer (Backend)

### 5.1 Workflow CRUD (`api/oss/src/apis/fastapi/workflows/`)

Standard Git-pattern CRUD. **Dual mounted** under both `/workflows` and `/preview/workflows` (preview hidden from OpenAPI — migration seam):

**Workflow Management:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/workflows/` | Create workflow |
| GET | `/workflows/{id}` | Fetch workflow |
| PUT | `/workflows/{id}` | Edit workflow |
| POST | `/workflows/{id}/archive` | Soft delete |
| POST | `/workflows/{id}/unarchive` | Restore |
| POST | `/workflows/query` | Filter/search workflows |

**Variants:** CRUD + fork under `/workflows/variants/`

**Revisions:** CRUD + commit/log under `/workflows/revisions/`

**Execution Services:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/workflows/invoke` | Invoke a workflow (delegates to SDK `invoke_workflow`) |
| POST | `/workflows/inspect` | Inspect a workflow (delegates to SDK `inspect_workflow`) |

### 5.2 Service & DAO

- **Service:** `api/oss/src/core/workflows/service.py` — delegates to shared `GitDAO`
- **DTOs:** `api/oss/src/core/workflows/dtos.py` — `Workflow`, `WorkflowVariant`, `WorkflowRevision`
- **DBEs:** `api/oss/src/dbs/postgres/workflows/dbes.py` — `WorkflowArtifactDBE`, `WorkflowVariantDBE`, `WorkflowRevisionDBE` (has `data` JSONB)
- **DAO:** No dedicated DAO file — uses shared `GitDAO` from `api/oss/src/dbs/postgres/git/dao.py`, wired in `api/entrypoints/routers.py`

**Wiring in entrypoints** (`routers.py`):
- `WorkflowsService` is shared — injected into both `ApplicationsService` and `EvaluatorsService`
- These all reuse the same Git DAO with different DBE types

### 5.3 Invoke & Inspect (New System)

The workflows router has **both invoke and inspect** endpoints:

**`POST /workflows/invoke`** (router.py lines 1114-1139):
```
Client -> WorkflowsRouter.invoke_workflow()
  -> WorkflowsService.invoke_workflow()
    -> sign_secret_token(user_id, project_id, workspace_id, org_id)
    -> SDK's invoke_workflow(request, credentials=f"Secret {token}")
      -> workflow().invoke(request, secrets, credentials)
        -> Vault -> Resolver -> Normalizer middleware chain
        -> execute handler
      -> WorkflowServiceBatchResponse or WorkflowServiceStreamResponse
    -> handle_invoke_success(req, response) -> JSON or SSE/NDJSON stream
```

**`POST /workflows/inspect`** (router.py lines 1143-1168):
```
Client -> WorkflowsRouter.inspect_workflow()
  -> WorkflowsService.inspect_workflow()
    -> SDK's inspect_workflow(request)
      -> workflow().inspect(credentials)
      -> resolve interface + configuration
      -> WorkflowServiceRequest with schemas populated
    -> handle_inspect_success(request) -> JSON
```

**EE permissions:** `RUN_WORKFLOWS` for invoke, `VIEW_WORKFLOWS` for inspect.

### 5.4 Legacy Invoke (Proxy Pattern)

The legacy invoke path (still active) goes through a different flow:

- `api/oss/src/core/invocations/service.py` — resolves variant -> deployment -> URL, makes HTTP call to SDK service
- Legacy: `api/oss/src/routers/app_router.py` — `POST /api/app/{app_id}/generate`

```
Client -> API (resolve variant -> deployment URL) -> SDK HTTP Service (/run or /test) -> execute handler -> response back
```

---

## 6. Capability Flags

### 6.1 Current State

| Flag | Defined In | Set By | Exposed Via |
|------|-----------|--------|-------------|
| `is_custom` | `WorkflowFlags` | SDK auto-detection (`is_custom_uri`) + `WorkflowDBE.is_custom` | Persisted in DB |
| `is_evaluator` | `WorkflowFlags` | `@ag.evaluator()` sets True, `@ag.application()` sets False | OpenAPI `x-agenta.flags`, `inspect()` |
| `is_human` | `WorkflowFlags` | Not set anywhere currently | — |
| `is_chat` | `WorkflowFlags` | `@ag.route(flags={"is_chat": True})` or auto-detect from `MessagesInput` | OpenAPI `x-agenta.flags`, `inspect()` |

### 6.2 How Flags Are Exposed

**Legacy serving** (`serving.py:904-935`):
```json
// In OpenAPI spec, on each path operation:
{
  "post": {
    "x-agenta": {
      "flags": {
        "is_evaluator": true,
        "is_chat": false
      }
    }
  }
}
```

**New running** (`running.py:420-447`):
```python
# inspect() returns WorkflowServiceRequest which includes:
WorkflowServiceRequest(
    flags=self.flags,   # dict with is_evaluator, is_chat, etc.
    ...
)
```

### 6.3 Persistence & Adapter Layer

The API has its own `WorkflowFlags` in `api/oss/src/core/workflows/dtos.py` (mirrors SDK's), plus `WorkflowQueryFlags` with optional fields for filtering. Flags flow through the revision system into the DB via the `data` JSONB column on `WorkflowRevisionDBE`. The `WorkflowDBE` itself only has `is_custom` as a first-class column.

**Legacy adapter** (`api/oss/src/services/legacy_adapter.py`):
- `_template_key_to_flags()` — maps old template types to flags (e.g. `CHAT_SERVICE` -> `is_chat=True`, `SDK_CUSTOM` -> `is_custom=True`)
- `_flags_to_app_type()` — reverse mapping for backward compat

### 6.4 Frontend Flag Reading

**File:** `web/packages/agenta-entities/src/appRevision/api/schema.ts`

The frontend reads flags with a priority chain:
1. Read `x-agenta.flags.is_chat` from OpenAPI spec (explicit SDK flag)
2. Heuristic fallback: check if endpoint has a `messages` schema property

Result stored in `RevisionSchemaState.isChatVariant`, used to toggle chat vs completion UI.

### 6.5 Missing Flags

| Flag | Status | Description |
|------|--------|-------------|
| `can_stream` / `is_streaming` | Missing | Whether the workflow supports streaming output |
| `can_annotate` | Missing | Whether the workflow can be used for human annotation |
| `can_batch` | Missing | Whether the workflow supports batch execution |
| `is_async` | Missing | Whether the workflow supports async execution |

### 6.6 Missing Command Flags

The invoke request currently has no way to specify runtime behavior. There's no mechanism like:
```python
# Hypothetical command flags in request:
WorkflowServiceRequest(
    commands={
        "stream": True,
        "evaluate": True,
        "chat_mode": True,
    }
)
```

The `aggregate` and `annotate` params on the `workflow` decorator hint at this direction but aren't exposed as request-level commands.

---

## 7. Tracing

### 7.1 SDK Tracing

**Files:**
- `sdk/agenta/sdk/tracing/main.py` — `Tracing` class, span lifecycle
- `sdk/agenta/sdk/tracing/conventions.py` — attribute naming (`ag.type`, `ag.data.inputs`, etc.)
- `sdk/agenta/sdk/tracing/processors.py` — span batching/processing
- `sdk/agenta/sdk/tracing/exporters.py` — HTTP export to API

**Span attributes:** `ag.type` (workflow/evaluator/task/agent/tool/...), `ag.node.name`, `ag.data.inputs`, `ag.data.outputs`, `ag.internals`, `ag.refs`, `ag.meta`, `ag.metrics`, `ag.tokens.*`, `ag.cost`

### 7.2 API Tracing

**File:** `api/oss/src/apis/fastapi/tracing/router.py`

Endpoints:
- `POST /observability/v1/otlp/traces` — ingest (OTel-compatible)
- `POST /observability/v1/traces/query` — query
- Various span query endpoints

### 7.3 Trace Propagation Gap

Current flow:
```
API receives invoke request
  -> API calls SDK HTTP service (NO traceparent header)
    -> SDK creates NEW root span (new trace)
      -> SDK exports spans to API tracing endpoint
```

There is **no trace context propagation** from the API's request context into the SDK invocation. Each SDK call starts a fresh trace. The `ag-project-id` header is passed, but not `traceparent`/`tracestate`.

---

## 8. Builtin Interface Definitions

**File:** `sdk/agenta/sdk/workflows/interfaces.py`

Each builtin handler has a `WorkflowServiceInterface` with explicit `JsonSchemas` defining:
- `schemas.parameters` — JSON Schema for configuration
- `schemas.inputs` — JSON Schema for inputs
- `schemas.outputs` — JSON Schema for outputs

This is the richest schema definition in the system, but it only covers builtins. Custom workflows rely on the legacy serving system to extract schemas from Python function signatures.

---

## 9. Key File Map

### SDK

| File | Role |
|------|------|
| `sdk/agenta/sdk/decorators/running.py` | New workflow/application/evaluator decorators, invoke/inspect logic |
| `sdk/agenta/sdk/decorators/routing.py` | New HTTP routing: `/invoke`, `/inspect` endpoints, stream format negotiation |
| `sdk/agenta/sdk/decorators/serving.py` | Legacy HTTP serving, OpenAPI generation, flag injection |
| `sdk/agenta/sdk/models/workflows.py` | All workflow types: flags, request/response, schemas, aliases |
| `sdk/agenta/sdk/models/shared.py` | Shared base types (Identifier, Slug, Lifecycle, etc.) |
| `sdk/agenta/sdk/workflows/utils.py` | Handler/interface/configuration registries, URI parsing |
| `sdk/agenta/sdk/workflows/interfaces.py` | Builtin handler interface definitions (JSON Schemas) |
| `sdk/agenta/sdk/workflows/configurations.py` | Builtin handler default configurations |
| `sdk/agenta/sdk/workflows/handlers.py` | Builtin handler implementations |
| `sdk/agenta/sdk/tracing/main.py` | Tracing engine, span lifecycle |
| `sdk/agenta/sdk/tracing/conventions.py` | Attribute naming conventions |
| `sdk/agenta/sdk/router.py` | FastAPI router (health endpoint only) |
| `sdk/agenta/sdk/types.py` | Legacy types (FuncResponse, MessagesInput, etc.) |

### API

| File | Role |
|------|------|
| `api/oss/src/apis/fastapi/workflows/router.py` | Workflow CRUD routes |
| `api/oss/src/apis/fastapi/workflows/models.py` | Request/response schemas |
| `api/oss/src/core/workflows/service.py` | Business logic |
| `api/oss/src/core/workflows/dtos.py` | Domain objects |
| `api/oss/src/core/workflows/interfaces.py` | DAO contracts |
| `api/oss/src/dbs/postgres/workflows/dbes.py` | SQLAlchemy entities |
| `api/oss/src/dbs/postgres/workflows/dao.py` | Postgres DAO |
| `api/oss/src/core/invocations/service.py` | Invoke orchestration (proxy) |
| `api/oss/src/core/applications/service.py` | Legacy bridge |
| `api/oss/src/services/legacy_adapter.py` | Flag <-> template type mapping |
| `api/oss/src/services/llm_apps_service.py` | Flag usage in invocation |
| `api/entrypoints/routers.py` | Route mounting |

### Web

| File | Role |
|------|------|
| `web/packages/agenta-entities/src/appRevision/api/schema.ts` | Flag reading from `x-agenta` in OpenAPI |

---

## 10. Summary of Gaps

| # | Gap | Impact |
|---|-----|--------|
| 1 | **Two parallel HTTP serving systems** (serving.py vs running.py) | Confusion about which path is canonical |
| 2 | **API inspect exists but doesn't cache** | `POST /workflows/inspect` delegates to SDK but doesn't persist/cache results |
| 3 | **No OpenAPI-compatible endpoint in new system** | Legacy serving has `/openapi.json` with `x-agenta.flags`; new system has `/inspect` but not OpenAPI-formatted |
| 4 | **Flags not persisted in DB** | Only `is_custom` stored; `is_evaluator`, `is_chat`, `is_human` are runtime-only |
| 5 | **Missing capability flags** | `can_stream`, `can_annotate`, `can_batch`, `is_async` not defined |
| 6 | **No command flags in request** | Can't tell the workflow to stream, evaluate, or use chat mode at invocation time |
| 7 | **No trace propagation** | API -> SDK invocation creates separate trace; no `traceparent` forwarding |
| 8 | **Mutual exclusion of flags** | `is_evaluator` and `can_annotate` can't coexist; `is_chat` doesn't imply `can_chat` |
| 9 | **Custom workflow schemas** | Custom workflows rely on Python signature extraction (legacy) rather than explicit JSON Schema (new) |
| 10 | **`aggregate` and `annotate` params** | Exist on `workflow` decorator but aren't connected to flags or request commands |
