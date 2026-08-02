# Plan

Build in four phases. Each phase is independently reviewable and leaves the app working. The
deferred Tools and Models charts are a fifth phase that lands after a backend change; the
first four phases finish the locked scope.

File paths follow the existing observability feature so the new page reads as a sibling of
it, not a new pattern.

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
  the split cost and token paths and the duration min, max, and p95 fields, combines the
  unfiltered and status-filtered run counts into success and failed, and returns the per-bucket
  and window-total shape in data-contract.md. Reuse `metricField` and
  `calculateIntervalFromDuration`, and add a small `pcts` accessor for p95.
- Add a fetch function in `web/oss/src/services/tracing/api/` that builds the project-scope
  conditions (no single-app reference by default; the selected agents' reference conditions),
  passes the explicit `specs`, and calls `fetchSpansAnalytics`. It issues two queries per
  window: the unfiltered one for totals and latency/cost/tokens, and a second one that adds
  `{field: "status_code", operator: "eq", value: "ERROR"}` and reads the run count as failed
  runs (see data-contract.md). The failed-run query needs only the run-count spec.
- The spec `type` strings (`numeric/continuous`) and the nested `pcts.p95` shape are already
  verified in the backend code (see data-contract.md); validate them against one live response
  while building this phase, and check the prompt/completion split reads non-zero on real
  traffic.
- Derive the previous comparison window as the equal-length window immediately before the
  selected one: for `[oldest, newest]`, the previous window is
  `[oldest - (newest - oldest), oldest]`. This works for both preset and custom ranges.

Done when: a temporary log or test shows correct totals for a known window, and the previous
window is fetched for comparison.

## Phase 3: state and page assembly

Goal: the page is interactive; controls drive the data.

- Add atoms under `web/oss/src/state/analytics/` following
  `state/observability/dashboard.ts`: a time-range atom holding a `SortResult` (default: the
  last 7 days), an agents-filter atom, a current-window query atom, and a previous-window
  query atom (or one query returning both). Each query atom drives the two calls per window
  (unfiltered and status-filtered). Key every atom on project id, time range, and the agents
  filter. Set `staleTime` to one minute and `refetchOnWindowFocus: false`.
- Build the header controls: the time-range control and the Filters popover with the Agents
  multi-select. Reuse the observability time windowing (the `Sort` control and its
  `SortResult`) for the time range, so any window, including a custom start-and-end range,
  works; do not build a fixed list of range options. Source the Agents options from the
  agents atom confirmed in Phase 1.
- Wire loading and empty states following `AnalyticsDashboard.tsx` (antd `Spin`, a "No data"
  empty state per card).

Done when: changing the time range or the agents filter refetches and the page reflects it,
with correct loading and empty states.

## Phase 4: summary panel and the four charts

Goal: the full locked-scope UI.

- Summary panel: a health donut component (recharts `RadialBarChart` or a small SVG ring)
  showing `round(100 x successRate)` with the band label and prose. Below the run-count floor
  it renders the neutral "Not enough runs yet" state instead of a band. Plus four stat tiles;
  each shows the value, a change badge versus the previous window (green when the change is
  good for that metric, red otherwise; note that lower latency and lower cost are good), and a
  sparkline of the current window.
- Chart components, each a card with a title, a one-line description, a recharts chart, and a
  toggleable legend:
  - Runs: stacked bars, successful and failed.
  - Latency: bars of average with a p95 reference line; tooltip shows average, p95, min, max.
  - Costs: stacked bars, prompt and completion.
  - Tokens: stacked bars, prompt and completion.
- Lay the four charts out in a two-column grid. All colors come from theme tokens and the
  theme scale; verify both light and dark themes and hover, empty, and loading states.

Done when: the four in-scope charts and the summary panel render correctly in both themes,
and `pnpm lint-fix` passes.

## Phase 5 (deferred, after a backend change): Tools and Models

Not part of this plan's scope. Recorded so Phase 1 to 4 leave the right boundary. The backend
work splits into two prerequisites that are **not co-equal**; they unlock different views, so
Phase 5 itself splits into 5a and 5b. See context.md for the verified engine details.

### Prerequisite 1: span-focus wiring (unlocks 5a)

Thread `focus` through to the base query so `focus = "span"` reads child spans.
`query.focus` reaches `dao.analytics()` but is never passed to `build_base_cte`, which
hardcodes `WHERE parent_id IS NULL`; make that predicate conditional on `focus`.

- **Ship a guard with it**: under `focus = "span"`, cumulative metrics double-count (the
  rollup lives on the root span). Reject or auto-map a cumulative spec under `focus = "span"`,
  and have per-model cost/tokens use the `incremental` paths, not the cumulative ones.

### Prerequisite 2: group-by dimension (unlocks only per-model cost, in 5b)

Add a grouping dimension so a numeric metric (cost, tokens) splits by a categorical path
(model name) in one call. Prefer a **per-query** dimension over a per-spec `group_by`: it
matches "one view, one breakdown," leaves `MetricSpec` untouched, and confines the nested
`{group_value: stats}` output shape to one code path. This is the harder change; defer it
until 5a has shipped.

### 5a: Tools and Models-share (needs prerequisite 1 only)

Once span-focus lands, these need **no** group-by, because a `categorical/single` spec
already returns per-value frequencies:

- Tools horizontal-bar card: `categorical/single` on `span_name` (+ `status_code` for error
  rate), `focus = "span"`.
- Models horizontal-bar card with a click-to-filter legend: `categorical/single` on
  `attributes.ag.meta.request.model`, `focus = "span"`.
- Models multi-select in the Filters popover.

### 5b: per-model cost/tokens (needs prerequisites 1 and 2)

Adds the numeric-by-model breakdown once the group-by dimension exists, using the
`incremental` cost/token paths under `focus = "span"`.

### Frontend seam to leave now

The request builder in Phase 2 takes `focus` and an arbitrary `specs` list without reshaping,
and the page grid can accept two more chart cards. 5a and 5b add queries and cards without
touching the four existing charts.

Recommendation for the boundary: ship Phase 1 to 4 as a four-chart grid. Do not mount empty
Tools and Models cards in this release; a visible "coming soon" card ages badly. Land the
chart-card component as a reusable shell so Phase 5 only supplies data and series config.

## Testing and verification

- Follow `docs/designs/testing/README.md`. Add unit tests for the new mapper (pure
  function: buckets in, dashboard shape out) and for the health-score computation. These need
  no live database.
- Verify the four charts against one live project by running the local stack per the root
  `AGENTS.md` local dev loop.
- Run `pnpm lint-fix` in `web` before committing. Do not commit during the planning phase.

## Risks and unknowns to resolve during the build

- Live-response validation of the metric shape: the nested `pcts.p95` reads correctly and the
  prompt/completion split is non-zero on real traffic (resolve in Phase 2). The `type` strings
  and the `pcts.p95` nesting are already verified in the backend code.
- The correct agents-list atom for the filter options (resolve in Phase 1).
- Whether the multi-agent reference filter uses `or` grouping or a single `in` with multiple
  values in this dialect (resolve in Phase 2 against the existing filter builder).
- Whether the runner marks a failed run's root span `status_code = ERROR`. The failed-run
  count and the health score depend on it; validate on live traffic in Phase 2.
- The run-count floor for the neutral health state (tune in Phase 4; start around 20).
