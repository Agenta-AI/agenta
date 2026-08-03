# Research: what this feature reuses

Every path below was read directly. The takeaway: the data path from endpoint to dashboard
already exists for the Observability page. This feature adds a new page on top of that
spine and reads a few response fields the current mapper drops.

## The analytics fetch layer (reuse, extend by one field)

`web/packages/agenta-entities/src/trace/api/api.ts`

- `fetchSpansAnalytics(params)` calls `POST /spans/analytics/query` through the Fern client
  (`getTracesClient().querySpansAnalytics`) and validates the response with
  `analyticsResponseSchema`. Returns `null` on a non-2xx response or a shape mismatch.
- `SpansAnalyticsParams` today: `projectId`, `appId`, `focus` (default `trace`), `interval`
  (bucket minutes), `oldest` / `newest` (ISO bounds), `filter` (a `{conditions: [...]}`
  object, serialized to a JSON-string query param), `abortSignal`.
- It intentionally omits `specs`, so the backend applies its default set. To get the prompt
  and completion split this page needs, add an optional `specs` field to
  `SpansAnalyticsParams` and pass it through as a JSON-string query param, the same way
  `filter` is passed. The endpoint already accepts `specs`; this is a frontend-only change.

## The response-to-dashboard mapper (reuse pattern, new mapper for richer fields)

`web/oss/src/services/tracing/lib/helpers.ts`

- `analyticsToGeneration(analytics, range)` reduces the bucket list into
  `GenerationDashboardData`. It reads these dotted metric paths, which match the backend's
  default specs:
  - `attributes.ag.metrics.costs.cumulative.total` (field `sum`)
  - `attributes.ag.metrics.tokens.cumulative.total` (field `sum`)
  - `attributes.ag.metrics.duration.cumulative` (fields `sum`, `count`)
  - `attributes.ag.metrics.errors.cumulative` (field `sum`)
  - `attributes.ag.type.trace` (field `count`)
- It derives run count from the `ag.type.trace` count, failures from the errors sum, success
  as `total - failures`, and average latency as `durationSum / durationCount` in
  milliseconds.
- `metricField(metrics, path, field)` is the safe reader for one **flat** numeric field
  (`count`, `sum`, `min`, `max`). Reuse it for those. It reads one level deep, so it does
  **not** reach percentiles; p95 lives at `metrics[path].pcts.p95`, one level further down.
  Add a small nested accessor (or extend `metricField` with a two-key form) for the p95 read;
  do not assume p95 is a flat sibling of `sum`.
- What it does not read, and this page needs:
  - `gen_ai.usage.cost` (field `sum`, plus `count` for the coverage gate) for a coverage-gated
    total-cost tile. The canonical `costs.cumulative.*` paths hold no data on agent root spans,
    so there is no prompt/completion cost split to read; see data-contract.md.
  - `tokens.cumulative.prompt` and `tokens.cumulative.completion` for the Tokens split, which
    is coverage-gated because it shares the cost field's mid-July coverage collapse.
  - `duration.cumulative` flat fields `min`, `max`, and the nested `pcts.p95` percentile for
    the Latency tooltip and marker.
  - Category `freq` arrays on `ag.data.parameters.agent.harness.kind`,
    `ag.data.parameters.agent.llm.model`, and the agent `references` paths for the breakdown
    charts.
- This page does not reuse the existing mapper's `errors.cumulative`-based failure count. A
  failed run is a run whose root span status is `STATUS_CODE_ERROR` (there is no
  `STATUS_CODE_OK` on root spans; success is the complement), which a metric spec cannot read,
  so the page gets the failed-run count from a separate status-filtered query. See
  data-contract.md.
- `calculateIntervalFromDuration(durationMinutes)` picks a bucket size that keeps the bar
  count reasonable and stays under the backend's ~1024-bucket limit. Reuse it directly for
  the time-range-to-interval mapping.

`web/oss/src/services/tracing/api/index.ts`

- `fetchGenerationsDashboardData(appId, options)` builds the `conditions` array (it pushes a
  `references in [{id: appId}]` condition when an app id is present), computes the interval,
  and calls `fetchSpansAnalytics({focus: "trace", ...})`. This is the template for the new
  page's fetch function. For project scope, omit the single-app reference condition and add
  reference conditions only for the agents the user selects in the filter, plus the base
  `trace_type is invocation` condition on every query. The new page also issues a second query
  per window with a `{field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"}` filter
  to count failed runs.

## The dashboard state atoms (reuse pattern, new atoms for this page)

`web/oss/src/state/observability/dashboard.ts`

- `observabilityDashboardQueryAtom` is an `atomWithQuery` keyed on app id, project id, and
  the time-range atom; it calls `fetchGenerationsDashboardData` with a `staleTime` of one
  minute and `refetchOnWindowFocus: false`.
- `observabilityDashboardTimeRangeAtom` holds the selected range as a `SortResult`.
- `useObservabilityDashboard()` unwraps loading and fetching flags.
- The new page follows this exact shape with its own atoms: a time-range atom, an
  agents-filter atom, a main query atom for the current window, and a second query atom (or
  a widened single query) for the previous window that the change badges compare against.

## Existing dashboard UI (reference, not reused directly)

`web/oss/src/components/pages/observability/dashboard/`

- `AnalyticsDashboard.tsx` renders `WidgetCard`s and `CustomAreaChart`s from the mapped
  data, with a `Sort` time-range selector and antd `Spin` for loading.
- `CustomAreaChart.tsx` wraps recharts area charts.
- These render **area** charts with total figures. This page needs **stacked bar** charts, a
  **horizontal bar** chart (for the deferred Tools view), sparklines, and a donut, so it
  brings its own chart components rather than bending the area chart. It still follows the
  same card-plus-chart composition and the same loading and empty-state conventions.

## Charting library

`web/oss/package.json` depends on **recharts `^3.1.0`**. Existing recharts usage to copy
style and theming from:

- `web/oss/src/components/pages/observability/dashboard/CustomAreaChart.tsx`
- `web/oss/src/components/EvalRunDetails/components/EvaluatorMetricsChart/BarChart.tsx`
- `web/oss/src/components/EvalRunDetails/components/EvaluatorMetricsChart/HistogramChart.tsx`

Build the page's charts with recharts (`BarChart` stacked and horizontal, `LineChart` or
`AreaChart` for sparklines, `RadialBarChart` or a small SVG ring for the donut). Do not port
the reference implementation's hand-rolled SVG chart code; it hardcodes hex colors and
duplicates what recharts gives.

## Routing and sidebar

- Pages live under `web/oss/src/pages/w/[workspace_id]/p/[project_id]/`. Existing folders:
  `observability`, `evaluations`, `annotations`, `apps`, `settings`, and others. The
  observability page file is a thin wrapper:

  ```tsx
  import ObservabilityTabs from "@/oss/components/pages/observability"
  const GlobalObservability = () => <ObservabilityTabs />
  export default () => <GlobalObservability />
  ```

  Add `analytics/index.tsx` as the same kind of thin wrapper around a new
  `components/pages/analytics` module.

- The sidebar project items are defined in
  `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx`. The Observability entry
  is the shape to copy:

  ```tsx
  {
      key: "app-observability-link",
      title: "Observability",
      link: `${projectURL}/observability`,
      icon: <ChartLineUpIcon size={14} />,
      disabled: !hasProjectURL,
  }
  ```

  Add an `Analytics` entry with its own key, a `${projectURL}/analytics` link, and an icon
  from `@phosphor-icons/react`.

## The agents list for the filter

The Agents multi-select needs the project's agents as options. The filter narrows the query
by pushing `references in [{id: <agentId>}]` conditions (the same field the observability
fetch uses for a single app). Source the option list from the existing apps or workflows
state rather than a new endpoint. Confirm the exact atom during Phase 1; candidates are the
app-management or workflow molecule selectors already used by the sidebar's agent switcher.

## Conventions that constrain the build

From `web/AGENTS.md`:

- All new API calls go through the Fern client and the per-resource accessors in
  `@agenta/sdk/resources`. Keep zod validation at the boundary with `safeParseWithLogging`.
- Data fetching uses Jotai `atomWithQuery`; never `useEffect` with manual state. Put every
  reactive dependency in the `queryKey`; set a sensible `staleTime`.
- Exactly one project is ever in scope. Do not write multi-project-defensive code.
- Styling is Tailwind utility classes plus antd semantic tokens (`bg-colorBgContainer`,
  `text-colorText`, and the `--ag-color*` variables). No raw hex, no inline `style`, no
  CSS-in-JS except for antd overrides Tailwind cannot express. Implement and verify both
  light and dark themes. The reference palette maps onto these tokens; series colors come
  from the theme scale, not from literals.
- Keep in-code comments to one line.
