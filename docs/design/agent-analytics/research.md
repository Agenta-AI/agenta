# Research — ground truth

How the analytics engine actually works, what live queries prove, and the code the page reuses.
Every claim here was read from the current tree or measured against a running stack. Where a
number comes from measurement, [capability-review.md](capability-review.md) (`§`) holds the probe.

Citations are current as of this rewrite. The deep review's own line numbers are frozen at commit
`31c0781d42` and have drifted; the load-bearing ones were re-verified and are corrected below.

---

## How the engine works today

### It reads root spans only

`build_base_cte` (`api/oss/src/dbs/postgres/tracing/utils.py:1042`) unconditionally applies
`WHERE parent_id IS NULL` (`:1073`). One run is one root span, so the endpoint counts and
summarizes runs — never the child spans where the tool name, the model that answered, and the
per-span status live. This single fact decides what the page can and cannot chart.

### The `focus` field is dead

`focus` reaches `dao.analytics()` but is never passed to `build_base_cte`
(`api/oss/src/dbs/postgres/tracing/dao.py:378-387`), so the `parent_id IS NULL` predicate is
never conditional on it. The endpoint accepts `focus`, echoes it back, and ignores it. Reading
the echoed query to confirm behaviour will confirm a parameter that did nothing.

### Metrics are `{type, path}` specs over JSON, with no fixed list

A spec names a JSON path and a type; the engine summarizes whatever path it names. Two types
matter to this page:

- **`numeric/continuous`** emits `count`, `sum`, `min`, `max`, and 27 percentiles nested under a
  `pcts` object — so p95 is at `metrics[path].pcts.p95`, not a flat sibling. (`PERCENTILE_LEVELS`
  at `utils.py:924-955`; `percentile_cont` at `utils.py:1266-1287`; nesting at `utils.py:1994`.)
- **`categorical/single`** emits a per-value `freq` table per bucket — runs per harness, per
  model, per agent, in one spec each.

The exact type strings are validated by the `MetricType` enum
(`api/oss/src/core/tracing/dtos.py:240-249`): `numeric/continuous`, `numeric/discrete`,
`categorical/single`, and others. There is **no** bare `numeric` — a wrong string contributes
zero rows silently (`utils.py:1187` numeric, `utils.py:1661` categorical). The default spec set
(`DEFAULT_ANALYTICS_SPECS`, `api/oss/src/core/tracing/service.py:91-98`) reads the canonical
`ag.metrics.costs.cumulative.total` cost path, which holds no data on agent roots — which is why
the page must pass explicit specs.

### `status_code` is a column, not a spec target

Specs read the `attributes` JSON only (`build_extract_cte` extracts `attributes #> path`,
`utils.py:1120`), and the extract stage groups by `(timestamp, spec_index)` with no grouping key
— so no spec can split a numeric metric by a category, and no spec can read `status_code`. A
failed run is a run whose root span `status_code` is `STATUS_CODE_ERROR`, so the failure count
comes from a **separate filtered query**. `status_code` is a first-class filter field
(`api/oss/src/core/tracing/utils/filtering.py:508-509`); the operator must be `is` and the value
the full enum literal, or the query returns an empty 200. There is no `STATUS_CODE_OK` — a clean
run is `STATUS_CODE_UNSET`, so success is the complement.

### Buckets are fixed-width, not calendar

`date_bin` steps by a fixed duration offset from the window start, in UTC — so buckets drift off
local midnight across a DST transition, and calendar months are not expressible. Above 1024
buckets the interval is silently coarsened (`_MAX_ALLOWED_BUCKETS`, `utils.py:808`; `_get_stride`
walks to a coarser stride at `:848-859`) — only `buckets[].interval` reports what actually ran.

### It fails silently, four ways

A statement-timeout, a rejected filter, a malformed window, and a genuinely empty window all
return `{"count": 0, "buckets": []}` with HTTP 200. An unknown filter field is logged and dropped
(`filtering.py:542-546`), which **widens** the result. The analytics DAO method is wrapped in
`@suppress_exceptions(default=[])` (`dao.py:305`), the route in
`@suppress_exceptions(default=AnalyticsResponse(), exclude=[HTTPException])`
(`api/oss/src/apis/fastapi/tracing/router.py:431`), and only `HTTPException` passes through both
that and the outer `intercept_exceptions` (`api/oss/src/utils/exceptions.py:98-99, 129-130`).
That is why fixing the silent failure (v2 B1) has to cross two layers.

### Cost lives on one unmapped path

The canonical `ag.metrics.costs.cumulative.*` paths are empty on agent roots — the roll-up never
crosses the run's OTLP batch boundary to reach the root. The only populated cost path is
`gen_ai.usage.cost`, which the semconv adapter does **not** map to the canonical path
(`api/oss/src/apis/fastapi/otlp/extractors/adapters/logfire_adapter.py:148-196`). The evaluations
service builds its own spec list including `ag.metrics.costs.cumulative.total` and never reads the
default set (`api/oss/src/core/evaluations/service.py:141-158, 1565-1571`), so mapping the cost at
ingest — not in the endpoint defaults — is what fixes both surfaces.

---

## What live queries prove

Measured on two local dev stacks over `2026-07-01` → `2026-08-03` (§1.3). No production data was
probed, so **every coverage percentage is unverified on production traffic**; capability claims
hold on any dataset.

- **Run count equals the root-span count exactly.** Analytics returned 7,529 for the window;
  direct SQL over the same window returned 7,529 (§4.4 item 1).
- **Latency, harness, and agent identity have near-total coverage** (~99%, ~99%, 96%). These are
  the dependable columns.
- **Cost and the token split collapsed.** Populated on 70–95% of runs in early July, then near
  zero within a week, cause unknown — the v2 B2 blocker.
- **Per-user is meaningless today.** `created_by_id` is a typed column
  (`api/oss/src/dbs/postgres/tracing/mappings.py:210`) but had exactly one distinct value per
  project on both stacks.
- **Performance sets the limits, not capability.** A 7-day core call costs ~0.26s, a 30-day one
  ~1.7s — so 7 days is the sane default. A `focus=span` scan is a ~5x row fan-out (2.60s vs
  0.68s), which is why span-focus must ship behind the failure-visibility fix.
- **Almost nothing is tested.** One analytics unit test exists
  (`api/oss/tests/pytest/unit/tracing/test_analytics_bucket_order.py`), asserting bucket order.

---

## The code the page reuses

The endpoint-to-dashboard path already exists for the Observability page. A new page sits on top
of that spine and reads a few fields the current mapper drops — it does not rebuild the data layer.

- **Fetch layer** — `web/packages/agenta-entities/src/trace/api/api.ts`: `fetchSpansAnalytics`
  calls `POST /spans/analytics/query` through the Fern client. `SpansAnalyticsParams` (`:293`)
  omits `specs` on purpose. The Fern `QuerySpansAnalyticsRequest` already declares `specs?: string`
  beside `filter?: string`, so passing explicit specs is one added field, one serialized line, no
  client regeneration.
- **Mapper** — `web/oss/src/services/tracing/lib/helpers.ts`: `analyticsToGeneration` (`:106`)
  reduces buckets to the dashboard shape; `metricField` (`:88`) reads one **flat** field and does
  not reach `pcts.p95`; `calculateIntervalFromDuration` (`:37`) picks a bucket size under the
  1024 ceiling. The existing mapper derives failures from `errors.cumulative` — a count of
  errored steps, not failed runs — so a new page needs its own mapper and the status-filtered
  query. Do not change the existing one; Observability depends on it.
- **Fetch template** — `web/oss/src/services/tracing/api/index.ts`:
  `fetchGenerationsDashboardData` builds the `conditions` array and calls
  `fetchSpansAnalytics({focus: "trace", ...})`.
- **State atoms** — `web/oss/src/state/observability/dashboard.ts`: the `atomWithQuery` pattern
  keyed on project, range, and filters, `staleTime` one minute, `refetchOnWindowFocus: false`.
  `observabilityDashboardTimeRangeAtom` already has a second consumer, so a new page needs its own
  atoms.
- **Charts** — recharts `^3.1.0` (`web/oss/package.json`). Style and theming to copy:
  `observability/dashboard/CustomAreaChart.tsx` and
  `EvalRunDetails/.../EvaluatorMetricsChart/{BarChart,HistogramChart}.tsx`. The existing charts
  are area charts of totals; this page needs stacked/grouped bars and a per-bucket p95 line.
- **Route + sidebar** — pages live under
  `web/oss/src/pages/w/[workspace_id]/p/[project_id]/`; the observability page is a thin wrapper.
  The sidebar's `app-observability-link` entry
  (`web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx:141`) is the shape to copy.
- **Agents list** — source the agent filter options from the existing apps/workflows state the
  sidebar's agent switcher already uses, not a new endpoint.

Conventions that constrain any build (`web/AGENTS.md`): all calls through the Fern client with
zod at the boundary; Jotai `atomWithQuery` with every dependency in the key, never `useEffect`;
exactly one project in scope; Tailwind + antd semantic tokens, no raw hex or inline style, both
themes; one-line comments.
