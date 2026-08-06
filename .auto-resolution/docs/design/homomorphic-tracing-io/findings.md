# Findings: Tracing Query/Ingest Round-Trip Failures

> Branch: `fix-non-homomorphic-ingest-and-query-in-tracing`
> Synced on: `2026-04-22`
> Skill workflow: `sync-findings`
> Effective path: `docs/design/homomorphic-tracing-io`

## Sources

- GitHub issue `#4172`: `https://github.com/Agenta-AI/agenta/issues/4172`
- GitHub issue `#4173`: `https://github.com/Agenta-AI/agenta/issues/4173`
- Linear linkbacks:
  - `AGE-3734`: tracing query/ingest schema asymmetry on `ag.metrics.duration.cumulative`
  - `AGE-3735`: tracing ingest validation errors drop whole batch
- Local implementation:
  - `api/oss/src/core/tracing/utils/parsing.py`
  - `api/oss/src/core/tracing/utils/attributes.py`
  - `sdk/agenta/sdk/models/tracing.py`
  - `api/oss/tests/pytest/unit/tracing/utils/test_parsing.py`
- Related historical context:
  - `docs/design/best-effort-ingestion/plan.md`
  - `docs/design/best-effort-ingestion/status.md`

## Sync Summary

- Created this master findings record from open GitHub issues `#4172` and `#4173`.
- Re-checked both issues against current local code on `2026-04-22`; all currently tracked findings are fixed in this branch.
- Issue `#4172` maps to duration metric shape drift: ingest writes `duration.cumulative` as a scalar, while the SDK/API tracing model currently expects a metrics dictionary.
- Issue `#4173` maps to four ingest/query loss paths: missing defensive metric containers after sanitization, `errors.incremental` shape drift, missing `errors.cumulative` for analytics, and a batch-level catch that drops every span after one parse failure.
- No GitHub review threads were resolved or replied to because the sources are issues, not PR review threads.

## Rules

- `findings.md` is the canonical synced findings record for this branch-scoped tracing fix.
- Keep non-findings context above `Open Findings`.
- Preserve GitHub issue provenance in each finding's `Sources`.
- Treat query/ingest round-trip compatibility as the primary acceptance surface.

## Notes

- The current unit test expectation in `api/oss/tests/pytest/unit/tracing/utils/test_parsing.py` still asserts scalar shapes for computed duration and event-derived error count. That is evidence that scalar duration/errors may be the intended domain shape, not necessarily the bug.
- Analytics is further evidence that scalar duration is intentional: default analytics queries `attributes.ag.metrics.duration.cumulative`, legacy analytics sums `ag.metrics.duration.cumulative`, and the semantic-conventions docs document `ag.metrics.duration.cumulative` without `.total`.
- Analytics is not consistent for errors: default analytics queries `attributes.ag.metrics.errors.cumulative`, ingest currently writes `errors.incremental`, and legacy analytics builds an `errors` bucket by filtering exception events rather than reading `ag.metrics.errors`.
- The prior best-effort ingestion work documented field-level sanitization and per-span isolation as complete, but this branch's current span ingestion path still has a batch-level catch in `parse_spans_from_request`.
- `api/oss/src/core/tracing/dtos.py` re-exports the canonical tracing models from `sdk/agenta/sdk/models/tracing.py`, so model compatibility has to be handled at the SDK model boundary or before validation.
- Generated `costs` and `tokens` currently use canonical nested metric dictionaries (`prompt`, `completion`, `total`) in the propagation helpers; the scalar generated-shape findings are specific to `duration` and `errors`.

## Decisions

- `duration` and `errors` are scalar metric entries by contract.
- `costs` and `tokens` remain keyed metric dictionaries.
- The SDK/API model should change to accept scalar `cumulative`/`incremental` values for duration and errors.
- Error counts should keep both scalar semantic levels:
  - `errors.incremental`: exception count for this span's own events.
  - `errors.cumulative`: exception count for this span plus children, produced for trace-level analytics.
- Read/query normalization should preserve existing scalar stored data for duration and errors.
- Dictionary normalization or backfill for duration/errors is not applicable under this decision.

## Open Questions

- Should the ingest response remain `202 Accepted` with only `count` and `links`, or should it optionally include structured failure counts while preserving OTel write semantics?

## Open Findings

## Closed Findings

### [CLOSED] F3. `parse_spans_from_request` drops the whole batch after one span parse failure

- ID: `F3`
- Origin: `sync`
- Lens: `mixed`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Reliability`
- Summary: `parse_spans_from_request` wraps flattening and all per-span parsing in one broad `try/except`. One bad span or one enrichment error resets `span_dtos` to `[]`, causing every valid span in the same batch to be lost while the ingest endpoint can still return `202 Accepted`.
- Evidence:
  - `api/oss/src/core/tracing/utils/parsing.py:351-362` wraps the whole loop and sets `span_dtos = []` on any exception.
  - `api/oss/tests/pytest/unit/tracing/utils/test_parsing.py:189-192` currently codifies the all-empty fallback for unexpected errors.
  - Issue `#4173` reports a customer-visible response of `{"count": 0, "links": []}` for the failed replay path.
- Files:
  - `api/oss/src/core/tracing/utils/parsing.py`
  - `api/oss/tests/pytest/unit/tracing/utils/test_parsing.py`
- Cause: Error isolation is at batch scope instead of span scope.
- Explanation: This undermines the intended OTel best-effort behavior. The endpoint accepts the write, but one invalid field or span can erase unrelated valid spans in the same payload before persistence.
- Suggested Fix:
  - Split flattening failures from per-span parse failures.
  - Wrap `_parse_span_from_request(span)` per span, append successful parses, and log enough structured context for failed spans.
  - Return dropped span links in `dropped` while keeping successful span links in `links`.
  - Count both successful and dropped links in the response `count`.
  - Update tests so a mixed batch persists valid spans and drops or quarantines only the failing span.
  - Consider tracking failure counts internally, even if response shape remains backward-compatible.
- Alternatives:
  - Return a hard validation error for the whole batch, but that conflicts with the documented best-effort OTel ingest semantics.
- Sources:
  - GitHub issue `#4173`
  - Linear `AGE-3735`

### [CLOSED] F1. Duration metric shape contract is inconsistent between ingest/query and validation

- ID: `F1`
- Origin: `sync`
- Lens: `mixed`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Compatibility`
- Summary: The tracing ingest parser computes duration from `start_time`/`end_time` and stores `ag.metrics.duration.cumulative` as a scalar number, while the SDK/API tracing model currently defines `cumulative` as a metrics dictionary. The failure is the non-homomorphic contract: query output can include a scalar shape that ingest validation rejects on replay.
- Evidence:
  - `api/oss/src/core/tracing/utils/parsing.py:285-290` assigns `ag["metrics"]["duration"] = {"cumulative": duration_ms}`.
  - `sdk/agenta/sdk/models/tracing.py:44-46` declares `AgMetricEntryAttributes.cumulative: Optional[Metrics]`, where `Metrics` is a dictionary type.
  - `api/oss/src/core/tracing/service.py:90-94` defines the default analytics path as `attributes.ag.metrics.duration.cumulative`.
  - `api/oss/src/dbs/postgres/tracing/dao.py:569-576` legacy analytics sums `ag.metrics.duration.cumulative` as a scalar numeric value.
  - `docs/docs/observability/trace-with-opentelemetry/03-semantic-conventions.mdx:246-250` documents `ag.metrics.duration.cumulative` without a nested `.total`.
  - `api/oss/src/core/tracing/dtos.py:22-66` re-exports the SDK tracing models at the API core boundary.
  - `api/oss/tests/pytest/unit/tracing/utils/test_parsing.py:173-175` currently expects `metrics["duration"]["cumulative"] == 1000.0`.
- Files:
  - `api/oss/src/core/tracing/utils/parsing.py`
  - `sdk/agenta/sdk/models/tracing.py`
  - `api/oss/src/core/tracing/service.py`
  - `api/oss/src/dbs/postgres/tracing/dao.py`
  - `api/oss/src/core/tracing/dtos.py`
  - `api/oss/tests/pytest/unit/tracing/utils/test_parsing.py`
- Cause: The runtime/storage/query shape for duration and the Pydantic contract disagree. The scalar shape may be semantically correct for duration, but it is not accepted by the current shared model.
- Explanation: A customer round-trip flow queries traces from one Agenta instance and ingests them into another. Because query returns the stored scalar duration shape, replaying the queried span feeds a scalar into a model contract that expects a dictionary, which triggers validation/sanitization and contributes to silent data loss.
- Suggested Fix:
  - Keep `duration.cumulative` scalar.
  - Update `AgMetricEntryAttributes` or introduce precise metric DTOs so `duration.cumulative: number` validates.
  - Preserve existing scalar stored/query data; do not backfill duration to `{total: value}`.
  - Add unit and acceptance coverage so query output with scalar duration can be ingested again without rewriting metric shapes.
- Alternatives:
  - Keep one uniform dict-only metric model for every metric entry; this is consistent but may over-model naturally scalar metrics like duration and error count.
  - Normalize duration to `{total: value}` everywhere; rejected by product/architecture decision because scalar duration is canonical.
- Sources:
  - GitHub issue `#4172`
  - Linear `AGE-3734`

### [CLOSED] F2. Sanitized metrics can be missing before duration/error enrichment writes into them

- ID: `F2`
- Origin: `sync`
- Lens: `mixed`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: After `initialize_ag_attributes` sanitizes invalid `ag.metrics` data into `ag.unsupported`, `_parse_span_from_request` writes into `ag["metrics"]["duration"]` and `ag["metrics"]["errors"]` via chained indexing. If the metrics container is absent or not a dict, this raises and prevents otherwise salvageable spans from being ingested.
- Evidence:
  - `api/oss/src/core/tracing/utils/attributes.py:223-246` retries validation after moving invalid top-level fields into `unsupported` and may return a cleaned `ag` payload with invalid metrics quarantined.
  - `api/oss/src/core/tracing/utils/parsing.py:285-293` writes duration and errors via `ag["metrics"]["duration"]` and `ag["metrics"]["errors"]`.
  - Issue `#4173` reports this exact path after scalar `metrics.duration.cumulative` is sanitized from queried spans.
- Files:
  - `api/oss/src/core/tracing/utils/parsing.py`
  - `api/oss/src/core/tracing/utils/attributes.py`
- Cause: Enrichment assumes validation left a writable `ag.metrics` dict in place, but best-effort sanitization can remove or replace invalid metric content.
- Explanation: The best-effort ingest contract is to preserve valid span data and quarantine unsupported fields. Chained indexing after sanitization turns that recovery path into a hard parse error.
- Suggested Fix:
  - Use defensive container creation before enrichment, for example `metrics = ag.setdefault("metrics", {})` followed by per-entry `setdefault`.
  - Preserve sanitized invalid metric content under `ag.unsupported.metrics` while writing computed `duration` and `errors` into a valid `ag.metrics` container.
  - Add unit coverage for scalar `duration.cumulative` input plus start/end time enrichment.
- Alternatives:
  - Skip duration/error enrichment when metrics were sanitized, but that loses valid derived fields unnecessarily.
- Sources:
  - GitHub issue `#4173`
  - Linear `AGE-3735`
  - GitHub issue `#4172` as the companion source that creates the invalid scalar shape

### [CLOSED] F4. Error-count metric shape contract is inconsistent between ingest/query and validation

- ID: `F4`
- Origin: `sync`
- Lens: `mixed`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Compatibility`
- Summary: The tracing ingest parser derives an exception count from span events and stores `ag.metrics.errors.incremental` as a scalar integer, while the SDK/API tracing model currently defines `incremental` as a metrics dictionary. This is the same non-homomorphic metric-entry contract mismatch as duration, on the errors path.
- Evidence:
  - `api/oss/src/core/tracing/utils/parsing.py:292-297` assigns `ag["metrics"]["errors"] = {"incremental": 0}` and increments that scalar for exception events.
  - `sdk/agenta/sdk/models/tracing.py:44-46` declares `AgMetricEntryAttributes.incremental: Optional[Metrics]`, where `Metrics` is a dictionary type.
  - `api/oss/tests/pytest/unit/tracing/utils/test_parsing.py:173-175` currently expects `metrics["errors"]["incremental"] == 1`.
  - `api/oss/src/core/tracing/service.py:90-94` currently defines the default analytics path for errors as `attributes.ag.metrics.errors.cumulative`, unlike costs/tokens which point to `.cumulative.total`.
  - `api/oss/src/dbs/postgres/tracing/dao.py:656-673` legacy analytics does not read `ag.metrics.errors`; it builds the `errors` bucket by adding an exception-event filter to the query.
  - `api/oss/src/dbs/postgres/tracing/utils.py:1100-1182` new analytics extracts exactly the requested JSON path and only includes it in numeric/continuous stats when that JSON value is a number.
- Files:
  - `api/oss/src/core/tracing/utils/parsing.py`
  - `sdk/agenta/sdk/models/tracing.py`
  - `api/oss/src/core/tracing/service.py`
  - `api/oss/src/dbs/postgres/tracing/dao.py`
  - `api/oss/src/dbs/postgres/tracing/utils.py`
  - `api/oss/tests/pytest/unit/tracing/utils/test_parsing.py`
- Cause: The runtime/storage/query shape for event-derived error count and the Pydantic contract disagree. A scalar count may be semantically correct for errors, but it is not accepted by the current shared metric-entry model.
- Explanation: `AgMetricEntryAttributes` applies the same dict-valued `cumulative`/`incremental` contract to `duration`, `errors`, `tokens`, and `costs`. `costs` and `tokens` naturally need keyed values such as `prompt`, `completion`, and `total`; `errors` is a simple count and currently uses a scalar incremental shape. The bug is that query, ingest validation, and analytics do not share one accepted errors contract.
- Suggested Fix:
  - Keep `errors.incremental` scalar for event-derived per-span error count.
  - Update `AgMetricEntryAttributes` or introduce precise metric DTOs so scalar `errors.incremental` validates.
  - Produce scalar `errors.cumulative` for trace-level analytics, since default analytics currently requests `attributes.ag.metrics.errors.cumulative`.
  - Keep `DEFAULT_ANALYTICS_SPECS` pointed at `attributes.ag.metrics.errors.cumulative` once cumulative errors are produced.
  - Preserve existing scalar stored/query data; do not backfill errors to `{total: value}`.
  - Add query-to-ingest round-trip coverage for spans with exception events.
- Alternatives:
  - Keep one uniform dict-only metric model for every metric entry; this is consistent but may over-model naturally scalar metrics like duration and error count.
  - Normalize errors to `{total: value}` everywhere; rejected by product/architecture decision because scalar errors are canonical.
- Sources:
  - GitHub issue `#4173`
  - Linear `AGE-3735`
  - GitHub issue `#4172` as the companion metric-shape issue

### [CLOSED] F5. Error analytics expects `errors.cumulative` but ingest only produces `errors.incremental`

- ID: `F5`
- Origin: `sync`
- Lens: `mixed`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Analytics`
- Summary: Event parsing records per-span exception counts as scalar `ag.metrics.errors.incremental`, but default analytics queries scalar `ag.metrics.errors.cumulative`. No current propagation helper creates cumulative error counts, so the new analytics default can miss error metrics even after scalar errors are accepted by validation.
- Evidence:
  - `api/oss/src/core/tracing/utils/parsing.py:292-297` produces `errors.incremental`.
  - `api/oss/src/core/tracing/service.py:90-94` default analytics requests `attributes.ag.metrics.errors.cumulative`.
  - `api/oss/src/core/tracing/utils/trees.py:194-435` propagates cumulative `costs` and `tokens`, but has no equivalent cumulative propagation for `errors`.
  - `api/oss/src/dbs/postgres/tracing/utils.py:1100-1182` new analytics extracts exactly the requested JSON path and only includes it when that JSON value is numeric.
  - `api/oss/src/dbs/postgres/tracing/dao.py:656-673` legacy analytics sidesteps this by filtering exception events instead of reading `ag.metrics.errors`.
- Files:
  - `api/oss/src/core/tracing/utils/parsing.py`
  - `api/oss/src/core/tracing/utils/trees.py`
  - `api/oss/src/core/tracing/service.py`
  - `api/oss/src/dbs/postgres/tracing/utils.py`
  - `api/oss/src/dbs/postgres/tracing/dao.py`
- Cause: Error count has only the incremental write path; the metrics propagation pipeline computes cumulative values for tokens and costs, but not for errors.
- Explanation: The resolved contract keeps errors scalar, but still needs both `incremental` and `cumulative` levels. `errors.incremental` is correct for the span-local event count. `errors.cumulative` is needed on root spans so trace-level analytics can report total errors across a trace using the existing default analytics spec.
- Suggested Fix:
  - Add cumulative error propagation alongside `cumulate_tokens` and `cumulate_costs`.
  - Treat missing `errors.incremental` as `0`; write `errors.cumulative` only when the cumulative count is non-zero.
  - Keep `errors.incremental` scalar and produce `errors.cumulative` scalar.
  - Keep the new analytics default spec pointed at `attributes.ag.metrics.errors.cumulative` while the analytics base query is trace/root-span oriented.
  - Use `errors.incremental` as a default only if analytics is changed to include all spans or to switch specs based on span-vs-trace focus.
  - Add unit coverage for a parent/child trace where the child has an exception event and the root receives `errors.cumulative`.
  - Add analytics coverage proving the default `attributes.ag.metrics.errors.cumulative` spec sees the propagated scalar value.
- Alternatives:
  - Change default analytics to `errors.incremental`, but that would undercount trace-level errors on parent/root spans unless the query includes all spans or changes grouping by focus.
  - Keep legacy event-filter analytics only, but that leaves the new generic analytics endpoint inconsistent with default specs.
- Sources:
  - GitHub issue `#4173`
  - Linear `AGE-3735`
