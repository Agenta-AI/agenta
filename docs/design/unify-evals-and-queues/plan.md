# Plan

1. Define the canonical default queue shape with open filters: `scenario_ids=None`, `step_keys=None`, `user_ids=None`, and no default batching restrictions.
2. Add a durable default-queue identifier, preferably an explicit queue flag or role that distinguishes default queues from custom queues independently of shape.
3. Add queue archival support across DTOs, service methods, DAO methods, and API endpoints, including archive and unarchive operations.
4. Extend queue query/fetch paths with `include_archived` support and ensure archived default queues can be found during reconciliation.
5. Add global policy toggle for unconditional default queues, e.g. `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS`, as a module-level global.
6. Implement shared policy helpers for:
   - whether a run has active human evaluator steps
   - whether default queues are unconditional for all runs
7. Replace the current path-specific human-queue helper with a default-queue reconciliation operation that can create, unarchive, no-op, or archive according to the two-policy model.
8. Invoke default-queue reconciliation from simple evaluation run creation and run-editing flows so queue lifecycle follows evaluation lifecycle rather than dispatch timing.
9. Use source-family flags for ingestion semantics; persist `is_queue` as active default queue + active human evaluator work.
10. Update simple queue/default queue creation paths so the default queue leaves `step_keys` open instead of snapshotting human step keys.
11. Add backend tests for unconditional mode, conditional mode, archive/unarchive behavior, coexistence with custom queues, open step scope, and existing queue regressions.
12. Update design/API documentation to describe the default queue model, the two policies, queue archival semantics, and the frontend decisions intentionally left outside this backend work.
