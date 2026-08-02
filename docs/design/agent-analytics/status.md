# Status

Source of truth for progress. Update as work lands.

## Current state

Planning complete, and a grilling session on 2026-08-02 sharpened the design. No code written.
The workspace holds the plan; implementation has not started and no branch exists yet.

## Locked decisions

1. Frontend-first scope: four charts (Runs, Latency, Costs, Tokens), four stat tiles, health
   donut, Agents filter, time-range control. No `api/` change in this plan.
2. New page at project scope named Analytics; the default query aggregates all project agents,
   and the Agents filter narrows the set.
3. An **agent** is an application/workflow artifact. The Agents filter lists the project's
   agents and narrows by `references`; no variant or environment granularity in v1.
4. The count of agent invocations is called a **run**. The Observability dashboard calls the
   same metric a "request"; the two are allowed to diverge until Observability is aligned in a
   later, separate change.
5. A **failed run** is a run whose root span `status_code` is `ERROR` (a run-level outcome,
   not a count of errored steps). It comes from a second, status-filtered analytics query, not
   a metric spec.
6. The **health score** is the success rate: `round(100 x successRate)`, banded Healthy 85+,
   Watch 65 to 84, At risk below 65. Latency was dropped from it. Below a run-count floor the
   donut shows a neutral "Not enough runs yet" state instead of a band.
7. The time-range control opens on the **last 7 days** and accepts any window via the
   observability `Sort` control and `SortResult`.
8. The deferred **Tools** and **Models** views are omitted entirely in this release, not shown
   as placeholders. The chart-card shell is built reusably so they drop in later.

## Key finding from research

The data path from the analytics endpoint to a mapped dashboard shape already exists for the
Observability page (`fetchSpansAnalytics`, `analyticsToGeneration`, the observability dashboard
atoms). This feature reuses that spine. The data-layer work is: pass explicit metric specs for
the prompt/completion split, read the duration min/max/p95 the current mapper drops, and add
the status-filtered failed-run query. The endpoint returns all of these, so the frontend-first
scope needs no backend change.

## Resolved by code verification

- **Spec `type` strings**: every number metric is `numeric/continuous` (there is no bare
  `numeric` in `MetricType`; `DEFAULT_ANALYTICS_SPECS` confirms it).
- **p95 field**: nested at `metrics[path].pcts.p95`, not a flat field; `metricField` does not
  reach it, so the mapper needs a small `pcts` accessor.
- **`specs` plumbing**: the Fern `QuerySpansAnalyticsRequest` type already carries
  `specs?: string` and forwards it, so passing specs is a small entities-layer change.
- **Failed-run mechanism**: `status_code` is a table column and metric specs read only the
  `attributes` JSON (`build_extract_cte`), so a spec cannot target it. Failed runs come from a
  second query with a `status_code = ERROR` filter (`status_code` is a first-class filter
  field). Four analytics calls total: unfiltered and status-filtered, for the current and the
  previous window.

## Open questions to resolve during the build

- Agents-list atom for the filter options (Phase 1).
- Multi-agent reference filter encoding: a single `in` with all ids, or one condition per
  agent combined with `or` (Phase 2, against the existing filter builder).
- Whether the runner marks a failed run's root span `status_code = ERROR`. The failed-run
  count and health score depend on it; validate on live traffic (Phase 2).
- Live-response validation: the nested `pcts.p95` reads correctly and the prompt/completion
  split is non-zero on real traffic (Phase 2).
- The run-count floor for the neutral health state (Phase 4; start around 20).

## Deferred to a later backend change

Tools chart, Models chart, Models filter, per-model cost. Split into two sub-phases because
the two backend prerequisites are not co-equal gates:

- **5a, Tools and Models-share**: needs only span-focus wiring (thread `focus` into
  `build_base_cte`, make `WHERE parent_id IS NULL` conditional). No group-by needed, because a
  `categorical/single` spec already returns per-value frequencies. Ship a guard: under
  `focus = "span"`, cumulative metrics double-count, so cost/tokens must use `incremental`
  paths.
- **5b, per-model cost/tokens**: additionally needs a group-by dimension. Harder; defer
  until 5a ships.

Open design decision for 5b: group-by as a per-query dimension (preferred) vs a per-spec
`group_by` field. Phase 5 in plan.md; not scheduled here.

## Source materials

- Decoded reference implementation: the artifact was unpacked to plain source. The page logic
  (data model, charts, KPIs) is the `Component` class; the layout is the `x-dc` template.
  Original artifact:
  `https://claude.ai/code/artifact/75b4f14e-9c9b-407b-9d35-317927fb6772`.
- Backend capability notes: `docs/design/agent-analytics/Note.md`.
- Endpoint architecture review (the source of the root-span-only and dead-`focus` findings): a
  read-only review generated 2026-08-01; its conclusions are captured in context.md and
  data-contract.md, so the workspace does not depend on the review file.
