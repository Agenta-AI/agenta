# Research: Current Human Evaluation Implementation

This document maps the current human evaluation stack — from UI to storage — as it works today. It covers the frontend components, state management, API calls, backend service logic, and annotation storage. The goal is to understand what exists before designing the v2 annotation queue.

---

## Overview

Human evaluation today is tightly woven through two overlapping systems:

1. **Evaluation runs** — the main path for structured human evaluation on test sets. A run is created with human evaluator steps. Annotators open each scenario row and fill in metric values. Results land in `evaluation_results` linked to the run.

2. **Ad-hoc trace annotation** — a lighter path from the observability view. A user spots a trace in the traces table, opens the `AnnotateDrawer`, fills in metric values, and submits. The annotation is stored as an OTel span of type `annotation`.

Both paths share the same annotation storage and the same evaluator definitions. They diverge in how they get invoked and what they write back to.

---

## Frontend: Components and Data Flow

### Key Files

```
web/oss/src/
├── components/
│   ├── pages/evaluations/humanEvaluation/
│   │   └── EmptyStateHumanEvaluation/     # Empty state shown before any runs exist
│   ├── EvalRunDetails/
│   │   ├── components/
│   │   │   ├── AnnotateDrawer/
│   │   │   │   └── VirtualizedScenarioTableAnnotateDrawer.tsx  # Main annotation UI in eval table
│   │   │   └── TableCells/
│   │   │       └── MetricCell.tsx         # Renders annotation values in the scenarios table
│   │   └── atoms/table/run.ts             # Classifies steps as input / invocation / annotation
│   └── SharedDrawers/
│       ├── AnnotateDrawer/                # Annotation drawer (used from trace view + eval table)
│       │   ├── index.tsx                  # Multi-step wizard controller
│       │   └── assets/
│       │       ├── Annotate/index.tsx     # Metric input form (per evaluator)
│       │       └── AnnotateDrawerTitle/index.tsx  # Save logic, API calls
│       └── TraceDrawer/
│           └── components/TraceContent/
│               └── components/
│                   ├── AnnotationTabItem/ # Shows annotations grouped by evaluator on a span
│                   └── TraceTypeHeader/   # "Annotate" button that opens AnnotateDrawer
├── lib/hooks/
│   ├── usePreviewEvaluations/index.ts     # Eval run lifecycle (create, query)
│   └── useAnnotations/index.ts            # SWR hook to query annotations
└── services/annotations/api.ts            # createAnnotation / updateAnnotation API calls
```

---

### The AnnotateDrawer (Shared Component)

`web/oss/src/components/SharedDrawers/AnnotateDrawer/index.tsx`

A 400px-wide multi-step drawer used from both the trace view and the eval table. It has three steps:

| Step | Enum value | What it shows |
|------|-----------|---------------|
| 1 | `ANNOTATE` | Metric input fields per selected evaluator |
| 2 | `SELECT_EVALUATORS` | Pick which human evaluators to annotate with |
| 3 | `CREATE_EVALUATOR` | Create a new human evaluator on the fly |

**Key props:**
- `data?: AnnotationDto[]` — existing annotations for the target span (pre-fills fields)
- `traceSpanIds?: {traceId, spanId}` — the span being annotated
- `evalSlugs?: string[]` — pre-select specific evaluator slugs
- `showOnly?` — lock to a single step (e.g., always show `ANNOTATE`)
- `queryKey?` — TanStack Query key to invalidate after save

**Deduplication on open:**
When the drawer opens, existing `AnnotationDto[]` are deduplicated:
- Sort by `createdAt` descending
- Keep latest per `references.evaluator.slug`
- Filter to only annotations where `origin === "human"` AND `channel === "web"` AND `created_by_id === currentUserId`
- Other users' annotations are noted but fields are shown empty (so the current user submits their own)

**Evaluator selection** is persisted in `localStorage` under key `${projectId}-evaluator` so users don't have to re-select on every open.

**Metric rendering** (`assets/Annotate/index.tsx`):

Each evaluator's JSON schema drives the input widgets via `PlaygroundPropertyControl`:

| Schema type | Widget |
|-------------|--------|
| `integer` / `number` | Slider or numeric input (with optional min/max) |
| `string` | Text input |
| `boolean` | Toggle / thumbs up-down |
| `array` of enum strings | Multi-select label picker |
| `anyOf [string, null]` enum | Single-select dropdown |

**Save logic** (`assets/AnnotateDrawerTitle/index.tsx`, `onSaveChanges()`):

1. For existing annotations with changes → `PATCH /annotations/{traceId}/{spanId}`
2. For newly selected evaluators → `POST /annotations/`
3. After save, invalidate:
   - Jotai `fetchAnnotations()` (for observability table)
   - SWR cache entries matching `/annotations/`
   - SWR cache for `/evaluators`
   - Optional TanStack Query key passed via `queryKey` prop

---

### VirtualizedScenarioTableAnnotateDrawer (Eval Table Path)

`web/oss/src/components/EvalRunDetails/components/AnnotateDrawer/VirtualizedScenarioTableAnnotateDrawer.tsx`

This is the annotation UI specifically for evaluation run scenario tables. It is opened by clicking a row's action cell, which sets the global atom `virtualScenarioTableAnnotateDrawerAtom` with `{scenarioId, runId}`.

**What it reads on open:**
- `scenarioStepsQueryFamily({scenarioId, runId})` — fetches the steps for this scenario
- `scenarioAnnotationsQueryAtomFamily({traceIds, runId})` — fetches existing annotations (collecting `traceId`s from both invocation steps and prior annotation steps)
- `evaluationEvaluatorsByRunQueryAtomFamily(runId)` — fetches human evaluators configured for this run

**`handleAnnotate()` — what happens on submit:**

```
1.  updateAnnotation()     → PATCH /annotations/{tid}/{sid}   (for changed existing annotations)
2.  createAnnotation()     → POST  /annotations/               (for newly-selected evaluators)
3.  upsertStepResultWithAnnotation()
                           → PATCH /evaluations/results/       (links annotation trace_id to step result)
4.  upsertScenarioMetricData()
                           → POST  /run-metrics/...             (stores per-scenario metric summaries)
5.  updateScenarioStatus(scenarioId, "success")
                           → PATCH /evaluations/scenarios/...
6.  checkAndUpdateRunStatus(runId)
                           → may PATCH /evaluations/runs/...
7.  triggerMetricsRefresh({projectId, runId, scenarioId})
                           → POST  /evaluations/metrics/refresh
8.  Invalidate all relevant caches
```

The critical step is #3: the annotation's OTel `trace_id` is written into `EvaluationResult.trace_id`, creating the link between the evaluation system and the annotation storage.

---

### MetricCell

`web/oss/src/components/EvalRunDetails/components/TableCells/MetricCell.tsx`

Renders annotation values in the scenarios table. Key behaviors:

- Uses `useScenarioCellValue({scenarioId, runId, column})` to read the value
- Shows a greyed-out "invalid" state if `scenarioHasInvocationAtomFamily` returns false (no invocation yet)
- For annotation columns (`column.stepType === "annotation"`), metric paths are prefixed with `attributes.ag.` to match how OTel attributes are stored
- Shows a `MetricDetailsPreviewPopover` on hover with run-level aggregated stats (mean, distribution)

---

### usePreviewEvaluations — Eval Run Creation

`web/oss/src/lib/hooks/usePreviewEvaluations/index.ts`

This hook manages evaluation run lifecycle. The `createNewRun()` function orchestrates run creation:

```
1. If testset given: paginate through POST /testcases/query to collect testcase IDs
2. Build run payload with meta: {evaluation_kind: "human"}
3. POST /evaluations/runs/        → creates the EvaluationRun
4. POST /evaluations/scenarios/   → creates one scenario per testcase row
5. POST /evaluations/results/     → seeds placeholder step results
   (one per: input step, invocation step, each annotation step)
```

Human evaluation runs are flagged with `has_human: true` in `EvaluationRunFlags`. This is how the UI filters to show only human eval runs in the Human Evaluation tab.

**Note:** The frontend does NOT currently call the queue endpoints (`/evaluations/queues/`). The `EvaluationQueue` backend is fully implemented but unused by the frontend. There is no assignment, no inbox, and no per-item status — any annotator can annotate any scenario.

---

### useAnnotations Hook

`web/oss/src/lib/hooks/useAnnotations/index.ts`

Simple SWR hook that queries annotations:
- Calls `POST /annotations/query?project_id=...`
- Transforms raw API data: resolves `created_by_id → username`, formats dates, groups output values
- Returns standard SWR response

**`AnnotationDto` structure:**

```typescript
interface AnnotationDto {
    trace_id?: string
    span_id?: string
    data: { outputs?: Record<string, FullJson> }
    references?: {
        evaluator: { id?, slug?, version?, attributes? }
        evaluator_revision?: { ... }
        testset?: { ... }
        testcase?: { ... }
    }
    links?: Record<string, { trace_id?, span_id? }>
    channel?: "web" | "sdk" | "api"
    kind?: "adhoc" | "eval"
    origin?: "custom" | "human" | "auto"
    createdAt?: string
    createdBy?: string
    createdById?: string
}
```

---

## Backend: Annotation Storage

### Key insight: Annotations are OTel traces

Annotations are **not stored in a dedicated database table**. They are stored as OTel spans of type `annotation` in the tracing system (Clickhouse / OTel store).

`api/oss/src/core/annotations/service.py`

**`create()` flow:**
1. Look up evaluator revision by slug/id
2. If no evaluator exists, auto-create one using `SimpleEvaluatorsService.create()` with a JSON schema inferred via `genson.SchemaBuilder`
3. Set `AnnotationFlags`:
   ```python
   AnnotationFlags(
       is_evaluator=True,
       is_custom=origin == "custom",
       is_human=origin == "human",
       is_sdk=channel == "sdk",
       is_web=channel == "web",
       is_evaluation=kind == "eval",
   )
   ```
4. Serialize all data into OTel span attributes via `parse_into_attributes()`
5. Create an `OTelTracingRequest` with:
   - `trace_type = TraceType.ANNOTATION`
   - `span_type = SpanType.TASK`
   - Fresh random `trace_id` and `span_id`
   - OTel `links` containing the linked invocation span IDs
6. Call `self.tracing_router.create_trace(..., sync=True)` (synchronous write)
7. Return `Link(trace_id, span_id)`

**Annotation OTel span shape:**

```
trace_id:  <random hex, the annotation's own trace>
span_id:   <random hex>
attributes:
  ag.type.trace          = "annotation"
  ag.flags.is_human      = true
  ag.flags.is_web        = true
  ag.flags.is_evaluation = true   ← if kind == "eval"
  ag.data.outputs        = {"score": 4, "comment": "looks good"}
  ag.references.evaluator = {"id": "...", "slug": "quality-rating"}
links[0]:
  trace_id = <the application invocation trace>
  span_id  = <the specific span being annotated>
```

**`query()` flow:**
- Builds an OTel `TracingQuery` filtering on:
  - `ag.type.trace == "annotation"`
  - `flags.*` for origin/channel/kind
  - `references` for evaluator id/slug
  - `links` for linked invocation span
- Calls `self.tracing_router.query_spans()`
- Parses each result span's attributes back to `Annotation` DTO

### Annotation API Endpoints

Mounted at `/annotations/`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create annotation |
| GET | `/{trace_id}` | Fetch by trace (root span) |
| GET | `/{trace_id}/{span_id}` | Fetch by span |
| PATCH | `/{trace_id}` | Edit annotation |
| PATCH | `/{trace_id}/{span_id}` | Edit annotation |
| DELETE | `/{trace_id}` | Delete annotation |
| DELETE | `/{trace_id}/{span_id}` | Delete annotation |
| POST | `/query` | Filter/search annotations |

The `trace_id` here is the **annotation's own OTel trace id**, not the application trace it annotates. The link to the application trace is stored inside the annotation span's `links` array.

---

## Backend: Human Evaluators

### What Makes an Evaluator "Human"

The `is_human` flag propagates through the whole stack:

- `WorkflowFlags.is_human: bool = False` (base, in `api/oss/src/core/workflows/dtos.py`)
- `EvaluatorFlags(WorkflowFlags)` inherits it
- `SimpleEvaluatorFlags(EvaluatorFlags)` inherits it
- A human evaluator has **no `service.uri`** — it has only a JSON schema defining what metrics to collect

**Frontend filter:** `useEvaluators({preview: true, queries: {is_human: true}})` → `POST /simple/evaluators/query` with body `{evaluator: {flags: {is_human: true}}}`

**Evaluator-as-Workflow pattern:**  
Human evaluators are stored via the Git-style Artifact/Variant/Revision pattern in `workflow_artifacts`, `workflow_variants`, `workflow_revisions` tables. `EvaluatorsService` is an alias of `WorkflowsService`. The evaluator's JSON schema lives in `data.service.format` on the revision.

### Default Human Evaluator

Auto-created per project on project creation:

```python
# api/oss/src/core/evaluators/defaults.py
SimpleEvaluatorCreate(
    slug="quality-rating",
    name="Quality Rating",
    description="Rate the quality of responses with a simple thumbs up or down.",
    flags=SimpleEvaluatorFlags(is_custom=False, is_human=True),
    data=SimpleEvaluatorData(service={
        "agenta": "v0.1.0",
        "format": {
            "type": "object",
            "required": ["outputs"],
            "properties": {
                "outputs": {
                    "type": "object",
                    "properties": {"approved": {"type": "boolean"}},
                    "required": ["approved"],
                }
            }
        }
    })
)
```

---

## End-to-End Flow: Human Evaluation in an Eval Run

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. SETUP                                                           │
│                                                                     │
│  POST /simple/evaluators/      → create human evaluator    │
│    flags: {is_human: true}                                          │
│    data.service.format: <JSON schema>                               │
│                                                                     │
│  POST /evaluations/runs/       → create eval run           │
│    data.steps: [                                                    │
│      {key: "input", type: "input"},                                 │
│      {key: "invocation", type: "invocation"},                       │
│      {key: "quality-rating", type: "annotation", origin: "human"}  │
│    ]                                                                │
│    flags: {has_human: true}                                         │
│                                                                     │
│  POST /evaluations/scenarios/  → one per testcase row      │
│  POST /evaluations/results/    → seed placeholder results  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. ANNOTATOR WORKS (in EvalRunDetails table)                       │
│                                                                     │
│  For each scenario row:                                             │
│    → VirtualizedScenarioTableAnnotateDrawer opens                  │
│    → Annotator fills in metric values (driven by evaluator schema)  │
│    → Clicks "Annotate"                                              │
│                                                                     │
│  POST  /annotations/           → creates OTel annotation   │
│    origin: "human", kind: "eval", channel: "web"                   │
│    data.outputs: {approved: true}                                   │
│    links[0]: {trace_id: <invocation>, span_id: <inv_span>}         │
│    → returns {trace_id: <ann_trace>, span_id: <ann_span>}           │
│                                                                     │
│  PATCH /evaluations/results/   → links annotation to step  │
│    step_key: "quality-rating"                                       │
│    trace_id: <ann_trace>    ← the bridge between the two systems   │
│                                                                     │
│  POST  /run-metrics/...        → upsert scenario metrics   │
│  PATCH /evaluations/scenarios/ → status = "success"        │
│  POST  /evaluations/metrics/refresh → aggregate run stats  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. RESULTS VISIBLE                                                 │
│                                                                     │
│  MetricCell reads per-scenario metric value from run-metrics store  │
│  MetricDetailsPreviewPopover shows distribution / mean             │
│  TraceSidePanel/AnnotationTabItem shows per-span annotations       │
│    (grouped by evaluator slug, showing all users' annotations)     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## End-to-End Flow: Ad-hoc Trace Annotation

```
┌─────────────────────────────────────────────────────────────────────┐
│  FROM OBSERVABILITY VIEW                                            │
│                                                                     │
│  User opens TraceDrawer → clicks "Annotate" button                  │
│  → AnnotateDrawer opens with traceSpanIds                           │
│  → User selects evaluators, fills metrics, clicks Save              │
│                                                                     │
│  POST  /annotations/                                        │
│    origin: "human", kind: "adhoc", channel: "web"   ← key diff     │
│    links[0]: {trace_id: <app trace>, span_id: <span>}               │
│                                                                     │
│  No evaluation system involvement. Annotation lives in OTel store.  │
│  Annotation appears in TraceSidePanel/AnnotationTabItem immediately.│
│  Becomes filterable in observability table (annotation filters).    │
└─────────────────────────────────────────────────────────────────────┘
```

The key difference from the eval path: `kind = "adhoc"` instead of `kind = "eval"`, and no `EvaluationResult` is created or updated.

---

## What the EvaluationQueue Provides vs What the Frontend Uses

The backend `EvaluationQueue` has a complete implementation:

| Feature | Backend status | Frontend status |
|---------|---------------|-----------------|
| Queue CRUD | ✅ Full API at `/evaluations/queues/` | ❌ Not called |
| Assignment algorithm | ✅ `filter_scenario_ids()` in `utils.py` | ❌ Not used |
| Per-repeat tracking | ✅ `user_ids: List[List[UUID]]` | ❌ Not used |
| Scenario subset filter | ✅ `data.scenario_ids` | ❌ Not used |
| Per-item task status | ❌ Not implemented | ❌ Not needed yet |
| Inbox view | ❌ Not implemented | ❌ Not implemented |
| Assignment UI | ❌ Not implemented | ❌ Not implemented |
| Write-back to testset | ❌ Not implemented | ❌ Not implemented |
| Write-back to traces | ✅ Via `kind="adhoc"` annotations | ✅ Used in TraceDrawer |

**The frontend today effectively skips the queue entirely.** Any annotator can open any scenario and annotate it. The assignment logic in the backend sits unused. This is the primary gap the v2 design must address.

---

## Key Observations for v2 Design

1. **Two annotation paths already exist** (`kind="eval"` and `kind="adhoc"`) and share the same storage and evaluator system. The v2 queue needs to serve both.

2. **The bridge between evaluation system and annotation storage** is `EvaluationResult.trace_id`. This single field links a scenario step result to an OTel annotation span. Any new approach needs a similar bridge or a unified storage model.

3. **Human evaluators have no `service.uri`** — they are schema-only. The evaluator's JSON schema directly drives the annotation form UI. This means the evaluator is already the "annotation schema" concept from the PRD.

4. **The `EvaluationQueue` assignment algorithm is ready** but has never been wired to the frontend. The v2 design can either reuse it or replace it, but it doesn't need to be rebuilt.

5. **No per-item task status exists anywhere.** Both paths are purely "annotate when you feel like it." The concept of pending/claimed/completed is new for v2.

6. **Auto-creation of evaluators** happens inside `AnnotationsService.create()` when a slug is referenced that doesn't exist yet. This is a useful behavior to preserve for the programmatic annotation use case.
