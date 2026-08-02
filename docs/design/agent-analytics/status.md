# Status

Source of truth for progress. Update as work lands.

## Current state

Phases 1–4 implemented (frontend-first scope). Typecheck clean, `pnpm lint-fix` clean, and
the mapper + health-score unit tests pass (9 tests). Not yet verified against a live stack;
Phase 5 (Tools/Models) remains deferred behind the backend prerequisites.

### Landed files

- Route + nav: `web/oss/src/pages/w/[workspace_id]/p/[project_id]/analytics/index.tsx`
  **plus the EE mirror** `web/ee/src/pages/.../analytics/index.tsx` (EE's Pages Router
  re-exports each OSS page; without the mirror the route 404s in EE builds);
  `app-analytics-link` entry in `Sidebar/hooks/useSidebarConfig/index.tsx`.
- Data layer: `specs` added to `SpansAnalyticsParams`/`fetchSpansAnalytics`
  (`web/packages/agenta-entities/src/trace/api/api.ts`); new mapper + health-score
  (`web/oss/src/services/tracing/lib/agentAnalytics.ts`, with `metricField`/`metricPct`
  exported from `helpers.ts`); fetch fn
  (`web/oss/src/services/tracing/api/agentAnalytics.ts`); types
  (`web/oss/src/services/tracing/types/agentAnalytics.ts`).
- State: `web/oss/src/state/analytics/dashboard.ts` (time-range, agents-filter, query atoms).
- UI: `web/oss/src/components/pages/analytics/` (page, header controls, summary panel with
  health donut + 4 stat tiles, and the four charts via a reusable `ChartCard` shell).
- Tests: `web/oss/src/services/tracing/lib/agentAnalytics.test.ts`.

### Still to verify on a live stack (Phase 2 open questions)

- Nested `pcts.p95` reads correctly and the prompt/completion split is non-zero on real
  traffic.
- The runner marks a failed run's root span `status_code = ERROR`.
- The multi-agent `references in [...]` encoding returns the expected narrowed set.
- Tune the `HEALTH_RUN_FLOOR` (currently 20) against real volume.

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
   Model — all server-side conditions on root-span fields, so all three filter today with no
   backend change. The configured-Model filter narrows by the author's alias, not the model that
   answered (that is the deferred resolved-Model view).
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
- Multi-agent reference filter encoding: a single `in` with all ids, or one condition per
  agent combined with `or` (Phase 2, against the existing filter builder).
- Whether the runner marks a failed run's root span `status_code = STATUS_CODE_ERROR`. The
  failed-run count depends on it; validate on live traffic (Phase 2).
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
