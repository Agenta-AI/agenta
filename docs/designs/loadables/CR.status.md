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
| F-001 | `transfer` removed from API/service while migrations still call it | compatibility, functionality, api, migrations, testsets | P0 | TBD (awaiting your instruction) | TODO |
| F-002 | `/preview/testcases/query` dropped legacy `testset_revision_id` | compatibility, correctness, api, testcases | P1 | TBD (awaiting your instruction) | TODO |
| F-003 | `/preview/spans/{trace_id}/{span_id}` does not return nested child spans | correctness, tracing, spans, api | P1 | TBD (awaiting your instruction) | TODO |
| F-004 | `edit_trace()` ignores `trace_id` parameter | contract, correctness, tracing, service | P2 | TBD (awaiting your instruction) | TODO |
| F-005 | `merge_specs()` returns empty list when both params and body provide specs | correctness, contract, tracing, analytics | P2 | TBD (awaiting your instruction) | TODO |
| F-006 | B.2 testcase pagination semantics diverge from A.2/design | consistency, correctness, pagination, loadables, testsets | P2 | TBD (awaiting your instruction) | TODO |
| F-007 | Query hydration fields (`trace_ids`, `traces`) appear persistable via commit payload | contract, data-model, queries, persistence | P2 | TBD (awaiting your instruction) | TODO |
| F-008 | Loadables e2e fixture appears outdated for traces ingest payload (`spans` vs `traces`) | tests, completeness, tracing, e2e | P2 | TBD (awaiting your instruction) | TODO |
| F-009 | Stale `"Status: RED"` docstrings in loadables e2e tests | docs, tests, hygiene | P3 | TBD (awaiting your instruction) | TODO |
| F-010 | Double UUID computation in `json_array_to_json_object` is confusing | readability, maintainability, testsets | P3 | TBD (awaiting your instruction) | TODO |
| F-011 | Include-flag default semantics asymmetry needs clarifying comments | readability, maintainability, queries, testsets | P3 | TBD (awaiting your instruction) | TODO |
| F-012 | Streaming backward-compat key fallback is implicit | readability, compatibility, tracing, streaming | P3 | TBD (awaiting your instruction) | TODO |
| F-013 | Empty tracing utils `__init__.py` noted as informational | informational, structure, tracing | P3 | TBD (awaiting your instruction) | TODO |
| F-014 | `_populate_traces` output shape may be inconsistent (list of single-key trace dicts) | consistency, contract, queries, tracing | P2 | TBD (awaiting your instruction) | TODO |
| F-015 | Testset retrieve caching concern around windowed IDs/cache key serialization | caching, pagination, testsets, performance | P2 | Verify on current HEAD, then close if confirmed fixed | DONE |
| F-016 | `TracesRouter` path route `/{trace_id}` may swallow mistaken `GET /query`/`GET /ingest` | routing, correctness, api, tracing | P2 | TBD (awaiting your instruction) | TODO |
| F-017 | Missing EE permission check in `TracesRouter.create_trace` | security, authorization, ee, tracing | P0 | TBD (awaiting your instruction) | TODO |

## Dedup Notes

- `F-003` is the same issue as PR discussion `discussion_r2863216950`; tracked once.
- `F-015` is marked `DONE` based on a PR thread resolution comment; keep as done unless you want explicit local re-verification.
