# Runnables — Gap Analysis

> Status: gap analysis
> Date: 2026-03-05
> Companion: [README.md](./README.md) (exploration)

This document catalogs gaps found during the initial exploration, organized by category with recommended actions.

---

## G1. Dual Serving Systems

**What:** Two coexisting HTTP serving systems — legacy `serving.py` and new `running.py` + `routing.py`.

**Why it matters:** Consumers don't know which endpoints to target. The API must maintain two invoke paths (legacy proxy vs new direct). Frontend has to parse both OpenAPI `x-agenta.flags` and inspect responses.

**Current state:**
- Legacy: `/run`, `/test`, `/generate`, `/generate_deployed`, `/openapi.json`
- New: `{path}/invoke`, `{path}/inspect`
- Both active and reachable

**Action:**
- [ ] Clarify which system is canonical going forward
- [ ] Plan deprecation timeline for legacy endpoints
- [ ] Ensure the new system covers all legacy capabilities before deprecation
- [ ] Identify consumers still hitting legacy endpoints (frontend, SDK client, external users)

---

## G2. Inspect: No Caching or Persistence

**What:** `POST /workflows/inspect` delegates to the SDK's `inspect_workflow()` every time. Results are not cached or persisted.

**Why it matters:** Inspect resolves the interface, configuration, and schemas at call time. If the handler isn't registered (e.g. builtin not loaded, custom service down), inspect fails. The API has no fallback and no historical record of what a workflow's interface looked like.

**Current state:**
- API calls SDK's `inspect_workflow()` synchronously
- Result is a `WorkflowServiceRequest` with schemas, flags, configuration
- Nothing stored in DB

**Action:**
- [ ] Decide whether inspect results should be persisted at commit time (when a revision is committed, capture its inspect snapshot)
- [ ] Consider caching inspect results per revision ID
- [ ] Evaluate whether the revision's `data` JSONB (which stores `WorkflowRevisionData` = interface + configuration) already serves this purpose — and if so, whether it's sufficient or needs enrichment

---

## G3. OpenAPI Is Missing as a First-Class Discovery Surface in the New System

**What:** The legacy system exposes `/openapi.json` with `x-agenta.flags` on each operation. The new system has `/inspect` which returns a `WorkflowServiceRequest` — a different format. The target contract needs both: `inspect` as the native runnable discovery surface and `openapi.json` as the OpenAPI discovery surface for the same runnable namespace.

**Why it matters:** External consumers (tools, integrations, other services) may expect OpenAPI format for discovery. The frontend currently reads from the legacy OpenAPI spec.

**Current state:**
- Legacy: `/openapi.json` — standard OpenAPI 3.x with `x-agenta` extensions
- New: `GET {path}/inspect` — returns `WorkflowServiceRequest` (proprietary schema)
- No equivalent of OpenAPI in new system

**Action:**
- [ ] Add `openapi.json` as a first-class discovery peer to `inspect` in the new runnable system
- [ ] Add SDK-level discovery helpers for the same documents: `get_workflow_openapi()`, `get_application_openapi()`, `get_evaluator_openapi()`
- [ ] Determine whether `openapi.json` should be generated from the inspect response or maintained separately
- [ ] Ensure inspect and `openapi.json` stay schema- and flag-consistent for the same runnable
- [ ] Consider whether the frontend should migrate from reading `/openapi.json` to reading `/inspect`, `openapi.json`, or API-provided classification depending on the consumer

---

## G4. Primary Flag-Centric Contract Should Be Removed

**What:** The old design treated identity flags, capability flags, and command flags as the main contract surface. That direction is now superseded.

**Revised direction:**

- stream/batch selection belongs to HTTP content negotiation
- chat/message behavior belongs to schemas and OpenAPI via explicit `x-` parameters
- evaluator/custom/human identity belongs to URI families and registry truth
- `annotation` vs `invocation` belongs to trace ingestion and observability, not to authored runnable flags
- stored workflow revision flags may remain, but only as materialized metadata derived from other sources of truth or explicit user-owned custom metadata

**Action:**

- [ ] Stop expanding the primary `can_*` / `is_*` runnable contract surface
- [ ] Replace stream/batch/evaluate/chat/verbose flag semantics with HTTP/schema/URI-driven semantics
- [ ] Redefine stored workflow revision flags as materialized metadata only

---

## G5. Invoke Negotiation Model Needs To Be Explicit

**What:** The invoke contract needs an explicit response negotiation model rather than request-time command flags.

**Revised direction:**

- use `Accept` to select:
  - `application/json`
  - `text/event-stream`
  - `application/x-ndjson`
  - `application/jsonl`
- fail explicitly when the runnable cannot satisfy the requested media type
- let callers batch/aggregate streaming responses themselves when they need batched behavior

**Action:**

- [ ] Define runtime HTTP negotiation semantics for supported response media types
- [ ] Expose the same negotiation choices through SDK programmatic invoke
- [ ] Remove stream/evaluate/chat/verbose command semantics from the primary invoke contract

---

## G5a. SDK Response-Mode API Needs To Match HTTP

**What:** The SDK still needs a clear programmatic way to ask for JSON vs SSE vs NDJSON/JSONL behavior.

**Why it matters:** Without that, the SDK and HTTP surfaces drift again even if the underlying runtime supports the same media types.

**Action:**

- [ ] Define SDK-side response-mode / media-type selection APIs that mirror HTTP negotiation
- [ ] Ensure forwarded requests preserve negotiated response semantics

---

## G6. Passive Incoming Trace Context Support Is Underspecified in SDK Runtime

**What:** The plan should not treat trace propagation as an API-to-SDK integration task. The only relevant requirement here is that SDK routing/running can accept incoming parent trace context when present, especially for workflow-to-workflow execution.

**Why it matters:** A workflow calling another workflow should be able to preserve parent-child trace relationships. That requires passive support in SDK routing/running. It does not require this plan to add any new propagation path from the backend API into the SDK.

**Current state:**
- lower-level tracing terminology and machinery already exist in the SDK runtime
- current docs overstate trace propagation as an API-to-SDK gap
- there is no decision in this plan to introduce any new producer of incoming trace context

**Action:**
- [ ] Clarify that trace-context support in this plan is limited to passive handling in SDK routing/running
- [ ] Ensure SDK tracing can respect incoming parent context when it is already present
- [ ] Ensure workflow-to-workflow execution can preserve parent-child relationships
- [ ] Remove API-to-SDK propagation work from the plan

---

## G7. Legacy Adapter Complexity

**What:** `api/oss/src/services/legacy_adapter.py` translates between old template-based system and new flag-based system. `_template_key_to_flags()` and `_flags_to_app_type()` maintain bidirectional mapping.

**Why it matters:** Every new flag or capability requires updating the adapter in both directions. The adapter is a source of bugs when the mapping is incomplete or ambiguous.

**Current state:**
- CHAT_SERVICE/CHAT_TEMPLATE -> `is_chat=True`
- SDK_CUSTOM/CUSTOM -> `is_custom=True`
- Everything else -> defaults

**Action:**
- [ ] Catalog all consumers of the legacy adapter
- [ ] Determine if the adapter can be simplified or removed as legacy endpoints are deprecated
- [ ] If kept, ensure it's tested against all flag combinations

---

## G8. Custom Workflow Schema Gap

**What:** Builtin handlers have rich, explicit JSON Schema definitions in `sdk/agenta/sdk/workflows/interfaces.py`. Custom (user-defined) workflows rely on the legacy serving system to extract schemas from Python function signatures, which produces less precise schemas.

**Why it matters:** Custom workflows have weaker introspection. The new system expects explicit `WorkflowServiceInterface.schemas`, but custom workflows don't always provide them.

**Current state:**
- Builtins: Full JSON Schema for inputs, outputs, parameters in `interfaces.py`
- Custom (legacy `@ag.route()`): Schema extracted from function signature + `config_schema` Pydantic model
- Custom (new `@ag.workflow()`): Schema from `schemas=` param or `interface.schemas` — but not always provided

**Action:**
- [ ] Ensure the new system can auto-extract schemas from handler signatures as a fallback
- [ ] Or: require explicit schemas for all custom workflows in the new system
- [ ] Validate that schemas are present during handler registration, not at invoke time
- [ ] Consider a migration path for legacy custom workflows to provide explicit schemas

---

## G9. `aggregate` and `annotate` — Disconnected Internal Params Behind the Future Evaluate Contract

**What:** The `workflow` decorator accepts `aggregate` (stream-to-batch conversion) and `annotate` (annotation vs invocation mode) params. These exist in the running context but aren't connected to the external flag or request-flag systems.

**Why it matters:** These params are the implementation mechanisms for capabilities described in G4/G5, but they're not wired up. `aggregate` is the mechanism behind `can_stream` + batch fallback. `annotate` is the current lower-level mechanism behind the future `can_evaluate` / `evaluate` contract.

**Current state:**
- `aggregate`: Optional[Union[bool, Callable]] — if truthy, NormalizerMiddleware converts stream to batch
- `annotate`: Optional[bool] — stored in running context and tracing context, but no consumer reads it directly as part of a public evaluation contract
- Both are set in `workflow.__init__()` and passed through to context managers

**How they should connect (per G4/G5):**
- `aggregate` = the implementation of "this workflow streams natively, but batch is requested" → should be activated by `stream=false` (or absent) request flag when `can_stream=true`
- `annotate` = the current implementation of "run in evaluation mode" → should be activated by `evaluate=true` request flag when `can_evaluate=true`

**Action:**
- [ ] Wire `aggregate` to `can_stream` capability + `stream` request flag (G4/G5)
- [ ] Wire `annotate` to `can_evaluate` capability + `evaluate` request flag (G4/G5)
- [ ] Keep them as decorator-level params for setting defaults, but allow per-invocation override via request flags

---

## G10. API Execution Path Is Split Between In-Process Calls and Service Handoff

**What:** The API currently has multiple execution patterns: the new `POST /workflows/invoke` calls SDK code in-process, while the legacy path resolves a deployment URL and calls an SDK service over HTTP. The subsystem design now points toward a control-plane model where the API classifies targets and hands runnable ones to the runtime `/services` surface.

**Why it matters:** We should not blur API responsibilities with runtime execution responsibilities. If the runnable lives in another container, the API should dispatch to it rather than behaving like the execution engine. This matters for auth, streaming, timeouts, builtins exposure, and non-runnable custom workflows.

**Current state:**
- New: `POST /workflows/invoke` -> `WorkflowsService.invoke_workflow()` -> SDK's `invoke_workflow()` (in-process)
- Legacy: `POST /api/app/{app_id}/generate` -> `InvocationsService` -> HTTP call to SDK service -> response
- Runtime service mounting already exists separately, but the runnable family is not yet cleanly standardized around it

**Action:**
- [ ] Map which consumers use which path
- [ ] Use redirect as the target runnable handoff pattern
- [ ] Route runnable builtin execution through the runtime `/services` family
- [ ] Expand the runtime `/services` surface so all Agenta builtins are reachable, not only the currently exposed subset
- [ ] Review and standardize runtime service URL shapes
- [ ] Make non-runnable custom workflows fail invoke explicitly
- [ ] Keep inspect working for non-runnable targets from persisted discovery truth
- [ ] Make `openapi.json` come from the same provenance as `inspect` for a given target
- [ ] Refresh builtin service URLs from URI on reads and writes
- [ ] Refresh builtin input/output schemas from URI/inspect on reads and writes, with caching
- [ ] Avoid blindly overwriting user-owned parameter schema during builtin refresh

---

## G11. Frontend Flag Reading — Only Legacy Source

**What:** The frontend reads workflow capability flags from the legacy `/openapi.json` via `x-agenta.flags.is_chat`. It doesn't use the new `/inspect` endpoint or API-provided classification.

**Why it matters:** The frontend absolutely needs to read flags — capability flags drive UI behavior (chat vs completion mode, streaming support, evaluation mode, verbose vs concise response rendering). The problem is the source: the legacy `/openapi.json` with `x-agenta` extensions, plus heuristic fallbacks. The frontend should read flags from the new system (persisted API revision/query responses first, `/inspect` only when there is no local revision truth yet).

**Current state:**
- `web/packages/agenta-entities/src/appRevision/api/schema.ts` reads `x-agenta.flags` from legacy OpenAPI
- Heuristic fallback: checks for `messages` schema property
- Stores result in `RevisionSchemaState.isChatVariant`
- No consumption of `/inspect` responses
- No consumption of API-provided derived classification

**Action:**
- [ ] Migrate frontend to read flags from API-provided classification in revision/query responses, with `/inspect` only as a fallback when no local revision truth exists yet
- [ ] Ensure the new source provides everything the frontend needs: identity flags (`is_evaluator`, `is_chat`, `is_verbose`), capability flags (`can_stream`, `can_evaluate`, `can_chat`, `can_verbose`), derived classification (`is_custom`, `is_runnable`), and schemas
- [ ] Remove the legacy `x-agenta.flags` reading path once the new source is available
- [ ] Remove the heuristic `messages` property fallback — use explicit flags

---

## G12. Applications and Evaluators Missing Invoke/Inspect Endpoints

> Status update: superseded by [plan.G12.md](./plan.G12.md). This gap was closed as not planned.

**What:** This was the earlier proposal to add API-owned invoke/inspect endpoints for applications and evaluators.

**Decision:** `/invoke` and `/inspect` are runtime `/services` endpoints, not API-owned application/evaluator router endpoints. Applications and evaluators remain filtered workflow projections in CRUD/query/revision and catalog surfaces.

**Current state:**
- `POST /workflows/invoke` and `POST /workflows/inspect` — exist, implemented
- `POST /applications/invoke` and `POST /applications/inspect` — **do not exist**
- `POST /evaluators/invoke` and `POST /evaluators/inspect` — **do not exist**
- Application and evaluator routers only have CRUD (create, fetch, edit, archive, query, revisions, commit, log)
- Application and evaluator services have no invoke/inspect methods
- The SDK has `invoke_application`, `inspect_application`, `invoke_evaluator`, `inspect_evaluator` functions in `running.py` — but these are not wired to any API routes

**What exists on the SDK side but is not exposed via API:**
- `sdk/agenta/sdk/decorators/running.py:607` — `invoke_application()`
- `sdk/agenta/sdk/decorators/running.py:639` — `inspect_application()`
- `sdk/agenta/sdk/decorators/running.py:709` — `invoke_evaluator()`
- `sdk/agenta/sdk/decorators/running.py:741` — `inspect_evaluator()`

**Mounting structure (for reference):**
- `/applications/` (+ `/preview/applications/`) — CRUD only
- `/simple/applications/` (+ `/preview/simple/applications/`) — simplified CRUD
- `/evaluators/` (+ `/preview/evaluators/`) — CRUD only
- `/simple/evaluators/` (+ `/preview/simple/evaluators/`) — simplified CRUD

**Current target:**
- [ ] Keep application/evaluator API surfaces focused on filtered retrieval, query, revision, and catalog behavior
- [ ] Let the API control plane call runtime `/services/.../invoke` or `/services/.../inspect` internally when explicit live execution or discovery is needed
- [ ] Avoid adding new API-owned domain runtime endpoints that duplicate the runtime surface

---

## G12a. Catalog Surface Is Partial, Evaluator-Specific, and Not Centered on Workflows

**What:** `GET /preview/simple/evaluators/templates` is a monolithic payload that currently mixes several concerns:
- catalog entry metadata (`name`, `key`, `categories`, `description`)
- preset bundles (`settings_presets`)
- UI form metadata (`settings_template`)
- partial schema detail (`outputs_schema`)

It is evaluator-specific today, and there is no equivalent schema-first catalog surface for predefined workflows or the filtered application/workflow views derived from them.

**Why it matters:** We need a proper runnable catalog, not a template dump. Consumers should be able to:
- list predefined evaluators and predefined applications/workflows
- retrieve presets separately from the catalog entry
- create a workflow/evaluator/application with a complete persisted contract (`inputs`, `parameters`, `outputs`)

Without this split, evaluator creation stays ad hoc and the resulting workflow revision data is incomplete.

**Current state:**
- `GET /preview/simple/evaluators/templates` returns static Python data from `api/oss/src/resources/evaluators/evaluators.py`
- `EvaluatorTemplate` mixes catalog, preset, UI, and runtime concerns in one DTO
- `build_evaluator_data()` derives `uri` and mostly only `schemas.outputs`; `schemas.inputs` and `schemas.parameters` are not first-class for builtin evaluators
- `auto_ai_critique` can effectively define its output contract through `json_schema`, but `auto_custom_code_run` does not have the same first-class schema authoring path
- The evaluator input shape is effectively shared and hard-coded at the workflow level, but that shared input schema is not modeled explicitly as part of the catalog contract
- Parameter schema is not modeled as a first-class contract for builtin evaluators; it is implicit in `settings_template`
- `settings_template` is effectively a frontend form-definition shape, not the canonical JSON Schema contract for workflow revision data
- Special evaluator kinds (human, webhook, custom code, LLM-as-a-judge, etc.) are identified mainly by template key conventions rather than by URI classification and workflow flags

**Action:**
- [ ] Replace the monolithic templates payload with a proper catalog surface for predefined runnables
- [ ] Add canonical workflow catalog endpoints, e.g. `/workflows/catalog/`, `/workflows/catalog/{entry_key}`, `/workflows/catalog/{entry_key}/presets/`
- [ ] Add evaluator catalog endpoints as filtered workflow catalog views, e.g. `/evaluators/catalog/`, `/evaluators/catalog/{entry_key}`, `/evaluators/catalog/{entry_key}/presets/`
- [ ] Add the same abstraction for applications as filtered workflow catalog views so predefined applications and predefined evaluators stay symmetric over one workflow catalog source
- [ ] Define catalog DTOs around one catalog entry shape plus preset bundles
- [ ] Make the catalog shape explicit rather than implied:
  - list response with `count` and `items`
  - entry fields including `uri`, optional compatibility `key`, optional precomputed `url`, optional `headers`, `name`, `description`, `categories`, workflow flags, and `schemas.inputs` / `schemas.parameters` / `schemas.outputs`
  - presets response that returns override bundles with `parameters`, optional `script`, optional `headers`, and other presettable workflow fields when relevant
- [ ] Give code evaluators the same first-class output-schema definition path as AI-critique evaluators; output schema is required for a proper runnable evaluator
- [ ] Model evaluator `schemas.inputs` explicitly as the shared predefined input contract for evaluator workflows, rather than leaving it implicit
- [ ] Support `schemas.parameters` for evaluator entries as optional: useful when we want schema-driven parameter validation, but not required for every evaluator
- [ ] When clients use catalog entries or presets to populate normal workflow/application/evaluator creation flows, persist full workflow revision schemas (`inputs`, `parameters`, `outputs`)
- [ ] Keep `settings_template` as UI convenience metadata only, not the source of truth for runnable schema

---

## G12b. Legacy `service` / `configuration` Fields Still Exist in Workflow Revision Data

**What:** The target revision contract has already effectively normalized around `uri`, `url`, `headers`, `schemas`, `script`, `parameters`, and `runtime`, but legacy `service` and `configuration` fields still exist in workflow/application/evaluator revision DTOs and generated client types.

**Why it matters:** As long as those legacy fields exist, the revision contract stays ambiguous. The codebase can keep re-introducing legacy semantics, and catalog/create flows cannot rely on one clean source of truth.

**Current state:**
- `WorkflowRevisionData` in the SDK/API model layer still exposes `service` and `configuration` in generated client types and revision DTOs
- evaluator creation and compatibility flows still construct legacy payloads in some paths
- acceptance tests still assert on legacy `data.service` / `data.configuration` fields
- the legacy adapter still carries old template-era mapping logic that can keep these fields alive

**Action:**
- [ ] Audit code paths that read or write `data.service` / `data.configuration`
- [ ] Migrate those paths to normalized revision fields (`uri`, `url`, `headers`, `schemas`, `script`, `parameters`, `runtime`)
- [ ] Update evaluator builders/defaults that still construct legacy service/configuration payloads
- [ ] Add migrations or normalization on read/write if persisted legacy revision payloads still exist
- [ ] Remove the legacy fields from revision DTOs and generated client types once compatibility coverage is complete

---

## G13. Route Isolation — Each Workflow Must Be Its Own Namespace

**What:** When a user defines multiple workflows (routes) in the same codebase, they currently share a single FastAPI app. Each workflow should instead be an isolated unit with its own `invoke` and `inspect` namespace — mountable independently.

**Why it matters:** Shared route registration conflates multiple workflows into one runtime namespace. Consumers cannot target a specific workflow cleanly for execution or live discovery. Instead, each should be a self-contained runtime namespace with:
- `{path}/invoke` — execute this specific workflow
- `{path}/inspect` — discover this specific workflow's interface

**Current state:**

*Legacy system (`serving.py`):*
- Multiple `@ag.route("/summarize")`, `@ag.route("/embed")` all register on the same global `app`
- Single shared `/openapi.json` contains ALL routes
- `create_app()` exists as a workaround to create isolated sub-apps, but it's opt-in and manual:
  ```python
  chat_app, chat_route = ag.create_app()
  @chat_route("/", config_schema=MyConfig)
  async def chat_handler(...): ...
  main_app.mount("/chat", chat_app)
  ```
- This workaround gives separate OpenAPI specs per sub-app, but requires users to manage mounting themselves

*New system (`routing.py`):*
- `route(path="/summarize")` registers `{path}/invoke` and `{path}/inspect` on a shared `default_app` (or a provided app/router)
- Multiple `route()` calls on the same app produce multiple invoke/inspect pairs, but they still share one app registration path
- No built-in isolation — `route()` doesn't create a sub-application

**Desired behavior:**

Each `@ag.route()` (or `@ag.workflow()`, `@ag.application()`, `@ag.evaluator()`) should produce a self-contained pair:

```
{path}/invoke       — POST, execute this workflow
{path}/inspect      — POST, discover this workflow's interface/schemas/flags
```

When a codebase defines multiple workflows:
```python
@ag.application(slug="summarize")
def summarize(text: str): ...

@ag.application(slug="embed")
def embed(text: str): ...
```

The result should be:
```
/summarize/invoke
/summarize/inspect

/embed/invoke
/embed/inspect
```

Discovery for existing local revisions should still prefer persisted revision/query truth; `/inspect` is the live fallback.

**Action:**
- [ ] Make each `route()` create an isolated sub-application (or use FastAPI's sub-app mounting) so each workflow gets its own invoke/inspect namespace
- [ ] Ensure the legacy `create_app()` pattern is either replaced by this or deprecated
- [ ] Update the `route` class in `routing.py` to handle this — currently it just calls `self.root.add_api_route()` on a shared app

---

## G14. `is_custom` — Overloaded Semantics and Fragile Detection

**What:** `is_custom` currently means "this workflow is user-deployed code, not a backend-managed builtin". But the flag is detected/set in three independent ways across layers, and its meaning has drifted to also control request shape, caching strategy, and parameter flattening.

**Why it matters:** The flag does too much. It conflates "where does this workflow run?" (deployment topology) with "how should I serialize inputs for it?" (request format) and "how often should I poll its spec?" (caching policy). These concerns should be separate.

### G14a. How `is_custom` Is Set (Three Sources of Truth)

1. **SDK — URI-based detection** (`sdk/agenta/sdk/workflows/utils.py:320-326`):
   ```python
   def is_user_custom_uri(uri):
       provider, kind, key, version = parse_uri(uri)
       return provider == "user" and kind == "custom"
   ```
   If URI starts with `user:custom:`, or if no URI is given (returns `True` by default). Then `running.py:208-210` auto-sets `flags["is_custom"] = True`.

2. **API — Legacy adapter mapping** (`api/oss/src/services/legacy_adapter.py:1153,1214`):
   Maps old `AppType.CUSTOM` / `AppType.SDK_CUSTOM` template keys → `is_custom=True`. Also maps back from `is_custom + uri` → display string `"custom"` / `"custom (sdk)"`.

3. **Frontend — Schema inference** (`web/oss/src/lib/shared/variant/transformer/transformToRequestBody.ts:64-67`):
   ```typescript
   const isCustomBySchema = Boolean(spec) && !hasInputsProperty && !hasMessagesProperty && !(isChat ?? variant?.isChat)
   const isCustomByAppType = (appType || "").toLowerCase() === "custom"
   const isCustomFinal = Boolean(isCustom) || isCustomBySchema || isCustomByAppType
   ```
   Three-way OR: explicit flag, schema shape inference, or app type string. The schema inference is fragile — a workflow that happens to not define an `inputs` property is assumed custom.

### G14b. What `is_custom` Controls

| Layer | Behavior When `is_custom=true` | Concern |
|-------|-------------------------------|---------|
| **SDK** | URI namespace is `user:custom:*` | Handler registration |
| **API** | Legacy adapter maps to `AppType.CUSTOM` | Legacy compat |
| **API** | Annotations set `AnnotationOrigin.CUSTOM` when `is_custom=true` | Annotation origin tracking |
| **Frontend** | Input keys extracted from schema (not wrapped in `inputs` container) | Request serialization |
| **Frontend** | Parameters flattened to top level (not under prompt configuration name) | Request serialization |
| **Frontend** | Cache disabled (`staleTime: undefined` instead of 5 min) | Caching policy |
| **Frontend** | OpenAPI spec polled every 1 minute (vs. never for non-custom) | Spec refresh |

The request serialization behavior (input key extraction, parameter flattening) is the biggest practical impact. Custom workflows get a fundamentally different request shape than builtins — and this is driven by a flag that's supposed to mean "user-deployed code", not "different wire format".

### G14c. Evolution Path

The user's direction: **URL/URI presence should determine human/custom status.** Specifically:
- If a workflow has a URI of `user:custom:*` → it has user-deployed code
- If a workflow has no URI (or a `agenta:builtin:*` URI) → it's managed by the backend

This means `is_custom` as a flag may become redundant — it can be derived from the URI. The behaviors currently controlled by `is_custom` should be decomposed:

- **Request format** → should be determined by the workflow's interface schema, not by `is_custom`
- **Caching policy** → should be configurable independently, or based on whether the workflow has a live external endpoint
- **Annotation origin** → should track actual origin (`human`, `sdk`, `builtin`), not a boolean flag
- **Handler namespace** → already derived from URI; the flag is redundant

**Action:**
- [ ] Audit all frontend `isCustom` / `isCustomFinal` usage and determine which behaviors are actually about request format vs. deployment topology
- [ ] Separate "request format" concern from `is_custom` — the interface schema should drive request shape
- [ ] Consider making `is_custom` derivable from URI presence (`user:custom:*` → custom) rather than a stored flag
- [ ] Remove the frontend schema inference path for custom detection — it's fragile and error-prone
- [ ] Decouple caching policy from `is_custom` — make it based on whether the workflow has a remote endpoint
- [ ] Clean up `AnnotationOrigin` to not depend on `is_custom` — use a proper origin enum

---

## G15. `is_feedback` — Misnomer for "Not Runnable"

**What:** `is_feedback` doesn't really mean "human". It means **not runnable** — there's no engine, no code, no URI. The workflow has no handler to invoke. Someone or something external must provide the output. "Human evaluator" is just the primary use case of a non-runnable workflow, but the concept is broader.

**Why it matters:** The name `is_feedback` implies the flag is about human-in-the-loop specifically, but the real semantic is about runnability. A non-runnable workflow is one where the system can't `invoke` it — there's nothing to run. No URI = not runnable. Period.

### G15a. How `is_feedback` Is Set

1. **API — Default evaluator creation** (`api/oss/src/core/evaluators/defaults.py:141-144`):
   ```python
   flags=SimpleEvaluatorFlags(is_custom=False, is_feedback=True)
   ```
   The default "human evaluator" is seeded with `is_feedback=True`. This is the primary source.

2. **API — Annotation origin mapping** (`api/oss/src/core/annotations/service.py:100-104`):
   ```python
   is_feedback=annotation_create.origin == AnnotationOrigin.HUMAN
   ```
   When annotations come from human origin, the evaluator flags get `is_feedback=True`.

3. **SDK — Never set by SDK code.** The SDK defines the field (`WorkflowFlags.is_feedback: bool = False`) but no SDK decorator or auto-detection logic sets it to `True`. This makes sense: the SDK IS the engine — if code is running in the SDK, it's runnable by definition.

### G15b. What `is_feedback` Controls

| Layer | Behavior | Purpose |
|-------|----------|---------|
| **API** | Query filter: `SimpleEvaluatorQueryFlags(is_feedback=True)` | Find non-runnable evaluators |
| **API** | Annotation origin mapping: `is_feedback → AnnotationOrigin.HUMAN` | Track annotation provenance |
| **Frontend** | Filter evaluator lists: show human-only or exclude human | Separate non-runnable vs. automatic evaluator UI tabs |
| **Frontend** | Annotation drawer: `queries: {is_feedback: true}` | Show only non-runnable evaluators for manual annotation |
| **Frontend** | Evaluator navigation: skip human evaluators in trace drawer | Don't navigate to non-runnable evaluators (nothing to inspect) |
| **Frontend** | Layout control: `isHumanEval` prop changes page layout | Different UI for manual evaluation sessions |
| **Frontend** | Evaluation kind derivation: `evaluationKind.ts` checks annotation steps with `origin="human"` | Classify evaluation runs as "human" type |

### G15c. Key Observations

1. **`is_feedback` really means "not runnable".** No URI, no handler, no code. The workflow is a definition (interface/schema for what output is expected) but not an executable. Someone external — a human, an external system, anything — must fill in the result.

2. **The SDK never sets it.** This is logically consistent: the SDK IS the engine. If code runs in the SDK, the workflow is runnable by definition. `is_feedback=true` only comes from the API side, for workflows that have no SDK counterpart.

3. **Non-runnable workflows can't be invoked.** The invoke/inspect machinery doesn't apply. A non-runnable workflow's "interface" defines what the expected output looks like (the annotation schema), not how to produce it.

4. **Currently evaluator-only, but the concept is general.** Today only evaluators use `is_feedback`. But "a workflow definition without an engine" could apply beyond evaluation — e.g., a manual data processing step in a pipeline. The concept belongs at the workflow level, not just evaluators.

5. **The flag is clean but misnamed.** `is_feedback` works well mechanically — it's set in few places, read for clear purposes, and has no fragile detection logic (unlike `is_custom`). The problem is the name, not the behavior.

### G15d. Current State: Human Evaluators Have No URI

The default human evaluator is created with `data=SimpleEvaluatorData(service={...})` — no `uri` field. The `uri` on the revision data is `None`. The service's `_extract_builtin_evaluator_key()` checks `simple_evaluator_data.uri` and returns `None` for human evaluators.

So today: `is_feedback=true` correlates with `uri=None`. But **"not runnable" is broader than just URI absence.** A `user:custom:*` workflow could also be non-runnable if there's no reachable endpoint — the URI identifies the handler but doesn't guarantee invocability. And conversely, a builtin with a URI might not be runnable if the handler isn't loaded.

### G15e. Evolution Path

**URI ≠ runnability.** A workflow can have a URI (identity) but still be non-runnable. Runnability is about the engine (handler/URL), not the identity.

- **Has handler in registry** → runnable in-process (builtins)
- **Has URL** → runnable remotely (user-deployed SDK services, webhooks)
- **Has URI but no handler and no URL** → not runnable (e.g., `user:custom:my-annotation:v3` — user-defined human evaluator with custom schema)
- **No URI** → legacy state (should be backfilled)

A user-created human evaluator with a custom schema should be `user:custom:{variant_slug}:v{N}` — it has a URI (it's a user-created entity), but no engine. The default platform human evaluator should be `agenta:builtin:human:v0`.

The name should evolve. `is_feedback` is misleading — it should reflect runnability, not who operates it.

See [taxonomy.md](./taxonomy.md) for the full proposed taxonomy.

**Action:**
- [ ] Recognize that `is_feedback` means "not runnable", not "human-operated"
- [ ] Derive runnability from handler/URL presence — NOT from URI presence
- [ ] Give all workflows URIs (including human evaluators): `user:custom:{variant_slug}:v{N}` or `agenta:builtin:human:v0`
- [ ] Consider renaming or replacing `is_feedback` with `is_runnable` (inverted)
- [ ] The SDK never needs to set this flag — if code runs in the SDK, it's runnable
- [ ] Ensure the frontend annotation drawer and evaluator filters work off the derived concept
- [ ] Non-runnable workflows should not have invoke endpoints (they have nothing to invoke)

---

## G16. `is_feedback` + `is_custom` Combined — Toward URI-Derived Classification

**What:** Both `is_feedback` and `is_custom` encode information that can be derived from the workflow's URI rather than stored as explicit flags.

**Why it matters:** Storing derivable state leads to drift (flag says one thing, URI says another). Making classification derive from the URI is simpler and more consistent.

### G16a. Runnability Rules

Runnability depends on the URI provider — it's not fully independent:

```
agenta:* URI  → always runnable (platform guarantees handlers)
user:* URI    → runnable only if handler or URL present
no URI        → legacy / unresolved (current no-URI state is a bug to backfill)
```

`agenta:*` URIs are always runnable because the platform ships and registers their handlers. `user:*` URIs need a deployed engine — either a handler loaded in the SDK process or a reachable URL. No URI is currently a bug (human evaluators should have URIs but don't); in this design set it is a legacy state to backfill, not a target contract shape.

The primary derivation:
- **`is_custom`** → `is_user_custom_uri(uri)` — already exists in SDK (`sdk/agenta/sdk/workflows/utils.py:320`)
- **`is_runnable`** → `agenta:*` → always true; `user:*` → has handler OR has url; no URI → false

### G16b. `user:custom` URI Key = Variant Slug, Version = Revision Version

For backend-defined `user:custom` cases, the URI should map to the git-style model:
- `user:custom:variant_slug:v{revision_version}`
- Example: `user:custom:my-app:v3` → variant slug `my-app`, revision version 3
- `latest` resolves to highest `vN`

Builtins are different:
- `agenta:builtin:{key}:{builtin_version}`
- the third field is the builtin key, not the backend variant slug
- the version is the builtin version, not the backend revision version

See [taxonomy.md](./taxonomy.md) for full details.

### G16c. What Needs to Change

1. **Give all workflows URIs** — including human evaluators (default: `agenta:builtin:human:v0`, user-created: `user:custom:{variant_slug}:v{N}`)
2. **`is_custom`** → derive from `is_user_custom_uri(uri)` (already exists)
3. **`is_feedback`** → derive from `not is_runnable` (no handler AND no url) — NOT from URI absence
4. **Align backend-defined `user:custom` URI key with variant slug**, version with revision version
5. **Remove stored `is_custom`/`is_feedback` flags** — compute at read time
6. **Frontend** must stop inferring `isCustom` from schema shape — use API-provided values
7. **API** must expose derived classification in query/inspect responses

### G16d. Migration Considerations

- **Human evaluators need URIs:** Default → `agenta:builtin:human:v0`. User-created → `user:custom:{variant_slug}:v{N}`.
- **Existing custom workflows:** Ensure all `is_custom=True` records have `user:custom:*` URIs. Most already do from the `SDK_CUSTOM` migration.
- **Legacy adapter:** `AppType.CUSTOM` mapped to `agenta:builtin:hook:v0` (correct — legacy "custom" was a builtin template). Document clearly.
- **`AnnotationOrigin`:** Should derive from runnability, not from stored flags. `is_runnable=false` → human/external origin. `is_runnable=true + is_custom` → custom origin. `is_runnable=true + is_builtin` → auto origin.

**Action:**
- [ ] Design URI-based derivation for `is_custom` (from URI) and `is_runnable` (from handler/URL)
- [ ] Backfill URIs for human evaluators
- [ ] Align backend-defined `user:custom` URI key with variant slug, version with revision version
- [ ] Add computed properties to DTOs
- [ ] Phase out stored `is_custom`/`is_feedback` flags
- [ ] Update legacy adapter to produce URIs

## G17. Frontend/Playground — No Request-Flag Support

**What:** The playground and frontend have no mechanism to send request flags (`stream`, `evaluate`, `chat`, `verbose`) per-invocation, and no handling for the different response modes those flags produce.

**Why it matters:** Request flags (G5) let callers activate capabilities per-invocation. But even once the backend supports them, the frontend needs UI and response handling for each:

- **`stream=true`/`stream=false`**: The playground must handle both streaming and batch responses. `stream=true` requires progressive rendering, chunked output display, and abort/cancel support. `stream=false` forces batch even when the workflow supports streaming. Today the playground only handles batch responses.
- **`evaluate=true`**: Evaluation mode changes the trace that is generated (often materialized internally as annotation trace vs invocation trace). The frontend needs to understand and display the different trace shape.
- **`chat=true`/`chat=false`**: Switching between chat and completion mode should change the playground UI — chat mode shows a message thread, completion mode shows input/output forms. Today the mode is static per variant (`is_chat`), not switchable per-invocation.
- **`verbose=true`/`verbose=false`**: In chat mode, `verbose=true` means render the full structured response payload; `verbose=false` means render the concise output (typically the last assistant message only). If `is_verbose=true`, the toggle should be disabled because concise mode is not available.

**Current state:**
- Playground sends invoke requests with no request flags
- Response handling assumes batch-only (no streaming support in playground)
- Chat vs completion mode is determined by `is_chat` identity flag, not switchable at invocation time
- No UI toggle for stream/evaluate/chat/verbose request flags
- No concise vs verbose response rendering path

**Relationship to other gaps:**
- **G4** defines the capability flags (`can_stream`, `can_evaluate`, `can_chat`, `can_verbose`) — what the workflow advertises
- **G5** defines the request flags (`stream`, `evaluate`, `chat`, `verbose`) — what the caller requests
- **G17** is the frontend counterpart — the UI must let users send request flags and handle the resulting response modes

**Action:**
- [ ] Add stream toggle to playground when workflow advertises `can_stream=true`
- [ ] Handle streaming responses in playground (progressive rendering, abort)
- [ ] Add chat/completion mode toggle when workflow advertises `can_chat=true` and `is_chat=false` (supports both modes)
- [ ] Add verbose/concise response toggle when workflow advertises `can_verbose=true` and `is_verbose=false`
- [ ] Handle both concise chat rendering and verbose structured payload rendering
- [ ] Handle evaluation mode traces when `evaluate=true` is sent
- [ ] Disable request-flag toggles when the workflow doesn't advertise the corresponding capability
- [ ] Define graceful fallback UX when a request flag is sent but the workflow doesn't support it

---

## G18. Web Consumers Still Targeting Legacy Serving Endpoints

**What:** The frontend and web packages still call `/test`, `/run`, `/generate`, and `/generate_deployed` — the legacy SDK serving endpoints. The new system exposes `{path}/invoke` per route, but the web layer has not migrated.

**Why it matters:** As long as web consumers hit legacy endpoints, the legacy serving system (`serving.py`, `@ag.entrypoint`) cannot be removed. This is the primary blocker for checkpoint 2.

**Current state:**
- `web/packages/agenta-entities/src/legacyAppRevision/state/runnableSetup.ts` — maps `direct` mode to `/test` and `deployed` mode to `/run`; the resolved URL flows into all playground execution
- `web/oss/src/services/app-selector/api/index.ts` — probes `["/test", "/run", "/generate", "/generate_deployed", "/"]` to extract default parameters from the shared OpenAPI spec
- `web/packages/agenta-entities/src/legacyEvaluator/state/runnableSetup.ts` — same endpoint pattern as `legacyAppRevision`

**Action:**
- [ ] Switch playground invocation URL from `/test`/`/run` to `{routePath}/invoke`
- [ ] Resolve `direct` vs `deployed` mode distinction from the revision `url` field rather than the endpoint suffix
- [ ] Update app-selector schema extraction to probe `/invoke` first; long-term replace path-probe with an inspect-based call
- [ ] Verify `legacyEvaluator` runnableSetup follows the same migration

---

## Gap Themes

The gaps cluster into three cross-cutting themes. Many individual gaps are facets of the same underlying problem.

### Theme 1: Legacy Removal

The system carries a full legacy layer — legacy SDK serving, legacy API adapter, legacy invoke paths, legacy frontend flag reading — running in parallel with the new system. These are not independent gaps; they are the same duality seen from different angles. The legacy layer must be removed, not maintained indefinitely.

| Gap | What's Legacy | What Replaces It |
|-----|--------------|------------------|
| G1 (Dual serving) | `serving.py` — `/run`, `/test`, `/generate`, `/openapi.json` | `running.py` + `routing.py` — `{path}/invoke`, `{path}/inspect` |
| G3 (No OpenAPI in new) | Legacy `/openapi.json` with `x-agenta.flags` | Per-workflow `{path}/openapi.json` in new system (G13) |
| G7 (Legacy adapter) | `legacy_adapter.py` — bidirectional `AppType` ↔ flags mapping | URI-derived classification (G16), no adapter needed |
| G10 (API execution split) | In-process API execution and service handoff coexist without a clear target | Converge on API control-plane dispatch to runtime services |
| G11 (Frontend flag source) | Frontend reads `x-agenta.flags` from legacy `/openapi.json` | Frontend reads from `/inspect`, per-workflow `/openapi.json`, or API-provided classification |
| G12b (Legacy revision fields) | `data.service` / `data.configuration` still exist in revision DTOs and generated client types | Normalize on `uri`, `url`, `headers`, `schemas`, `script`, `parameters`, `runtime` |

These gaps should be tackled together as a coordinated legacy removal effort. Removing the legacy serving system (G1) unblocks removing the legacy adapter (G7), which clarifies the control-plane/runtime split in G10, which unblocks the frontend migration (G11). The new system needs OpenAPI per workflow (G3/G13) before the legacy `/openapi.json` can be dropped.

### Theme 2: Negotiation, Derivation, and Materialization

The current design overuses flags as authored contract input. Streaming/batching should be negotiated at HTTP level, chat behavior should come from schemas/OpenAPI, and identity/classification should come from URI families or trace heuristics. Stored flags should survive only as materialized metadata where needed.

| Gap | What's Wrong | What Fixes It |
|-----|-------------|---------------|
| G4 (Authored capability flags) | Primary capability flags (`can_stream`, `can_chat`, etc.) should not be the execution contract | Move stream/batch to HTTP negotiation; derive chat/evaluate metadata from schemas/URI/registry |
| G5 (Command flags) | Request-time command flags (`stream`, `evaluate`, `chat`, `verbose`) are the wrong surface | Replace with `Accept`-driven negotiation plus caller-side utilities |
| G5a (SDK response-mode API) | SDK invoke does not yet expose explicit response-mode negotiation cleanly | Align SDK invoke with HTTP media-type choices |
| G9 (aggregate/annotate) | Decorator params disconnected from the new negotiation/derivation model | Treat as internal implementation details, not primary external flags |
| G14 (`is_custom` overloaded) | Flag controls request format, caching, topology | Derive from URI family |
| G15 (`is_feedback` misnomer) | Should be a URI-family fact, not a stored authored flag | Derive from custom feedback URI family |
| G16 (URI-derived classification) | Stored flags drift from URI truth | Materialize from URI truth instead of authoring directly |
| G17 (Frontend request-flag support) | Playground still thinks in flags instead of negotiation/schema inference | Use `Accept` plus inspect/OpenAPI/schema heuristics |

### Theme 3: New System Completeness

The new serving/routing system exists but is incomplete. It lacks features the legacy system provides (OpenAPI, route isolation, domain-level endpoints) and features still underspecified in the new design (passive incoming trace-context support, custom schema parity, frontend request-flag support).

| Gap | What's Missing |
|-----|---------------|
| G3 (No OpenAPI in new) | Per-workflow OpenAPI spec |
| G6 (Passive incoming trace support) | SDK runtime trace-context expectations are underspecified and should stay SDK-local |
| G8 (Custom schemas) | Custom workflows have weaker introspection than builtins |
| G12 (App/Eval invoke/inspect) | Applications and evaluators have no invoke/inspect endpoints |
| G12a (Catalog split) | Evaluators/apps lack a clean catalog surface with revision-like entries and separate preset bundles |
| G12b (Legacy revision fields) | Workflow revision data still carries legacy `service` / `configuration` fields |
| G13 (Route isolation) | Multiple workflows share one namespace instead of being isolated |
| G17 (Frontend request-flag support) | Playground has no stream/chat/evaluate/verbose toggles or response handling |

---

## Summary Priority Matrix

| Gap | Severity | Effort | Theme | Suggested Priority |
|-----|----------|--------|-------|--------------------|
| G1 (Dual systems) | High | Large | Legacy | Core — clean up dual serving systems |
| G2 (Inspect caching) | Low | Small | — | Quick win — check if revision data suffices |
| G3 (No OpenAPI in new) | High | Medium | Legacy + Completeness | Core — new system needs OpenAPI per workflow |
| G4 (Authored capability flags) | High | Medium | Negotiation + Derivation | Core — remove primary capability-flag dependence; derive from HTTP/schema/URI/registry truth |
| G5 (Command flags in request) | High | Medium | Negotiation + Derivation | Core — replace stream/evaluate/chat/verbose command flags with content negotiation and schema/URI inference |
| G5a (SDK response-mode API) | Medium | Small | Interface | Important — align SDK invoke with explicit media-type / response-mode choices |
| G6 (Passive incoming trace support) | Medium | Small | Completeness | Narrow — keep support inside SDK routing/running only |
| G7 (Legacy adapter) | High | Small | Legacy | Core — remove legacy adapter |
| G8 (Custom schemas) | High | Medium | Completeness | Core — parity with builtins |
| G9 (aggregate/annotate) | High | Small | Negotiation + Derivation | Core — demote to internal implementation details behind the new contract |
| G10 (API execution split) | High | Large | Architecture + Legacy | Core — converge on API control-plane dispatch to runtime services |
| G11 (Frontend flag source) | High | Medium | Legacy | Core — frontend must read flags from new system, not legacy OpenAPI |
| G12 (App/Eval invoke/inspect) | High | Small | Completeness | Core — thin wrappers over existing workflow endpoints |
| G12a (Catalog split) | High | Medium | Completeness | Core — split evaluator templates into proper catalogs and persist full schemas on create |
| G12b (Legacy revision fields) | High | Medium | Legacy + Completeness | Core — remove `data.service` / `data.configuration` from revision contracts |
| G13 (Route isolation) | High | Medium | Completeness | Core — each workflow must be its own namespace with invoke/inspect/openapi.json |
| G14 (`is_custom` overloaded) | High | Medium | Negotiation + Derivation | Core — derive from URI family instead of authoring directly |
| G15 (`is_feedback` = not runnable) | High | Small | Negotiation + Derivation | Core — replace with URI-family-derived human/custom feedback classification |
| G16 (URI-derived classification) | High | Large | Negotiation + Derivation | Core — make URI the primary identity source and materialize metadata from it |
| G17 (Frontend request-flag support) | High | Medium | Negotiation + Completeness | Core — playground uses `Accept`, schema heuristics, and response-mode handling instead of flag toggles |
