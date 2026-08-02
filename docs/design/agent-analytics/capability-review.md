# What the analytics backend can answer today

An evidence-backed capability review for the project Analytics page proposed in PR #5648.

Written against commit `31c0781d42`. Every claim below carries either a `path/to/file:LINE`
citation or the result of a live HTTP call made on 2026-08-02.

The raw evidence, meaning one saved request and response pair per probe plus the `EXPLAIN
(ANALYZE, BUFFERS)` query plans, came to 119 files and stayed out of the repository. The numbers
those files support are quoted inline wherever a claim depends on them. Appendix A lists every
probe by number and says what it tested, so anyone can reproduce a probe from the request shown
next to the claim it supports.

---

## 1. The decision

### 1.1 What we recommend

**Do not build the six-chart page as PR #5648 specifies it.** Two of its six charts read JSON
paths that hold no data on either dataset we measured, and its failed-run filter is rejected by
the backend and returns an empty success, so the page would report 100% health forever on a
project with a 9.5% failure rate.

**Do build a narrower page.** Six of the fourteen capabilities the repo owner listed work today
and mean what a reader would assume they mean. Four more work today but only under a narrower
label than the wish list uses, such as "configured model" rather than "model". Four are not
available at any price today. The narrower page needs no new backend capability, but it does
need three things PR #5648 does not have: a corrected failure filter, a default window of seven
days rather than thirty, and an explicit answer for what the page shows when a metric has no
data.

**Settle two things before writing code.** First, what each metric means, because several of
today's queryable values are proxies rather than the thing itself. Section 7 lists the choices.
Second, why cost and the prompt/completion token split stopped being recorded in mid-July on both
datasets we measured. Until someone answers that, the cost tile has nothing to show.

### 1.2 The four findings that drive that recommendation

1. **The query engine is more capable than the PR assumes.** It summarizes any JSON path you
   name, returns 27 percentiles on every numeric metric, and returns a per-value frequency table
   per time bucket on every categorical metric. Three of the wish-list items the PR defers to a
   later release work today, and three items the PR never mentions work today.
2. **The data pipeline is less healthy than the PR assumes.** The canonical cost paths hold no
   data on any agent run. A different, unmapped path does hold cost, and its coverage fell from
   about 70% of runs to near zero within a week in mid-July on both datasets. We measured the
   collapse. We did not find its cause.
3. **Several queryable values are proxies, not the thing named.** The endpoint can return the
   first *configured* tool of each run. It cannot return which tools ran. It can return the
   author's model *alias*. It cannot return which model answered. Counting those as working
   capabilities would flatter the plan.
4. **Performance, not capability, sets the limits.** The thirty-day view the shipped dashboard
   already issues takes 1.7 seconds at today's volume, and a killed query returns HTTP 200 with
   an empty result rather than an error. Seven days costs 0.26 seconds. Make seven days the
   default.

### 1.3 Where the numbers come from, and what that limits

Every measurement here was taken on one of two local development stacks.

| | Stack A | Stack B |
|---|---|---|
| Edition and image | EE, dev | OSS, dev |
| Tracing database | `agenta_ee_tracing` | `agenta_oss_tracing` |
| Root spans in the probe window | 7,529 | 9,720 |
| All spans in the probe window | 37,316 | 38,874 |
| Mean root-span attribute size | 10,011 bytes | 6,482 bytes |

The probe window everywhere is `2026-07-01T00:00:00Z` to `2026-08-03T00:00:00Z`.

**No production or cloud data was probed.** A read-only check against a hosted deployment
confirmed only that all three analytics routes are mounted; the credential available resolved to
a project with zero spans, so no data query was possible there. **Every coverage percentage in
this report therefore describes two local dev stacks and is unverified on production traffic.**

Coverage claims are the ones most likely to differ elsewhere. Capability claims, meaning what the
query engine can and cannot compute, come from code and from live calls and hold on any dataset.
Performance claims come from single-user runs against a warm cache on one machine, so they
establish the shape of the cost curve, not a capacity number you can plan against.

---

## 2. Vocabulary

The rest of the report leans on these. Read them once.

**Span.** One unit of recorded work, stored as one database row. A model call is a span. A tool
call is a span. The agent invocation itself is a span.

**Trace.** All the spans of one run, linked by a shared trace id.

**Root span.** The span in a trace with no parent (`parent_id IS NULL`). One agent run produces
exactly one root span, so counting root spans counts runs. **Child span** means any other span in
the trace. This distinction decides most of the report: the analytics endpoint reads root spans
only.

**Configured, resolved, invoked.** Three different things that are easy to confuse. *Configured*
is what the agent's author wrote down, for example the model alias `haiku` and the list of tools
the agent is allowed to use. *Resolved* is what the system turned that into at run time, for
example the model id the provider actually served. *Invoked* is what the run actually did, for
example the three tools it called. Today's analytics endpoint can read configured values. It
cannot read resolved or invoked values.

**Incremental and cumulative.** A metric written on one span for that span alone is
*incremental*. The same metric summed over a span and all its descendants is *cumulative*.
Ingest computes cumulative values by walking up the tree, so a cumulative value appears on every
ancestor. Summing a cumulative metric across all spans double-counts it.

**Window.** The absolute from-and-to time range of the whole query, sent as `oldest` and
`newest`.

**Period.** The bucket size the window is sliced into, sent as `interval`. The unit is
**minutes**, not seconds. The router docstring at
`api/oss/src/apis/fastapi/tracing/router.py:450-451` says seconds and is wrong.

**Bucket.** One time slice of the result. The response returns one metrics object per bucket.

**Fixed-duration bucket versus calendar bucket.** The backend buckets by fixed strides, for
example 1,440 minutes. A calendar day is not always 1,440 minutes long, because of daylight
saving transitions, and a calendar month is never a fixed number of minutes. The backend cannot
express calendar buckets.

**Metric spec.** A request instruction of the form `{type, path}` that names a JSON path to
summarize and how to summarize it. The endpoint has no fixed metric list. It summarizes whatever
path you name. **Default specs** are the six the backend applies when a request sends none.

**Coverage.** The share of rows on which a given path actually holds a value. A metric can be
perfectly expressible and still return nothing, because coverage is zero.

**Cardinality.** The number of distinct values a categorical breakdown can return. Nothing in the
current code caps it.

**Detoasting.** PostgreSQL stores large column values out of line, in a side table called TOAST.
Reading any part of such a value requires fetching and reassembling the whole thing. Every span's
`attributes` column is large enough for this to apply, and it is the single largest cost in every
analytics query.

**Semantic convention.** The agreed naming scheme for span attributes. Agenta's namespace is
`ag.*`, for example `ag.metrics.duration.cumulative`. Attributes arriving under a foreign
namespace, such as the OpenTelemetry GenAI convention `gen_ai.*`, stay verbatim as sibling keys
unless an adapter maps them into `ag.*`.

---

## 3. How analytics works today

### 3.1 Storage: two kinds of column, and why it matters

Analytics reads one table, `spans`, in a **separate analytics database**
(`AnalyticsEngine`, `api/oss/src/dbs/postgres/shared/engine.py:110-124`, wired at
`api/entrypoints/routers.py:534-543`). The schema is at
`api/oss/src/dbs/postgres/tracing/dbas.py:9-97` and splits into two kinds of storage:

- **Columns.** `project_id`, `trace_id`, `span_id`, `parent_id`, the enums `trace_type`,
  `span_type`, `span_kind`, `status_code`, the timestamps, `created_by_id`, and the root-only
  promoted `session_id` / `user_id` / `agent_id`.
- **JSONB.** `attributes`, `references`, `links`, `hashes`, `events`.

**Metric specs read the `attributes` JSONB only. Every column is filter-only.** The extract stage
projects `attributes #> path` and nothing else
(`api/oss/src/dbs/postgres/tracing/utils.py:1106-1126`). Verified live: specs on `span_name`,
`status_code`, `attributes.span_name` and `attributes.status_code` all returned zero buckets
(probe 37).

That one fact explains two later findings. Success and failure need a second filtered query
rather than one grouped query, and per-user numbers are unreachable even though the user id sits
in a column on every row.

### 3.2 How one run becomes rows

One agent run produces **one trace, two OTLP batches, one root span**. The batch boundary is
where cost goes missing, so it is worth a picture.

```
                        one trace, one trace_id
  ┌───────────────────────────────────────────────────────────────────┐
  │                                                                   │
  │  BATCH 1  (exported by the SDK)                                   │
  │  ┌─────────────────────────────────────────────┐                  │
  │  │ ROOT SPAN   type=workflow                   │  <- the only row │
  │  │   ag.data.parameters.*  (the agent config)  │     analytics    │
  │  │   ag.metrics.duration.cumulative            │     can read     │
  │  │   gen_ai.usage.*  (stamped by record_usage) │                  │
  │  └─────────────────────────────────────────────┘                  │
  │                                                                   │
  │  BATCH 2  (exported by the runner, linked by traceparent)         │
  │  ┌─────────────────────────────────────────────┐                  │
  │  │ invoke_agent      ag.meta.skills.loaded     │                  │
  │  │   turn 1                                    │  invisible to    │
  │  │     chat <model>  ag.meta.request.model     │  the analytics   │
  │  │                   cache-token counts        │  endpoint        │
  │  │     execute_tool <name>  ag.meta.tool.name  │                  │
  │  └─────────────────────────────────────────────┘                  │
  └───────────────────────────────────────────────────────────────────┘
```

**Batch one is the SDK.** The `/invoke` handler `_agent`
(`sdks/python/agenta/sdk/agents/handler.py:252`) runs inside the tracing decorator. As the
outermost recording span it is forced to type `workflow`
(`sdks/python/agenta/sdk/decorators/tracing.py:337-339`). That is the root span.

**Batch two is the runner.** The root span's `traceparent` is injected into the harness config
(`sdks/python/agenta/sdk/agents/tracing.py:41-77`), and the runner exports its own tree in a
separate request.

Two consequences from that shape decide half the wish list.

**First, the agent's configuration is queryable on the root span.** The decorator writes the
resolved agent config as `ag.meta.configuration`
(`sdks/python/agenta/sdk/decorators/tracing.py:548-556`), and ingest relocates the whole blob to
`ag.data.parameters` (`api/oss/src/core/tracing/utils/attributes.py:250-256`). Harness,
configured model, provider, configured tools and configured skills are therefore a JSON subtree
on the run row. None of PR #5648's documents mention this, and it is the single most useful fact
in the report.

**Second, the cost roll-up never reaches the root span.** Ingest computes the roll-up per OTLP
request (`parse_span_idx_to_span_id_tree`, `api/oss/src/core/tracing/utils/trees.py:174-193`).
The runner's spans have a remote parent, so they never join the SDK batch's tree. Confirmed by
data: `ag.metrics.costs.cumulative` is present on **zero of 48,005 spans** on stack A. Section
4.4 item 4 covers what does work instead.

The child spans in batch two carry exactly what the wish list wants for tools and models:
`ag.meta.tool.name` on each `execute_tool` span (`logfire_adapter.py:172`, emitted at
`services/runner/src/tracing/otel.ts:787`), and `ag.meta.request.model` on each `chat` span
(`logfire_adapter.py:150`). Both are invisible to the analytics endpoint, for the reason in
section 3.5.

### 3.3 The three endpoints and the two implementations

The repo owner remembered two analytics endpoints. There are three mounted routes plus two hidden
aliases, served by two implementations.

| Mounted path | operation_id | OpenAPI tag | Deprecated | Registered at |
|---|---|---|---|---|
| `POST /tracing/spans/analytics` | `fetch_legacy_analytics` | Legacy | no | `router.py:108-116` |
| `POST /tracing/analytics/query` | `query_analytics` | Deprecated | **yes** | `router.py:118-127` |
| `POST /spans/analytics/query` | `query_spans_analytics` | Traces | no | `router.py:955-962` |

All three are in `api/oss/src/apis/fastapi/tracing/router.py`. Two hidden `preview` aliases also
exist (`api/entrypoints/routers.py:1146-1153` and `:1194-1200`).

**Routes 2 and 3 are the same implementation.** Both call `dao.analytics` with the same parsing.
Verified live: the same request body to both returned an identical payload (`count: 7529`,
probe 0b). Route 2 is marked `deprecated=True` and has no caller in `web/`.

**Route 1 is a different implementation** (`dao.legacy_analytics`,
`api/oss/src/dbs/postgres/tracing/dao.py:529-736`). It computes four fixed metrics with two
hand-written aggregate queries.

Side by side:

| | Legacy `/tracing/spans/analytics` | Specs-driven `/spans/analytics/query` |
|---|---|---|
| Metrics | Fixed four (count, duration, costs, tokens), each split into total and errors (`dao.py:554-607`) | Arbitrary, driven by `specs` |
| `focus=span` | **Works** (`dao.py:566-570`, `:680-688`) | **Accepted, echoed, ignored** (`utils.py:1073`) |
| "Errors" means | Spans carrying an `exception` event, hard-coded (`dao.py:659-676`) | Whatever you ask for; `status_code` is unreachable as a metric |
| Empty buckets | Zero-filled across the window (`dao.py:706-711`) | Omitted entirely |
| Percentiles, min, max, histograms | None | Yes, on every numeric spec |
| Category breakdowns | None | Yes, per value per bucket |
| Speed on the same data | 0.29 s for a 30-day daily query | 0.52 s for one spec, 1.92 s for eight |
| Rate limit on EE cloud | 180-request burst, then 1 request per minute per organization | Falls to the general bucket: 480/min free, 1,440/min paid |
| Callers | None in `web/`; still in both generated clients | The only path the product uses |

### 3.4 Do both work? Yes, with one caveat each

**Both execute and both return correct numbers.** Live calls to both succeeded on both stacks.

The legacy endpoint has a latent defect worth one sentence and no bug report. The condition that
defines its `errors` half is added inside `if query.filtering:`
(`api/oss/src/dbs/postgres/tracing/dao.py:645-676`), so a call with `filtering=None` would leave
`errors` un-narrowed and equal to `total`. The HTTP surface cannot reach that state in practice:
`merge_queries` injects an empty `Filtering()` object whenever either the query params or the
body parse (`api/oss/src/core/tracing/service.py:343-355`), and an empty `Filtering()` is truthy,
so the branch always runs. Verified live: an unfiltered legacy call returned `total.count 11` and
`errors.count 2` for the same day, and adding a filter changed nothing (probe 18). One corner
remains untested: a completely bare POST with no query params and no body, which is the only
shape that could produce `filtering=None` (`service.py:333-341`). One curl would settle it.

The specs-driven endpoint has a bigger caveat, and it is the one that bites: **every failure
returns HTTP 200 with an empty result.** Section 3.8 covers all four failure modes.

### 3.5 The query, and its three hard constraints

`TracingDAO.analytics` (`api/oss/src/dbs/postgres/tracing/dao.py:305-527`) composes one
statement:

1. Strip the `attributes.` prefix from each spec path (`dao.py:346-352`). A spec path is a JSONB
   path relative to the `attributes` column.
2. `build_specs_values` (`utils.py:1008-1039`) turns the spec list into a SQL `VALUES` relation
   with `path = spec.path.split(".")`.
3. `build_base_cte` (`utils.py:1042-1103`) selects the rows: project scope, the `created_at`
   window, `date_bin(stride, created_at, oldest)` bucketing, external filters, and
   `.where(SpanDBE.parent_id.is_(None))`.
4. `build_extract_cte` (`utils.py:1106-1126`) cross-joins those rows against the spec relation
   and projects `attributes #> path AS jv`.
5. `build_statistics_stmt` (`utils.py:1129-1164`) unions the per-type reducer families.
6. Python assembles the metric blob (`dao.py:426-484`).

**Constraint one: root spans only.** The `parent_id IS NULL` predicate at
`api/oss/src/dbs/postgres/tracing/utils.py:1073` is unconditional, and `dao.analytics` never
passes `query.formatting` to `build_base_cte` (`dao.py:378-387`). The endpoint accepts `focus`,
echoes it back, and ignores it. Verified live with hard proof: two calls identical except for
`focus=trace` versus `focus=span`, on a duration spec, returned **byte-identical** payloads
(count 7,530, sum 88,193,670.749 both times), while the echoed `query.formatting.focus` reported
whichever value was sent (probe 13b). PR #5648 identifies this correctly and names the right fix
location.

**Constraint two: no grouping key but time.** Every reducer groups by `(timestamp, idx)` and
nothing else (`utils.py:1205, 1228, 1259, 1285, 1671, 1701, 1723`). You can get counts per
category, and you can get statistics per time bucket. In one request you cannot cross them.

**Constraint three: specs read `attributes` only** (`utils.py:1120`), as covered in 3.1.

### 3.6 What each spec type returns

`MetricSpec` is `{type, path, bins, vmin, vmax, edge}`
(`api/oss/src/core/tracing/dtos.py:252-259`). The `type` picks the reducer family:

| `type` | What comes back |
|---|---|
| `numeric/continuous` | `count`, `sum`, `mean`, `min`, `max`, `range`, `pcts` (**27** percentile levels, p00.05 to p99.95, including p95 and p99), `iqrs`, `pscs`, `hist` |
| `numeric/discrete` | The above plus a `freq` table and `uniq` |
| `categorical/single` | `count` plus `freq` (an array of `{value, count, density}`) plus `uniq` |
| `categorical/multiple` | The same, over a JSON array **of strings** |
| `binary` | `count` plus a true/false `freq` |
| `string`, `json` | `count` only |
| `none`, `*` | Nothing. No reducer family exists |

The percentile levels are at `api/oss/src/dbs/postgres/tracing/utils.py:924-955`. There are
**27** of them, confirmed by counting the dict keys in a live response (probe 16a).

The caller cannot ask for a subset. A `numeric/continuous` spec always computes the count, the
basic statistics, all 27 percentiles and a histogram, whatever the page needs
(`utils.py:1211-1215`, `:1263-1287`).

**Every family type-gates its rows.** `numeric/continuous` counts only rows where
`jsonb_typeof(jv) = 'number'` (`utils.py:1187`); `categorical/single` only `'string'`
(`utils.py:1660`); `categorical/multiple` requires an array whose elements are strings
(`utils.py:1746-1749`). A spec pointed at the wrong JSON type contributes zero rows and reports
no error. This is why `…agent.harness.kind`, a string, works and `…agent.harness`, an object,
does not.

### 3.7 Bucketing

Rules, from `_get_stride` and `_get_interval` (`utils.py:830-876`):

- `interval` is in minutes. 1440 is a day, 10080 is a week.
- **Omitting `interval` collapses the window into one exact bucket** (`utils.py:838-841`). This
  is the cheapest way to get a true window-level total or percentile, and PR #5648 never uses it.
- Bucket edges are fixed-width offsets from `oldest`, computed by `date_bin`
  (`utils.py:1051-1055`), always in UTC, keyed on `created_at`, which is ingest time rather than
  the span's start time (`parse_windowing`, `utils.py:892-921`).
- `_MAX_ALLOWED_BUCKETS = 1024` (`utils.py:808`). Above it the stride is **silently widened**
  (`utils.py:848-859`). Verified live: a 7-day window with `interval=1` returned 627 buckets each
  reporting `"interval": 15` (probe 15).
- Buckets with no rows are **omitted** by the specs-driven endpoint. The frontend must build its
  own x-axis.

### 3.8 Four ways the endpoint fails quietly

All four verified live, all producing plausible wrong numbers rather than errors.

1. **An unknown filter field is logged and dropped, not rejected**
   (`api/oss/src/core/tracing/utils/filtering.py:542-546`). A typo **widens** the result.
   Verified: a filter on `{"field": "environment", "operator": "is", "value": "production"}`
   returned 7,529, identical to unfiltered (probe 11b).
2. **An invalid operator or value raises `FilteringException`, which becomes an empty 200.** The
   handler is decorated `@suppress_exceptions(default=AnalyticsResponse(), exclude=[HTTPException])`
   (`router.py:1276`), and `FilteringException` is not an `HTTPException`. Verified: the filter
   PR #5648 specifies returned HTTP 200 with `buckets: []` in 0.016 seconds (probe 5).
3. **A malformed `oldest` or `newest` silently substitutes the default 30-day window.**
   `parse_query_from_body_request` catches everything
   (`api/oss/src/apis/fastapi/tracing/utils.py:136-158`) and `parse_windowing` then applies
   `_DEFAULT_TIME_DELTA` (`utils.py:807`, applied at `:909-915`). Verified: `"oldest":
   "not-a-date"` returned 7,519 instead of 7,529, with `query.windowing` echoing `{}` (probe 39).
4. **A query killed by the statement timeout also becomes an empty 200.** Section 5.5.

**Do not trust the echoed query.** The response echoes back the resolved `query` and `specs`
(`router.py:1311-1315`), and both earlier research passes recommended reading it as the standard
debugging move. It reports **what you asked for, not what ran**. With `interval=1` the echo says
1 while the buckets ran at a coarsened stride, and `query.formatting.focus` echoes `span` on an
endpoint that ignores focus. The only field that reports what actually ran is
`buckets[].interval`.

### 3.9 A worked example

Two real calls, taken from the saved artifacts. Project and account identifiers are redacted.

**Call one: run count, latency and percentiles for a whole window, in one bucket.** Omitting
`interval` gives exact window-level numbers that cannot be derived from per-bucket data.

```json
POST <host>/api/spans/analytics/query?project_id=<PROJECT_ID>
{
  "oldest": "2026-07-01T00:00:00+00:00",
  "newest": "2026-08-03T00:00:00+00:00",
  "specs": [
    {"type": "numeric/continuous", "path": "attributes.ag.metrics.duration.cumulative"}
  ]
}
```

Response, abridged; `pcts` has 27 keys, and `iqrs`, `pscs` and `hist` are omitted here:

```json
{
  "count": 1,
  "buckets": [{
    "timestamp": "2026-07-01T00:00:00Z",
    "interval": 47520,
    "metrics": {
      "attributes.ag.metrics.duration.cumulative": {
        "type": "numeric/continuous",
        "count": 7529,
        "sum": 88185838.233,
        "mean": 11712.822,
        "min": 0.77,
        "max": 465914.479,
        "range": 465913.709,
        "pcts": {"p50": 4090.6, "p95": 25777.31, "p99": 60184.84}
      }
    }
  }],
  "query": {...}, "specs": [...]
}
```

Read that as 7,529 runs, 11.7 seconds average, 25.8 seconds at p95. Duration is in milliseconds.
`count` at the top of the response is the **number of buckets**, not the number of runs
(`router.py:1310`). Anything reading the top-level `count` as a run total is wrong.

**Call two: harness usage per day.** A `categorical/single` spec returns a full frequency table
per bucket, which is a per-value breakdown in one request.

```json
POST <host>/api/spans/analytics/query?project_id=<PROJECT_ID>
{
  "oldest": "2026-07-01T00:00:00+00:00",
  "newest": "2026-08-03T00:00:00+00:00",
  "interval": 1440,
  "specs": [
    {"type": "categorical/single",
     "path": "attributes.ag.data.parameters.agent.harness.kind"}
  ]
}
```

Response, first bucket of 30:

```json
{
  "count": 30,
  "buckets": [{
    "timestamp": "2026-07-03T00:00:00Z",
    "interval": 1440,
    "metrics": {
      "attributes.ag.data.parameters.agent.harness.kind": {
        "type": "categorical/single",
        "count": 11,
        "freq": [
          {"value": "claude",  "count": 10, "density": 0.90909},
          {"value": "pi_core", "count": 1,  "density": 0.09091}
        ],
        "uniq": ["claude", "pi_core"]
      }
    }
  }]
}
```

Artifacts: `p16a-no-interval-duration.*` and `p08a-harness-kind.*`.

### 3.10 The chart layer today

The web app has one analytics call path, four files deep:

```
AnalyticsDashboard.tsx
  └── useObservabilityDashboard()          web/oss/src/state/observability/dashboard.ts:57
        └── observabilityDashboardQueryAtom               dashboard.ts:22
              └── fetchGenerationsDashboardData    web/oss/src/services/tracing/api/index.ts:19
                    ├── analyticsToGeneration  web/oss/src/services/tracing/lib/helpers.ts:106
                    └── fetchSpansAnalytics
                          web/packages/agenta-entities/src/trace/api/api.ts:323
```

It calls route 3 with everything in the query string and **never sends `specs`** (`api.ts:343`),
so the backend applies its six defaults (`DEFAULT_ANALYTICS_SPECS`,
`api/oss/src/core/tracing/service.py:91-98`). The mapper reads five dotted paths and one flat
field through `metricField` (`helpers.ts:88-92`), which reads **one level deep and numeric
only**. Everything nested, meaning `pcts`, `freq`, `hist` and `iqrs`, is invisible to the app
today, not because the backend withholds it but because nobody reads it.

---

## 4. The wish list, capability by capability

The repo owner asked about fourteen capabilities:

1. Number of runs, per window, grouped by period (day, week, month).
2. Average latency, per window, grouped by period.
3. Latency maximum, minimum and 95th percentile.
4. Cost, split into prompt, completion and cache, with the same window and period.
5. Tokens, split into prompt, completion and cache, with the same window and period.
6. Run success and failure counts, with the same window and period.
7. Tool usage aggregated per period: which tools ran, how often.
8. Model usage aggregated per period.
9. Harness usage aggregated per period.
10. Filtering by agent.
11. Filtering by model.
12. Filtering by harness.
13. Filtering by the user who made the call, and numbers per user.
14. Skills used.

### 4.1 How to read the table

A single "does it work" column would mislead, because four different questions hide inside it.
The table below answers all four separately.

- **Expressible?** Can today's query engine produce this number at all, from any request?
- **What it means.** Is the number the thing the wish list names, or a proxy standing in for it?
  A proxy can still be worth charting, but it must be labelled honestly in the UI.
- **Coverage.** What share of runs actually carry the data, on the two datasets we measured.
- **Ready to ship?** Would a user reading this chart draw a correct conclusion.

### 4.2 The summary table

| # | Capability | Expressible? | What the number means | Coverage measured | Ready to ship? |
|---|---|---|---|---|---|
| 1 | Runs per window, per period | Yes, in fixed-duration buckets. Calendar months are not expressible | Root spans in the window. Includes annotation traces unless filtered | 100% | **Yes**, with a `trace_type` filter and an honest bucket label |
| 2 | Average latency per period | Yes | Mean root-span wall clock, milliseconds | 8,817 of 8,820 roots (A) | **Yes** |
| 3 | Latency min, max, p95 | Yes. 27 percentiles ship on every numeric spec | Exact percentile over root durations. Window-level p95 needs a separate no-interval call | Same as 2 | **Yes** |
| 4 | Cost total | Yes, but only at `attributes.gen_ai.usage.cost` | The harness's own reported total for the run. The canonical `ag.metrics.costs.*` paths are empty on agent roots | 2.0% (A), 68.6% (B), both near zero after mid-July | **No.** Blocked on the coverage investigation |
| 4b | Cost split prompt / completion | Yes in principle. Ingest computes it | Modelled at ingest on LLM child spans and rolled up within one batch. For agent runs it never reaches the run's root span | 0 of 48,005 spans (A) | **No** |
| 4c | Cost split for cache | No | Not modelled anywhere in the cost shape | n/a | **No** |
| 5 | Tokens total | Yes | Harness-reported total tokens for the run | 5,842 of 7,529 (A) | **Yes**, if the tile states its coverage |
| 5b | Tokens split prompt / completion | Yes | Same field family as the total | Zero on A, real on B, collapsed alongside cost | **No.** Gate on coverage |
| 5c | Cache tokens | No. Child spans only | Cache reads and writes per model call | 444 spans, 0 roots (A) | **No** |
| 6 | Success versus failure | Yes, with a corrected filter | Root span status. Blind to failures inside an otherwise clean run, measured at 1.2% of runs | 100% | **Yes**, if you write down that failure means root-span error |
| 7 | Tool usage per period | Only the **first configured** tool, by array index | Configuration order, not usage. Which tools ran is on child spans | index 0 present on 7,221 roots; invoked tool names on 7,587 non-root spans | **No** as "tool usage" |
| 8 | Model usage per period | Yes, for the configured alias | The author's alias, not the model that answered. A run can call several models | 7,345 of 7,529 (A) | **Proxy only.** Label it "configured model" |
| 9 | Harness usage per period | Yes | The configured harness kind, one per run, so this is exact | 8,765 of 8,809 roots (A) | **Yes.** Absent from PR #5648 |
| 10 | Filter by agent, and per-agent breakdown | Yes, both | Agent identity from `references`. Two naming families must be unioned | 7,241 of 7,529; 288 roots carry none | **Yes** |
| 11 | Filter by model | Yes, for the configured alias | Same proxy as item 8 | Same as 8 | **Yes**, with the alias label |
| 12 | Filter by harness | Yes | Configured harness kind | 7,056 of 7,529 | **Yes.** Absent from PR #5648 |
| 13 | Filter by user, and numbers per user | Filter yes, breakdown no. Specs cannot read columns | `created_by_id` is the credential owner, not an end user | Exactly one distinct value per project on both stacks | **No** |
| 14 | Skills used | Only the **first configured** skill, by array index | Configuration order. Invoked skills are recorded nowhere | index 0 present on 491 roots | **No** |

**Counting honestly:** six capabilities are ready and mean what the wish list says (1, 2, 3, 9,
10, 12). Four more are ready under a narrower label (5, 6, 8, 11). Four are not available (4, 7,
13, 14), and within item 5 the split and the cache lines are not available either.

Three dimensions nobody asked for also work today and cost one spec each: runs per connection
mode, runs per default permission, and runs by streaming flag. Appendix B has the numbers.

### 4.3 The recurring wall, stated precisely

Six verdicts above reduce to one limitation.

**Works today in one call:** a count breakdown per attribute value, per time bucket. Runs per
harness per day, per model, per agent, per skill, per connection mode. This is what
`categorical/single` returns, and it needs no backend change.

**Works today at one call per value:** a numeric statistic *for* a given value, through a deep
JSON filter. Average or p95 latency for `haiku`, then for `sonnet`, and so on. The value list
comes from one no-interval call, whose `uniq` array is the complete distinct-value list for the
window. So the pattern is one call to learn the values plus N calls to measure them. Six models
issued in parallel measured 0.68 seconds (section 5.3).

**Does not work in a single request:** a numeric statistic split by a category. "Sum of cost by
model", "p95 latency by tool". Verified live: a request with a duration spec and a harness spec
returns both, but the duration statistics cover all 7,529 rows with no split by harness (probe
27). There is no grouping dimension anywhere in `api/oss/src/core/tracing/` today. Section 8.4
covers what adding one should look like, and why the obvious shape is not the right one.

### 4.4 The detail, item by item

Each item names the probe that tested it. Appendix A indexes every probe by number.

---

#### 1. Number of runs per window, grouped by period

**Ready to ship, in fixed-duration buckets. Calendar months are not expressible.**

**How.** One `categorical/single` spec on `attributes.ag.type.trace`, with `interval` set to 1440
for days or 10080 for weeks, plus a `trace_type is invocation` filter. Read
`buckets[].metrics["attributes.ag.type.trace"].count`.

**Live test.** Probe 0 returned `count 7529` for the probe window on stack A, and a direct SQL
count of root spans over the same window returned **exactly 7,529**. So the analytics run count
provably equals the root-span count. Probes 4a to 4c then showed the failure split summing
exactly: 7,529 unfiltered, 715 errored, 6,814 not errored.

**Semantic conventions.** `ag.type.trace` is stamped on every span of every trace by
`api/oss/src/core/tracing/utils/trees.py:114-140`, with values `invocation` or `annotation`.
Nothing new needs recording.

**Three caveats.**

- **The run count includes annotation traces** unless you filter. Annotations are evaluator runs
  and human annotations, not agent runs. The magnitude is small on our datasets, 3 annotation
  roots of 8,820 on stack A, but PR #5648's own glossary defines a run as an invocation and then
  specifies a metric that counts both. Either add the `trace_type` filter, or read the `freq`
  array, which already carries the split.
- **Calendar months are not expressible.** `_get_interval` (`utils.py:862-876`) maps minutes,
  hours, days and weeks only. A 30-day stride is not a month. The workaround is one no-interval
  call per calendar month, so twelve calls for a year.
- **A "day" is 1,440 minutes, not a calendar day.** The frontend can align `oldest` to the
  viewer's local midnight, and that is worth doing. Verified live: moving `oldest` from
  `00:00+00:00` to `00:00+02:00` moved every bucket boundary from `T00:00:00Z` to `T22:00:00Z`
  and re-shuffled the counts (probe 17). But `date_bin` steps by a fixed duration
  (`utils.py:1051-1055`), so across a daylight saving transition the buckets drift off local
  midnight by an hour for the rest of the window. Label the axis as 24-hour periods, or add
  timezone-aware boundaries in the backend. Do not call fixed-stride buckets calendar days.

---

#### 2. Average latency per window, grouped by period

**Ready to ship. No backend work.**

**How.** Add `{"type": "numeric/continuous", "path": "attributes.ag.metrics.duration.cumulative"}`
to the same request. Per bucket, `mean` comes back directly. For a window average, do **not**
average the per-bucket means. Sum the `sum` fields and divide by the summed `count` fields, or
issue the no-interval call and read `mean` exactly.

**Live test.** Probe 16a, whole probe window, one bucket: `count 7529`, `sum 88185838.233`,
`mean 11712.82`, `min 0.77`, `max 465914.479`.

**Semantic conventions.** `ag.metrics.duration.cumulative` is not a roll-up despite the name.
Ingest overwrites it with the span's own wall-clock duration in milliseconds
(`api/oss/src/core/tracing/utils/parsing.py:296-306`). Coverage is effectively total, 8,817 of
8,820 roots on stack A. Units are milliseconds, and the existing frontend mapper documents a past
bug where they were divided by 1000 (`helpers.ts:132-135`).

---

#### 3. Latency maximum, minimum and 95th percentile

**Ready to ship. No backend work of any kind. PR #5648 treats this as new work.**

**How.** The same `numeric/continuous` spec as item 2. `min` and `max` are flat fields.
Percentiles are **nested**: `metrics[path].pcts.p95`. All 27 levels ship on every
`numeric/continuous` spec, always, computed by
`percentile_cont(ARRAY[...]) WITHIN GROUP (ORDER BY value)` (`utils.py:1266-1287`, levels at
`:924-955`).

**For a window-level p95, omit `interval`.** Percentiles do not compose across buckets. Averaging
or taking the maximum of per-bucket p95s is wrong for any non-uniform distribution.

**Live test.** Probe 16a versus 16b, same window, one with no interval and one with
`interval=1440`: window p95 was **25,777 ms**, while the July 3 bucket's p95 was **251,838 ms**
and July 7's was 103,313 ms. You cannot derive the first from the second. Probe 31 additionally
confirmed that a spec with `bins: 10, vmin: 0, vmax: 60000` returns a ten-bin histogram with
per-bin density, for free.

**Frontend note.** `metricField` (`helpers.ts:88-92`) reads one level deep and numeric only, so
p95 is unreachable through it. The zod boundary is not the obstacle: `metricsBucketSchema`
(`web/packages/agenta-entities/src/trace/core/schema.ts:310-317`) types metrics as
`z.record(z.string(), z.record(z.string(), z.unknown()).nullable())`, so nested objects survive
validation. The mapper needs a small nested accessor, nothing more.

---

#### 4. Cost, split prompt / completion / cache

**Not ready. Total cost is computable through a path PR #5648 does not name, but its coverage
collapsed in mid-July on both datasets and nobody has found out why. The prompt and completion
split is modelled but never reaches an analytics-visible row. A cache line item does not exist.**

This is the most consequential correction to PR #5648.

**What does not work.** `ag.metrics.costs.cumulative.total`, `.prompt` and `.completion`, which
are what PR #5648's data contract reads and what the backend's own default spec reads
(`service.py:94`). Live, a request naming all three returned HTTP 200 with `buckets: []` (probe
1). SQL: `ag.metrics.costs.cumulative` is present on **0 of 48,005 spans** on stack A, root or
child. **Built as specified, PR #5648's Total-cost tile and its entire Costs chart render
nothing.**

**Those paths are modelled, not missing.** `calculate_costs`
(`api/oss/src/core/tracing/utils/trees.py:579-650`) prices every chat-family span through litellm
and writes `ag.metrics.costs.incremental.{prompt, completion, total}`. `cumulate_costs`
(`trees.py:231-350`) then walks the tree and writes the same three keys under `cumulative` on
every ancestor. The prompt-and-completion split of cost therefore exists as a first-class
concept. What it does not do is cross the batch boundary from section 3.2: the tree is built per
OTLP request (`trees.py:174-193`), the run's root span is a `workflow` span with no cost of its
own, and its LLM children arrive in a different request. The roll-up fires inside batch two and
lands on `invoke_agent`, which is a child span and therefore invisible to analytics.

**What does work.** `attributes.gen_ai.usage.cost`. `record_usage`
(`sdks/python/agenta/sdk/agents/tracing.py:213-236`) stamps the harness's own cost figure on the
root span, and no OTLP adapter maps it into `ag.*`
(`grep -rn "usage.cost" --include=*.py api/` returns nothing), so it stays at a raw top-level
JSONB path. Specs take arbitrary paths, so it aggregates:

```json
{"type": "numeric/continuous", "path": "attributes.gen_ai.usage.cost"}
```

**Live test.** Probe 2. Stack A: `count 151` of 7,529 runs (2.0%), `sum $34.03`, `p50 $0.096`,
`p95 $0.97`. Stack B: **6,666 of 9,720 runs (68.6%), sum $436.06**.

**The coverage collapse.** The two stacks disagree by a factor of thirty, and the difference is
not configuration. Both projects are about 99% `harness=claude`, `provider=anthropic`,
`connection.mode=self_managed`. The difference is time. Daily coverage of `gen_ai.usage.cost` on
the root span:

```
stack B  Jul-06  381/395    Jul-07 1101/1145   Jul-10 1153/1442   Jul-12 1308/1459
         Jul-13   81/1455   Jul-14    0/629
stack A  Jul-03    6/11     Jul-07   55/74     Jul-08   28/184    Jul-10   12/378
         Jul-12    0/364    Jul-20 to Aug-02: 0 to 2 per ~290 runs per day
```

Cost was populated on 70% to 95% of runs in early July on **both** stacks and fell to roughly zero
within a week. The wiring exists end to end: harness, runner, root span, analytics spec. We proved
the pipeline works by aggregating $436 over 6,666 runs on stack B.

**We did not find the cause, so we do not call it a regression.** We measured coverage, not code
history. Nobody ran `git log` over `record_usage`, the runner's usage reporting, or the harness
adapters. The mechanism is easy to state and hard to attribute: `record_usage` returns early when
the harness reports a falsy `usage.total` (`tracing.py:221`) and writes cost only when the
harness returns a truthy `cost` (`:232-234`). So the collapse could be a code change, a harness
version change, a change to the shape of the usage payload, or a change in what kind of traffic
these stacks carry. **This is the single most important open item in this report.** In order:

1. Correlate the mid-July date with runner, SDK, harness and deployment versions.
2. Compare terminal `run.result().usage` payloads by harness and by streaming versus batch mode.
3. Check whether `total`, `input`, `output` and `cost` changed names or types.
4. Separate successful, failed, cancelled and manually instrumented traffic before comparing.

Both stacks are local dev stacks. Whether production shows the same collapse is unverified.

**Where litellm undercounts, separately.** Where litellm does price a call, it undercounts cached
prompts, because `cost_per_token` receives the non-cached prompt count only. One measured
example: a span with 1 uncached prompt token, 25,182 cache-read tokens and 20 completion tokens
was priced at $0.000303 while the harness reported $0.0082, a 27x undercount.

**A partial fallback, with a hard caveat.** The legacy endpoint under `focus=span` sums
`costs.incremental` over all spans and returns a real number (`dao.py:566-570`). Live: a July 4
bucket returned `costs: 0.0066` where the specs endpoint returns nothing (probe 3). **Do not
build a product on it.** On EE cloud that route is throttled to a 180-request burst and then one
request per minute per organization (section 5.4). It is a debugging tool.

**The cheapest fix, if one is wanted.** Map `gen_ai.usage.cost` to
`ag.metrics.costs.cumulative.total` in `GENAI_SEMCONV_ATTRIBUTES_EXACT`
(`api/oss/src/apis/fastapi/otlp/extractors/adapters/logfire_adapter.py:148-196`, verified
absent), so the canonical path holds the run total and no default spec has to change. Map it to
`cumulative`, not `incremental`: `record_usage`'s own docstring says the value is the run's
aggregate total (`tracing.py:213-219`), so labelling it incremental would misname it and would
double-count against the runner's own child spans once `focus=span` works. One thing to verify
with a test before shipping that map: ingest's roll-up writes `cumulative` only when it computes
a non-zero total (`trees.py:319-341`), so an adapter-written value should survive on a zero-cost
batch, but nothing pins that behaviour today.

A prompt, completion and cache split of cost needs the harnesses to report split costs, which
most do not.

---

#### 5. Tokens, split prompt / completion / cache

**Total is ready to ship with a coverage label. The prompt and completion split moves with cost
and shares the same collapse. Cache tokens are instrumented on child spans only.**

**How.**

```json
"specs": [
  {"type": "numeric/continuous", "path": "attributes.ag.metrics.tokens.cumulative.total"},
  {"type": "numeric/continuous", "path": "attributes.ag.metrics.tokens.cumulative.prompt"},
  {"type": "numeric/continuous", "path": "attributes.ag.metrics.tokens.cumulative.completion"}
]
```

**Live test.** Probe 7. Stack A: total `count 5842`, `sum 309M`, but prompt and completion at
`p50 0` and `p95 0`. Stack B: **prompt `sum 4.47M`, `p95 2877`; completion `sum 1.62M`,
`p95 473`.**

So the split is not structurally zero. It moves in lockstep with the cost field and shares the
same mid-July collapse. On a dataset where the pipeline works, a stacked prompt and completion
chart renders real data. On a dataset where it does not, it renders a flat zero band, which is
worse than an empty chart because it looks like data. `record_usage`
(`sdks/python/agenta/sdk/agents/tracing.py:213-236`) stamps whatever the harness reports for
input and output, and returns early when the harness reports a falsy total (`:221`).

**Cache tokens need no new instrumentation, but they need a way to be read.** The real path is
`gen_ai.usage.cache_read.input_tokens` and `gen_ai.usage.cache_creation.input_tokens`, note the
dotted spelling rather than `cache_read_input_tokens`. Live: **444 spans** carry it, holding 8.98M
cached input tokens, and **zero of them are root spans**; 446 are `CHAT` children. Verified by
requesting both paths and getting no entry at all in the metrics dict (probe 32). Cache tokens
therefore need exactly the same unblocking as tool usage: either roll them up to the root at
ingest, or make `focus=span` work.

---

#### 6. Run success versus failure

**Ready to ship, with a required correction to PR #5648's filter and an explicit definition of
failure.**

**How.** Two calls with the same window and interval. Unfiltered gives totals. Filtered gives
failures.

```json
"filter": {"conditions": [
  {"field": "status_code", "operator": "is", "value": "STATUS_CODE_ERROR"}
]}
```

**Live test.** Probes 4a to 4c on stack A: unfiltered 7,529; `is STATUS_CODE_ERROR` 715;
`is_not STATUS_CODE_ERROR` 6,814. The halves sum exactly.

**Three traps, in order of cost.**

1. **PR #5648's filter is wrong and fails silently.** Its data contract specifies
   `{field: "status_code", operator: "eq", value: "ERROR"}`. Both halves fail. `status_code` is
   dispatched to `_parse_enum_field_condition`
   (`api/oss/src/core/tracing/utils/filtering.py:508-509`), which raises for any operator outside
   comparison and list (`:366-371`); `"eq"` is `NumericOperator.EQ`
   (`api/oss/src/core/tracing/dtos.py:114`). The value fails too, because `OTelStatusCode` accepts
   only `STATUS_CODE_OK`, `STATUS_CODE_ERROR` and `STATUS_CODE_UNSET`
   (`api/oss/src/core/otel/dtos.py:113-116`). `FilteringException` then becomes an empty 200.
   Verified live: HTTP 200 in 0.016 seconds with `buckets: []` (probe 5). Because the PR's data
   contract computes `success = total - failed` (`pr5648-docs/data-contract.md:71`), **the page
   as specified reports zero failures and 100% health forever, on a project with a 9.5% failure
   rate.**
2. **There is no `STATUS_CODE_OK` on root spans.** Success is `STATUS_CODE_UNSET`. A "success"
   filter must be `is_not STATUS_CODE_ERROR`. PR #5648 gets this right by accident, by defining
   success as the complement of failure. Write it down explicitly, because the obvious
   implementation returns zero.
3. **Do not use `errors.cumulative`,** which is what the shipped dashboard does
   (`helpers.ts:124`). It counts errored steps rolled up the tree and can exceed the run count.
   For agent traffic the two agree exactly today, 715 rows both ways on stack A, but the hazard
   is real for multi-span SDK workflows. PR #5648 correctly rejects it.

**A blind spot that needs a product decision.** Root status does not see failures inside a run.
Live on stack A over the July window: 569 traces have an errored child span, and **94 of them
have a clean root**, which is **1.2%** of 7,530 runs (probe 6). Those runs count as successes. An
all-time measurement on an earlier snapshot of the same stack put it at 2.7%; use 1.2% as the
current figure. Section 7 lists this as a semantics decision, not a bug.

---

#### 7. Tool usage aggregation per period

**Not ready as "tool usage". The endpoint can chart the first configured tool of each run, which
is configuration order rather than usage. Which tools actually ran needs `focus=span`.**

**What the engine can do today.** A spec path can index into a JSON array. The DAO splits the
spec path on `.` and hands it to the JSONB `#>` operator, which reads an integer segment as an
array index (`build_specs_values`, `utils.py:1008-1039`). So this returns a frequency table
today:

```json
{"type": "categorical/single",
 "path": "attributes.ag.data.parameters.agent.tools.0.name"}
```

**Live test.** Probe 34: **7,221 rows**, with `get_pr` 6,777, `read` 297, `list_open_issues` 103,
`bash` 23 and a tail. Configured tools ship on the root span at
`ag.data.parameters.agent.tools`, on 8,685 of 8,792 roots.

**Read that result honestly.** The path names element **zero**. It charts the first *configured*
tool of each run. It does not chart the tools the run used, and it does not even chart the whole
configured set. A chart titled "Tool usage" fed by that path would be wrong, and a chart titled
"Most common first configured tool" is not a chart anyone asked for. Treat the array-index
mechanism as proof that the extraction works, not as a shippable metric.

Charting the whole configured array needs either one spec per index, with no way to know the
array length, or a `jsonb_array_elements` expansion in the backend. Separately, a
`categorical/multiple` spec on `…agent.tools` returns nothing, because the array holds
**objects** and that family requires an array of strings (`utils.py:1746-1749`). Verified across
four spec types (probe 25).

**What actual tool usage would need.** Each tool call is its own span, named `execute_tool
<name>`, with `span_type = TOOL` and the name at `ag.meta.tool.name`, emitted at
`services/runner/src/tracing/otel.ts:778-787`. SQL: **7,587 spans carry that path, zero of them
roots.** A `categorical/single` spec on it returns zero buckets under any `focus` value (probe
13). This is the `focus=span` blocker.

**Three things must ship with a `focus=span` fix, or it produces wrong numbers.**

1. **A cumulative-versus-incremental guard.** Cumulative paths are written onto every ancestor
   (`trees.py:311-350`), so scanning all spans double-counts them. Cost and tokens must switch to
   `incremental` under span focus. PR #5648 identifies this correctly and it is the sharpest
   thing in its plan.
2. **A run-count dedupe rule.** `ag.type.trace` is stamped on every span in a trace, so a run
   count under `focus=span` counts spans, not runs.
3. **An index for non-root rows.** Today's index is partial:
   `ix_spans_root_project_created_trace ... WHERE parent_id IS NULL`. Measured fan-out is
   **4.96x**, 37,316 spans against 7,529 roots, and the measured cost of scanning all spans
   instead of roots for one spec over 30 days is **2.60 s against 0.68 s** (section 5).

---

#### 8. Model usage aggregation per period

**A proxy is ready to ship: the configured model alias. The model that actually answered needs
`focus=span`. Cost or latency broken down by model needs a grouping dimension.**

**How, for the alias, today.**

```json
"specs": [
  {"type": "categorical/single", "path": "attributes.ag.data.parameters.agent.llm.model"},
  {"type": "categorical/single", "path": "attributes.ag.data.parameters.agent.llm.provider"}
]
```

**Live test.** Probe 9: model returned 7,345 rows across **26 distinct values** (`haiku` 6,808,
`gpt-5.6-luna` 158, `sonnet` 114 and a long tail); provider returned 7,317 rows across 5 values.
`runner.kind` and `sandbox.kind` also return frequency tables.

**What the UI must say.** This is the **author's alias**, not the model that served the request,
and one run can call several models. The resolved id lives at `ag.meta.request.model` on each
child `chat` span, on 10,003 child spans and zero roots, unreachable until `focus=span` lands. A
small number of root spans store `…llm.model` as an object rather than a string, and the
`jsonb_typeof(jv) = 'string'` gate skips them, so the frequency counts can sit slightly below the
run count.

**Per-model latency is cheaper than it looks.** One filtered call per model:

```json
"filter": {"conditions": [
  {"field": "attributes", "key": "ag.data.parameters.agent.llm.model",
   "operator": "is", "value": "haiku"}
]}
```

Verified live (probe 26): 27 buckets with full statistics, and six models issued in parallel
finished in **0.68 seconds** (section 5.3). For a dimension with ten or fewer values this is a
workable v1 pattern. Section 5.7 states its costs, because it is not free.

**Per-model cost needs a grouping dimension** (section 4.3). PR #5648 correctly names group-by as
the harder, later change, but its plan text elsewhere implies span focus is the blocker for both.
It is not.

---

#### 9. Harness usage aggregation per period

**Ready to ship. Absent from all six of PR #5648's documents.**

**How.** One `categorical/single` spec on `attributes.ag.data.parameters.agent.harness.kind`. The
full request and response are the worked example in section 3.9.

**Live test.** Probe 8a: 30 daily buckets, each with a frequency array. SQL: the path is present
on 8,765 of 8,809 roots (99.5%) and is always a JSON string.

**Two caveats.**

- **The path must end in `.kind`.** `…agent.harness` is a JSON object. A `categorical/single`
  spec pointed at it returns exactly the handful of legacy rows that store `harness` as a bare
  string: **6 rows** in the probe window, `pi_agenta` 3 and `pi_core` 3 (probe 8b). A `json` spec
  on the same object path returns `count: 7523`, and 7,523 plus 6 equals 7,529, which proves the
  type gate exactly (probe 8c).
- **The runner's own harness id is unmapped.** `gen_ai.agent.name` on the `invoke_agent` child
  span has no `ag.*` mapping. `logfire_adapter.py:186-187` maps `gen_ai.agent.id` and
  `gen_ai.agent.description` but not `.name`, and it is on a child span anyway. The config-blob
  path is the usable one.

---

#### 10. Filtering by agent, and per-agent breakdown

**Both ready to ship. The breakdown is not in PR #5648's plan.**

**Filter.**

```json
"filter": {"conditions": [
  {"field": "references", "operator": "in", "value": [{"id": "<VARIANT_ID>"}]}
]}
```

This is already the mechanism the shipped frontend uses
(`web/oss/src/services/tracing/api/index.ts:41-47`). `references` accepts list, dictionary and
existence operators only (`filtering.py:159-163`), and the `in` value must be a list of
dictionaries.

**Breakdown, one call, no filter.**

```json
"specs": [
  {"type": "categorical/single", "path": "attributes.ag.references.workflow_variant.id"},
  {"type": "categorical/single", "path": "attributes.ag.references.application_variant.id"}
]
```

**Live test.** Probe 10: 6,900 plus 341 equals 7,241 of 7,529 runs. **288 roots carry no agent
reference at all.**

**You must union two naming families.** Agent identity is recorded under
`workflow` / `workflow_variant` / `workflow_revision` and under
`application` / `application_variant` / `application_revision`. A page that queries only one
silently loses a chunk of traffic.

**One thing that does nothing.** The frontend sends `application_id` on every analytics call
(`projectScopedRequest`, `client.ts:40`). The analytics handler never reads it
(`router.py:1277-1315` uses `request.state.project_id` only). App scoping comes entirely from the
`references` condition.

---

#### 11. Filtering by model

**Ready to ship, for the configured alias.**

Shown under item 8. Verified live (probe 23): a filter on `…agent.llm.model is haiku` combined
with a harness-kind spec returned 6,808 rows, all `claude`. Arbitrary-depth attribute filters
work through `_to_jsonb_path` (`utils.py:72-87`), and for comparison operators they compile to a
containment predicate that the GIN index on `attributes` can assist.

**One trap.** `key` is required on an `attributes` condition (`filtering.py:89-93`). Omitting it
raises, which becomes an empty 200.

---

#### 12. Filtering by harness

**Ready to ship. Absent from PR #5648.**

```json
"filter": {"conditions": [
  {"field": "attributes", "key": "ag.data.parameters.agent.harness.kind",
   "operator": "is", "value": "claude"}
]}
```

**Live test.** Probe 22: 7,056 of 7,529 runs. The only loss is the small number of legacy rows
that store `harness` as a bare string.

---

#### 13. Filtering by the calling user, and numbers per user

**Not ready. The filter mechanism works, but the dimension holds one value per project on every
dataset we checked, and per-user numbers need a backend change on top of that.**

**The filter.**

```json
"filter": {"conditions": [
  {"field": "created_by_id", "operator": "in", "value": ["<ACCOUNT_ID>"]}
]}
```

`created_by_id` is the Agenta account whose credential ingested the span. Ingest writes it on
every row (`api/oss/src/dbs/postgres/tracing/mappings.py:210`, column at
`api/oss/src/dbs/postgres/shared/dbas.py:106-109`), and the filter accepts comparison, list and
existence operators (`filtering.py:428-432`).

**Live test, and why it proves less than it looks.** Probe 11a returned **all 7,529 runs**,
because probe 12 found `created_by_id` has **exactly one distinct value per project** on both
stacks. A fabricated id returns zero buckets, so the filter is mechanically valid. But the demo
is evidentially empty: there is no second user to narrow to.

**Numbers per user do not work, twice over.**

- **Mechanically.** `created_by_id` is a **column**, and specs read `attributes #> path` only. No
  spec can produce a per-user frequency table (probe 37).
- **Evidentially.** There is a second user concept, `ag.user.id`, an end-user identity that the
  instrumenting caller must set. It survives ingest as an attribute and is also copied to a
  `user_id` column (`trees.py:143-172`). A `categorical/single` spec on `attributes.ag.user.id`
  is a working mechanism with zero data: SQL shows the promoted `user_id`, `session_id` and
  `agent_id` columns are **NULL on 100% of root spans on both stacks**, and no root span carries
  the attribute. The agent runtime never sets it.

**Options.** The cheapest hack is to copy `created_by_id` into `attributes` at ingest, so one
`categorical/single` spec gives the breakdown. It is a hack: it duplicates a typed column into
JSON to route around the query engine's inability to group by a column, and it doubles the
storage of a value that already exists. The better fix is to let the analytics contract name
`created_by_id` as a dimension directly (section 8.4). Either way, decide first whether "who
called" means the API credential or an end user set through `ag.user.id`; that is a product
question, and the answer changes which field matters.

Whether cloud projects have more than one distinct `created_by_id` is unverified.

---

#### 14. Skills used

**Not ready. The endpoint can chart the first configured skill of each run. Which skills the
agent actually used is recorded nowhere.**

**What the engine can do today.** The same array-index mechanism as item 7:

```json
{"type": "categorical/single",
 "path": "attributes.ag.data.parameters.agent.skills.0.name"}
```

**Live test.** Probe 34: **491 rows**, `build-an-agent` 422, `style-editing` 30,
`agenta-getting-started` 23, `composio-github-pr` 16. A separate existence filter on
`…agent.skills` found **518 root spans** carrying a configured skill list, split `pi_core` 266,
`claude` 248, `pi_agenta` 4 (probe 35). The entries carry `name`, `description`, `body`, `files`,
`allow_executable_files` and `disable_model_invocation`.

The same honesty applies as for tools: index zero is configuration order.

**What is missing.** Nothing records a skill invocation anywhere. Two adjacent things exist and
neither answers the question:

- **Configured skills** on the root span, covered above. Configured is not used.
- **Loaded skills** on the `invoke_agent` child span at `ag.meta.skills.loaded`, an array of
  strings on 1,067 spans, written at `services/runner/src/tracing/otel.ts:703-705`. It would work
  with a `categorical/multiple` spec under `focus=span`. But the runner sets it from the skills
  surfaced to the model, so "loaded into context" is not "invoked", and it is on a child span
  (probe 13 confirms child paths return nothing).

**What it would take.** A runner-side signal for skill invocation, as a span or an event carrying
the skill's identity, then promotion to the root span if you want it without `focus=span`. This
is a product and instrumentation question before it is an analytics one.

### 4.5 One more hazard: response size

`freq` and `uniq` arrays are **uncapped**. A `TOP_K = 3` constant is defined at
`api/oss/src/dbs/postgres/tracing/utils.py:988` and never applied. One measured response with a
single metric across 590 buckets was **897 KB**, because every bucket carries 27 percentiles, an
IQR set and a histogram. A breakdown over an open-ended dimension, such as tool name or user id,
has no size bound at all. Cap the bucket count on the frontend, and treat any high-cardinality
categorical spec as a size risk until the backend caps it.

---

## 5. Scale and performance

### 5.1 The conclusion first

**Today's query shape is not a durable contract for a product page.** Three measured facts say
so, and they hold regardless of how the numbers extrapolate:

1. **Cost scales with bytes read, not with rows returned.** Every analytics query de-TOASTs the
   whole `attributes` JSONB of every matched span to read a handful of values out of it. A
   30-day, one-metric query touched about 915 MB of buffers to produce 29 averages.
2. **A killed query is indistinguishable from an empty window.** The statement timeout returns
   HTTP 200 with `buckets: []` after 15 seconds of spinner.
3. **The 30-day view the shipped dashboard already issues costs 1.7 seconds** at 7,500 runs, on a
   warm cache, with one user. The 7-day view costs 0.26 seconds.

None of that blocks a seven-day beta. All of it blocks treating "any window, any metric" as a
supported API.

### 5.2 What was measured, and over how much data

Wall-clock timings against both local stacks, 7 repetitions per shape on stack A and 5 on stack
B, plus `EXPLAIN (ANALYZE, BUFFERS)` runs against the tracing database directly. All windows end
at a fixed anchor so they are reproducible. Every run was single-user against a warm cache on one
machine. **Nothing here was measured under concurrency, and nothing was measured on
production-shaped data.**

Volume behind each window on stack A, counted rather than estimated:

| Window | Root spans | All spans | Root attribute bytes |
|---|---|---|---|
| 24 hours | 295 | 1,497 | 0.91 MB |
| 7 days | 2,051 | 10,571 | 7.9 MB |
| 21 days | 6,320 | | 24 MB |
| 30 days | 7,523 | 37,207 | **72 MB** |

Note the jump from 24 MB at 21 days to 72 MB at 30 days for only 19% more rows. Early-July runs
carry much larger attribute blobs; the largest single root span is 2.1 MB.

### 5.3 The measurements

**A. Window size dominates. Bucket period barely matters.** One numeric spec, median seconds:

| Window | Hourly | Daily | Weekly |
|---|---|---|---|
| 24 hours | 0.040 | 0.038 | 0.038 |
| 7 days | 0.169 | 0.090 | 0.097 |
| 30 days | 0.77 to 1.54 | 0.724 | 0.688 |

The one exception is high bucket counts, and that cost sits in the API process, not the database.
The 590-bucket 30-day hourly query measured 700 ms at the database against 679 ms for the
29-bucket daily version, a 3% difference. The extra time is Python bucket assembly and JSON
serialization of an 897 KB response.

**B. Each additional metric spec costs about 0.2 seconds.** 30 days, daily buckets, median
seconds: 1 spec 0.725, 4 specs 1.087, 8 specs 2.318, 16 specs 3.726. Specs are not amortized. The
query cross-joins every matched span against the spec list (`utils.py:1106-1126`), so eight specs
means 60,184 intermediate rows for 7,523 spans.

**C. Filtering can make a query faster than the row count suggests.** A filter on
`…agent.llm.model is haiku` keeps 91% of the rows and runs **2.1x faster**, 0.329 s against
0.700 s. It drops 710 rows and **49 of the 72 MB**, because the excluded runs average 127 KB of
attributes each against haiku's 3.5 KB. Latency follows the bytes.

**D. The shapes an analytics page would actually issue,** median seconds on stack A:

| Shape | Buckets | Median |
|---|---|---|
| The shipped dashboard's own request, 24 hours | 48 | **0.075** |
| Same, 7 days | 56 | **0.260** |
| Same, **30 days** | 56 | **1.714** |
| One call, 8 specs, 30 days daily | 29 | **2.486** |
| Window-level statistics, 8 specs, no interval | 1 | **1.821** |
| Per-model latency, one model | 26 | **0.302** |

**E. Six small parallel calls beat one big call, on an idle database.** Six tiles issued as six
parallel single-spec calls finished in **0.974 s**. The identical coverage in one six-spec request
took **1.700 s**. Postgres parallelises across connections, while the multi-spec query's internal
joins are serial nested loops. Five per-model calls issued sequentially took 2.659 s, so
parallelism is doing the work, not call count. Section 5.7 explains why this is a useful
measurement and a poor contract.

### 5.4 Rate limits: two routes are unusable for a dashboard on cloud

While benchmarking, the legacy endpoint began returning **HTTP 429** with
`X-Ratelimit-Limit: 180` and `Retry-After: 41`.

`api/ee/src/core/access/entitlements/types.py:170-175` puts both `/tracing/...` analytics routes
in the `TRACING_SLOW` category:

```python
Category.TRACING_SLOW: [
    (Method.POST, "/tracing/*/query"),
    (Method.POST, "/tracing/spans/analytics"),  # LEGACY
],
```

The bucket for that category on the paid tier is `capacity=180, rate=1` (`types.py:486-493`), and
`rate` is **tokens added per minute** (`types.py:117`; the Lua refill at
`api/oss/src/utils/throttling.py:108-110` divides elapsed milliseconds by 60,000). So it is a
180-request burst that refills at one request per minute. The bucket key includes the
organization (`api/ee/src/middlewares/throttling.py:242-247`), so the budget is shared by every
user in the org.

The documentation states this correctly. `docs/docs/misc/faq/platform/api-rate-limits.mdx:11`
defines the two numbers as burst and per-minute refill, and the table lists trace queries and
analytics at 180 / 1 on the Pro plan. An earlier draft of this report claimed the FAQ described
the bucket as a per-minute rate. That claim was wrong; the FAQ is right.

Measured live, three requests back to back:

| Route | Result |
|---|---|
| `POST /spans/analytics/query` | 200, `X-Ratelimit-Remaining: 1439` |
| `POST /tracing/analytics/query` (deprecated) | 200, `X-Ratelimit-Remaining: 0` |
| `POST /tracing/spans/analytics` (legacy) | **429**, `Retry-After: 27` |

An earlier probe fired 130 sequential requests at both routes and saw 130 HTTP 200s each (probe
19). That does not contradict the 429: 130 is below the 180-request burst, so the probe never
drained the bucket. The three-request table above was taken after the benchmark run had drained
it, which is why the deprecated route reports zero remaining.

Three consequences:

- **A page firing six analytics calls exhausts the `TRACING_SLOW` burst in 30 page loads** and is
  then limited to one chart refresh per minute for the whole organization. Those routes are not
  usable for a dashboard.
- **`/spans/analytics/query` is not in the category map at all,** so it falls to the `STANDARD`
  catch-all: 480 requests per minute on the free tier and 1,440 on the paid tier
  (`types.py:376-379` and `:466-469`). That is what makes a dashboard viable. It also means
  analytics shares a bucket with every other ordinary API call, and 480/min is only 80 page loads
  per minute at six calls each. We could not determine whether the omission was deliberate; the
  code shows the classification, not the intent.
- **OSS self-hosted has no throttling at all.** The middleware exists only under `api/ee`.

**The product rule: the new page must use `POST /spans/analytics/query`.** The shipped frontend
already does.

### 5.5 Where the time actually goes

**Latency tracks attribute bytes, not rows.** Measured from `EXPLAIN (ANALYZE)` of the exact SQL
the DAO builds:

| Window | Roots | Attribute MB | Database time | ms per MB |
|---|---|---|---|---|
| 24 hours | 295 | 0.91 | 7.5 ms | 8.2 |
| 7 days | 2,051 | 7.9 | 69.8 ms | 8.8 |
| 21 days | 6,320 | 24 | 212.1 ms | 8.8 |
| 30 days | 7,523 | 72 | 678.9 ms | 9.4 |

That is a straight line in megabytes and visibly not a straight line in rows: 19% more rows from
21 to 30 days, 220% more time.

**The plan shows two separate costs, and only one of them is about bytes.**

*One spec, 30 days* (query plan `exp-1.out`). PostgreSQL **inlined** the base and extract CTEs and
evaluated `attributes #> '{ag,metrics,duration,cumulative}'` directly in the heap scan's filter
(`exp-1.out:5-8`). That scan alone took 660 ms of the 679 ms total and touched 117,085 buffers,
about 915 MB, to produce 7,523 numbers.

So the SQL is not asking for more than it needs; the planner already pushes the extraction down
to the scan. The cost is that reading any path out of a JSONB value requires fetching and
de-TOASTing the entire value first. A root span's `attributes` averages 10 KB on this dataset, so
reading one 8-byte number costs a 10 KB detoast. **Rewriting the query to project `#>` earlier
would change nothing.** An earlier draft of this report recommended exactly that. It was wrong.

*Eight specs, 30 days* (query plan `exp-8.out`) exposes a second cost that has nothing to do with
bytes. With eight specs, several downstream CTEs reference `extract_cte`, so PostgreSQL
materializes it: 60,184 extracted rows in 1,614 ms (`exp-8.out:6`). Then the planner's row
estimate for every CTE scan collapses to 1, and it chooses nested loops. Four separate joins each
discard **3,123,312** rows to keep 25,188 (`exp-8.out:43-45`, `:55-57`, `:67-69`, `:90-92`).
Total 2,688 ms. That is why the eighth spec costs so much more than the first, and no amount of
byte reduction fixes it.

Two problems, two different fixes:

1. **Byte cost.** Only typed storage removes it. Promote the handful of hot metric paths into real
   columns, or write a per-run facts table at ingest, so a chart never reads a JSONB blob.
2. **Plan cost.** The multi-spec query joins CTEs the planner cannot estimate. Reshaping that
   query, or letting a request name which aggregations it wants, cuts work directly: today a
   `numeric/continuous` spec always computes the count, the basics, all 27 percentiles and a
   histogram, even for a tile that shows one sum (`utils.py:1211-1215`, `:1263-1287`).

**Row selection is healthy and will stay healthy.** The index
`ix_spans_root_project_created_trace btree (project_id, created_at, trace_id) WHERE parent_id IS
NULL` matches the generated predicate and is 984 kB. At 24 hours the planner uses it with a real
range condition. At 30 days on a project whose entire history is 30 days it flips to a different
index and post-filters the time predicate, which is correct there. The cost is entirely in what
happens after the rows are found.

**The timeout returns HTTP 200 with an empty body.** `TIMEOUT_STMT` sets
`statement_timeout = '15000'` (`utils.py:48`, applied at `dao.py:420`). The DAO method is
decorated `@suppress_exceptions(default=[])` (`dao.py:305`), which catches everything and returns
an empty list, and the router then wraps that empty list in a normal `AnalyticsResponse`.

Reproduced live on stack A, 30-day window, 80 specs:

```
HTTP 200 in 15.033 s   ->   {"count": 0, "buckets": []}
```

and in the API log:

```
asyncpg.exceptions.QueryCanceledError: canceling statement due to statement timeout
[SUPPRESSED]
```

The user sees an empty chart after a 15-second spinner, with no error code and nothing that lets
the frontend tell "no data in this window" apart from "the query was killed". Spec counts at 30
days approach that cliff steadily: 24 specs 5.4 s, 32 specs 7.3 s, 48 specs 10.6 s, 64 specs 13.3
to 14.1 s, 80 specs timeout.

### 5.6 What happens as data grows

**This subsection is a risk range, not a capacity forecast.** Read the caveats before the table,
because they govern it.

- The extrapolation rests on the measured 9 ms/MB/spec figure. That figure is an observation on
  one dataset with one attribute-size distribution, not a constant. A project whose runs carry
  small attributes will sit far below it; one with 2 MB blobs will sit above it.
- The synthetic 10x check duplicated existing rows with `generate_series(1,10)` in the benchmark
  script `exp-1-10x.sql`. That reuses the same heap pages, the same TOAST entries, the
  same cache locality, the same value distribution and the same table statistics. It is not a
  database with ten times as many independently stored spans, and it flatters the result.
- Every measurement is single-user with a warm cache. Concurrency was not tested at all.
- Working against all of the above: the TOAST relation is already about 5x `shared_buffers` at
  today's volume, so cache hit rates fall as data grows and the real curve steepens.

| Project size | 30-day root attributes | 1 spec | 6 specs (shipped shape) | 8 specs |
|---|---|---|---|---|
| **1x** (today, 7.5k runs) | 72 MB | 0.7 s | **1.7 s** | 2.4 s |
| **3x** (~23k runs) | 216 MB | ~2 s | ~5 s | ~7 s |
| **10x** (~75k runs) | 720 MB | 3 to 6.5 s | 10 to 17 s | 13 to 23 s |
| **100x** (~750k runs) | 7.2 GB | 24 to 65 s | beyond the timeout | beyond the timeout |

What to take from it:

- **The 30-day view is the shape at risk.** It is the slowest thing the product issues today, and
  it is the first thing that will cross the 15-second statement timeout as projects grow. Whether
  that happens at 5x or at 20x depends on attribute sizes and concurrency, which we did not
  measure. Treat "30 days will break before 100x" as the claim; treat any tighter number as
  unproven.
- **Short windows are much safer,** because a 24-hour window is bounded by ingest rate rather
  than by history. A 100x project's 24-hour window would hold roughly 29,500 roots and 290 MB.
  That is well inside today's limits on these measurements, but it has not been tested under
  concurrent load.
- **A blank chart, not a slow chart, is the failure mode,** until section 8.4's first item lands.

### 5.7 What is safe behind a page load

**Safe today on these measurements:**

- Any window up to **7 days**, at any bucket period, with up to about 8 specs: 0.09 s to 1.3 s.
- **24-hour** windows at any shape: under 0.2 s.
- The choice of metric does not matter. Counts, latency, percentiles, histograms and categorical
  breakdowns all cost about the same. Only the number of specs and the volume of data matter.

**Needs a narrower default or caching first:**

- **The 30-day window.** 1.7 s for the shipped six-spec shape at today's volume. Make the page's
  default **7 days**, and treat 30 and 90 days as an explicit user choice with a loading state.
- **Any request with more than about 8 specs.**
- **Bucket counts above about 100.** The database does not care; the JSON does.

**On fanning out into many small calls.** Six parallel one-spec calls measured 1.7x faster than
one six-spec call, and per-value latency through N filtered calls is the only way to get
per-model or per-harness statistics today. Both are legitimate ways to build v1. Neither is a
contract to design around, and the report should not pretend otherwise:

- Six calls do not do less work. They do six scans instead of one, and they win only by borrowing
  six database connections from a pool that other users share. The win shrinks or reverses under
  concurrency, which we did not test.
- Six calls consume six times the rate-limit budget. At 480 requests per minute on the free tier
  that is 80 page loads per minute for the whole organization (section 5.4).
- Six calls can partly fail, partly time out, and disagree with each other if data lands between
  them. The page needs a per-call error state, not one spinner.

Use the fan-out for v1 because it works and it is measurable. Put "one bounded request per page
section" in the target contract (section 8.4).

---

## 6. Frontend integration

### 6.1 Which endpoint, and what the client already supports

Use `POST /spans/analytics/query`. Nothing needs regenerating.

- The Fern request type already carries `specs`: `QuerySpansAnalyticsRequest` has `focus`,
  `format`, `oldest`, `newest`, `interval`, `rate`, `filter` and `specs`
  (`web/packages/agenta-api-client/src/generated/api/resources/traces/client/requests/QuerySpansAnalyticsRequest.ts:9-18`),
  and the client forwards `specs` straight into the query params
  (`.../traces/client/Client.ts:709-719`).
- `filter` and `specs` are typed as plain strings, so the generated client imposes no shape.
  Whatever JSON you stringify goes through. The only real constraint is `MetricSpec` on the
  backend.
- The zod boundary does not strip nested metric fields. `metricsBucketSchema`
  (`web/packages/agenta-entities/src/trace/core/schema.ts:310-317`) types metrics as
  `z.record(z.string(), z.record(z.string(), z.unknown()).nullable())`, so `pcts`, `freq` and
  `hist` survive validation as `unknown`. TypeScript forces a cast at the read site. No data is
  lost.

### 6.2 The client changes needed

1. **Add an optional `specs` field to `SpansAnalyticsParams`**
   (`web/packages/agenta-entities/src/trace/api/api.ts:293-310`) and serialize it to a JSON string
   query param beside the existing `filter` line at `api.ts:344`. One field, one line. PR #5648
   identifies this correctly, and the package layer is the right home for it: it is transport,
   not page logic.
2. **Add a nested accessor for percentiles** in a new page-level mapper. `metricField`
   (`helpers.ts:88-92`) reads one level deep and finite numbers only; p95 lives at
   `metrics[path].pcts.p95`.
3. **Add a reader for `freq` arrays,** which unlocks every category breakdown in section 4.
   Nothing reads them today.
4. **Keep the new mapper in the app layer, beside `analyticsToGeneration`, not inside it.** The
   Observability page depends on the existing mapper's shape.
5. **Do not reuse `observabilityDashboardTimeRangeAtom`.** A second consumer already shares it
   (`web/oss/src/components/pages/agent-home/components/UsageSummary/index.tsx:11,29`), and a
   third surface would fight over the range. Give the new page its own atoms.
6. **Do not copy `CustomAreaChart.tsx`.** It hardcodes hex colours at `:28-32`, which
   `web/AGENTS.md` forbids.

### 6.3 What the browser can compute, and what it cannot

**Simple arithmetic, needs nothing new:** window totals (sum the per-bucket sums), window average
latency (sum of duration sums divided by the sum of duration counts, never the mean of per-bucket
means), success rate, ratios, percentage-change badges against a previous window, sparklines,
stacked series, and window-level min and max, which do compose.

**Impossible from bucketed data, no matter how clever the mapper:**

- **A window-level percentile.** p95 does not compose across buckets. Verified: window p95
  25,777 ms against a single day's 251,838 ms. The fix is not backend work. It is the no-interval
  second call.
- **A window-level distinct count.** The same value appears in many buckets, so `uniq` arrays
  cannot be summed. Same fix.
- **Any grouping the request did not ask for.** No numeric metric can be split by a category
  after the fact.
- **Anything on a child span.** Those rows never leave the database.

### 6.4 What the response shape forces on the UI

- **Empty buckets are omitted.** The frontend must build its own x-axis, or gaps will read as
  missing days rather than as zero days.
- **The top-level `count` is the number of buckets,** not the number of runs.
- **The requested interval may have been coarsened silently.** Only `buckets[].interval` reports
  what ran. If the UI lets the user pick a period, read the effective interval back and label the
  chart with it.
- **A wrong filter renders as zero, not as an error.** Verify every filter the page sends once
  against a known-good window during development, because there is no runtime signal.
- **Buckets are 24-hour periods aligned to `oldest`,** not calendar days. Align `oldest` to the
  viewer's local midnight and label the axis honestly.

### 6.5 Two defects already shipped on this spine

Neither was introduced by PR #5648, and both are inherited by any page built beside it.

- **`failure_rate` is a fraction rendered with a percent sign.** `helpers.ts:160` returns
  `errorCount / totalCount`, and `AnalyticsDashboard.tsx:96` renders it with a `%` suffix through
  `formatNumber`, which does not multiply by 100. A 50% failure rate displays as "0.5%".
- **Two dead filter conditions.** `web/oss/src/services/tracing/api/index.ts:48-61` pushes
  `environment` and `variant` conditions. Neither is a real field, so the backend logs a warning
  and drops them, which **widens** the query. No current caller sets those options, so it is
  latent rather than live, but it is the same silent-drop failure mode that breaks PR #5648's
  failed-run filter.

---

## 7. The semantics you must decide before you build

Several numbers on this page can be computed today but mean more than one thing. Pick an answer
for each, write it in the UI, and do not let the implementation pick by default.

| Question | The options | What we would pick, and why |
|---|---|---|
| What is a **failed run**? | (a) The root span's status is `STATUS_CODE_ERROR`. (b) Any span in the trace errored. (c) The run produced no usable result. | (a) for v1, and say so in a tooltip. It is the only one computable in one call. It misses 1.2% of runs that failed inside and recovered a clean root (probe 6). (b) needs `focus=span`. (c) is not recorded anywhere. |
| What is a **run**? | (a) Every root span. (b) Root spans of `trace_type = invocation`. | (b). Annotations are evaluator and human-annotation traces, not agent runs, and the PR's own glossary says so before its metric counts both. |
| What is **the model**? | (a) The alias the author configured. (b) Every model the run actually called. | Chart (a) and label it "configured model". (b) needs `focus=span` and a decision about runs that call several models. Do not print (a) under the word "model". |
| What is **tool usage**? | (a) The first tool in the configured list. (b) The whole configured list. (c) The tools the run actually called. | Only (c) is worth charting, and it needs `focus=span`. Ship nothing here in v1 rather than shipping (a). |
| What is **skill usage**? | (a) Configured skills. (b) Skills loaded into context. (c) Skills the agent invoked. | (c), and nothing records it. This needs a runner change before it is an analytics question. |
| Who is **the user**? | (a) The Agenta account whose API credential wrote the span. (b) An end user the caller declares through `ag.user.id`. | Decide by what the page is for. (a) answers "which teammate ran this"; today it holds one value per project. (b) answers "which of my customers", and nothing sets it. |
| What does a **cost number** include? | (a) Whatever the harness reported. (b) Agenta's own litellm pricing of the LLM spans. | (a) is what the working path holds, and it is the run total. (b) exists but never reaches the run's root span, and it undercounts cached prompts by up to 27x. Whichever you pick, the tile must state its coverage. |
| What is a **day**? | (a) A fixed 1,440-minute period aligned to the window start. (b) A calendar day in the viewer's timezone. | (a) is what the backend does. Offer it and label it. (b) needs timezone-aware bucketing in the backend, because a fixed stride drifts across daylight saving transitions. |

---

## 8. Proposal

### 8.1 What PR #5648 gets right

Build on these. They are correct and they were not obvious.

- **The endpoint choice.** `POST /spans/analytics/query` is the right route, for capability
  reasons and for the rate-limit reason the PR did not know about.
- **Reusing the existing fetch layer and adding `specs` as one optional field.** That is exactly
  the right seam.
- **Rejecting `errors.cumulative` as a failed-run count.** It counts errored steps, not failed
  runs. The PR is right to define a failed run as a run whose root span status is `ERROR`, and
  right that this needs a second filtered query because specs cannot read columns.
- **Identifying `focus` as dead and naming the exact fix location** (`utils.py:1073`).
- **Naming the double-count guard that must ship with a `focus=span` fix.** Cumulative paths are
  written onto every ancestor, so scanning all spans inflates cost and tokens with no error. This
  is the sharpest observation in the PR's plan.
- **Splitting the deferred work into two unequal prerequisites,** span focus and group-by, and
  noting that only per-model cost needs the second.
- **Deciding not to mount empty "coming soon" cards.**

### 8.2 The corrections that block the plan as written

1. **The failed-run filter is rejected and returns an empty 200.** Correct form:
   `{field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"}`. Success is
   `is_not STATUS_CODE_ERROR`; there is no `STATUS_CODE_OK` on root spans. Verified live.
2. **The Costs chart and the Total-cost tile read dead paths.**
   `ag.metrics.costs.cumulative.prompt` and `.completion` are on zero spans on both stacks. The
   only populated path is `attributes.gen_ai.usage.cost`, which the PR never names, and its
   coverage collapsed in mid-July for reasons nobody has established. That is a data question, so
   it is neither `api/` work nor frontend work.
3. **The Tokens split chart depends on the same collapsed coverage.** It works where the pipeline
   works and renders a flat zero band where it does not.
4. **Window-level p95 is absent from the plan.** Omitting `interval` returns one exact bucket for
   the whole window. The plan's four-call shape spends calls re-fetching per-bucket data to
   compute totals the backend would compute exactly.
5. **`focus=span` is accepted, echoed and ignored,** which means the plan's own debugging advice,
   reading the echoed query, will confirm a parameter that did nothing.
6. **The run count includes annotation traces** without a `trace_type` filter, which contradicts
   the PR's own glossary definition of a run.
7. **Calendar months are not expressible,** and period semantics are never defined in the PR.
   Buckets are fixed-width offsets from `oldest`, in UTC, keyed on ingest time.
8. **The 1024-bucket ceiling is a silent override, not a limit to stay under.** A long window with
   a small period returns a different granularity than the user chose, with nothing in the UI
   saying so.
9. **Harness, per-user, cache tokens and skills never appear in the PR's six documents,** not even
   as out of scope. Two of those four work today.

### 8.3 v1: a coverage-gated beta

**Principle.** The page is a beta behind a flag. It ships only metrics whose meaning we can state
in one sentence and whose coverage we can show. Nothing on it depends on a backend capability
that does not exist. Two backend items are prerequisites anyway, and they are listed as such
rather than hidden inside "no backend changes required".

**Scope.**

- **Default window of 7 days,** not 30. This is the single most important change to the plan.
  30 days costs 1.7 s today and is the shape that degrades first. 7 days costs 0.26 s.
- **Summary tiles from one no-interval call:** total runs, average latency, p95 latency, total
  tokens, and the distinct-value lists for harness, configured model and agent. One call, one
  bucket, exact numbers.
- **Charts from bucketed calls:** runs stacked by success and failure, average latency with a p95
  line, total tokens.
- **Three category charts nobody planned and that cost one spec each:** runs per harness, runs per
  configured model, runs per agent, each per period. These are the most differentiated content on
  the page and the honest ones.
- **Filters:** by agent (`references`), by harness, and by configured model.
- **Cost and the token split are coverage-gated, not omitted.** Query
  `attributes.gen_ai.usage.cost`, compare its `count` against the run count for the same window,
  and render the tile only when coverage clears a threshold. Below it, say "cost data is not
  available for this window" rather than showing a zero. The same rule governs the
  prompt/completion token split.
- **Not on the page:** tool usage, skill usage, resolved-model usage, per-user numbers, cache
  tokens. Section 4.2 says why for each.

**Query shape.** Fan out into several small parallel calls for now, with a per-call error state,
and keep any single request at or under 8 specs. Section 5.7 states what that costs.

**Work items, in order.**

Backend, and both are prerequisites:

1. **Make a killed or rejected query say so.** Section 8.4 item 1. Without it, every empty chart
   on the page is ambiguous, and the coverage gate above cannot tell "no cost data" from "the
   query died".
2. **Investigate the cost and token-split coverage collapse.** File it. Section 4.4 item 4 lists
   the first four checks.

Frontend:

3. Add the optional `specs` field to `SpansAnalyticsParams` and serialize it
   (`web/packages/agenta-entities/src/trace/api/api.ts`).
4. Add a page-level mapper with a nested reader for `pcts` and a reader for `freq` arrays. Do not
   change the existing mapper; the Observability page depends on it.
5. Build the page's own atoms. Do not reuse `observabilityDashboardTimeRangeAtom`.
6. Issue the no-interval window call for the tiles and the bucketed calls for the charts, in
   parallel.
7. Use the corrected failure filter, and add a `trace_type is invocation` filter to the run count.
8. Align `oldest` to the viewer's local midnight. Offer day, week and "whole window" as periods.
   Do not offer calendar months. Label the axis as 24-hour periods.
9. Read `buckets[].interval` and label the chart with the effective period.
10. Implement the four page states: data, no data in window, metric unavailable (coverage below
    threshold), and request failed.
11. Fix `failure_rate`, which is rendered without multiplying by 100.

**Named semantic-convention attributes v1 adds: none.** That is deliberate, and it is also the
reason cost has to be coverage-gated rather than fixed here.

### 8.4 v2: the backend work, in order

**1. Make failures visible. Small. Do this first.**

A killed query, a rejected filter and an empty window are three different things that all return
`{"count": 0, "buckets": []}` today. Removing `@suppress_exceptions(default=[])` from
`TracingDAO.analytics` (`dao.py:305`) is **not** enough, and the sibling `query` method is not the
model to copy: it raises a bare `Exception` (`dao.py:288-298`), and the route is itself wrapped in
`@suppress_exceptions(default=AnalyticsResponse(), exclude=[HTTPException])` (`router.py:1276`),
which swallows any non-`HTTPException` (`api/oss/src/utils/exceptions.py:97-113`). The fix has to
cross both layers:

- Raise a typed analytics-timeout error in core, and translate it at the router into an
  `HTTPException` with status 504 and a "narrow your window" message. `HTTPException` passes
  through both the route's `suppress_exceptions` and the outer `intercept_exceptions`
  (`exceptions.py:129-130`), so it reaches the client.
- Do the same for `FilteringException` and for a malformed window, as 4xx.
- Add a per-metric `sample_count` to the response so the frontend can tell "no data" from
  "unavailable".

**2. Decide the contract. Medium, and it gates everything below.**

Today's request shape is an arbitrary JSON path plus a type hint, validated by silence: an unknown
filter field is dropped (`filtering.py:542-546`), a wrong-typed metric contributes zero rows
(`utils.py:1660`), and cardinality is uncapped. That is a reasonable internal exploration engine.
It is a poor public contract for a product page, because every UI built on it depends on the exact
JSON shape ingest happens to write today.

The alternative is a typed run-analytics request: named metrics and dimensions from an enum, an
explicit list of requested aggregations, a filter grammar over known fields, granularity, a
timezone, and documented caps on window, bucket count and cardinality. Core validates it and
returns 4xx on unsupported combinations; a query compiler turns it into SQL.

The trade is real: the typed contract is more work now and cannot answer a question nobody
anticipated. Given that the page is the first product surface on this engine and that its metrics
are the ones in section 7, the typed contract is the better bet. Decide it before v2 code, because
items 3 to 6 look different under each answer.

**3. Make `focus=span` work. Medium. Unlocks tool usage, resolved-model usage, cache tokens.**

Thread `query.formatting` into `build_base_cte` and make the `parent_id IS NULL` predicate
conditional (`utils.py:1073`, `dao.py:378-387`). Three things must ship with it or it produces
wrong numbers, all named in section 4.4 item 7: a cumulative-versus-incremental guard, a run-count
dedupe rule, and an index for non-root rows. Measured cost of the wider scan: 2.60 s against
0.68 s for one spec over 30 days, a 4.96x row fan-out. Do not ship it before item 4, or a
span-focus query on a busy project will hit the statement timeout.

**4. Stop reading JSONB on the chart path. Medium to large. Improves everything, permanently.**

Section 5.5 shows why: reading one 8-byte number out of a 10 KB JSONB value costs a 10 KB
detoast, and the planner already does everything it can. The fix is storage, not SQL. Two shapes,
in increasing cost:

- **Hot columns.** Promote duration, status, token counts, cost, harness, agent reference and
  configured model into typed columns on `spans` at ingest. Charts stop touching TOAST entirely.
- **A per-run facts table.** One row per run with those fields plus provenance, and optional child
  facts for invoked tools and models. This also gives invoked tools and resolved models a home
  that does not require copying one value onto the root span, and it is what item 3 would
  otherwise force.

Both need a plan for late-arriving spans: a run's two OTLP batches can arrive seconds apart, so
any fact row must be updated idempotently and the page needs a stated freshness policy.

**5. Add a dimension to the query. Medium. Unlocks every "metric by category" chart.**

Today no request can split a numeric statistic by a category (section 4.3). The obvious fix, one
`group_by` JSON path per query, is the wrong shape: it forces every metric in the request to share
one dimension, and it extends the arbitrary-path protocol that item 2 is trying to replace. Under
a typed contract, each requested series should name its own optional dimension from the enum,
which also makes a cardinality cap natural to express and enforce. Either way it needs that cap,
because `freq` and `uniq` are uncapped today and one metric at 590 buckets is already 897 KB.

**6. Per-user attribution. Small, once item 2 or item 4 lands.**

`created_by_id` is already a typed column on every row
(`api/oss/src/dbs/postgres/tracing/mappings.py:210`). It needs to become a nameable dimension, not
a value copied into JSON. It is worth nothing until projects have more than one writer, and it
needs the "who is the user" decision from section 7 first.

**7. Pre-aggregation. Large, and not automatically the answer.**

A rollup table keyed by `(project_id, bucket, harness, model, variant)` would turn every query in
this report into an index-only scan of a few hundred rows. Three reasons to sequence it last.
Ordinary count and sum rollups cannot reproduce today's exact `percentile_cont` p95
(`utils.py:1263-1287`); you would be trading exactness for sketches, which is a product decision.
That key omits status, user, tool, skill, trace type and timezone, so it answers fewer questions
than it looks like it does. And it has the same late-arriving-batch problem as item 4, with less
room to fix it. Normalize typed facts first, measure production, then roll up the specific queries
that justify it.

**Semantic-convention attributes v2 would add or change:**

- Map `gen_ai.usage.cost` to `ag.metrics.costs.cumulative.total` in
  `GENAI_SEMCONV_ATTRIBUTES_EXACT` (`logfire_adapter.py:148-196`). Cumulative, not incremental:
  the value is the run's aggregate total, and calling it incremental would double-count against
  the runner's own spans under `focus=span`. Mapping it at ingest is better than changing the
  tracing endpoint's default specs, for two reasons. It fixes the path rather than routing around
  it, and it also reaches the second consumer of this engine: the evaluations service builds its
  own metric list, which includes `attributes.ag.metrics.costs.cumulative.total`
  (`api/oss/src/core/evaluations/service.py:141-158`), and passes its own specs
  (`service.py:1565-1571`). It never reads `DEFAULT_ANALYTICS_SPECS`, so a default-spec change
  would leave evaluation cost metrics as empty as they are now.
- Do not add an `ag.meta.model`. `ag.meta.request.model` and `ag.meta.response.model` already
  exist (`logfire_adapter.py:150,160`) and already mean the two different things people want. A
  run can call several models, so copying one of them onto the root span loses information; the
  child facts in item 4 are the right home.
- Map `gen_ai.agent.name` to `ag.meta.agent.name`, beside the existing
  `gen_ai.agent.description` mapping. It is the only `gen_ai.agent.*` key with no mapping.
- Add a skill-invocation signal from the runner, as a span or event carrying the skill's identity.
  Neither the configured array nor `ag.meta.skills.loaded` means invoked.

### 8.5 What still has to be decided outside this report

These are not analytics questions, but the page cannot ship without answers.

- **Observability and the deprecated routes.** The sidebar already exposes an Observability page
  (`web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx:143`) built on the same
  endpoint. Does Analytics replace it, or sit beside it? If it replaces it, plan the URL
  migration and the removal of `analyticsToGeneration`. Separately, `POST
  /tracing/analytics/query` is marked deprecated and has no caller in `web/`, and `POST
  /tracing/spans/analytics` has none either; both are still in the generated clients, so removing
  them needs a client-compatibility decision.
- **Rollout.** Put the page behind a flag until the cost coverage question is answered and the
  metric semantics in section 7 are written down. The existing per-user exploration switches in
  `web/oss/src/state/settings/featureFlags.ts:6-20` are a local precedent, but a beta of this kind
  wants an org or project level flag the team can set, not a per-browser toggle.
- **Authorization and tenancy tests.** The route checks `Permission.VIEW_SPANS` and scopes the
  query to `request.state.project_id` (`router.py:1284-1290`). Nothing tests that a filter cannot
  reach another project's rows, that reference filters respect app scope, or that per-user
  filters cannot enumerate other accounts.
- **Test coverage.** One unit test touches analytics
  (`api/oss/tests/pytest/unit/tracing/test_analytics_bucket_order.py`), and it asserts bucket
  ordering. Nothing pins the 1024-bucket cap, the interval widening, `focus` semantics, the
  percentile output shape, the `freq` shape, filter-operator validation, the empty-200 behaviour,
  bucket boundaries across a daylight saving transition, or partial coverage. Every one of those
  is a behaviour the page would depend on.
- **A performance gate.** Before the page leaves beta, measure it under concurrent load on
  production-shaped data, and set a documented maximum window and bucket count.

### 8.6 OSS and EE

Both editions run the same analytics SQL. The application entrypoint imports the OSS DAO
(`from oss.src.dbs.postgres.tracing.dao import TracingDAO`, `api/entrypoints/routers.py:70`), and
`api/ee/src/dbs/postgres/tracing/dao.py` defines only `TracingRetentionDAO` (`:77`), which deletes
old traces. There is no EE analytics implementation to diverge.

What does differ in EE: the throttling middleware and its entitlement categories
(`api/ee/src/middlewares/throttling.py`, `api/ee/src/core/access/entitlements/types.py`), and
retention, which bounds how much history a query can reach. Every capability finding in this
report therefore holds on both editions. Every rate-limit finding is EE-only. Performance findings
were taken on both, on stack A (EE) and stack B (OSS), and agree in shape.

### 8.7 Open items

Things this report could not settle, listed so nobody assumes they were checked.

1. **The cause of the cost and token-split coverage collapse.** We measured it on two stacks and
   did not investigate why. This blocks the cost tile and it is the most important open item here.
2. **Whether production shows the same coverage.** Every percentage here comes from local dev
   stacks.
3. **How the query behaves under concurrency and on production-shaped data.** Every timing here is
   single-user and warm-cache. The 10x extrapolation used duplicated rows, which understates the
   real cost.
4. **Whether cloud projects have more than one distinct `created_by_id`.** If they do not,
   per-user analytics has no meaning regardless of backend work.
5. **The bare-POST corner of the legacy `errors` defect.** A POST with no query params and no body
   is the only shape that could reach `filtering=None`. One curl settles it.
6. **Whether an adapter-written `ag.metrics.costs.cumulative.total` survives ingest's roll-up.**
   The roll-up writes only on a non-zero total (`trees.py:319-341`), which suggests it would, but
   nothing tests it.

---

## Appendix A: probe index

Each probe was one live HTTP call whose request and response were saved. Those files are not in
the repository. The table below says what each probe tested and which section uses its result, so
a reader who wants to re-run one can rebuild the request from the section that cites it.

| Probe | What it tested | Result used in |
|---|---|---|
| 00 | Baseline run count | 4.4 item 1 |
| 01 | `ag.metrics.costs.cumulative.*` specs | 4.4 item 4 |
| 02 | `gen_ai.usage.cost` coverage, both stacks | 4.4 item 4 |
| 03 | Legacy endpoint under `focus=span` | 4.4 item 4 |
| 04a-c | Unfiltered / errored / non-errored counts | 4.4 item 6 |
| 05 | PR #5648's `eq` / `ERROR` filter | 4.4 item 6 |
| 06 | Traces with errored children and clean roots | 4.4 item 6 |
| 07 | Token totals and splits, both stacks | 4.4 item 5 |
| 08a-c | Harness kind, harness object, json spec | 4.4 item 9 |
| 09 | Configured model and provider frequencies | 4.4 item 8 |
| 10 | Agent reference breakdown | 4.4 item 10 |
| 11a-c | `created_by_id` filters, unknown-field widening | 3.8, 4.4 item 13 |
| 12 | Distinct `created_by_id` per project | 4.4 item 13 |
| 13a-c | Tool name under each `focus` value | 3.5, 4.4 item 7 |
| 15 | `interval=1` over 7 days, silent coarsening | 3.7 |
| 16a-b | No-interval versus daily percentiles | 4.4 items 2, 3 |
| 17a-b | UTC versus offset midnight bucket edges | 4.4 item 1 |
| 18a-b | Legacy endpoint with and without a filter | 3.4 |
| 19 | 130 sequential requests to both routes | 5.4 |
| 20 | Wide window, many specs | 5.3 |
| 22, 23 | Deep JSON filters on harness and model | 4.4 items 11, 12 |
| 24 | Deprecated route parity | 3.3 |
| 25 | Four spec types against the tools array | 4.4 item 7 |
| 26 | Per-model filtered latency | 4.4 item 8 |
| 27 | Duration spec plus harness spec, no split | 4.3 |
| 29, 36 | Streaming flag, connection mode, permissions | Appendix B |
| 31 | Explicit histogram bins | 4.4 item 3 |
| 32 | Cache-token paths | 4.4 item 5 |
| 34 | Array index 0 on tools and skills | 4.4 items 7, 14 |
| 35 | Existence filter on configured skills | 4.4 item 14 |
| 37 | Column names as metric specs | 3.1 |
| 39 | Malformed `oldest` | 3.8 |

Section 5 also cites four benchmark artifacts, likewise kept outside the repository: `exp-1.out`
(the query plan for one spec over 30 days), `exp-8.out` (eight specs over 30 days),
`exp-1-10x.sql` (the synthetic row multiplier), and a `results-*.json` timing series. Every number
this report draws from them is quoted at the point of use.

## Appendix B: three dimensions nobody asked for

Found while probing, all working today with one `categorical/single` spec each, all on stack A
over the probe window:

- **Connection mode**, `attributes.ag.data.parameters.agent.llm.connection.mode`: `self_managed`
  7,019, `agenta` 172 (probe 36).
- **Default runner permission**, `attributes.ag.data.parameters.runner.permissions.default`:
  `allow_reads` 7,357, `allow` 90, `ask` 27 (probe 36).
- **Streaming flag**, `attributes.ag.flags.stream`: true 409, false 6,946 (probe 29).

None is on the wish list. Each costs one spec and answers a real operational question.
