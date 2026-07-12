# Status

**State:** design ready for review

**Date:** 2026-07-12

## Completed

- Traced Pi, Claude ACP, runner, Python service, OTLP ingestion, cost calculation, tree rollup,
  storage/query, observability UI, tests, and public docs.
- Confirmed the first information loss occurs in the pre-production runner usage contract.
- Confirmed ACP context occupancy is currently conflated with billed token totals.
- Confirmed existing Agenta OTLP attributes can transport direct monetary metrics, but API cost
  calculation overwrites them.
- Confirmed cache/reasoning subcategories need inclusive-parent semantics and explicit rollup rules.
- Defined a runner-first implementation sequence and a separate approval-gated API semconv phase.

## Proposed decisions

1. Runner work comes first. The canonical result separates usage, cost, provenance, and context.
2. Input/output totals follow current OTel GenAI inclusive semantics. Cache and reasoning are
   subcategories.
3. ACP `used/size` is context utilization only.
4. Reported provider cost outranks harness-calculated cost; the runner does not estimate.
5. Incremental billable usage has one span owner. Parent totals are derived or explicitly marked
   summaries.
6. Monetary cost uses a documented Agenta extension because OTel has no standard GenAI cost
   attribute.
7. Public semantic-convention, cost-tracking, and API tracing docs change with the stable API
   implementation.

## Approval gates

- Runner and service owners: approve the pre-production wire shape and normalization rules before
  phases 1 through 3. Phase 4 only prepares projection fixtures and the approval packet.
- CTO: approve exported span attribution, cross-batch summaries, service-to-API semantic
  convention, ingestion precedence, rollup, and public docs before phase 5.

## Open decisions for review

1. Which cross-batch parent-summary strategy should replace repeated incremental usage?
2. Can runner and service versions skew during deployment, requiring temporary parsing of the old
   flat usage shape?
3. Should the first Vercel projection expose cache details or only inclusive input/output/total?
4. Should API rollups be generic over numeric metric keys or governed by a versioned bucket schema?
5. Should the first UI change label only reported versus estimated total, or also expose cache and
   reasoning breakdowns?

## Next action

Review `interface-design.md`, especially token inclusivity, cost provenance, span attribution, and
the approval-gated Agenta semantic-convention proposal. No implementation starts until the design
PR is approved.
