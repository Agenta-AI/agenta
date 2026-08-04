# Status

Source of truth for progress. Update as work lands.

## Current state

v1 is implemented on `feat/agents-analytics-dashboard` and remediated to match these docs: the
health donut, summary panel, stat tiles, success-rate, and previous-window comparison were
removed; breakdown charts, the Harness/configured-Model filters, coverage gating, four card
states, the latency **line** chart, the cost **area** chart, and the house colour palette were
added. Two backend blockers (B1, B2) and one filter bug remain before v1 is done — see
scope.md's "Remaining v1 work". Not yet verified against a live stack.

### Done / not done (v1)

- ✅ Page shell + route (OSS + EE mirror) + sidebar; data layer (`specs` + fetch + mapper);
  Runs, Latency, Cost, Tokens charts; three breakdown charts; time-range control; four card
  states; coverage gating for cost and the token split.
- ✅ Agents filter (`references`).
- ⚠️ **Harness and configured-Model filters do not work.** They send the dotted attribute path
  as the condition `field`; the backend drops any unknown `field` with only a `log.warning`
  (`filtering.py`), so nothing narrows and no error surfaces. Fix: `{field: "attributes",
  key: "ag.data.parameters.agent.harness.kind", ...}`, plus a `key` field on the client
  `FilterCondition`.
- ⏳ **B1** (failure visibility) and **B2** (coverage-collapse investigation) — backend, not done.

### Landed files

- Route + nav: `web/oss/src/pages/w/[workspace_id]/p/[project_id]/analytics/index.tsx`
  **plus the EE mirror** `web/ee/src/pages/.../analytics/index.tsx` (EE's Pages Router
  re-exports each OSS page; without the mirror the route 404s in EE builds);
  `app-analytics-link` entry in `Sidebar/hooks/useSidebarConfig/index.tsx`.
- Data layer: `specs` added to `SpansAnalyticsParams`/`fetchSpansAnalytics`
  (`web/packages/agenta-entities/src/trace/api/api.ts`); mapper + breakdown reducer + coverage
  helper (`web/oss/src/services/tracing/lib/agentAnalytics.ts`, with `metricField`/`metricPct`
  exported from `helpers.ts`); fetch fn issuing three calls — unfiltered, status-filtered, and
  breakdown (`web/oss/src/services/tracing/api/agentAnalytics.ts`); types
  (`web/oss/src/services/tracing/types/agentAnalytics.ts`).
- State: `web/oss/src/state/analytics/dashboard.ts` (time-range, agents / harness / models
  filter atoms, query atom).
- UI: `web/oss/src/components/pages/analytics/` — page, header controls (three filters), the
  four charts (StackedBarChart, LatencyChart line, CostAreaChart) and three BreakdownBarChart
  cards, all via a reusable `ChartCard` shell with the four states.
- Tests: `web/oss/src/services/tracing/lib/agentAnalytics.test.ts`.

### Still to verify on a live stack

- Nested `pcts.p95` reads correctly and the prompt/completion split is non-zero on real
  traffic.
- The runner marks a failed run's root span `status_code = STATUS_CODE_ERROR`.
- The Agents `references in [...]` filter, and (once fixed) the Harness/Model attribute
  filters, narrow rather than returning an empty 200.
- Real cost / token-split coverage against the `COVERAGE_THRESHOLD` (currently 0.5).

## Locked decisions

1. Frontend-first scope, with two backend prerequisites (Phase 0 in plan.md). Charts: Runs,
   Latency, Cost (coverage-gated total), Tokens (coverage-gated split), and runs per harness /
   configured model / agent. No Costs prompt/completion split chart; `gen_ai.usage.cost` is a
   total only. Plus the Agents / Harness / configured-Model filters and the time-range control;
   harness and configured model are both breakdown charts and filters (decision 3). The two
   Phase 0 items: make a killed or rejected query distinguishable from an empty one, and
   investigate the cost / token-split coverage collapse.
2. A net-new page at project scope, named Analytics. The default query aggregates every project
   agent; the Agents filter narrows the set.
3. An **agent** is an application/workflow artifact. The Agents multi-select lists the project's
   agents and narrows by `references`. v1 has three filters — Agents, Harness, and configured
   Model — all server-side conditions on root-span fields, so all three *can* filter with no
   backend change. Agents works; Harness and configured Model are currently sent with the wrong
   condition shape and are silently dropped (see "Remaining v1 work" in scope.md). The
   configured-Model filter narrows by the author's alias, not the model that answered (that is
   the deferred resolved-Model view).
4. One agent invocation is a **run**. The Observability dashboard calls the same metric a
   "request"; the two may diverge until Observability is aligned in a later, separate change.
5. A **failed run** is a run whose root span `status_code` is `STATUS_CODE_ERROR` — a run-level
   outcome, not a count of errored steps. There is no `STATUS_CODE_OK`, so success is the
   complement. It comes from a second, status-filtered query, not a metric spec. The Runs chart's
   successful-and-failed split builds on it.
6. The time-range control opens on the **last 7 days** and accepts any window through the
   observability `Sort` control and `SortResult`.
7. The deferred **Tools** and **Models** views ship in no form this release, not even as
   placeholders. The chart-card shell is built reusably, so they drop in later.

## Key finding from research

The data path from the analytics endpoint to a mapped dashboard shape already exists for the
Observability page (`fetchSpansAnalytics`, `analyticsToGeneration`, the observability dashboard
atoms). This feature reuses that spine. The data-layer work: pass explicit metric specs for the
total cost (`gen_ai.usage.cost`) and the token split, read the duration min/max/p95 the current
mapper drops, read the category `freq` breakdowns, and add the status-filtered failed-run query.
The endpoint returns the latency, run-count, and breakdown fields directly. Cost and the token
split stay coverage-gated, because their populated paths collapsed in mid-July — which is why
the scope carries two backend prerequisites (Phase 0) rather than none.

## Resolved by code verification

- **Spec `type` strings**: every number metric is `numeric/continuous`. `MetricType` has no bare
  `numeric`, and `DEFAULT_ANALYTICS_SPECS` confirms it.
- **p95 field**: nested at `metrics[path].pcts.p95`, not a flat field. `metricField` does not
  reach it, so the mapper needs a small `pcts` accessor.
- **`specs` plumbing**: the Fern `QuerySpansAnalyticsRequest` type already carries `specs?: string`
  and forwards it, so passing specs is a small entities-layer change.
- **Failed-run mechanism**: `status_code` is a table column, and metric specs read the
  `attributes` JSON only (`build_extract_cte`), so no spec can target it. Failed runs come from a
  second query with a `{field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"}` filter
  (`status_code` is a first-class filter field; the operator must be `is` and the value the full
  enum literal, or the backend returns an empty 200). Per the selected window the page issues two
  bucketed queries — one unfiltered for the charts, one status-filtered for failed runs — and
  every chart reads them per bucket. See data-contract.md.

## Open questions to resolve during the build

- ~~Agents-list atom for the filter options (Phase 1).~~ **Resolved:** use
  `agentsWorkflowsAtom` from `web/oss/src/components/pages/agents/store.ts`. It returns
  `AppWorkflowRow[]` (`{workflowId, name, ...}`); the `workflowId` is the `references` id
  the analytics filter narrows by.
- ~~Multi-agent reference filter encoding.~~ **Resolved in code:** a single `references in [{id}, …]`
  condition. Confirm it narrows on live traffic.
- Whether the runner marks a failed run's root span `status_code = STATUS_CODE_ERROR`. The
  failed-run count depends on it; validate on live traffic.
- Live-response validation: the `trace_type` and `status_code` filters narrow rather than
  returning an empty 200, the nested `pcts.p95` reads correctly, and the cost / token-split
  coverage on real traffic (Phase 2; it may be near zero — the Phase 0 investigation).

## Deferred to a later backend change

The Tools chart, the Models chart, the Models filter, and per-model cost. They split into two
sub-phases, because the two deferred-view enablers (span-focus wiring and a group-by dimension —
distinct from the two Phase 0 blockers) are not co-equal gates:

- **5a, Tools and Models-share**: needs span-focus wiring only (thread `focus` into
  `build_base_cte`, make `WHERE parent_id IS NULL` conditional). No group-by, because a
  `categorical/single` spec already returns per-value frequencies. Ship a guard: under
  `focus = "span"`, cumulative metrics double-count, so cost/tokens must use the `incremental`
  paths.
- **5b, per-model cost/tokens**: additionally needs a group-by dimension. Harder; defer until 5a
  ships.

Open design decision for 5b: group-by as a per-query dimension (preferred) versus a per-spec
`group_by` field. Phase 5 in plan.md; not scheduled here.

## Source materials

- Decoded reference implementation: the artifact was unpacked to plain source. The page logic
  (data model, charts, KPIs) is the `Component` class; the layout is the `x-dc` template.
  Original artifact:
  `https://claude.ai/code/artifact/75b4f14e-9c9b-407b-9d35-317927fb6772`.
- Backend capability notes: `docs/design/agent-analytics/Note.md`.
- Endpoint architecture review (the source of the root-span-only and dead-`focus` findings): a
  read-only review generated 2026-08-01. Its conclusions live in context.md and data-contract.md,
  so the workspace does not depend on the review file.
