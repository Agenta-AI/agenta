# Data contract: request the page sends, response fields it reads

This page talks to one endpoint, `POST /spans/analytics/query`, through the existing
`fetchSpansAnalytics`. Nothing here changes the endpoint. It documents the exact request the
page builds and the response fields the new mapper reads, and it flags the one frontend
extension: passing explicit metric specs.

Every request and response shape below comes from the capability review
(`capability-review.md`), which verified each against live calls on two stacks. Where a value
still needs confirming against a live response during the build, the text says so.

## Request

The request carries four kinds of field, grouped by what each field is, not by which chart it
feeds:

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
  never rely on the echoed `focus` to confirm behaviour.
- **Data selection** (what to measure): `specs`, a list of metric specs naming the JSON
  paths to summarize. See below.
- **Data filter** (which spans qualify): `filter`, a `{conditions: [...]}` object. Every
  query carries a base `{field: "trace_type", operator: "is", value: "invocation"}` condition
  so annotation traces (evaluator and human-annotation runs) do not inflate the run count and
  the latency, cost, and token numbers. At project scope with no agent selected, add nothing
  else so the query spans the whole project. For selected agents, add `references` conditions
  on the chosen agent ids. For a selected **harness**, add a condition on
  `attributes.ag.data.parameters.agent.harness.kind`; for a selected **configured model**, add a
  condition on `attributes.ag.data.parameters.agent.llm.model`. Both are root-span attributes and
  filter today with no backend change (capability-review.md §4.2 items 11–12); the model filter
  narrows by the configured alias, not the model that answered. Combine multiple values within one
  filter the same way the agent filter does (the encoding to confirm in Phase 2). All three
  filters — Agents, Harness, configured Model — are server-side, so each belongs in the query key
  and changing any of them refetches. The `trace_type` value is the unprefixed literal `invocation`
  (verified against the `TraceType` enum, `api/oss/src/core/otel/dtos.py`); unlike
  `status_code`, it is not prefixed, and the backend validates the value against the enum, so a
  wrong literal returns an empty 200. The one encoding still to confirm against the filter
  builder in Phase 2 is whether multiple agent ids go as a single
  `{operator: "in", value: [{id: a}, {id: b}]}` or one condition per agent combined with `or`.
  A fallback for the run count that avoids the `trace_type` filter entirely: read the `freq`
  array of the `attributes.ag.type.trace` categorical spec, which already carries the
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
optional `specs` field to `SpansAnalyticsParams` and serialize it exactly as `filter` is
serialized. The Fern request type (`QuerySpansAnalyticsRequest`) already declares `specs?: string`,
and `fetchSpansAnalytics` already does `request.filter = JSON.stringify(filter)`, so the change is
`request.specs = JSON.stringify(specs)` on one line beside it — no client regeneration needed.

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
  percentile levels ship on every numeric/continuous spec, so the per-bucket p95 line needs no
  backend work. Confirm the nested shape against one live response in Phase 2.
- **Cost has no prompt/completion split, and its one working path is coverage-gated.** The
  canonical `ag.metrics.costs.cumulative.total`, `.prompt`, and `.completion` paths hold no
  data on agent root spans (the cost roll-up never crosses the run's OTLP batch boundary to
  reach the root span). The only populated cost path is `attributes.gen_ai.usage.cost`, the
  harness's own reported run total, and its coverage collapsed to near zero in mid-July on
  both measured stacks for a cause nobody has established yet. The Cost chart therefore renders
  the total only, and only when coverage clears a threshold (see "Coverage gating" below).
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

The six core metric specs (run count, latency, cost, total tokens, and the two token-split
specs) plus the four category specs (harness, configured model, and the two agent-reference
families) come to **ten specs** — more than one request should carry. So the page does not put
them in a single call. It fans out into small bucketed calls, each at or under about eight
specs, in parallel with a per-call error state:

1. **Bucketed core metrics** (six specs): run count, latency, cost, total tokens, and the
   prompt/completion split. Drives the Runs, Latency, Cost, and Tokens charts. This is the
   "six-spec shape" the timings below were measured on.
2. **Bucketed category breakdowns** (four specs): the harness, configured-model, and two
   agent-reference categorical specs. Drives the three breakdown charts.
3. **Bucketed status-filtered** (one spec): the per-bucket failed run count for the stacked Runs
   chart.

Every chart reads its data per bucket. On the measured data a 7-day window costs about 0.26 s
and a 30-day window about 1.7 s for the six-spec core call, so 7 days is the default and 30 or
90 days is an explicit user choice with a loading state; the smaller category and status calls
run alongside it.

## Response fields the mapper reads

The response is `{buckets: [{timestamp, interval, metrics: {<path>: {<field>: value}}}]}`.

**Join the parallel calls by `timestamp`, not by array position.** Each call omits its empty
buckets independently (see "Response quirks"), so the unfiltered, category, and status-filtered
responses can have different bucket counts and different offsets — a bucket with successes but no
failures is present in the unfiltered array and absent from the status-filtered one. The mapper
keys each response's buckets by `timestamp`, builds the union x-axis, and fills a missing bucket
as zero for that call. It must also read `buckets[].interval` back and treat the calls as
comparable only when their effective `interval` agrees; if the backend coarsened one call's
interval differently, surface a mismatch state rather than aligning mismatched buckets. Only
under this timestamp join do the per-bucket claims below hold. The new mapper then produces, per
bucket:

- `failed` = the `type.trace` count from the status-filtered query for that `timestamp` (runs
  whose root span is `STATUS_CODE_ERROR`), or zero if the status-filtered call omitted the
  bucket. This is a true failed-run count, never larger than the total for the same bucket.
- `success` = the unfiltered `type.trace` count for that `timestamp` minus `failed`. Because
  both counts come from the same bucket after the timestamp join, `success` cannot go negative
  and no flooring is needed; without the join (positional pairing across omitted buckets) it
  could. This departs from the existing observability mapper, which subtracts the
  `errors.cumulative` sum. That sum counts errored steps, not failed runs, and can exceed the
  run count, so this page uses the run-level status instead.
- `latencyAvg` = duration `sum` / duration `count`, in milliseconds.
- `latencyMin`, `latencyMax` = the flat `min` / `max` duration fields.
- `latencyP95` = the **nested** `metrics[durationPath].pcts.p95`, per bucket. `metricField`'s
  flat one-level read does not reach it, so the mapper needs a small `pcts` accessor. This drives
  the per-bucket p95 line and the tooltip.
- `costTotal` = the `gen_ai.usage.cost` `sum`. Rendered only when its coverage gate passes.
- `tokensTotal` = the `tokens.cumulative.total` `sum`.
- `tokensPrompt`, `tokensCompletion` = the two token split sums. Rendered only when their
  coverage gate passes; below it they are suppressed, not shown as zero.

### Coverage gating

Cost and the token split can be perfectly expressible and still hold no data, because coverage
is zero on the window. For each gated metric, compare its spec `count` against the run count
for the same window. Render the chart only when coverage clears a threshold; below it, show
"cost data is not available for this window" (or the token equivalent) rather than a zero. A
zero reads as a real measurement and is worse than an explicit unavailable state. Total tokens
is shippable with a coverage label rather than a hard gate, because its coverage is partial
rather than collapsed.

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

## Boundary for the deferred charts

The deferred Tools and resolved-Models charts need `focus = "span"`, which is accepted, echoed,
and ignored today, so it always reads root spans. Actual tool names live at
`attributes.ag.meta.tool.name` and resolved model ids at `attributes.ag.meta.request.model`,
both on child spans only. Per-model cost additionally needs a group-by dimension the endpoint
does not have. Keep the request builder able to take a different `focus` and extra specs
without reshaping, so the follow-up change adds a second query rather than rewriting this one.
