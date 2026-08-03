# Context

## What a user sees today

Today the web app shows no agent performance across a project. A team running several agents
cannot open one screen and read how many runs happened, how many failed, how fast they ran, and
what they cost — narrowed to the agents they care about, over a window they choose.

The frontend already carries the plumbing to answer those questions. The atoms, the fetch
function, and the response mapper that talk to the analytics endpoint all exist and are in use.
This feature reuses that plumbing; it does not rebuild the data layer.

## What this feature adds

A new page named Analytics, reachable from the project sidebar and scoped to the whole project.
It shows:

- A header: the page title, a one-line description, a time-range control that accepts any
  window, and a Filters popover with three multi-selects that narrow every query: Agents (by
  `references`), Harness, and configured Model. All three are server-side filter conditions on
  root-span fields, so changing any of them refetches (see data-contract.md for the condition
  each one adds). The time-range control reuses the observability windowing (the `Sort` control and its
  `SortResult`), so it takes the standard presets and a custom start-and-end range, not a fixed
  list of options. It opens on the last 7 days.
- Charts in a grid, each with hover tooltips and a legend whose entries toggle series on and
  off:
  - Runs: stacked bars of successful and failed runs per bucket.
  - Latency: bars of average latency per bucket, with a per-bucket p95 line; the tooltip shows
    average, p95, min, and max.
  - Cost: total cost per bucket, coverage-gated. When cost coverage is low it reads "not
    available for this window" instead of a zero.
  - Tokens: total tokens per bucket, with a coverage label. The prompt/completion split renders
    as stacked bars only when its coverage gate passes.
  - Runs per harness, runs per configured model, and runs per agent: category breakdowns, one
    `categorical/single` spec each. "Configured model" is the model alias the agent's author
    set on the root span; it is **not** the model that actually answered the run. The answered
    model lives on child spans and is the deferred model-usage view below. This chart must be
    labelled "configured model" and never implemented as the deferred model-usage view.

  There is no Costs prompt/completion split chart. The split paths hold no data on agent runs,
  so the Cost chart shows the total from `gen_ai.usage.cost` only. See data-contract.md and
  capability-review.md.

## Locked scope decisions

These decisions are settled and drive the plan. Do not reopen them without the requester.

1. Frontend-first, with two backend prerequisites. Build the charts above, the Agents / Harness /
   configured-Model filters, and the time-range control against today's endpoint. Harness and
   configured model appear both as breakdown charts and as filters; all three filters read
   root-span attributes, so none of them needs a backend change. The endpoint
   returns most of the fields these need directly, but two backend items gate a trustworthy
   release, tracked as Phase 0 in plan.md: make a killed or rejected query distinguishable from a
   genuinely empty one, and investigate the mid-July collapse in cost and token-split coverage.
   The Cost chart and the token split stay coverage-gated until someone explains that collapse.

2. A net-new page at project scope, named Analytics. It aggregates every agent in the project by
   default. The Agents multi-select narrows the set, so the default query carries no single-app
   reference filter.

3. A failed run is a run whose root span status is `STATUS_CODE_ERROR`, a run-level outcome
   (there is no `STATUS_CODE_OK` on root spans, so success is the complement). The Runs chart's
   successful-and-failed split builds on that, not on a count of errored steps. data-contract.md
   holds the definition and the query it needs.

## Model usage and tool usage need backend work

Two views fall out of scope for this plan, because the backend cannot serve them yet. This is an
engineering constraint, not an open design question.

Tool usage (calls per tool, tool error rate) and model usage (runs per model, cost per model)
read fields that live on child spans: the tool name, the model name, the span type, and the
per-span status. Today's analytics endpoint reads root spans only. It accepts a `focus` field
that would widen the scan to all spans, but the field is inert, so those fields stay out of
reach.

The two deferred-view enablers below — span-focus wiring and a group-by dimension — are not
co-equal gates; each unlocks a different thing. These are distinct from the two Phase 0 blockers
in the locked scope above (query-failure visibility and the coverage investigation); do not
conflate the two pairs.

- **Span-focus wiring** unlocks both the tool view and the model-share view in their basic form.
  `query.focus` reaches `dao.analytics()` but never reaches `build_base_cte`, which
  unconditionally applies `WHERE parent_id IS NULL`
  (`api/oss/src/dbs/postgres/tracing/utils.py`). Thread `focus` through so `focus = span` drops
  that predicate, and the query reads child spans. A `categorical/single` spec already returns
  per-value frequencies, so counting calls per tool or runs per model needs no group-by once
  span focus works.
  - One caveat must ship with the fix: under `focus = span`, the cumulative metric paths
    double-count. `ag.metrics.*.cumulative` are rollups stored on the root span, so scanning all
    spans sums the root total plus every child's. Cost and tokens must switch to the
    `incremental` paths under span focus, or the figures inflate with no error. The fix needs a
    guard that rejects or auto-maps a cumulative spec under `focus = span`.
- **A group-by dimension** unlocks only per-model cost and tokens. Crossing a numeric metric
  (cost, tokens) with a categorical dimension (model name) is the one thing the frequency
  reducers cannot do; the extract stage groups by `(timestamp, spec)` only, with no grouping
  key. This is the harder, later change. Preferred shape: a per-query `group_by` dimension that
  splits every spec by one path, leaves `MetricSpec` untouched, and confines the nested
  `{group_value: stats}` output to one code path.

## Goals

- Reuse the analytics fetch layer, the response mapper, and the time-windowing control rather
  than add a second path to the same endpoint.
- Deliver the layout and interactions with the repo's charting library and theme tokens, in both
  light and dark themes.
- Leave a clean seam, so the deferred model and tool views land as an additive change once the
  backend prerequisites ship — not a rewrite.

## Non-goals

- No new analytics capability under `api/` for the page itself. The two Phase 0 items harden
  existing behavior; they do not add a chart's data path.
- No change to the existing Observability page.
- No real-time streaming. The page fetches per time-range selection and caches like the existing
  dashboard atoms.
