# Plan

1. Extend the live query loop so human and custom evaluators can remain pending instead of being dropped.
2. Extend the batch query loop with the same pending/manual behavior where applicable.
3. Add source-aware queue run data that preserves the query revision or testset revision in the step definitions.
4. Add source-to-item resolution at the queue boundary for any new source-aware queue creation path.
5. Extend `POST /simple/queues/` with source-aware queue creation via `queries` or `testsets`, on top of the existing trace/testcase queue path.
6. Keep the existing low-level trace ID and testcase ID queue endpoints working for backward compatibility.
7. Add validation and error messages for unsupported source kinds, mixed source combinations, and attempts to add direct items to source-backed queues.
8. Add backend tests for query-backed manual evaluators, revision-preserving source-aware queue creation, and current queue regressions.
9. Update docs to explain the current matrix, the new proposal, and the migration path.
