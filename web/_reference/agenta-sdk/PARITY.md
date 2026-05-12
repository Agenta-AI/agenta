# `@agenta/sdk` Python SDK Parity

This document tracks how the TypeScript SDK lines up against the Python SDK.

## Audience

- **Python users coming to TypeScript:** look up a Python operation, find the TS equivalent (or learn it's deferred).
- **Maintainers:** know what's intentionally skipped vs what's a tracked gap.
- **Reviewers:** the v0.2 publish gate checks every Category A item is covered.

## At a glance

| Category | Count | Meaning |
|---|---|---|
| A — covered | ~248 ops | Documented Python feature has a TS equivalent. v0.2 publish gate checks this. |
| B — language-different | ~5 ops | Different mechanism in TS (decorators → HOFs, Pydantic → Zod). Documented rationale, not a gap. |
| C — deferred to v0.3+ | ~26 ops | Tracked but not in v0.2. Use raw `client.post(...)` if needed today. |
| Skipped (legacy / duplicate) | ~60 ops | Python Fern auto-generated for legacy paths or duplicate sub-clients. TS doesn't replicate. |

Numbers are approximate because Python's Fern auto-generation produces sync + async + raw variants of every method; the canonical-operation count is what matters.

## Category A — covered (the v0.2 gate)

Each Python operation here has a TypeScript equivalent reachable from `ag.<resource>.<method>(...)`. Naming differs because the TS SDK uses REST-style names; the Python SDK uses domain manager names (this is decision D5 in the sprint plan).

### Initialization & config

| Python | TypeScript |
|---|---|
| `ag.init(host, api_key, project_id, ...)` | `new Agenta({host, apiKey, projectId, ...})` |
| Env vars `AGENTA_HOST`, `AGENTA_API_KEY`, `AGENTA_PROJECT_ID` | Same env vars, plus `NEXT_PUBLIC_AGENTA_*` fallbacks |
| `ag.ConfigManager.get_from_yaml(filename, schema)` | `loadFromYaml(filename, schema?)` |
| `ag.ConfigManager.get_from_json(filename, schema)` | `loadFromJson(filename, schema?)` |

### Prompt / config registry

| Python | TypeScript |
|---|---|
| `ag.ConfigManager.get_from_registry(app_slug, environment_slug, ...)` | `ag.prompts.fetch({slugs, environment, ...})` |
| `ag.ConfigManager.aget_from_registry(...)` | `ag.prompts.fetch(...)` (already async) |
| `ag.ConfigManager.get_from_route(schema)` | (Category C — TS has no route framework yet) |

### Applications

| Python | TypeScript |
|---|---|
| `ag.AppManager.create(app_slug, template_key)` | `ag.applications.create({...})` |
| Fetch / list / update | `ag.applications.get / list / query / update` |
| Soft-delete app | `ag.applications.archive(id)` / `unarchive(id)` |
| `ag.VariantManager.delete(variant_slug, app_slug)` | `ag.applications.archiveVariant(id)` / `unarchiveVariant(id)` |
| Find by slug | `ag.applications.findBySlug(slug)` |

### Revisions (git-style versioning)

| Python | TypeScript |
|---|---|
| `ag.VariantManager.commit(parameters, ...)` | `ag.revisions.commit({application_id, data, message})` |
| Fetch revision by ref | `ag.revisions.retrieve({applicationRef \| applicationVariantRef \| applicationRevisionRef \| environmentRef})` |
| Fetch by app slug | `ag.revisions.retrieveBySlug(slug)` |
| Fetch by app id | `ag.revisions.retrieveByAppId(id)` |
| `ag.VariantManager.history(...)` | `ag.revisions.log({applicationId, depth})` |

### Environments / deployments

| Python | TypeScript |
|---|---|
| `ag.DeploymentManager.deploy(variant_slug, environment_slug)` | `ag.environments.deploy({environmentId, appId, appRevisionId, ...})` |
| `ag.DeploymentManager.adeploy(...)` | Same (always async) |
| Resolve environment | `ag.environments.resolve({environmentRef})` |
| Ensure exists | `ag.environments.ensureExists(slug, name)` |

### Test sets

| Python | TypeScript |
|---|---|
| `ag.testsets.acreate(name, data)` | `ag.testsets.create({slug, name, testcases})` |
| `ag.testsets.aretrieve(id_or_name)` | `ag.testsets.get(id)` / `findBySlug(slug)` |
| `ag.testsets.alist()` | `ag.testsets.list()` |
| Update | `ag.testsets.update(id, {testcases, ...})` |
| Archive / unarchive | `ag.testsets.archive(id)` / `unarchive(id)` |
| Transfer between projects | `ag.testsets.transfer(id, request)` |
| Upload / download | `ag.testsets.upload({formData})` / `download(id, fileType)` |
| Commit revision | `ag.testsets.commitRevision({testsetId, testcases, message})` |
| Revision retrieve / log / query | `ag.testsets.retrieveRevision / logRevisions / queryRevisions` |
| Revision archive / unarchive | `ag.testsets.archiveRevision(id)` / `unarchiveRevision(id)` |
| Revision download | `ag.testsets.downloadRevision(revisionId, fileType)` |
| Variant CRUD | `ag.testsets.createVariant / archiveVariant / unarchiveVariant / queryVariants` |

### Evaluators

| Python | TypeScript |
|---|---|
| Simple evaluator CRUD | `ag.evaluators.create / get / update / query / list / findBySlug` |
| Simple lifecycle | `ag.evaluators.archive(id)` / `unarchive(id)` / `transfer(id, request)` |
| Catalog templates | `ag.evaluators.listTemplates / getTemplate / listPresets` |
| Revision retrieve / commit | `ag.evaluators.retrieveRevision / commitRevision` |
| Revision get / archive / unarchive | `ag.evaluators.getRevision(id)` / `archiveRevision(id)` / `unarchiveRevision(id)` |
| Revision log / query | `ag.evaluators.logRevisions(request)` / `queryRevisions(options?)` |
| Variant CRUD | `ag.evaluators.createVariant / getVariant / archiveVariant / unarchiveVariant / forkVariant / queryVariants` |

### Queries (saved filters)

| Python | TypeScript |
|---|---|
| Full-query CRUD | `ag.queries.create / get / update / query / archive / unarchive` |
| Revisions: retrieve / commit | `ag.queries.retrieveRevision / commitRevision` |
| Revision get / archive / unarchive | `ag.queries.getRevision / archiveRevision / unarchiveRevision` |
| Revision log / query | `ag.queries.logRevisions / queryRevisions` |
| Simple-query lifecycle | `ag.queries.createSimple / getSimple / archiveSimple / unarchiveSimple / querySimple` |

### Workflows (the unified entity behind apps + evaluators)

| Python | TypeScript |
|---|---|
| Workflow CRUD | `ag.workflows.create / edit / update / query / archive / unarchive` |
| Convenience filters | `ag.workflows.listEvaluators` / `listApplications` / `findBySlug` / `findEvaluatorBySlug` / `fetchLatest` |
| Catalog templates | `ag.workflows.listTemplates / getTemplate / findTemplateByUri / fetchInterfaceSchemas` |
| Inspect / invoke | `ag.workflows.inspect(request)` / `invoke(request)` |
| Revisions: retrieve / commit / log | `ag.workflows.retrieveRevision / commitRevision / logRevisions` |
| Revision get / query / archive / unarchive | `ag.workflows.getRevision / queryRevisions / archiveRevision / unarchiveRevision` |
| Variants: create / get / fork / archive / unarchive / query | `ag.workflows.createVariant / getVariant / forkVariant / archiveVariant / unarchiveVariant / queryVariants` |

### Evaluations

| Python | TypeScript |
|---|---|
| Run CRUD | `ag.evaluations.createRuns / queryRuns / getRun / editRuns / deleteRuns / getRunsByIds / getRunsByReference` |
| Run lifecycle | `ag.evaluations.openRun(id)` / `closeRun(id, status)` / `openRuns / closeRuns` |
| Refresh runs / metrics | `ag.evaluations.refreshRuns(request)` / `refreshMetrics(request)` |
| Scenarios | `ag.evaluations.createScenarios / queryScenarios / getScenario / editScenarios / deleteScenarios` |
| Results | `ag.evaluations.queryResults / getResult` |
| Metrics | `ag.evaluations.queryMetrics / createMetrics / editMetrics / deleteMetrics` |
| Queues | `ag.evaluations.createQueues / queryQueues / getQueue / queryQueueScenarios / deleteQueue / deleteQueues` |
| Compare runs | `ag.evaluations.compareRuns({run_ids})` |
| `aevaluate(testsets, applications, evaluators)` | `ag.evaluations.createSimple({...})` plus `startSimple(id)` / `getSimple(id)` / `closeSimple(id)` / `stopSimple(id)` |

### Annotations

| Python | TypeScript |
|---|---|
| Create / update / delete by trace | `ag.annotations.create / editByTrace / deleteByTrace` |
| Get by trace (and optionally span) | `ag.annotations.getByTrace(traceId, spanId?)` |
| Query | `ag.annotations.query({filters, windowing})` |
| Convenience: get for many traces | `ag.annotations.getForTraces(traceIds)` |
| Convenience: human feedback shortcut | `ag.annotations.createHumanFeedback({trace_id, span_id, rating, comment, ...})` |

### Tracing / observability

| Python | TypeScript |
|---|---|
| Query spans / traces | `ag.tracing.querySpans / queryTraces` |
| List spans / traces | `ag.tracing.listSpans / listTraces` |
| Get span / trace | `ag.tracing.getSpan(traceId, spanId)` / `getTrace(traceId)` |
| Delete trace | `ag.tracing.deleteTrace(traceId)` |
| Sessions | `ag.tracing.querySessions({applicationId})` |
| Users | `ag.tracing.queryUsers({applicationId})` |
| Analytics (trace-level) | `ag.tracing.queryAnalytics(request)` |
| Span analytics (token usage, latencies) | `ag.tracing.spanAnalytics(request)` |
| Convenience: traces by application | `ag.tracing.queryByApplication(appId, options?)` |

### Vault / secrets

| Python (`secrets` Fern sub-client) | TypeScript |
|---|---|
| `create_secret` | `ag.vault.create(request)` |
| `read_secret` | `ag.vault.get(secretId)` |
| `update_secret` | `ag.vault.update(secretId, request)` |
| `delete_secret` | `ag.vault.delete(secretId)` |
| `list_secrets` | `ag.vault.list()` |

### Org / project / workspace / profile

| Python | TypeScript |
|---|---|
| Organization CRUD | `ag.organizations.*` (covers both `organization` singular and `organizations` plural Python sub-clients) |
| Workspace CRUD | `ag.workspaces.*` |
| Projects (also covers Python's `scopes` sub-client) | `ag.projects.*` |
| Profile | `ag.profile.*` |
| API keys | `ag.apiKeys.*` |
| Folders | `ag.folders.*` |

### Net-new in TypeScript (no Python equivalent in the public docs)

These are TypeScript-side surfaces that don't appear in the Python public docs. **All are public API for v0.2** (per the public-API audit, 2026-04-29). Some are convenience helpers built on top of existing resources; others map to backend endpoints that the Python Fern client also generates clients for, just under different sub-client names.

**Convenience helpers** (composed on top of other resources):

- `ag.prompts.push({...})` / `pushMany([...])` — high-level "create app + commit revision + deploy" idempotent helper.
- `ag.prompts.fetchOne(slug, ...)` — single-slug shorthand.
- `ag.prompts.getApplicationRefs(slug)` — return `{applicationId, revisionId}` for telemetry tagging.
- `ag.testsets.createFromTraces({...})` — compose a testset from existing trace IDs by extracting fields.

**TS-only LLM-powered features:**

- `ag.optimization.*` — `generateTestCases`, `generateVariant`, `generateCandidates`, `simulateConversation`. Run client-side, use the consumer's LLM client.

**Resources covering real backend endpoints not documented for Python:**

| TS Resource | Backend mount | Methods | Use case |
|---|---|---|---|
| `ag.profile` | `/profile` | `fetch`, `updateUsername` | Multi-user apps wanting "logged in as" semantics |
| `ag.projects` | `/projects` | `list`, `get`, `create`, `update`, `delete` | Multi-project tenancy |
| `ag.tools` | `/preview/tools` | catalog browsing (12 ops covering providers/integrations/actions, connections, execution) | Building agents that use third-party tool integrations (Composio etc.) |
| `ag.webhooks` | `/webhooks` | `create`, `edit`, `delete`, `query`, `test`, `queryDeliveries` | Customer-side webhook subscriptions for eval / deployment events |
| `ag.aiServices` | `/ai/services` | `getStatus`, `callTool` | Programmatic access to Agenta-hosted AI tools (prompt refinement, etc.) |

These are real backend endpoints with active routers (verified in [api/entrypoints/routers.py](api/entrypoints/routers.py)). They're not "TS inventions" — they cover concerns Python's Fern client also generates clients for, just outside the Python public docs.

## Category B — language-different (rationale documented)

These features exist on both sides but use different mechanisms because of language idioms. Each one has a documented TypeScript-native alternative.

| Python feature | TypeScript equivalent | Rationale |
|---|---|---|
| `@ag.instrument()` decorator on functions | `withSpan(name, fn)` HOF + setting `ag.type.node` attribute | TypeScript decorators are still Stage 3 with churn; HOFs work everywhere today and don't require a `tsconfig` opt-in. The `withSpan` helper covers the common case ergonomically. |
| Pydantic `BaseModel` schemas | Zod schemas | Zod is the standard TS validation library; declared as a peer dep. The `loadFromJson` / `loadFromYaml` helpers and `Prompts.fetch` Zod validation mirror the Pydantic usage on the Python side. |
| LiteLLM auto-instrumentation | Server-side adapters in the backend (`vercelai_adapter.py`, `openllmetry_adapter.py`, etc.) translate framework-native attributes to `ag.*`. TS users emit native AI SDK / Mastra spans; backend handles the rest. | TypeScript ecosystem has Vercel AI SDK + Mastra as its dominant frameworks, neither of which is what LiteLLM wraps. The architectural choice (D2 in the sprint plan) is "server-side authoritative" so this language-different mapping is by design, not a gap. |
| Pydantic schema validation on every config fetch | OpenAPI-derived Zod schemas at every API boundary. | The full pattern: `pnpm generate:schemas` runs `openapi-zod-client` against the backend's OpenAPI spec, post-processes for Zod 4 + strips Zodios runtime, and writes [`src/.generated/schemas.ts`](src/.generated/schemas.ts). Resource methods call [`validateBoundary(raw, schemas.X, "label")`](src/.generated/index.ts) which runs `safeParse` and either returns the parsed value or logs a one-line drift warning and falls through. Every generated schema ends with `.passthrough()` — backend `extra="allow"` semantics are preserved, so unknown fields don't trigger drift. See the [Response validation coverage](#response-validation-coverage) section for a method-level matrix. |
| `ag.tracing.store_session(session_id)` / `store_user(user_id)` | OTel baggage in `@agenta/sdk-tracing` (`setAgentaContext({session, user})`) | The TypeScript tracing package uses standard OTel baggage so session/user propagate across processes via traceparent headers. Python's helper writes the same baggage; just exposed differently. |

## Category C — deferred to v0.3+ (tracked, not lost)

Each item below has a Python operation that is **not** reachable from the TypeScript SDK in v0.2. Use the raw `ag.client.post(...)` if you need them today.

### Custom workflows / `@ag.route` analog (no v0.2 timeline)

Python's `@ag.route` decorator + FastAPI integration provides a complete server framework for hosting custom workflows on Agenta-managed infrastructure. The TypeScript SDK has no equivalent because the team hasn't picked a server framework (Hono / Express / Fastify / Next.js routes / framework-agnostic primitives). Tracked as a dedicated sprint, no v0.2 timeline.

Workaround for v0.2: build your own server with the framework you prefer; instrument with `@agenta/sdk-tracing` and call Agenta operations via `@agenta/sdk` resources.

### Trace redaction at the SDK level (compliance ask)

Python's `@ag.instrument(redact=...)` lets you strip PII from spans before they're emitted. TypeScript users can implement this on top of OTel span processors today, but the SDK doesn't ship a built-in `redact` helper.

Workaround for v0.2: use OTel's `BatchSpanProcessor` filter pattern to remove or mask attributes before export.

### Admin / EE endpoints

The Python Fern client auto-generates operations against `/admin/*`, `/billing/*`, `/permissions/*`, `/containers/*`. These are platform-admin or EE-only and not relevant to the typical SDK consumer.

| Python sub-client | Endpoints |
|---|---|
| `admin` | account provisioning, Stripe checkout/portal, plan switching, usage flushing |
| `billing` | plans, subscription, usage, Stripe events, checkout/portal |
| `access_control` | `/permissions/verify` |
| `containers` | `/containers/templates` (self-host runtime listing) |

Workaround for v0.2: hit these endpoints via `ag.client.post(...)` directly. Examples:

```ts
// Verify a permission (admin)
const ok = await ag.client.post("/permissions/verify", {permission: "edit_prompts"})

// List billing plans (EE)
const plans = await ag.client.get("/billing/plans", {legacy: true})
```

### Invocations (`/preview/invocations/*`)

The Python Fern client has 8 operations for the invocations resource. The backend router exists at [api/oss/src/apis/fastapi/invocations/router.py](https://github.com/Agenta-AI/agenta/blob/main/api/oss/src/apis/fastapi/invocations/router.py) but is **not mounted** in [api/entrypoints/routers.py](https://github.com/Agenta-AI/agenta/blob/main/api/entrypoints/routers.py). The Python SDK methods exist but 404 in production.

Action: deferred until backend mounts the router. Worth flagging to the backend team.

## Skipped — won't replicate

Python's Fern client auto-generates from the OpenAPI spec, which exposes:

- **Legacy endpoints** the TypeScript SDK intentionally bypasses because canonical replacements exist.
- **Duplicate sub-clients** that hit the same handlers as another sub-client (Fern artifacts).

These are genuinely not gaps. Listed for transparency.

### Legacy

| Python sub-client | Why skipped |
|---|---|
| `variants` (17 ops, mounted at `legacy_variants.router`) | Replaced by `Revisions` (commit, log, retrieve) plus `Applications.archiveVariant` / `unarchiveVariant`. |
| `apps` (11 ops at `apps/*` non-preview paths) | Predates the modern `applications` resource. TS uses `Applications` exclusively. |
| `configs` (3 ops at `configs/deployment/*`) | Partially superseded by the `Environments` deploy methods. |
| `human_evaluations` (10 ops at `/human-evaluations/*`) | Older API; replaced by the queues concept under `/preview/evaluations/queues/*`. Use `ag.evaluations.createQueues / queryQueues / queryQueueScenarios` instead. |
| `auth` (4 ops: SSO callback, session identities) | Browser-flow only. Not SDK-shaped. The TS SDK delegates to the consumer's auth library (NextAuth, Clerk, custom) and accepts an `authProvider` for runtime token refresh. |

### Duplicates of existing TS resources

| Python sub-client | TS equivalent |
|---|---|
| `secrets` | `Vault` — identical surface (create, read, update, delete, list). The two sub-clients in the Python Fern client hit the same endpoints. |
| `organization` (singular, 5 ops) | `Organizations` plural (covers all 5 + 12 more). The singular form is a Fern artifact. |
| `scopes` | `Projects` — Fern paths are `projects/*` despite the sub-client name. |

## Response validation coverage

The OpenAPI-derived Zod pipeline (Category B row above) generates `.passthrough()` schemas for every documented response shape. Resource methods wrap responses with [`validateBoundary`](src/.generated/index.ts) so type-shape drift between SDK and backend is caught early — a one-line `console.warn` is emitted and the raw payload still passes through unchanged.

### Methods wrapped with `validateBoundary`

These methods now return typed `SchemaOf<...>` payloads (validated at runtime, typed at compile time):

| Resource | Method(s) | Schema |
|---|---|---|
| `Workflows` | `query` | `WorkflowsResponse` |
| `Workflows` | `retrieveRevision` | `WorkflowRevisionResponse` |
| `Workflows` | `logRevisions` | `WorkflowRevisionsResponse` |
| `Evaluations` | `refreshMetrics`, `postMetrics`, `editMetrics` | `EvaluationMetricsResponse` |
| `Evaluations` | `refreshRuns` | `EvaluationRunsResponse` |
| `Evaluations` | `editRun` | `EvaluationRunResponse` |
| `Evaluations` | `editResults` | `EvaluationResultsResponse` |
| `Evaluations` | `deleteScenarios` | `EvaluationScenarioIdsResponse` |
| `Evaluations` | `queryQueues` | `EvaluationQueuesResponse` |
| `Evaluations` | `getQueue` | `EvaluationQueueResponse` |
| `Evaluations` | `deleteQueue` | `EvaluationQueueIdResponse` |
| `Evaluations` | `deleteQueues` | `EvaluationQueueIdsResponse` |
| `Environments` | `deploy` | `EnvironmentRevisionResponse` |
| `Environments` | `resolve` | `EnvironmentRevisionResolveResponse` |
| `Environments` | `guard`, `unguard` | `SimpleEnvironmentResponse` |
| `Environments` | `queryRevisions` | `EnvironmentRevisionsResponse` |
| `TestSets` | `unarchiveRevision`, `retrieveRevision`, `getRevision`, `archiveRevision` | `TestsetRevisionResponse` |
| `TestSets` | `logRevisions`, `queryRevisions` | `TestsetRevisionsResponse` |
| `TestSets` | `transfer` | `TestsetResponse` |
| `TestSets` | `createVariant`, `archiveVariant`, `unarchiveVariant`, `getVariant` | `TestsetVariantResponse` |
| `TestSets` | `queryVariants` | `TestsetVariantsResponse` |
| `TestSets` | `getTestset` | `SimpleTestsetResponse` |
| `TestSets` | `queryTestsets` | `SimpleTestsetsResponse` |
| `TestCases` | `query`, `queryPage` | `TestcasesResponse` |
| `Tracing` | `queryUsers` | `UserIdsResponse` |
| `Tracing` | `queryAnalytics`, `spanAnalytics` | `AnalyticsResponse` |
| `Tracing` | `querySessions` | `SessionIdsResponse` |

Adding more wrappers is mechanical (one extra line per call site). Schemas regenerate via `pnpm generate:schemas` after the backend OpenAPI spec changes.

### Methods intentionally returning `Promise<unknown>`

These stay untyped on purpose, in roughly three buckets:

1. **Routes not in the public OpenAPI spec** — `Workflows.inspect` / `Workflows.invoke` hit `/preview/workflows/{inspect,invoke}` which the public spec doesn't expose; routes may also 404 in some deployments. Some `/preview/*` getters (single trace / span fetches) are similarly absent because the spec emits them only at the non-preview path. Tracked for a future spec emission pass.
2. **Mutation / lifecycle endpoints** where the caller rarely inspects the response (`archive`, `delete*`, `edit*`, `transferOwnership`, environment guard/unguard, etc.).
3. **Legacy endpoints** (organizations, workspaces, environments admin, file-config loaders) — covered by the legacy surface; not part of the v0.2 critical path.

These are explicit choices, not gaps. They will tighten progressively as the backend OpenAPI spec gains coverage and as we get usage signal on which mutation responses callers actually inspect.

## Methodology

The audit was generated by:

1. Enumerating every method on every Python Fern sub-client (`sdk/agenta/client/backend/*/client.py`), filtering out sync/async duplicates.
2. Extracting the actual URL paths from each `raw_client.py`.
3. Comparing against the operations exposed by `@agenta/sdk` resource classes.
4. Categorizing each operation as A / B / C / Skipped based on path inspection (legacy router mount, preview prefix, sub-client overlap).
5. For Category C, verifying the backend exposes the route (the invocations finding came from this step — backend code exists but isn't mounted).

The full audit log including method-level mapping lives at `~/.gstack/projects/agenta_open_source/ts-sdk-parity-audit.md` (project-internal).

## What this means for v0.2 publish

Per the no-publish-until-parity gate locked in the sprint plan:

- **Category A is the publish gate.** Every operation in section "Category A" must have passing tests + reachable from `ag.<resource>.<method>(...)`. Reviewer signs off here.
- **Category B is documented**, not gated.
- **Category C is allowed**, marked in this doc and in the relevant Python-equivalent docs pages so users searching for those features know the v0.3 timeline.
- **Skipped** is just a note. Not a gate item.

## Reporting drift

If you find a Python operation that's missing from this doc and missing from the SDK, file an issue tagged `parity-gap`. Include:

- The Python `client.py` method name
- The URL path it hits
- A suggested category (A / B / C)

Drift is most likely to come from new backend endpoints added between Fern regenerations.
