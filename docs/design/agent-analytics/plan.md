# Plan

Build in four phases. Each phase is independently reviewable and leaves the app working. The
deferred Tools and resolved-Models charts are a fifth phase that lands after a backend change;
the first four phases finish the locked scope.

File paths follow the existing observability feature so the new page reads as a sibling of
it, not a new pattern. Every request and response shape referenced here is specified in
data-contract.md and verified in capability-review.md.

## Phase 0: backend prerequisites

Two backend items gate a trustworthy v1. Neither is frontend work; list and track them before
the page ships behind its flag.

- **Make a killed or rejected query say so.** Today a statement-timeout, a rejected filter, a
  malformed window, and a genuinely empty window all return `{"count": 0, "buckets": []}` with
  HTTP 200. The page cannot tell "no data" from "the query died", and the cost coverage gate
  in Phase 4 depends on that distinction. The fix crosses two layers: raise a typed
  timeout/filtering error in core and translate it at the router into an `HTTPException`
  (504 for timeout, 4xx for a bad filter or window), and add a per-metric `sample_count` to
  the response. See capability-review.md section 8.4 item 1.
- **Investigate the cost and token-split coverage collapse.** `attributes.gen_ai.usage.cost`
  and the `tokens.cumulative.prompt`/`.completion` split were populated on 70–95% of runs in
  early July on both measured stacks and fell to roughly zero within a week, cause unknown.
  Until this is understood, the cost tile has nothing dependable to show. File it; the first
  four diagnostic checks are in capability-review.md section 4.4 item 4. Both measured stacks
  were local dev; whether production shows the same collapse is unverified.

Done when: an empty result is distinguishable from a failure at the API surface, and the cost
coverage question has an owner and a tracking issue.

## Phase 1: page shell, route, and navigation

Goal: an empty Analytics page reachable from the sidebar, scoped to the project.

- Add the route wrapper `web/oss/src/pages/w/[workspace_id]/p/[project_id]/analytics/index.tsx`,
  a thin default export around a new page module, mirroring the observability page file.
- Add the page module `web/oss/src/components/pages/analytics/index.tsx` with the header
  (title, description) and a placeholder body.
- Add the sidebar entry in
  `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx`: key `app-analytics-link`,
  title `Analytics`, link `${projectURL}/analytics`, an icon from `@phosphor-icons/react`,
  disabled when there is no project URL. Place it next to the Observability entry.
- Confirm the agents-list source for the later filter (app-management or workflow molecule
  selectors) and note the chosen atom in status.md.

Done when: the sidebar shows Analytics, the route renders the header, both themes look
correct.

## Phase 2: data layer

Goal: the page can fetch mapped analytics for the current and previous windows.

- Extend `SpansAnalyticsParams` in `web/packages/agenta-entities/src/trace/api/api.ts` with an
  optional `specs` field, serialized to a JSON-string query param like `filter`. Verify the
  entities package still builds (`pnpm turbo run build --filter=@agenta/entities`).
- Add a new mapper next to the existing one in `web/oss/src/services/tracing/lib/` (do not
  change `analyticsToGeneration`; the observability page depends on it). The new mapper reads
  the duration min, max, sum, count, and nested `pcts.p95` fields, the total cost and total
  token sums with their `count` for the coverage gate, the coverage-gated prompt/completion
  token split, and the category `freq` arrays for the harness, configured-model, and agent
  breakdowns. It combines the unfiltered and status-filtered run counts into success and
  failed, and returns the per-bucket and window-total shape in data-contract.md. Reuse
  `metricField` and `calculateIntervalFromDuration`, and add a small `pcts` accessor for p95
  and a `freq` reader for the breakdowns.
- Add a fetch function in `web/oss/src/services/tracing/api/` that builds the base conditions
  (the `trace_type is invocation` condition, plus the selected agents' `references`
  conditions), passes the explicit `specs`, and calls `fetchSpansAnalytics`. Per window it
  issues the queries in data-contract.md: a bucketed unfiltered query for the charts, a
  bucketed status-filtered query for failed runs, and a no-interval unfiltered query for the
  exact summary-tile numbers including window-level p95. The status-filtered query adds
  `{field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"}` and reads the run count
  as failed runs; it needs only the run-count spec. The previous window needs only the
  no-interval unfiltered and status-filtered calls for the change badges.
- Validate three things against one live response while building this phase, because the
  backend fails silently on all three: the nested `pcts.p95` shape reads correctly; the exact
  enum literal for the `trace_type` filter and the `STATUS_CODE_ERROR` filter both narrow
  rather than returning an empty 200; and the coverage of `gen_ai.usage.cost` and the token
  split on real traffic (they may be near zero — this is the Phase 0 investigation surfacing).
- Derive the previous comparison window as the equal-length window immediately before the
  selected one: for `[oldest, newest]`, the previous window is
  `[oldest - (newest - oldest), oldest]`. This works for both preset and custom ranges.

Done when: a temporary log or test shows correct totals for a known window, the failed-run
filter is confirmed to narrow the result, and the previous window is fetched for comparison.

## Phase 3: state and page assembly

Goal: the page is interactive; controls drive the data.

- Add atoms under `web/oss/src/state/analytics/` following
  `state/observability/dashboard.ts`: a time-range atom holding a `SortResult` (default: the
  last 7 days), an agents-filter atom, a current-window query atom, and a previous-window
  query atom (or one query returning both). Each query atom drives the calls per window
  described in data-contract.md. Key every atom on project id, time range, and the agents
  filter. Set `staleTime` to one minute and `refetchOnWindowFocus: false`. Do not reuse
  `observabilityDashboardTimeRangeAtom`; a second consumer already shares it, so give this page
  its own atoms.
- Build the header controls: the time-range control and the Filters popover with the Agents
  multi-select, a Harness multi-select, and a configured-Model multi-select. Reuse the
  observability time windowing (the `Sort` control and its `SortResult`) for the time range,
  so any window, including a custom start-and-end range, works; do not build a fixed list of
  range options. Offer day, week, and "whole window" as periods; do not offer a month period,
  because calendar months are not expressible and a fixed 30-day stride is not a month. Align
  `oldest` to the viewer's local midnight and read `buckets[].interval` back to label the axis
  with the period that actually ran. Source the Agents options from the agents atom confirmed
  in Phase 1.
- Implement four explicit page states per card, following `AnalyticsDashboard.tsx` (antd
  `Spin` for loading): data, no data in this window, metric unavailable (coverage below the
  threshold), and request failed. The last two exist because a wrong filter or a killed query
  renders as an empty success today; do not collapse them into a single "No data" empty state.

Done when: changing the time range, the agents filter, the harness filter, or the model filter
refetches and the page reflects it, with all four states wired.

## Phase 4: summary panel and the charts

Goal: the full locked-scope UI. Every chart on this page means what its title says and needs no
backend capability that does not exist.

- **Summary panel:** a health donut component (recharts `RadialBarChart` or a small SVG ring)
  showing `round(100 x successRate)` with the band label and prose. Below the run-count floor
  it renders the neutral "Not enough runs yet" state instead of a band. Plus stat tiles for
  total runs, average latency, p95 latency, and total tokens, each with a change badge versus
  the previous window (green when the change is good for that metric, red otherwise; lower
  latency is good) and a sparkline of the current window. Add a coverage-gated total-cost tile
  that renders only when cost coverage clears the threshold and otherwise shows an explicit
  "cost data not available for this window", never a zero.
- **Charts**, each a card with a title, a one-line description, a recharts chart, and a
  toggleable legend:
  - Runs: stacked bars, successful and failed.
  - Latency: bars of average with a p95 reference line; tooltip shows average, p95, min, max.
  - Tokens: total tokens per period, with a coverage label. Show the prompt/completion split
    as stacked bars only when the split coverage gate passes; below it, show total only.
  - Runs per harness: one `categorical/single` spec, per period.
  - Runs per configured model: one `categorical/single` spec, per period, labelled "configured
    model" (this is the author's alias, not the model that answered).
  - Runs per agent: one `categorical/single` spec over the unioned `workflow_variant` and
    `application_variant` reference families, per period.
- There is no Costs prompt/completion chart. The cost split does not exist in the data, and the
  one working cost path (`gen_ai.usage.cost`) is a coverage-gated total, shown as the tile
  above rather than a per-part chart.
- Lay the charts out in a responsive grid. All colors come from theme tokens and the theme
  scale; verify both light and dark themes and hover, empty, unavailable, and loading states.

Done when: the in-scope charts and the summary panel render correctly in both themes across all
four states, and `pnpm lint-fix` passes.

## Phase 5 (deferred, after a backend change): Tools and resolved Models

Not part of this plan's scope. Recorded so Phase 1 to 4 leave the right boundary. The backend
work splits into two prerequisites that are **not co-equal**; they unlock different views, so
Phase 5 itself splits into 5a and 5b. See context.md and capability-review.md for the verified
engine details.

### Prerequisite 1: span-focus wiring (unlocks 5a)

Thread `focus` through to the base query so `focus = "span"` reads child spans. `query.focus`
reaches `dao.analytics()` but is never passed to `build_base_cte`, which hardcodes
`WHERE parent_id IS NULL`; make that predicate conditional on `focus`. Today the endpoint
accepts, echoes, and ignores `focus`, so nothing on a root-span page can rely on it.

- **Ship three guards with it**, or it produces wrong numbers: under `focus = "span"`,
  cumulative metrics double-count because the rollup lives on every ancestor, so per-model
  cost/tokens must use the `incremental` paths; a run count must dedupe because `ag.type.trace`
  is stamped on every span in a trace; and non-root rows need an index (the current index is
  partial on `parent_id IS NULL`, and the wider scan is a ~5x row fan-out). Do not ship
  span-focus before Phase 0's failure-visibility fix, or a span-focus query on a busy project
  hits the statement timeout and returns an empty 200.

### Prerequisite 2: group-by dimension (unlocks only per-model cost, in 5b)

Add a grouping dimension so a numeric metric (cost, tokens) splits by a categorical path
(model name) in one call. Prefer a **per-query** dimension over a per-spec `group_by`: it
matches "one view, one breakdown," leaves `MetricSpec` untouched, confines the nested
`{group_value: stats}` output shape to one code path, and makes a cardinality cap natural to
enforce. This is the harder change; defer it until 5a has shipped.

### 5a: Tools and resolved-Models share (needs prerequisite 1 only)

Once span-focus lands, these need **no** group-by, because a `categorical/single` spec already
returns per-value frequencies:

- Tools horizontal-bar card: `categorical/single` on `attributes.ag.meta.tool.name`,
  `focus = "span"`. Note that specs read the `attributes` JSON only, so the tool name must come
  from the attribute path, not from the `span_name` column, which no spec can read. A per-tool
  error rate needs the group-by dimension or a per-tool filtered call, because `status_code` is
  a column and cannot be a spec either.
- Resolved-Models horizontal-bar card with a click-to-filter legend: `categorical/single` on
  `attributes.ag.meta.request.model`, `focus = "span"`. This is the model that actually
  answered, distinct from the configured-model chart in Phase 4.
- Resolved-model multi-select in the Filters popover.

### 5b: per-model cost/tokens (needs prerequisites 1 and 2)

Adds the numeric-by-model breakdown once the group-by dimension exists, using the `incremental`
cost/token paths under `focus = "span"`.

### Frontend seam to leave now

The request builder in Phase 2 takes `focus` and an arbitrary `specs` list without reshaping,
and the page grid can accept more chart cards. 5a and 5b add queries and cards without touching
the Phase 4 charts.

Recommendation for the boundary: ship Phase 1 to 4. Do not mount empty Tools and Models cards
in this release; a visible "coming soon" card ages badly. Land the chart-card component as a
reusable shell so Phase 5 only supplies data and series config.

## Testing and verification

- Follow `docs/designs/testing/README.md`. Add unit tests for the new mapper (pure function:
  buckets in, dashboard shape out), for the success/failed split, for the coverage gate (a
  metric below threshold is suppressed, not shown as zero), and for the health-score
  computation. These need no live database.
- Verify the charts against one live project by running the local stack per the root
  `AGENTS.md` local dev loop. Confirm the `trace_type` and `status_code` filters narrow rather
  than widen, and confirm the p95 nested read.
- Run `pnpm lint-fix` in `web` before committing. Do not commit during the planning phase.

## Risks and unknowns to resolve during the build

- **Cost and token-split coverage** (Phase 0). Whether either has usable coverage on the target
  data, and the cause of the mid-July collapse. The cost tile and the token split chart depend
  on it. Both measured stacks were local dev; production is unverified.
- **Silent-failure validation** (Phase 2). The exact `trace_type` and `status_code` enum
  literals that narrow rather than returning an empty 200, and the nested `pcts.p95` read.
- The correct agents-list atom for the filter options (resolve in Phase 1).
- Whether the multi-agent reference filter uses `or` grouping or a single `in` with multiple
  values in this dialect (resolve in Phase 2 against the existing filter builder).
- Whether the runner marks a failed run's root span `status_code = STATUS_CODE_ERROR`. The
  failed-run count and the health score depend on it; validate on live traffic in Phase 2. The
  root-status definition also misses in-run failures that recovered a clean root (~1.2% of runs
  on the measured data); state the definition in a tooltip.
- The run-count floor for the neutral health state (tune in Phase 4; start around 20).
- Performance at scale: the 30-day window is the shape most at risk of crossing the 15-second
  statement timeout as a project grows. Keep 7 days the default and treat longer windows as an
  explicit choice with a loading state.
