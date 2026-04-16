# CR Status

Status checklist for PR findings consolidated from:
- `docs/designs/loadables/CR.findings.md`
- PR comments/reviews on `https://github.com/Agenta-AI/agenta/pull/3811`

Status values:
- `TODO`: not started
- `IN_PROGRESS`: currently being addressed
- `DONE`: fixed/verified
- `ACCEPTED`: intentionally not fixed
- `BLOCKED`: waiting on dependency/decision

| ID | Finding | Categories | Severity | Action | Status |
| --- | --- | --- | --- | --- | --- |
| F-001 | `transfer` removed from API/service while migrations still call it | compatibility, functionality, api, migrations, testsets | P0 | Added migration-local `_transfer_deprecated_testset(...)` in OSS/EE migration files and replaced removed service call | DONE |
| F-002 | `/testcases/query` dropped legacy `testset_revision_id` | compatibility, correctness, api, testcases | P1 | Migrated web callers to `testset_revision_ref.id`, removed legacy API shim, and added defensive 400 when no effective filters are provided | DONE |
| F-003 | `/spans/{trace_id}/{span_id}` does not return nested child spans | correctness, tracing, spans, api | P1 | Added core `fetch_spans` + `fetch_span` service methods and rewired endpoints to DAO-backed fetch path (`trace_id`/`span_id`), no tree traversal | DONE |
| F-004 | `edit_trace()` ignores `trace_id` parameter | contract, correctness, tracing, service | P2 | Moved trace-id validation to router boundary: extract payload trace_id, normalize both path and payload IDs via `parse_trace_id_to_uuid`, raise `HTTPException(400)` directly on mismatch or count != 1; service `edit_trace` no longer takes or validates `trace_id` | DONE |
| F-005 | `merge_specs()` returns empty list when both params and body provide specs | correctness, contract, tracing, analytics | P2 | Aligned merge precedence with existing query/body merge pattern: body specs win over params when both are provided | DONE |
| F-006 | B.2 testcase pagination semantics diverge from A.2/design | consistency, correctness, pagination, loadables, testsets | P2 | Updated `/testcases/query` ref-dereference path to paginate deterministic revision `testcase_ids`, fetch by paged IDs, and emit ID-based `windowing.next` | DONE |
| F-007 | Query hydration fields (`trace_ids`, `traces`) appear persistable via commit payload | contract, data-model, queries, persistence | P2 | Added revision-data sanitization before DAO writes: testsets persist only `data.testcase_ids`; queries persist only `data.formatting/filtering/windowing` in create/edit/commit paths | DONE |
| F-008 | Loadables e2e fixture appears outdated for traces ingest payload (`spans` vs `traces`) | tests, completeness, tracing, e2e | P2 | Updated loadables e2e fixture to post `traces` payload to `/traces/ingest` and added shape assertions for hydrated traces | DONE |
| F-009 | Stale `"Status: RED"` docstrings in loadables e2e tests | docs, tests, hygiene | P3 | Updated all 6 per-test `Status: RED` docstrings to `Status: GREEN`; trimmed stale fixme text | DONE |
| F-010 | Double UUID computation in `json_array_to_json_object` is confusing | readability, maintainability, testsets | P3 | Added inline comment explaining the second `_to_uuid` call is intentional: `testcase_data` was mutated (dedup_id injected) between the two calls, so the blob-hash fallback yields the correct final ID | DONE |
| F-011 | Include-flag default semantics asymmetry needs clarifying comments | readability, maintainability, queries, testsets | P3 | Added one-line comments at each flag-resolution site: testsets use opt-out (`is not False`, defaults True) to preserve legacy behaviour; queries use opt-in (`is True`, defaults False) because live trace execution is expensive | DONE |
| F-012 | Streaming backward-compat key fallback is implicit | readability, compatibility, tracing, streaming | P3 | Dropped the `"span_dto"` fallback; standardized on `"span"` as the canonical key — `serialize_span` writes `span=` and `deserialize_span` reads `data["span"]` directly | DONE |
| F-013 | Empty tracing utils `__init__.py` noted as informational | informational, structure, tracing | P3 | Empty `__init__.py` is standard Python package practice; no action needed | ACCEPTED |
| F-014 | `_populate_traces` output shape may be inconsistent (list of single-key trace dicts) | consistency, contract, queries, tracing | P2 | Verified current implementation builds `Trace(trace_id, spans)` objects; added e2e assertion for per-trace object shape (`trace_id` + `spans`) | DONE |
| F-015 | Testset retrieve caching concern around windowed IDs/cache key serialization | caching, pagination, testsets, performance | P2 | Verify on current HEAD, then close if confirmed fixed | DONE |
| F-016 | `TracesRouter` path route `/{trace_id}` may swallow mistaken `GET /query`/`GET /ingest` | routing, correctness, api, tracing | P2 | Added explicit reserved-segment guard in `TracesRouter.fetch_trace` returning 405 for `GET /traces/query|ingest`; confirmed static route registration still precedes `/{trace_id}` | DONE |
| F-017 | Missing EE permission check in `TracesRouter.create_trace` | security, authorization, ee, tracing | P0 | Added `is_ee()` + `check_action_access(..., Permission.EDIT_SPANS)` guard in `create_trace` | DONE |

## Dedup Notes

- `F-003` is the same issue as PR discussion `discussion_r2863216950`; tracked once.
- `F-015` is marked `DONE` based on a PR thread resolution comment; keep as done unless you want explicit local re-verification.
