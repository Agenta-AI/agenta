# Data contract: request the page sends, response fields it reads

This page talks to one endpoint, `POST /spans/analytics/query`, through the existing
`fetchSpansAnalytics`. Nothing here changes the endpoint. It documents the exact request the
page builds and the response fields the new mapper reads, and it flags the one frontend
extension: passing explicit metric specs.

Every request and response shape below is taken from the capability review
(`capability-review.md`), which verified each one against live calls on two stacks. Where a
value still has to be confirmed against a live response during the build, the text says so.

## Request

The request carries four kinds of fields. Classified by what each field is, not by which
chart it feeds:

- **Routing** (which tenant and window): `projectId`, `oldest`, `newest`. `projectId` comes
  from `projectIdAtom`. `oldest` and `newest` are ISO bounds taken from the selected
  `SortResult`, the same range object the observability windowing uses: a standard preset
  resolves to a start with `newest` omitted (meaning "now"), and a custom range supplies both
  `oldest` and `newest`. Any window is valid; there is no fixed set of options. Align `oldest`
  to the viewer's local midnight, because buckets are fixed-width offsets from `oldest`, not
  calendar days (see "Response quirks" below).
- **Policy** (how to slice and aggregate): `focus = "trace"` and `interval` (bucket size in
  minutes) from `calculateIntervalFromDuration`. The endpoint ignores `focus` entirely and
  always reads root spans, so `focus = "trace"` is the honest label rather than a switch;
  never rely on the echoed `focus` to confirm behaviour. Omit `interval` to collapse the
  window into one exact bucket (used for the window-level summary numbers below).
- **Data selection** (what to measure): `specs`, a list of metric specs naming the JSON
  paths to summarize. See below.
- **Data filter** (which spans qualify): `filter`, a `{conditions: [...]}` object. Every
  query carries a base `{field: "trace_type", operator: "is", value: "invocation"}` condition
  so annotation traces (evaluator and human-annotation runs) do not inflate the run count and
  the latency, cost, and token numbers. At project scope with no agent selected, add nothing
  else so the query spans the whole project. For selected agents, add `references` conditions
  on the chosen agent ids. Two things to validate against the existing filter builder in
  Phase 2: the exact enum literal for `trace_type` (mirror the `status_code` lesson below —
  the accepted value may be prefixed), and whether multiple agent ids encode as a single
  `{operator: "in", value: [{id: a}, {id: b}]}` or one condition per agent combined with
  `or`. A fallback for the run count that needs no `trace_type` literal: read the `freq` array
  of the `attributes.ag.type.trace` categorical spec, which already carries the
  invocation-versus-annotation split.

  A filter typo does not error. An unknown field is logged and dropped, which **widens** the
  result rather than narrowing it, and an invalid operator or value returns HTTP 200 with an
  empty result. Verify every filter the page sends once against a known-good window during
  development; there is no runtime signal.

### The `specs` extension

`fetchSpansAnalytics` omits `specs` today, so the backend applies its default set. The
defaults give totals for cost, tokens, duration, errors, and the trace and span type counts,
but they read the canonical `ag.metrics.costs.cumulative.*` cost paths, which hold no data on
agent runs (see the cost note below). The page must pass an explicit `specs` list. Add an
optional `specs` field to `SpansAnalyticsParams` and serialize it to a JSON-string query param
exactly as `filter` is serialized.

The specs the page sends, by path and type:

| Purpose | path | type | fields read |
| --- | --- | --- | --- |
| Run count | `attributes.ag.type.trace` | categorical/single | `count` (or the `freq` array) |
| Latency | `attributes.ag.metrics.duration.cumulative` | numeric/continuous | `count`, `sum`, `min`, `max`, `pcts.p95` |
| Total cost (coverage-gated) | `attributes.gen_ai.usage.cost` | numeric/continuous | `sum`, `count` |
| Total tokens | `attributes.ag.metrics.tokens.cumulative.total` | numeric/continuous | `sum`, `count` |
| Prompt tokens (coverage-gated split) | `attributes.ag.metrics.tokens.cumulative.prompt` | numeric/continuous | `sum` |
| Completion tokens (coverage-gated split) | `attributes.ag.metrics.tokens.cumulative.completion` | numeric/continuous | `sum` |

The category breakdown charts (runs per harness, per configured model, per agent) each send
one extra `categorical/single` spec and read its `freq` array:

| Purpose | path | type | fields read |
| --- | --- | --- | --- |
| Runs per harness | `attributes.ag.data.parameters.agent.harness.kind` | categorical/single | `freq` |
| Runs per configured model | `attributes.ag.data.parameters.agent.llm.model` | categorical/single | `freq` |
| Runs per agent | `attributes.ag.references.workflow_variant.id` and `attributes.ag.references.application_variant.id` | categorical/single | `freq` (union both families) |

Notes on the specs:

- **The `type` strings are verified against the backend.** `MetricType`
  (`api/oss/src/core/tracing/dtos.py`) has only `numeric/continuous` and `numeric/discrete`
  (there is no plain `numeric`). Use `numeric/continuous` for every number metric; a bare
  `numeric` is silently dropped.
- **p95 is nested, not a flat field.** The numeric/continuous reducer emits percentiles under
  a `pcts` object, so the value is at `metrics[path].pcts.p95`. `count`, `sum`, `min`, and
  `max` are flat siblings and read directly; only the percentiles sit one level down. All 27
  percentile levels ship on every numeric/continuous spec, so min/max/p95 latency need no
  backend work. Confirm the nested shape against one live response in Phase 2.
- **Cost has no prompt/completion split, and its one working path is coverage-gated.** The
  canonical `ag.metrics.costs.cumulative.total`, `.prompt`, and `.completion` paths hold no
  data on agent root spans (the cost roll-up never crosses the run's OTLP batch boundary to
  reach the root span). The only populated cost path is `attributes.gen_ai.usage.cost`, the
  harness's own reported run total, and its coverage collapsed to near zero in mid-July on
  both measured stacks for a cause nobody has established yet. The cost tile therefore renders
  only when coverage clears a threshold (see "Coverage gating" below), and there is no cost
  split to chart. Do not add a Costs prompt/completion chart.
- **Total tokens works with a coverage label; the split moves with cost.** The
  prompt/completion token split shares the same mid-July collapse as cost: it is real where
  the pipeline works and a flat zero band where it does not, which reads as data and is worse
  than an empty chart. Coverage-gate the split the same way as cost.

### Failed runs come from a second, filtered query

A failed run is a run whose root span `status_code` is `STATUS_CODE_ERROR`. `status_code` is a
table column, and metric specs read only the `attributes` JSON (`build_extract_cte` extracts
`attributes #> path`), so no spec can target it. Instead, the page runs a second analytics
query for the same window with an added filter condition on `status_code` and reads the run
count:

- Failed-run query filter: the base `trace_type` condition and the agent conditions (if any),
  plus `{field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"}`. `status_code` is
  a first-class filter field (`api/oss/src/core/tracing/utils/filtering.py`). The operator
  must be `is` and the value must be the full enum literal `STATUS_CODE_ERROR`. An `eq`
  operator or a bare `ERROR` value both raise inside the backend and come back as HTTP 200
  with an empty result, which would silently report zero failures forever.
- There is **no** `STATUS_CODE_OK` on root spans; a clean run's status is `STATUS_CODE_UNSET`.
  So success is the complement of failure, never a positive `STATUS_CODE_OK` filter.
- It needs only the run-count spec (`attributes.ag.type.trace`), so it is a cheap query.
- Per bucket: `failed` = the filtered run count; `success` = the unfiltered run count minus
  it.

**Blind spot to state in the UI.** Root-span status does not see failures inside a run that
recovered a clean root. On the measured data that is about 1.2% of runs. The v1 definition of
a failed run is "the root span errored"; say so in a tooltip. Catching in-run failures needs
`focus = "span"`, which does not work today (see the deferred boundary).

### The queries per window

Two shapes are needed because window-level percentiles cannot be composed from per-bucket
percentiles (averaging or maxing per-bucket p95s is wrong for any non-uniform distribution).
Counts and sums do compose, so they can be summed from the bucketed calls; only p95 forces the
no-interval call.

For the **current** window:

1. **Bucketed, unfiltered** (`interval` set): drives the Runs, Latency, Cost, and Tokens
   charts. Also carries the per-bucket failed count once combined with query 2.
2. **Bucketed, status-filtered**: the per-bucket failed run count for the stacked Runs chart.
3. **No-interval, unfiltered** (`interval` omitted, one exact bucket): the exact summary-tile
   numbers, including the window-level p95 latency that the bucketed call cannot produce.

For the **previous** comparison window (change badges only):

4. **No-interval, unfiltered**: exact previous-window totals and p95.
5. **No-interval, status-filtered**: the previous-window failed count for the previous success
   rate.

Derive the previous window as the equal-length window immediately before the selected one: for
`[oldest, newest]`, the previous window is `[oldest - (newest - oldest), oldest]`. This works
for both preset and custom ranges.

Keep any single request at or under about eight specs, and fan the calls out in parallel with a
per-call error state. On the measured data a 7-day window costs about 0.26 s and a 30-day
window about 1.7 s for the shipped six-spec shape, so 7 days is the default and 30 or 90 days
is an explicit user choice with a loading state.

## Response fields the mapper reads

The response is `{buckets: [{timestamp, interval, metrics: {<path>: {<field>: value}}}]}`. The
new mapper produces, per bucket:

- `failed` = the `type.trace` count from the status-filtered query (runs whose root span is
  `STATUS_CODE_ERROR`). This is a true failed-run count, never larger than the total.
- `success` = the unfiltered `type.trace` count minus `failed`. It cannot go negative, so no
  flooring is needed. This departs from the existing observability mapper, which subtracts the
  `errors.cumulative` sum. That sum counts errored steps, not failed runs, and can exceed the
  run count, so this page uses the run-level status instead.
- `latencyAvg` = duration `sum` / duration `count`, in milliseconds. For a window average, sum
  the duration `sum` fields and divide by the summed `count` fields, or read `mean` from the
  no-interval call. Never average per-bucket means.
- `latencyMin`, `latencyMax` = the flat `min` / `max` duration fields.
- `latencyP95` = the **nested** `metrics[durationPath].pcts.p95`. `metricField`'s flat
  one-level read does not reach it, so the mapper needs a small `pcts` accessor. The
  window-level p95 tile reads this from the no-interval call, not from the buckets.
- `costTotal` = the `gen_ai.usage.cost` `sum`. Rendered only when its coverage gate passes.
- `tokensTotal` = the `tokens.cumulative.total` `sum`.
- `tokensPrompt`, `tokensCompletion` = the two token split sums. Rendered only when their
  coverage gate passes; below it they are suppressed, not shown as zero.

And window totals for the summary tiles: total runs, success rate, average latency, p95
latency, total tokens, and coverage-gated total cost, plus the same figures for the previous
window so the change badges have a baseline. Lower latency and lower cost are the "good"
direction for the badge colour.

### Coverage gating

Cost and the token split can be perfectly expressible and still hold no data, because coverage
is zero on the window. For each gated metric, compare its spec `count` against the run count
for the same window. Render the tile or chart only when coverage clears a threshold; below it,
show "cost data is not available for this window" (or the token equivalent) rather than a zero.
A zero reads as a real measurement and is worse than an explicit unavailable state. Total
tokens is shippable with a coverage label rather than a hard gate, because its coverage is
partial rather than collapsed.

### Response quirks the mapper must handle

- **Empty buckets are omitted.** The mapper must build its own x-axis, or gaps read as missing
  days rather than as zero days.
- **The top-level `count` is the number of buckets, not the number of runs.** Read run counts
  from the per-bucket `type.trace` metric.
- **The requested `interval` may have been coarsened silently** above 1024 buckets. Only
  `buckets[].interval` reports what actually ran. If the UI lets the user pick a period, read
  the effective interval back and label the chart with it.
- **A wrong filter renders as zero, not as an error**, as noted under the request filter.
- **Buckets are 24-hour periods aligned to `oldest`**, not calendar days, and `date_bin` steps
  by a fixed duration, so buckets drift off local midnight across a daylight-saving transition.
  Calendar months are not expressible at all. Label the axis as 24-hour periods; do not offer
  a month period.

## Health score (browser-side, not in the contract)

Computed from the window totals, never sent to the backend:

- `successRate` = successful runs / total runs.
- `health` = round(100 x successRate). The score is the success rate; latency does not factor
  in, because a fixed latency band mislabels agents that are legitimately slow.
- Band: Healthy at 85 and above, Watch from 65 to 84, At risk below 65. The bands read
  directly as success percentages.
- Low-traffic guard: below a minimum run count in the window, do not band the score. Show a
  neutral "Not enough runs yet" donut instead, so a single failure in a quiet window does not
  read as At risk. The threshold is a build-time tuning value (start around 20 runs). The stat
  tiles and the charts still render whatever data exists.

## Boundary for the deferred charts

The deferred Tools and resolved-Models charts need `focus = "span"`, which is accepted, echoed,
and ignored today, so it always reads root spans. Actual tool names live at
`attributes.ag.meta.tool.name` and resolved model ids at `attributes.ag.meta.request.model`,
both on child spans only. Per-model cost additionally needs a group-by dimension the endpoint
does not have. Keep the request builder able to take a different `focus` and extra specs
without reshaping, so the follow-up change adds a second query rather than rewriting this one.
