# Context

## What a user sees today

Today the web app has no page that shows agent performance across a project. A team running
several agents cannot open one screen and read how many runs happened, how many failed, how
fast they ran, and what they cost, narrowed to the agents they care about, over a window they
choose.

The frontend already has the data plumbing to answer these questions. The atoms, the fetch
function, and the response mapper that talk to the analytics endpoint exist and are in use.
This feature reuses that plumbing; it does not rebuild the data layer.

## What this feature adds

A new page titled Analytics, reachable from the project sidebar, scoped to the whole project.
It shows:

- A header with the page title, a one-line description, a time-range control that accepts any
  window, and a Filters popover with an Agents multi-select that narrows the query to chosen
  agents. The time-range control reuses the existing observability time windowing (the `Sort`
  control and its `SortResult`), so it supports the standard presets and a custom
  start-and-end range. It is not a fixed list of options.
- A summary panel: a health donut (0 to 100, with a Healthy / Watch / At risk band and a
  one-line read-out) and four stat tiles (Total runs, Success rate, Avg latency, Total cost).
  Each tile shows a change badge against the previous window of equal length and a small trend
  line of the current window.
- Four charts in a grid, each with hover tooltips and a legend whose entries toggle series on
  and off:
  - Runs: stacked bars of successful and failed runs per bucket.
  - Latency: bars of average latency per bucket, with a p95 marker line; the tooltip shows
    average, p95, min, and max.
  - Costs: stacked bars of prompt cost and completion cost per bucket.
  - Tokens: stacked bars of prompt tokens and completion tokens per bucket.

## Locked scope decisions

Three decisions are settled and drive the plan. Do not reopen them without the requester.

1. Frontend-first. Build the four charts above, the four stat tiles, the health donut, the
   Agents filter, and the time-range control against today's endpoint. The endpoint already
   returns every field these need, so this scope ships without any change under `api/`.

2. Health donut computed in the browser. The page derives the health score from
   `0.72 x successRate + 0.28 x latencyScore`, where `latencyScore` maps average latency onto
   a 0 to 1 range (higher is faster). The bands are Healthy at 85 and above, Watch from 65 to
   84, At risk below 65. This is a display aid; it is not sent to or stored on the backend.

3. New page at project scope. This is a net-new page named Analytics. It aggregates every
   agent in the project by default. The Agents multi-select narrows the set, so the default
   query carries no single-app reference filter.

## Showing model usage and tool usage needs backend work

Two views are out of scope for this plan because the backend cannot serve them yet. This is an
engineering constraint, not an open design question.

Tool usage (calls per tool, tool error rate) and model usage (runs per model, cost per model)
read fields that live on child spans: the tool name, the model name, the span type, and the
per-span status. Today's analytics endpoint reads only root spans. It accepts a `focus` field
that would widen the scan to all spans, but the field is inert. So these fields are simply not
reachable through the endpoint today.

The two backend prerequisites are not co-equal gates; they unlock different things.

- Span-focus wiring unlocks both the tool view and the model-share view in their basic form.
  `query.focus` is in scope in `dao.analytics()` but never reaches `build_base_cte`, which
  unconditionally applies `WHERE parent_id IS NULL`
  (`api/oss/src/dbs/postgres/tracing/utils.py`). Threading `focus` through so `focus = span`
  drops that predicate lets the query read child spans. A `categorical/single` spec already
  returns per-value frequencies, so counting calls per tool or runs per model needs no
  group-by once span focus works.
  - Correctness caveat, must ship with the fix: under `focus = span` the cumulative metric
    paths double-count. `ag.metrics.*.cumulative` are rollups stored on the root span, so
    scanning all spans sums the root total plus every child's. Cost and tokens must switch to
    the `incremental` paths under span focus, or the figures come out inflated with no error.
    The fix needs a guard that rejects or auto-maps a cumulative spec under `focus = span`.
- Group-by dimension unlocks only per-model cost and tokens. Crossing a numeric metric (cost,
  tokens) with a categorical dimension (model name) is the one thing the frequency reducers
  cannot do; the extract stage groups by `(timestamp, spec)` only, with no grouping key. This
  is the harder, later change. Preferred shape: a per-query `group_by` dimension that splits
  every spec by one path, which leaves `MetricSpec` untouched and confines the nested
  `{group_value: stats}` output to one code path.

## Goals

- Reuse the existing analytics fetch layer, response mapper, and time-windowing control rather
  than adding a second path to the same endpoint.
- Deliver the layout and interactions using the repo's charting library and theme tokens, in
  both light and dark themes.
- Leave a clean boundary so the deferred model and tool views become an additive change once
  the backend prerequisites land, not a rewrite.

## Non-goals

- No change to `api/` in this plan.
- No change to the existing Observability page.
- No real-time streaming; the page fetches per time-range selection and caches like the
  existing dashboard atoms.
