# Status

Source of truth for progress. Update as work lands.

## Current state

Planning complete. No code written. The workspace holds the plan; implementation has not
started and no branch exists yet.

## Locked decisions

1. Frontend-first scope: four charts, four stat tiles, health donut, Agents filter,
   time-range control. No `api/` change in this plan.
2. Health donut computed in the browser (0.72 x success rate + 0.28 x latency score).
3. New page at project scope named Analytics; the default query aggregates all project
   agents.

## Key finding from research

The data path from the analytics endpoint to a mapped dashboard shape already exists for the
Observability page (`fetchSpansAnalytics`, `analyticsToGeneration`, the observability
dashboard atoms). This feature reuses that spine. The only data-layer gaps for the in-scope
charts are: pass explicit metric specs to get the prompt-and-completion split, and read the
duration min, max, and p95 fields the current mapper drops. The endpoint already returns all
of these, so the frontend-first scope needs no backend change.

## Resolved by the 2026-08-02 code verification pass

- **Spec `type` strings**: every number metric is `numeric/continuous` (there is no bare
  `numeric` in `MetricType`; the backend defaults confirm it). data-contract.md corrected.
- **p95 field**: nested at `metrics[path].pcts.p95`, not a flat field; `metricField` does not
  reach it. data-contract.md and research.md updated with the nested-accessor requirement.
- **`specs` plumbing**: the Fern `QuerySpansAnalyticsRequest` type already carries
  `specs?: string`, and the backend parses it from the query param, so passing specs is a
  two-line entities-layer change, not new plumbing.

## Open questions to resolve during the build

- Agents-list atom for the filter options (Phase 1).
- Multi-agent reference filter grouping in the filter dialect (Phase 2).
- The two latency-score constants that set where "fast" and "slow" fall (Phase 4).
- Data-quality check (Phase 2): confirm the prompt/completion cost and token split is
  non-zero on live traffic, and that `errors.cumulative` sum reads as "errors" not "failed
  runs" in the UI copy.

## Deferred to a later backend change

Tools chart, Models chart, Models filter, per-model cost. Split into two sub-phases because
the two backend prerequisites are not co-equal gates (verified against the engine 2026-08-02):

- **5a, Tools and Models-share**: needs only span-focus wiring (thread `focus` into
  `build_base_cte`, make `WHERE parent_id IS NULL` conditional). No group-by needed, because a
  `categorical/single` spec already returns per-value frequencies. Ship a guard: under
  `focus = "span"`, cumulative metrics double-count, so cost/tokens must use `incremental`
  paths.
- **5b, per-model cost/tokens**: additionally needs a group-by dimension. Harder; defer
  until 5a ships.

Open design decision for 5b: group-by as a **per-query dimension** (preferred) vs a per-spec
`group_by` field. Phase 5 in plan.md; not scheduled here.

## Source materials

- Decoded mockup: the artifact was unpacked to plain source. The page logic (data model,
  charts, KPIs, health score) is the `Component` class; the layout is the `x-dc` template.
  Original artifact:
  `https://claude.ai/code/artifact/75b4f14e-9c9b-407b-9d35-317927fb6772`.
- Backend capability notes: `docs/design/agent-analytics/Note.md`.
- Endpoint architecture review (the source of the root-span-only and dead-`focus` findings):
  a read-only review generated 2026-08-01; its conclusions are captured in context.md and
  data-contract.md, so the workspace does not depend on the review file.
