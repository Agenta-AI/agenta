# CR Status Checklist (`feature/annotation-queue-v2`, PR #3814)

Status values: `todo`, `in_progress`, `blocked`, `done`, `wontfix`.

| Done | Finding ID | Finding Categories | Finding Severity | Finding Action | Finding Status | Source |
|---|---|---|---|---|---|---|
| [x] | F-001 | backend, query-filtering, correctness | P0 | Build query flags with `EvaluationRunQueryFlags` (no `None -> False` coercion) | done | CR#1; PR comment 2863204845; PR comment 2863263591 |
| [x] | F-002 | backend, orchestrator, human-eval | P0 | Add `origin` guard in batch testset flow to skip human/custom auto-invocation | done | CR#2 |
| [x] | F-003 | backend, queue-data, scenario-assignment | P1 | Keep `scenario_ids` as explicit filter only; for simple queues ignore `queue.data.scenario_ids` and treat `null` as all scenarios | done | CR#3; PR comment 2863204780 |
| [x] | F-004 | backend, dispatch, run-topology | P1 | Add dedicated non-live query dispatch task (`evaluate_batch_query`), route `start()` query topology to it, and use query-defined windowing | done | CR#4; PR comment 2863204861 |
| [x] | F-005 | backend, API-contract, eventual-consistency | P2 | Return ID-only contract for add-traces/add-testcases (`SimpleQueueIdResponse`) to avoid returning stale queue snapshots | done | CR#5 |
| [x] | F-006 | backend, data-model, assignment-repeats | P2 | Keep simple queue repeats at least assignment-lane count and use defensive max when parsing to tolerate divergence | done | CR#6 |
| [x] | F-007 | backend, typing, validation | P2 | Canonicalize assignments to a single shape (`List[List[UUID]]`) and remove flat-list union ambiguity | done | CR#7; PR comments 2863204877, 2863204888 |
| [x] | F-008 | backend, resiliency, retries, logging | P2 | Reduce trace fetch retries and add warning-level terminal failure logging (no silent swallow on final retry) | done | CR#8 |
| [ ] | F-010 | backend, access-scope, inbox-semantics | P2 | Keep project-wide query behavior by default when no `user_id/user_ids` filter is provided (intentional product choice) | wontfix | CR#10 |
| [ ] | F-011 | backend, flag-inference, maintainability | P3 | TBD (tell Codex what to do) | todo | CR#11; PR comment 2863204817 |
| [ ] | F-012 | backend, queue-query, filtering | P3 | TBD (tell Codex what to do) | todo | CR#12 |
| [x] | F-013 | migrations, release-safety | P2 | Re-link migration chain to single-head graph in OSS+EE (`Heads: ['e9f0a1b2c3d4']`) | done | CR#13 |
| [ ] | F-014 | backend, tracing, data-correctness | P1 | Defer root-span cleanup to follow-up PR (no change in this PR) | wontfix | PR comment 2863204733 |
| [ ] | F-015 | backend, observability, log-quality | P3 | TBD (tell Codex what to do) | todo | PR comment 2863204794 |
| [x] | F-016 | backend, router-structure, runtime-breakage | P0 | Move `_unresolve_evaluation_response` back under `SimpleEvaluationsRouter` | done | PR comment 2863235645 |
