# Observability Feature — Architecture Flowchart

A top-to-bottom walkthrough of how the Observability feature works in the Agenta frontend, from page entry through data fetching, state management, and final UI rendering.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Page Entry & Routing](#2-page-entry--routing)
3. [State Management Layer](#3-state-management-layer)
4. [Data Fetching Pipeline](#4-data-fetching-pipeline)
5. [Traces Tab Flow](#5-traces-tab-flow)
6. [Sessions Tab Flow](#6-sessions-tab-flow)
7. [Trace Drawer Flow](#7-trace-drawer-flow)
8. [Session Drawer Flow](#8-session-drawer-flow)
9. [Analytics Dashboard Flow](#9-analytics-dashboard-flow)
10. [Entity Molecule Layer](#10-entity-molecule-layer)
11. [Component Tree Reference](#11-component-tree-reference)
12. [File Reference Index](#12-file-reference-index)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BROWSER / NEXT.JS ROUTER                        │
│                                                                         │
│   /w/[workspace]/p/[project]/observability     (project-scoped)         │
│   /w/[workspace]/p/[project]/apps/[app]/traces (app-scoped)            │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        PAGE COMPONENT LAYER                             │
│                                                                         │
│   ObservabilityTabs (tab switcher: "traces" | "sessions")               │
│   ├── ObservabilityTable  (traces tab)                                  │
│   └── SessionsTable       (sessions tab)                                │
│                                                                         │
│   Global Drawers (mounted in AppGlobalWrappers, always available):      │
│   ├── TraceDrawer                                                       │
│   └── SessionDrawer                                                     │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     STATE MANAGEMENT LAYER (Jotai)                       │
│                                                                         │
│   Control Atoms ──► Query Atoms ──► Derived/Selector Atoms              │
│   (filters,sort)   (TanStack Q)    (dedupe, merge, format)             │
│                                                                         │
│   Families: per-tab state (traces/sessions), per-span, per-session      │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      DATA FETCHING LAYER                                │
│                                                                         │
│   fetchAllPreviewTraces()  POST /preview/tracing/spans/query            │
│   fetchPreviewTrace()      GET  /preview/tracing/traces/{id}            │
│   deletePreviewTrace()     DEL  /preview/tracing/traces/{id}            │
│   fetchSessions()          POST /tracing/sessions/query                 │
│   queryAllAnnotations()    POST /preview/annotations/query              │
│   fetchAnalytics()         POST /preview/tracing/spans/analytics        │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      BACKEND API (FastAPI)                               │
│                                                                         │
│   api/oss/src/apis/fastapi/tracing/router.py                            │
│   api/oss/src/apis/fastapi/otlp/router.py                               │
│   api/oss/src/apis/fastapi/invocations/router.py                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Page Entry & Routing

```
User navigates via Sidebar
│
├── "Observability" (project-level)
│   URL: /w/{workspace}/p/{project}/observability
│   Page: web/oss/src/pages/w/[workspace_id]/p/[project_id]/observability/index.tsx
│   └── renders: <ObservabilityTabs />
│
└── "Observability" (app-level, under app menu)
    URL: /w/{workspace}/p/{project}/apps/{app}/traces
    Page: web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/traces/index.tsx
    └── renders: <ObservabilityTabs />

EE pages re-export from OSS:
  web/ee/src/pages/.../observability/index.tsx  →  imports OSS page
  web/ee/src/pages/.../traces/index.tsx         →  imports OSS page
```

**Key file**: `web/oss/src/components/pages/observability/index.tsx`

```
ObservabilityTabs
│
├── Reads: observabilityTabAtom  →  "traces" | "sessions"
├── Reads: URL query param ?tab= →  syncs to observabilityTabAtom
│
├── Tab: "traces"
│   └── renders <ObservabilityTable />
│
├── Tab: "sessions"
│   └── renders <SessionsTable />
│
└── Onboarding: <SetupTracingModal />  (dynamic import, shown on first use)
```

---

## 3. State Management Layer

### 3.1 Control Atoms (User Input State)

**File**: `web/oss/src/state/newObservability/atoms/controls.ts`

```
                        observabilityTabAtom
                       ("traces" | "sessions")
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
    Per-tab atom families  Proxy atoms         Computed atoms
    (keyed by tab name)    (active tab)        (merge logic)
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌────────────────┐  ┌──────────────────────┐
│ searchQueryAtom │  │ searchQueryAtom│  │ filtersAtomFamily(tab)│
│ Family("traces")│──│ (proxy)        │  │                      │
│ Family("sess")  │  │                │  │ = appScope           │
├─────────────────┤  ├────────────────┤  │ + softDefaults       │
│ traceTabsAtom   │  │ traceTabsAtom  │  │ + userFilters        │
│ Family(tab)     │──│ (proxy)        │  └──────────────────────┘
├─────────────────┤  ├────────────────┤           │
│ sortAtomFamily  │  │ sortAtom       │           │ appScope = if app_id:
│ (tab)           │──│ (proxy)        │           │   [{field:"references",
├─────────────────┤  ├────────────────┤           │     operator:"in",
│ limitAtomFamily │  │ limitAtom      │           │     value:[{id:appId,
│ traces=50       │──│ (proxy)        │           │     "attributes.key":
│ sessions=20     │  │                │           │     "application"}]}]
├─────────────────┤  ├────────────────┤           │
│ userFiltersAtom │  │ filtersAtom    │           │ softDefault = if traces:
│ Family(tab)     │──│ (proxy)        │◄──────────┘   [{field:"trace_type",
├─────────────────┤  ├────────────────┤                 operator:"is",
│ realtimeModeAtom│  │ realtimeModeAtom                 value:"invocation"}]
│ Family(tab)     │──│ (proxy)        │
└─────────────────┘  └────────────────┘

Other control atoms (not per-tab):
  selectedTraceIdAtom     →  currently selected trace ID
  selectedNodeAtom        →  currently selected span/node ID
  editColumnsAtom         →  visible table columns
  selectedRowKeysAtom     →  multi-select row keys
  testsetDrawerDataAtom   →  data for "add to testset" action
  autoRefreshAtom         →  boolean, triggers 15s refetch
  isAnnotationsSectionOpenAtom  →  annotations panel toggle
```

### 3.2 Query Atoms (Data Fetching State)

**File**: `web/oss/src/state/newObservability/atoms/queries.ts`

```
Control Atoms
│
├── sortAtomFamily("traces")
├── filtersAtomFamily("traces")
├── traceTabsAtomFamily("traces")
├── limitAtomFamily("traces")
├── selectedAppIdAtom
├── projectIdAtom
│
▼
buildTraceQueryParams(filters, sort, traceTabs, limit)    ◄── queryHelpers.ts
│
├── Returns: { params, hasAnnotationConditions, hasAnnotationOperator, isHasAnnotationSelected }
│
▼
tracesQueryAtom  ────────────────────────────────────  atomWithInfiniteQuery
│   queryKey: ["traces", projectId, appId, params]
│   queryFn: executeTraceQuery(...)
│   getNextPageParam: cursor-based (newest timestamp)
│   enabled: sessionExists && (appId || projectId)
│
├──► tracesAtom  ────────────────────────────────────  selectAtom (deduplicates)
│    │   Deduplicates spans across infinite pages by span_id
│    │
│    ├──► annotationLinksAtom  ──────────────────────  eagerAtom
│    │    │   Collects {trace_id, span_id} pairs from all traces
│    │    │
│    │    ▼
│    │    annotationsQueryAtom  ─────────────────────  atomWithQuery
│    │    │   queryKey: ["annotations", links]
│    │    │   queryFn: queryAllAnnotations({annotation: {links}})
│    │    │   enabled: links.length > 0
│    │    │
│    │    ├──► annotationsAtom  ─────────────────────  selectAtom
│    │    │
│    │    ▼
│    └──► tracesWithAnnotationsAtom  ────────────────  eagerAtom
│         │   attachAnnotationsToTraces(traces, annotations)
│         │
│         ├──► activeTraceIndexAtom  ────────────────  eagerAtom
│         ├──► activeTraceAtom  ─────────────────────  eagerAtom
│         ├──► selectedItemAtom  ────────────────────  eagerAtom
│         └──► annotationEvaluatorSlugsAtom  ────────  selectAtom
│
├──► traceCountAtom  ───────────────────────────────  selectAtom
│
└──► observabilityLoadingAtom  ─────────────────────  eagerAtom
     (tracesQuery.isLoading || annotationsQuery.isLoading)
```

### 3.3 useObservability Hook

**File**: `web/oss/src/state/newObservability/hooks/index.ts`

```
useObservability()   ◄── Central hook consumed by ObservabilityTable & ObservabilityHeader
│
├── Returns read/write access to ALL control atoms:
│   searchQuery, traceTabs, filters, sort, selectedTraceId,
│   selectedRowKeys, editColumns, selectedNode, autoRefresh, limit
│
├── Returns query results:
│   traces             (tracesWithAnnotationsAtom)
│   annotations        (annotationsQueryAtom.data)
│   isLoading          (combined loading state)
│   activeTraceIndex   (index of selected trace)
│   activeTrace        (selected trace node)
│   selectedItem       (selected span/node in trace tree)
│
└── Returns actions:
    fetchTraces()      (refetch traces query)
    fetchAnnotations() (refetch annotations query)
    fetchMoreTraces()  (load next page — infinite scroll)
    clearQueryStates() (reset all filters/sort/search)
```

---

## 4. Data Fetching Pipeline

### 4.1 Query Parameter Building

**File**: `web/oss/src/state/newObservability/atoms/queryHelpers.ts`

```
UI Filter[]                                    API Condition[]
─────────────                                  ────────────────

{field: "has_annotation",         ──►  Two-step query:
 operator: "in",                        Step 1: fetch annotation spans
 value: {evaluator: "accuracy"}}        Step 2: extract linked IDs → fetch traces

{field: "references",             ──►  {field: "references",
 key: "application.myapp",              operator: "in",
 operator: "in",                         value: [{id, "attributes.key": "application"}]}
 value: [...]}

{field: "custom",                 ──►  {field: "attributes",
 key: "attributes.my.key",              key: "my.key",
 operator: "contains",                   operator: "contains",
 value: "hello"}                         value: "hello"}

{field: "status_code",            ──►  {field: "status_code",
 operator: "is",                         operator: "is_not",
 value: "STATUS_CODE_OK"}               value: "STATUS_CODE_ERROR"}
                                         (inverted for OK status)

Sort (standard/custom)            ──►  params.oldest / params.newest
```

### 4.2 executeTraceQuery — Core Fetch Orchestrator

**File**: `web/oss/src/state/newObservability/atoms/queryHelpers.ts`

```
executeTraceQuery({params, pageParam, appId, isHasAnnotationSelected, ...})
│
├── Has "has_annotation" filter?
│   │
│   ├── YES: Two-Step Query
│   │   │
│   │   ├── STEP 1: Fetch annotation spans
│   │   │   params.focus = "span"
│   │   │   params.filter = [{field: "trace_type", operator: "is", value: "annotation"}, ...]
│   │   │   └── fetchAllPreviewTraces(step1Params, appId)
│   │   │       └── POST /preview/tracing/spans/query
│   │   │
│   │   ├── Extract linked IDs: extractLinkedIds(data1) → {traceIds[], spanIds[]}
│   │   │
│   │   └── STEP 2: Fetch actual traces by linked IDs
│   │       operator == "not_in"?
│   │       ├── YES: exclude IDs  → {field: "trace_id", operator: "not_in", value: traceIds}
│   │       └── NO:  include IDs  → {field: "trace_id", operator: "in", value: traceIds}
│   │       └── fetchAllPreviewTraces(step2Params, appId)
│   │
│   └── NO: Normal single-step query
│       └── fetchAllPreviewTraces(params, appId)
│           └── POST /preview/tracing/spans/query
│
├── Transform response to tree:
│   ├── isTracesResponse(data)?
│   │   └── transformTracesResponseToTree(data)  →  flat span[] from nested traces
│   │       └── transformTracingResponse(spans)  →  add invocationIds, key
│   │
│   └── isSpansResponse(data)?
│       └── transformTracingResponse(data.spans)
│
└── Calculate next cursor:
    └── Find earliest timestamp in results → nextCursor for pagination
    └── Guard: if cursor <= params.oldest → undefined (no more pages)

Returns: { traces: TraceSpanNode[], traceCount, nextCursor, annotationPageSize }
```

### 4.3 Response Transformation Pipeline

**File**: `web/oss/src/services/tracing/lib/helpers.ts`

```
API Response (TracesResponse)
│
│   Shape: { traces: { [traceId]: { spans: { [spanId]: TraceSpan } } } }
│
▼
transformTracesResponseToTree(response)
│   For each trace:
│     1. Collect all spans from trace.spans object
│     2. Build parent→children map using parent_id
│     3. Find root spans (no parent or parent not in set)
│     4. Recursively attach children[] arrays
│     5. Return flat array of root TraceSpanNode[]
│
▼
transformTracingResponse(spans)
│   For each span:
│     1. Add .key = span_id (for React keys)
│     2. Add .invocationIds = { trace_id, span_id } (for annotation linking)
│     3. Recursively process children
│
▼
TraceSpanNode[] (ready for UI consumption)
```

---

## 5. Traces Tab Flow

```
ObservabilityTable
│
│  ┌── useObservability() hook ─────────────────────────────────────────┐
│  │   traces, isLoading, fetchMoreTraces, hasMoreTraces,               │
│  │   editColumns, selectedTraceId, autoRefresh, ...                   │
│  └────────────────────────────────────────────────────────────────────┘
│
├── <ObservabilityHeader>
│   │
│   ├── Search bar ──► searchQueryAtom → filtersAtomFamily (merged)
│   ├── Filter pills ──► userFiltersAtomFamily("traces")
│   │   ├── Attribute filters (status_code, trace_type, span_name, ...)
│   │   ├── Reference filters (application, environment, variant)
│   │   ├── Custom attribute filters
│   │   └── has_annotation filter (evaluator-based)
│   ├── Sort/Date range ──► sortAtomFamily("traces")
│   │   ├── Standard: "Last 24 hours", "Last 7 days", etc.
│   │   └── Custom: startTime / endTime picker
│   ├── Trace tabs (Root spans / LLM spans / All spans) ──► traceTabsAtomFamily
│   │   └── Maps to API focus: "trace" | "span" | "chat"(→"span")
│   ├── Auto-refresh toggle ──► autoRefreshAtom (15-second interval)
│   ├── Column editor ──► editColumnsAtom
│   ├── Export CSV action
│   └── Batch actions: delete traces, add to testset
│
├── <Table> (Ant Design with resizable columns)
│   │
│   ├── Columns generated from:
│   │   ├── getObservabilityColumns()  ◄── assets/getObservabilityColumns.tsx
│   │   │   Static columns: span_type, name, inputs, outputs,
│   │   │   start_time, latency, cost, usage, status, tags
│   │   │
│   │   └── Dynamic evaluator columns from annotationEvaluatorSlugsAtom
│   │       └── One column per unique evaluator slug
│   │
│   ├── Cell renderers:
│   │   ├── <AvatarTreeContent>      → span type icon with color
│   │   ├── <NodeNameCell>           → span name (truncated)
│   │   ├── <TimestampCell>          → formatted timestamp
│   │   ├── <DurationCell>           → formatted latency
│   │   ├── <CostCell>              → formatted cost ($)
│   │   ├── <UsageCell>             → token usage
│   │   ├── <StatusRenderer>         → success/error badge
│   │   └── <EvaluatorMetricsCell>   → evaluator scores
│   │
│   ├── Formatting atom families:
│   │   ├── formattedTimestampAtomFamily(ts)
│   │   ├── formattedDurationAtomFamily(ms)
│   │   ├── formattedCostAtomFamily(cost)
│   │   └── formattedUsageAtomFamily(tokens)
│   │
│   ├── Row click:
│   │   └── Sets URL query params: ?trace={traceId}&span={spanId}
│   │       └── TraceDrawer opens (global component, reads URL params)
│   │
│   └── Pagination:
│       └── "Load more" button → fetchMoreTraces() → fetchNextPage()
│           └── Cursor: newest timestamp of last page
│
└── <EmptyObservability />  (when traces.length === 0 and !isLoading)
```

---

## 6. Sessions Tab Flow

```
SessionsTable
│
├── Session List Query Pipeline:
│   │
│   │  sortAtomFamily("sessions")
│   │  limitAtomFamily("sessions") = 20
│   │  realtimeModeAtomFamily("sessions")
│   │  selectedAppIdAtom, projectIdAtom
│   │         │
│   │         ▼
│   │  sessionsQueryAtom  ──────────────────  atomWithInfiniteQuery
│   │  │  queryKey: ["sessions", projectId, appId, windowing, limit, realtimeMode]
│   │  │  queryFn: fetchSessions({ windowing, filter, realtime })
│   │  │  POST /tracing/sessions/query
│   │  │
│   │  ├──► sessionIdsAtom  ────────────────  selectAtom (deduplicated)
│   │  │    │   string[] of session IDs
│   │  │    │
│   │  │    ▼
│   │  │    sessionsSpansQueryAtom  ─────────  atomWithInfiniteQuery
│   │  │    │  For EACH session ID in parallel:
│   │  │    │    executeTraceQuery({...params, filter: "ag.session.id" == sessionId})
│   │  │    │
│   │  │    ├──► sessionsSpansAtom  ─────────  selectAtom
│   │  │    │    Record<sessionId, TraceSpanNode[]>
│   │  │    │
│   │  │    └── Per-session derived atoms (atomFamily by sessionId):
│   │  │        ├── sessionTraceCountAtomFamily(id)
│   │  │        ├── sessionTimeRangeAtomFamily(id)
│   │  │        ├── sessionDurationAtomFamily(id)
│   │  │        ├── sessionLatencyAtomFamily(id)
│   │  │        ├── sessionUsageAtomFamily(id)
│   │  │        ├── sessionCostAtomFamily(id)
│   │  │        ├── sessionFirstInputAtomFamily(id)
│   │  │        └── sessionLastOutputAtomFamily(id)
│   │  │
│   │  └──► sessionCountAtom
│   │
│   └──► filteredSessionIdsAtom  (sessions with >0 spans)
│
├── <ObservabilityHeader componentType="sessions">
│   ├── Sort/Date range
│   ├── Realtime mode toggle: "All activity" vs "Latest activity"
│   │   └── realtimeModeAtomFamily("sessions")
│   │       false = all (first_active ordering, paginated)
│   │       true  = latest (last_active ordering, fixed limit, no pagination)
│   └── Auto-refresh toggle
│
├── <Table> (Session rows)
│   │
│   ├── Columns:
│   │   ├── SessionId
│   │   ├── StartTime / EndTime  ◄── sessionTimeRangeAtomFamily
│   │   ├── FirstInput           ◄── sessionFirstInputAtomFamily
│   │   ├── LastOutput           ◄── sessionLastOutputAtomFamily
│   │   ├── TracesCount          ◄── sessionTraceCountAtomFamily
│   │   ├── TotalLatency         ◄── sessionLatencyAtomFamily
│   │   ├── TotalCost            ◄── sessionCostAtomFamily
│   │   └── TotalUsage           ◄── sessionUsageAtomFamily
│   │
│   └── Row click:
│       └── Sets URL: ?session={sessionId}&span={spanId}
│           └── SessionDrawer opens
│
└── <EmptySessions />
```

---

## 7. Trace Drawer Flow

The TraceDrawer is a **global component** mounted in `AppGlobalWrappers` (always present in the DOM).

**File**: `web/oss/src/components/SharedDrawers/TraceDrawer/`

### 7.1 Drawer State Management

**File**: `store/traceDrawerStore.ts`

```
traceDrawerAtom  (atomWithImmer)
│
│  State shape:
│  {
│    open: boolean,
│    traceId: string | null,
│    activeSpanId: string | null,
│    originTraceId: string | null,          ← for "back to origin" navigation
│    history: {traceId, spanId}[]           ← stack for linked-span navigation
│  }
│
├── Derived atoms:
│   ├── isDrawerOpenAtom
│   ├── traceDrawerTraceIdAtom
│   └── traceDrawerActiveSpanIdAtom
│
└── Action atoms:
    ├── openTraceDrawerAtom     → sets open=true, traceId, activeSpanId, resets history
    ├── closeTraceDrawerAtom    → sets open=false (preserves state)
    ├── setTraceDrawerActiveSpanAtom  → updates activeSpanId
    └── setTraceDrawerTraceAtom → handles navigation:
        ├── source="external"  → reset history, set new origin
        ├── source="linked"    → push current to history stack, navigate
        └── source="back"      → pop from history stack, restore
```

### 7.2 Drawer Data Pipeline

```
traceDrawerTraceIdAtom
│
▼
traceDrawerQueryAtom  ──────────────────────  atomWithQuery
│  queryKey: ["trace-drawer", traceId]
│  queryFn: fetchPreviewTrace(traceId)
│  GET /preview/tracing/traces/{traceId}
│
▼
traceDrawerBaseTracesAtom  ─────────────────  derived atom
│  1. Check for response.tree (AgentaTreeDTO) → observabilityTransformer()
│  2. Fallback: normalizeTracesResponse() → transformTracesResponseToTree()
│     → transformTracingResponse()
│
├──► traceDrawerFlatBaseTracesAtom  ────────  flattenTraces() for span lookup
│    │
│    ▼
│    traceDrawerAnnotationLinksAtom  ───────  collect {trace_id, span_id} pairs
│    │
│    ▼
│    traceDrawerAnnotationsQueryAtom  ──────  atomWithQuery
│    │  queryFn: queryAllAnnotations({annotation: {links}})
│    │  POST /preview/annotations/query
│    │
│    ▼
│    traceDrawerAnnotationsAtom  ───────────  annotations list
│
▼
senitizedTracesAtom  ───────────────────────  merge traces + annotations
│  attachAnnotationsToTraces(baseTraces, annotations)
│
├──► traceDrawerFlatAnnotatedTracesAtom  ──  flattened for span lookup
├──► traceDrawerResolvedActiveSpanIdAtom ──  resolve span or default to first
├──► traceDrawerGetTraceByIdAtom  ──────────  utility getter
│
├──► Linked Spans Pipeline:
│    │
│    ├── annotationLinkTargetsAtom  ────────  annotation links pointing to active span
│    │   └── annotationLinkTracesQueryAtom   fetch linked trace trees
│    │       └── annotationLinkTracesAtom    cached trace map
│    │
│    ├── linksAndReferencesAtom  ───────────  ALL links + references for active span
│    │   │  Sources: annotation links, span.links, span.otel.links, references
│    │   │
│    │   ▼
│    │   linkedSpanTargetsAtom  ────────────  deduplicated link targets
│    │   └── linkedSpanTracesQueryAtom       fetch missing trace trees
│    │       └── linkedSpanTracesAtom        provided + fetched traces
│    │           └── linkedSpansAtom          final LinkedSpanRow[]
│    │
│    └──► Used by: LinkedSpansTabItem, TraceSidePanel
│
└──► traceDrawerBackTargetAtom      ────────  previous navigation target
└──► traceDrawerIsLinkedViewAtom    ────────  is viewing a linked trace?
```

### 7.3 Drawer Component Tree

```
TraceDrawer (EnhancedDrawer, 1200px/1920px)
│
├── URL Sync: reads ?trace= and ?span= query params
│   └── syncTraceStateFromUrl() on mount
│
└── <TraceDrawerContent>
    │
    ├── <TraceTypeHeader>
    │   ├── Back button (if viewing linked trace) → setTraceDrawerTraceAtom(source:"back")
    │   ├── Previous/Next trace navigation (from table list)
    │   ├── Trace ID display with copy action
    │   └── Expand/Collapse width toggle
    │
    ├── Left Panel: <TraceTree>
    │   │  Hierarchical span tree visualization
    │   │
    │   ├── Search: filters tree nodes by name
    │   ├── Settings: toggle latency/cost/tokens display
    │   │   └── Persisted in localStorage ("traceTreeSettings")
    │   │
    │   └── For each span node → <TreeContent>
    │       ├── <AvatarTreeContent>  (span type icon)
    │       ├── Span name (truncated)
    │       ├── Latency badge  ◄── formattedSpanLatencyAtomFamily
    │       ├── Cost badge     ◄── formattedSpanCostAtomFamily
    │       └── Token badge    ◄── formattedSpanTokensAtomFamily
    │
    ├── Center Panel: Tabs
    │   │
    │   ├── Tab: "Overview" → <OverviewTabItem>
    │   │   │  Shows selected span details
    │   │   │
    │   │   ├── Configuration section ◄── spanMetaConfigurationAtomFamily
    │   │   │   (model, temperature, max_tokens, etc.)
    │   │   │
    │   │   ├── Inputs section ◄── spanDataInputsAtomFamily
    │   │   │   ├── Chat messages (role-based display)
    │   │   │   └── JSON/YAML formatted data
    │   │   │
    │   │   ├── Outputs section ◄── spanDataOutputsAtomFamily
    │   │   │   ├── Chat messages
    │   │   │   └── JSON/YAML formatted data
    │   │   │
    │   │   ├── Internals section ◄── spanDataInternalsAtomFamily
    │   │   │
    │   │   └── Exception section ◄── spanExceptionAtomFamily
    │   │       (error messages highlighted in red)
    │   │
    │   ├── Tab: "Raw Data" → <AccordionTreePanel>
    │   │   ├── Full span data as JSON/YAML
    │   │   ├── Format switcher
    │   │   ├── Search with prev/next navigation
    │   │   └── Copy button
    │   │
    │   ├── Tab: "Linked Spans" (count badge) → <LinkedSpansTabItem>
    │   │   ├── Table of linked spans ◄── linkedSpansAtom
    │   │   └── Click → navigate to linked trace (setTraceDrawerTraceAtom, source:"linked")
    │   │
    │   └── Tab: "Annotations" → <AnnotationTabItem>
    │       └── Table of annotations for selected span
    │
    └── Right Panel: <TraceSidePanel>  (collapsible)
        │  ◄── traceSidePanelOpenAtom (persisted in localStorage)
        │
        ├── <TraceAnnotations>    → span annotations list
        ├── <TraceDetails>        → trace metadata (IDs, timestamps, status)
        ├── <TraceReferences>     → cross-references (app, environment, variant)
        └── <TraceLinkedSpans>    → compact linked spans list
```

---

## 8. Session Drawer Flow

**File**: `web/oss/src/components/SharedDrawers/SessionDrawer/`

```
SessionDrawer (EnhancedDrawer, 1250px)
│
├── URL Sync: reads ?session= and ?span= query params
│   └── syncSessionStateFromUrl() on mount
│
├── Store: sessionDrawerAtom
│   ├── isDrawerOpenAtom
│   ├── openSessionDrawerWithUrlAtom
│   ├── closeSessionDrawerAtom
│   └── setSessionDrawerActiveSpanAtom
│
└── <SessionDrawerContent>
    │
    ├── <SessionHeader>        → session ID, metadata
    │
    ├── Left: <SessionTree>    → chronological trace list
    │   │  Sorts traces by timestamp
    │   │  Reuses <TreeContent> from TraceTree
    │   │
    │   └── Node click:
    │       ├── Root trace → select in session view
    │       └── Child span → opens TraceDrawer (navigates to full trace)
    │
    ├── Center: <SessionContent>   → session details
    │
    └── Right: <SessionMessagePanel>  → interaction messages
```

---

## 9. Analytics Dashboard Flow

**File**: `web/oss/src/state/observability/dashboard.ts`

```
observabilityDashboardTimeRangeAtom
│  Default: 30 days ago → now
│
├── routerAppIdAtom
├── projectIdAtom
│
▼
observabilityDashboardQueryAtom  ───────────  atomWithQuery
│  queryKey: ["observability", "dashboard", appId, projectId, timeRange]
│  queryFn: fetchGenerationsDashboardData()
│  POST /preview/tracing/spans/analytics
│  Body: { focus: "trace", interval, oldest, newest, filter }
│
│  Backend aggregation:
│  - MetricSpec: duration, errors, costs, tokens (cumulative)
│  - MetricSpec: trace type, span type (categorical)
│  - Returns time-series buckets
│
▼
tracingToGeneration(data)  ──── Aggregates buckets to dashboard metrics
│
▼
observabilityDashboardAtom  (eagerAtom, null-safe)
│
▼
useObservabilityDashboard()  ── Hook returns { data, loading, error, refetch }
│
▼
<AnalyticsDashboard>
├── <WidgetCard> Requests    → success/failure counts, chart
├── <WidgetCard> Latency     → average latency, chart
├── <WidgetCard> Cost        → total/average cost, chart
└── <WidgetCard> Tokens      → total/average tokens, chart
    └── <CustomAreaChart>    → Recharts area chart visualization
```

---

## 10. Entity Molecule Layer

For individual span editing/viewing (used in Playground and entity-level interactions):

**File**: `web/packages/agenta-entities/src/trace/`

```
traceSpanMolecule  ◄── createMolecule() pattern
│
├── atoms.data(spanId)          → entity with draft merged
├── atoms.serverData(spanId)    → raw server data
├── atoms.draft(spanId)         → local changes only
├── atoms.isDirty(spanId)       → has unsaved changes
├── atoms.query(spanId)         → query state (isPending, isError)
├── atoms.inputs(spanId)        → extracted inputs
├── atoms.outputs(spanId)       → extracted outputs
├── atoms.agData(spanId)        → full ag.data object
│
├── reducers.update             → update draft
├── reducers.discard            → discard draft
│
├── get.data(spanId)            → imperative read
├── set.discard(spanId)         → imperative write
│
├── useController(spanId)       → [state, dispatch] React hook
│
├── drillIn.*                   → path navigation utilities
│
└── lifecycle.*                 → mount/unmount events

Batch Fetching:
  spanBatchFetcher  → groups concurrent span requests by projectId
  │  Max batch: 100 spans per request
  │  POST /preview/tracing/spans/query
  │
  traceBatchFetcher → groups concurrent trace requests
  │  Max batch: 50 traces per request
  │  POST /preview/tracing/spans/query (focus: "trace")
  │  Side effect: populates spanQueryAtomFamily cache

Cache Strategy:
  spanQueryAtomFamily(spanId)
  │
  ├── 1. Check traces-list cache (tracesQueryAtom pages)
  ├── 2. Check trace-drawer cache (traceDrawerQueryAtom)
  ├── 3. Check trace-entity cache (traceEntityAtomFamily)
  └── 4. Fallback: batch fetch from API
       └── Retry: 3 attempts with exponential backoff (1s, 2s, 4s)
```

---

## 11. Component Tree Reference

```
AppGlobalWrappers (always mounted)
├── <TraceDrawer />          ← dynamic import, ssr: false
└── <SessionDrawer />        ← dynamic import, ssr: false

Page: /observability or /traces
└── <ObservabilityTabs>
    ├── observabilityTabAtom = "traces"
    │   └── <ObservabilityTable>
    │       ├── <ObservabilityHeader>
    │       │   ├── Search bar
    │       │   ├── Filter pills (multi-filter with operators)
    │       │   ├── Sort / Date range picker
    │       │   ├── Trace tabs (Root / LLM / All)
    │       │   ├── Auto-refresh toggle
    │       │   ├── Column editor
    │       │   ├── CSV export
    │       │   └── Batch actions (delete, add to testset)
    │       ├── <Table> with cell renderers
    │       │   ├── <AvatarTreeContent>
    │       │   ├── <NodeNameCell>
    │       │   ├── <TimestampCell>
    │       │   ├── <DurationCell>
    │       │   ├── <CostCell>
    │       │   ├── <UsageCell>
    │       │   ├── <StatusRenderer>
    │       │   └── <EvaluatorMetricsCell>
    │       ├── Load more button
    │       └── <EmptyObservability>
    │
    └── observabilityTabAtom = "sessions"
        └── <SessionsTable>
            ├── <ObservabilityHeader componentType="sessions">
            ├── <Table> with session columns
            └── <EmptySessions>

<TraceDrawer> (global)
├── <TraceDrawerContent>
│   ├── <TraceTypeHeader>
│   ├── <TraceTree>
│   │   └── <TreeContent> per span
│   │       └── <AvatarTreeContent>
│   ├── Tabs:
│   │   ├── <OverviewTabItem>
│   │   ├── <AccordionTreePanel>
│   │   ├── <LinkedSpansTabItem>
│   │   └── <AnnotationTabItem>
│   └── <TraceSidePanel>
│       ├── <TraceAnnotations>
│       ├── <TraceDetails>
│       ├── <TraceReferences>
│       └── <TraceLinkedSpans>
└── <TestsetDrawer> (dynamic, for adding traces to testsets)

<SessionDrawer> (global)
└── <SessionDrawerContent>
    ├── <SessionHeader>
    ├── <SessionTree>
    ├── <SessionContent>
    └── <SessionMessagePanel>
```

---

## 12. File Reference Index

### Pages
| File | Purpose |
|------|---------|
| `web/oss/src/pages/w/[workspace_id]/p/[project_id]/observability/index.tsx` | Project-scoped observability page |
| `web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/traces/index.tsx` | App-scoped traces page |
| `web/ee/src/pages/.../observability/index.tsx` | EE re-export wrapper |
| `web/ee/src/pages/.../traces/index.tsx` | EE re-export wrapper |

### Main Components
| File | Purpose |
|------|---------|
| `web/oss/src/components/pages/observability/index.tsx` | ObservabilityTabs — tab switcher |
| `web/oss/src/components/pages/observability/components/ObservabilityTable/index.tsx` | Traces table |
| `web/oss/src/components/pages/observability/components/SessionsTable/index.tsx` | Sessions table |
| `web/oss/src/components/pages/observability/components/ObservabilityHeader/index.tsx` | Filters/search/controls |
| `web/oss/src/components/pages/observability/components/EmptyObservability/index.tsx` | Empty state |

### Cell Renderers
| File | Purpose |
|------|---------|
| `web/oss/src/components/pages/observability/components/AvatarTreeContent.tsx` | Span type icon |
| `web/oss/src/components/pages/observability/components/NodeNameCell.tsx` | Span name |
| `web/oss/src/components/pages/observability/components/TimestampCell.tsx` | Formatted time |
| `web/oss/src/components/pages/observability/components/DurationCell.tsx` | Latency display |
| `web/oss/src/components/pages/observability/components/CostCell.tsx` | Cost display |
| `web/oss/src/components/pages/observability/components/UsageCell.tsx` | Token usage |
| `web/oss/src/components/pages/observability/components/StatusRenderer.tsx` | Status badge |
| `web/oss/src/components/pages/observability/components/EvaluatorMetricsCell.tsx` | Evaluator scores |

### Trace Drawer
| File | Purpose |
|------|---------|
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceDrawer.tsx` | Drawer container |
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceDrawerContent.tsx` | Main content orchestrator |
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceHeader/index.tsx` | Navigation header |
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceTree/index.tsx` | Span tree |
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceSidePanel/index.tsx` | Side panel |
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/OverviewTabItem/index.tsx` | Span overview |
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/AccordionTreePanel.tsx` | Raw data viewer |
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/LinkedSpansTabItem/index.tsx` | Linked spans |
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/AnnotationTabItem/index.tsx` | Annotations tab |
| `web/oss/src/components/SharedDrawers/TraceDrawer/store/traceDrawerStore.ts` | Drawer state & queries |

### Session Drawer
| File | Purpose |
|------|---------|
| `web/oss/src/components/SharedDrawers/SessionDrawer/components/SessionDrawer.tsx` | Session drawer container |
| `web/oss/src/components/SharedDrawers/SessionDrawer/store/sessionDrawerStore.ts` | Session drawer state |

### State Management
| File | Purpose |
|------|---------|
| `web/oss/src/state/newObservability/atoms/controls.ts` | UI control atoms (filters, sort, tabs) |
| `web/oss/src/state/newObservability/atoms/queries.ts` | Query atoms (traces, sessions, annotations) |
| `web/oss/src/state/newObservability/atoms/queryHelpers.ts` | Query building & execution |
| `web/oss/src/state/newObservability/hooks/index.ts` | useObservability() hook |
| `web/oss/src/state/newObservability/selectors/tracing.ts` | Span metric extractors |
| `web/oss/src/state/observability/dashboard.ts` | Dashboard analytics atoms |
| `web/oss/src/state/entities/trace/store.ts` | Entity-level span store |
| `web/oss/src/state/entities/trace/controller.ts` | Entity controller API |
| `web/oss/src/state/url/trace.ts` | URL query param sync |

### Entity Packages
| File | Purpose |
|------|---------|
| `web/packages/agenta-entities/src/trace/state/molecule.ts` | traceSpanMolecule |
| `web/packages/agenta-entities/src/trace/state/store.ts` | Batch fetchers & cache |
| `web/packages/agenta-entities/src/trace/core/schema.ts` | Zod schemas |
| `web/packages/agenta-entities/src/trace/api/api.ts` | API functions |
| `web/packages/agenta-entities/src/trace/utils/selectors.ts` | Data extraction utilities |

### API Services
| File | Purpose |
|------|---------|
| `web/oss/src/services/tracing/api/index.ts` | Frontend API functions |
| `web/oss/src/services/tracing/lib/helpers.ts` | Response transformers |
| `web/oss/src/services/tracing/types/index.ts` | TypeScript types |
| `web/oss/src/services/annotations/api/index.ts` | Annotations CRUD |

### Filter Assets
| File | Purpose |
|------|---------|
| `web/oss/src/components/pages/observability/assets/getObservabilityColumns.tsx` | Column definitions |
| `web/oss/src/components/pages/observability/assets/getFilterColumns.ts` | Filter column adapters |
| `web/oss/src/components/pages/observability/assets/filters/referenceUtils.ts` | Reference filter parsing |
| `web/oss/src/components/pages/observability/assets/filters/operatorRegistry.ts` | Filter operators |

### Backend
| File | Purpose |
|------|---------|
| `api/oss/src/apis/fastapi/tracing/router.py` | Tracing routes |
| `api/oss/src/apis/fastapi/tracing/models.py` | Request/response models |
| `api/oss/src/apis/fastapi/otlp/router.py` | OTLP ingest endpoint |
| `api/oss/src/apis/fastapi/invocations/router.py` | Invocation routes |

### Global
| File | Purpose |
|------|---------|
| `web/oss/src/components/AppGlobalWrappers/index.tsx` | Mounts TraceDrawer globally |
| `web/oss/src/state/url/routeMatchers.ts` | Route-based feature gating |
| `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx` | Navigation links |
