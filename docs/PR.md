# PR: Loadables Retrieval Alignment + Traces Router Contract Cleanup

## Executive Summary

This PR aligns loadables retrieval behavior across testsets/queries, removes stale design drift in docs, and makes the traces router a first-class traces API (no tracing-shaped response types in traces endpoints).

## Change Inventory

## API: Testsets

1. Fixed `_populate_testcases(...)` call-site argument binding bugs by switching to keyword arguments.
2. Added deterministic ID-level windowing support for testset revision retrieval (`order`, `next`, `limit`) when enumerating `testcase_ids`.
3. Kept revision retrieval semantics where `include_testcases=true` returns both `testcases` and `testcase_ids`.
4. Updated `/testsets/revisions/retrieve` caching policy to cache only when `include_testcases=false`.

## API: Queries

1. Extended query revision population to merge request pagination (`next`, `limit`) into stored windowing.
2. Kept revision retrieval semantics where trace expansion can return both `traces` and `trace_ids`.
3. Updated `/queries/revisions/retrieve` caching policy to cache only when both `include_trace_ids=false` and `include_traces=false`.
4. Added permission coupling: query revision retrieve with trace expansion requires trace-view permission in addition to query-view permission.

## API: Traces Router

1. Introduced traces-specific DTOs:
   - `TraceResponse`
   - `TracesResponse`
   - `TracesQueryRequest`
2. Removed `formatting` from `TracesQueryRequest`.
3. Forced `/traces/query` to always return Agenta trace trees (never spans/opentelemetry formatting).
4. Removed external `TracingQuery` request contract from `TracesRouter.query_traces`; traces endpoint now consumes only `TracesQueryRequest`.
5. Added query permission coupling for ref-dereferenced traces query (`query_ref`, `query_variant_ref`, `query_revision_ref`).
6. Added native traces router fetch handler (`GET /traces/{trace_id}`) returning `TraceResponse`.

## Docs

1. Updated `docs/designs/loadables/loadables.querying.strategies.md` to include:
   - include-flag defaults
   - conditional caching behavior
   - permission coupling notes
   - `windowing.next` terminology
2. Updated `docs/designs/loadables/loadables.initial.specs.md` examples from `cursor` to `next`.
3. Removed redundant `docs/designs/loadables/loadables.querying.gap-analysis.md` after consolidating its useful content into the strategies document.

## Behavior Summary

1. Revision endpoints remain the control surface for ID/item expansion.
2. Record endpoints (`/testcases`, `/traces`) remain record-returning endpoints without extra top-level ID arrays.
3. Traces router now has a clean traces-only contract and response types.

## Validation

1. Formatting/lint:
   - `cd api && ruff format && ruff check --fix`
2. Targeted e2e:
   - `pytest -q oss/tests/pytest/acceptance/tracing/test_traces_basics.py oss/tests/pytest/acceptance/loadables/test_loadable_strategies.py`
   - Result: `27 passed`
3. Broader e2e:
   - `pytest -q oss/tests/pytest/acceptance/testsets/test_testsets_basics.py oss/tests/pytest/acceptance/testsets/test_testsets_queries.py oss/tests/pytest/acceptance/testsets/test_testcases_basics.py oss/tests/pytest/acceptance/tracing/test_spans_basics.py oss/tests/pytest/acceptance/tracing/test_spans_queries.py`
   - Result: `17 passed, 3 skipped` (existing flaky skips)
4. Full e2e suite:
   - `pytest -q oss/tests/pytest/acceptance`
   - Result: `175 passed, 3 skipped`
