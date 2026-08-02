# Data contract: request the page sends, response fields it reads

This page talks to one endpoint, `POST /spans/analytics/query`, through the existing
`fetchSpansAnalytics`. Nothing here changes the endpoint. It documents the exact request the
page builds and the response fields the new mapper reads, and it flags the one frontend
extension: passing explicit metric specs.

## Request

The request carries four kinds of fields. Classified by what each field is, not by which
chart it feeds:

- **Routing** (which tenant and window): `projectId`, `oldest`, `newest`. `projectId` comes
  from `projectIdAtom`. `oldest` and `newest` are ISO bounds taken from the selected
  `SortResult`, the same range object the observability windowing uses: a standard preset
  resolves to a start with `newest` omitted (meaning "now"), and a custom range supplies both
  `oldest` and `newest`. Any window is valid; there is no fixed set of options.
- **Policy** (how to slice and aggregate): `focus = "trace"` (root spans only, the only
  value that works today), and `interval` (bucket size in minutes) from
  `calculateIntervalFromDuration`.
- **Data selection** (what to measure): `specs`, a list of metric specs naming the JSON
  paths to summarize. See below.
- **Data filter** (which spans qualify): `filter`, a `{conditions: [...]}` object. At
  project scope with no agent selected, omit the reference conditions so the query spans the
  whole project. For selected agents, add `references` conditions on the chosen agent ids. The
  exact encoding, a single `{operator: "in", value: [{id: a}, {id: b}]}` or one condition per
  agent combined with `or`, follows the existing filter builder; see the plan.md open
  questions.

### The `specs` extension

`fetchSpansAnalytics` omits `specs` today, so the backend applies its default set. The
defaults give totals for cost, tokens, duration, errors, and the trace and span type counts.
That is enough for run count, average latency, total cost, and total tokens, but not for the
prompt-and-completion split or for p95, min, and max latency.

To get those, pass an explicit `specs` list. Add an optional `specs` field to
`SpansAnalyticsParams` and serialize it to a JSON-string query param exactly as `filter` is
serialized. The specs the page needs, by path and type:

| Purpose | path | type | fields read |
| --- | --- | --- | --- |
| Run count | `attributes.ag.type.trace` | categorical/single | `count` |
| Latency | `attributes.ag.metrics.duration.cumulative` | numeric/continuous | `count`, `sum`, `min`, `max`, `pcts.p95` |
| Prompt cost | `attributes.ag.metrics.costs.cumulative.prompt` | numeric/continuous | `sum` |
| Completion cost | `attributes.ag.metrics.costs.cumulative.completion` | numeric/continuous | `sum` |
| Prompt tokens | `attributes.ag.metrics.tokens.cumulative.prompt` | numeric/continuous | `sum` |
| Completion tokens | `attributes.ag.metrics.tokens.cumulative.completion` | numeric/continuous | `sum` |

The `type` strings are verified against the backend: `MetricType`
(`api/oss/src/core/tracing/dtos.py`) has only `numeric/continuous` and `numeric/discrete`
(there is no plain `numeric`), and the backend's own `DEFAULT_ANALYTICS_SPECS`
(`api/oss/src/core/tracing/service.py`) uses `numeric/continuous` for errors, costs, and
tokens. Use `numeric/continuous` for every number metric above; a bare `numeric` is silently
dropped.

p95 is **nested**, not a flat field. The numeric/continuous reducer (`parse_pcts` in
`api/oss/src/dbs/postgres/tracing/utils.py`) emits percentiles under a `pcts` object, so the
value is at `metrics[path].pcts.p95`. `count`, `sum`, `min`, and `max` are flat siblings and
read directly; only the percentiles sit one level down. Still confirm against one live
response in Phase 2, but expect the nested shape.

### Failed runs come from a second, filtered query

A failed run is a run whose root span `status_code` is `ERROR`. `status_code` is a
table column, and metric specs read only the `attributes` JSON (`build_extract_cte` extracts
`attributes #> path`), so no spec can target it. Instead, the page runs a second analytics
query for the same window with an added filter condition on `status_code` and reads the run
count:

- Failed-run query filter: the agent conditions above (if any), plus
  `{field: "status_code", operator: "eq", value: "ERROR"}`. `status_code` is a first-class
  filter field (`api/oss/src/core/tracing/utils/filtering.py`).
- It needs only the run-count spec (`attributes.ag.type.trace`), so it is a cheap query.
- Per bucket: `failed` = the filtered run count; `success` = the unfiltered run count minus
  it.

The page therefore issues two queries per window (unfiltered for totals and latency/cost/
tokens, status-filtered for failed runs), and it fetches a current and a previous window, so
four analytics calls in total.

## Response fields the mapper reads

The response is `{buckets: [{timestamp, metrics: {<path>: {<field>: value}}}]}`. The new
mapper produces, per bucket:

- `failed` = the `type.trace` count from the status-filtered query (runs whose root span is
  `ERROR`). This is a true failed-run count, never larger than the total.
- `success` = the unfiltered `type.trace` count minus `failed`. It cannot go negative, so no
  flooring is needed. This departs from the existing observability mapper, which subtracts the
  `errors.cumulative` sum. That sum counts errored steps, not failed runs, and can exceed the
  run count, so this page uses the run-level status instead.
- `latencyAvg` = duration `sum` / duration `count`, in milliseconds.
- `latencyMin`, `latencyMax` = the flat `min` / `max` duration fields.
- `latencyP95` = the **nested** `metrics[durationPath].pcts.p95` (see the note above the
  response section); `metricField`'s flat one-level read does not reach it, so the mapper
  needs a small `pcts` accessor.
- `costPrompt`, `costCompletion` = the two cost sums.
- `tokensPrompt`, `tokensCompletion` = the two token sums. These split fields are computed
  from per-part token counts, so providers that report only total tokens leave the
  prompt/completion split at zero while `total` is correct; verify the split is non-zero on
  live traffic in Phase 2, or the Costs/Tokens split bars render empty for those agents.

And window totals for the four stat tiles: total runs, success rate, average latency, total
cost, plus the same figures for the previous window so the change badges have a baseline.

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
  tiles and the four charts still render whatever data exists.

## Boundary for the deferred charts

The deferred Tools and Models charts need `focus = "span"` and, for per-model cost, a
`group_by` field on a spec. Neither works on today's endpoint. Keep the request builder able
to take a different `focus` and extra specs without reshaping, so the follow-up change adds a
second query rather than rewriting this one.
