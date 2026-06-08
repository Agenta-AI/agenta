# Unified Eval Loops Findings

Review scope: `feat/unified-eval-loops` branch (PR [#4341](https://github.com/Agenta-AI/agenta/pull/4341), base `release/v0.103.0`), synced against the open GitHub review threads.

Sources:

- GitHub PR #4341 review threads (9 comments, all from @mmabrouk, all currently unresolved). Pulled 2026-06-08.
- Per-finding re-verification against the current `feat/unified-eval-loops` checkout (each comment's claim was re-checked against the cited file/line before recording).
- Historical closed findings (UEL-001..033) retained in `findings.old.md`.

## Summary

- Status: 13 findings total (UEL-034..046). 9 synced from PR #4341 review threads (UEL-034..042), 2 from test runs/audits (UEL-045 slice-topology, UEL-046 e2e coverage), 2 topology decisions surfaced during the UEL-045 root-cause and dispositioned by @jp (UEL-043 supported, UEL-044 not_planned).
- _Closed (12): UEL-034 through UEL-046_ — all dispositioned (`fixed` / `wontfix`), applied locally. Commit refs: UEL-034/039/040/042 in `03ad0da4c`; UEL-035/037/038 in `571c73ada`; UEL-036 in `41741004d`; UEL-041 + UEL-043 + UEL-044 + UEL-045 + UEL-046 test/topology/perf, local. UEL-035's single-transaction half is wontfix-by-design; UEL-044 is wontfix (`query → application` not planned); UEL-042's lib-wide migration is deferred to its own PR (eval-side swap done here).
- _Open: none._ All synced and surfaced findings are resolved or dispositioned.
- Severity spread of closed work: 1 P1 (data loss on finalize), 4 P2 (SDK failure-drop, exception-mapping, connection-pool churn, async serialization, plus the test topology bug), 5 P3.
- GitHub threads: the 9 PR-comment findings (UEL-034..042) map to review threads still `unresolved` until the branch is pushed; the local fixes are committed but thread resolution waits on the push.
- Note: UEL-035 shares a migration file with the "default queue name backfill" fix but is a distinct concern, untouched by it.

## Notes

- Provenance is mixed: UEL-034..042 are comment-driven (each traces to one PR review thread, recorded in its `Sources` line); UEL-045 came from a full-suite test run; UEL-043/044 surfaced from design analysis during the UEL-045 root-cause. Each `Sources` line records the actual origin.
- Reviewer marked UEL-036 ("minor") and UEL-038 ("out of scope for this PR") with explicit scope hints; preserved in their severity/notes.
- The N+1 query findings (UEL-040, UEL-041) and the connection-pool finding (UEL-036) are performance/scaling issues, not correctness bugs — they bite only at scale (many scenarios, concurrent high-volume writes). UEL-042 (async serialization) is the same class. All are now closed.

## Open Questions

_None outstanding. The two topology product decisions are resolved: `testset → evaluator` is now supported (UEL-043), `query → application` is not_planned (UEL-044)._

## Open Findings

_None. All synced/surfaced findings are resolved or dispositioned; see Closed Findings._

## Closed Findings

### [CLOSED] UEL-043: `testset → evaluator` (no app) — now a supported dispatchable topology

- Origin: sync
- Lens: design
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Product topology
- Files: `sdks/python/agenta/sdk/evaluations/runtime/topology.py` (`classify_steps_topology`, the `testset -> evaluator` branch); doc `docs/designs/unified-eval-loops/topologies.md`; tests `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`, `sdks/python/oss/tests/pytest/unit/test_evaluations_runtime.py`, `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_flows_run.py`.
- Summary: The classifier dispatched `direct testcases → evaluator` (`{testcase, queue}`) but marked `testset → evaluator` (no app) as `potential`/undispatchable. A testset is a named, versioned bag of testcases, so scoring testset-sourced testcases directly is the same operation; the worker already ran the path to SUCCESS once dispatched. The deferral auto-failed-and-closed plain testset+auto-evaluator runs at `start` (`service.py:2706`).
- Resolution (applied locally, ruff clean): per @jp decision, `testset → evaluator` is now `status="supported"` with `dispatch=Dispatch(source="testset", mode="batch")` — the bounded-batch counterpart to the open-queue `direct testcases → evaluator` shape. `start`'s generic dispatch path (`service.py:2689`, any `topology.dispatch`) routes it through `process_run_from_source`, the same path as `testset → application → evaluator`. Doc moved it to the Supported section. Unit tests updated (SDK + API classifier assertions; added a `start`-dispatches-testset→evaluator test). _End-to-end test added_: `test_testset_to_mock_evaluator_runs_to_success` (mock evaluator, no app) — runs through the worker to SUCCESS with one scenario per testcase.
- Sources: @jp, 2026-06-09 ("if we support testcases > evaluator(s), we might as well want to support testset(s) > evaluator(s)"). Implemented + e2e-tested 2026-06-09.

### [CLOSED] UEL-044: `query → application` — marked not_planned (was deferred/potential)

- Origin: sync
- Lens: design
- Severity: P3
- Confidence: high
- Status: wontfix
- Category: Product topology
- Files: `sdks/python/agenta/sdk/evaluations/runtime/topology.py` (`query -> application` branch); doc `docs/designs/unified-eval-loops/topologies.md`; tests `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`, `sdks/python/oss/tests/pytest/unit/test_evaluations_runtime.py`.
- Summary: The classifier supports `testset → application` (batch inference) but marked `query → application` as `potential`, with a real blocker: re-invoking an application over query-sourced traces would attach source trace links as application links, misclassifying the new application traces as annotations.
- Resolution (applied locally, ruff clean): per @jp decision, this is _not a planned shape_ — changed `status` from `potential` to `not_planned` with a reason naming the link-misclassification blocker. Dispatch behavior is unchanged (it never dispatched); only the status label moves from "deferred/future-interest" to "not planned". Doc moved it into the not_planned group. Unit assertions updated (`potential` → `not_planned`); the existing "does not dispatch" start test still holds (renamed to `..._not_planned_topology`).
- Sources: @jp, 2026-06-09 ("move topology in finding 44 to not_planned"). Done 2026-06-09.

### [CLOSED] UEL-046: No end-to-end coverage for queue-based and no-app evaluator topologies

- Origin: test
- Lens: validation
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Testing
- Files: `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_flows_run.py`, `_flow_helpers.py`.
- Summary: An e2e topology-coverage audit (2026-06-09) found the 7 supported dispatch topologies were unevenly covered: `testset → app → evaluator`, `testset → app`, `live query → evaluator`, `batch query → evaluator` had flow tests, but `testset → evaluator` (no app, newly supported via UEL-043) and the queue-mode `direct testcases → evaluator` / `direct traces → evaluator` had only create-shape or mocked-dispatch tests — no true worker-run e2e.
- Resolution (applied locally, ruff clean): added two e2e flow tests in `test_evaluation_flows_run.py` — `test_testset_to_mock_evaluator_runs_to_success` (topology `{testset, batch}`, no app) and `test_direct_testcases_queue_runs_to_success` (topology `{testcase, queue}` via `POST /simple/queues/` kind=testcases + `/testcases/` batch push → `run_from_batch` → terminal). Added `_flow_helpers` helpers: `query_testcase_ids`, `create_testcases_queue`, `add_testcases_to_queue`. Both poll to terminal SUCCESS and assert one scenario per item.
- Deliberate gap (not closed): `direct traces → evaluator` (`{trace, queue}`) has no e2e here. A real test needs OTLP-ingested `trace_id`s and the trace-fetch worker, which is timing-sensitive/flaky (see the `tracing_worker_reload_loop_flake` note and the trace-ingestion-timing caveat in `test_evaluation_metrics_flow.py`). Constructing it would couple this eval suite to the tracing subsystem and import known flakiness; left for a tracing-scoped e2e instead. The shape is unit-covered (dispatch routing + mint/bind) in `test_runtime_topology_planner.py`.
- Sources: e2e coverage audit, @jp 2026-06-09 ("make sure there are end to end tests"). Done 2026-06-09.

### [CLOSED] UEL-034: Stale graph snapshot on per-slice finalize can permanently delete a newly-added step's data

- Origin: sync
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Correctness
- Files: `api/oss/src/core/evaluations/tasks/processor.py` (`_finalize_run_after_slice`, the `edit_run` call ~`:343-360`)
- Summary: The post-slice finalize re-read `current_run` for the status floor and `is_active` flag but passed `run.data` (the caller's pre-slice graph snapshot) to `edit_run`. `edit_run` → `_reconcile_run` → `_prune_removed_steps` deletes results/scenarios/metrics for any step present in the saved graph but missing from the passed graph. A step added between the slice snapshot and finalize would be overwritten out of the graph AND its data permanently, silently pruned.
- Resolution (applied locally, committed `03ad0da4c`, ruff clean): per user disposition — fix the edit, do NOT add a `set_run_status` helper (edits are full PUT, not partial patch; a status-only helper buys nothing for a non-git-backed entity). The finalize now sources the full PUT from the freshly-fetched `current_run` (`_run = current_run or run`), overriding only the fields finalize owns: `status=run_status` and `is_active` (flipped False on terminal status). `name/description/tags/meta/data` all come from `current_run`, so a concurrent graph change is preserved, not pruned. `final_flags` logic unchanged; `is_closed` never touched here. `EvaluationClosedConflict` is caught and treated as a benign lock, not a failure.
- Sources: PR #4341 thread, comment 3375193915 (@mmabrouk). User disposition 2026-06-08: full-PUT edit from current_run, not a `set_run_status` path. Fixed 2026-06-08.

### [CLOSED] UEL-035: Text-cast keyset (`id::text`) defeats the PK index on the backfill pagination

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Migration / Performance
- Files: `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py` (`_NEXT_RUN_IDS`). EE copy mirrors this (kept byte-identical).
- Summary: The original keyset cast `id::text` and ordered by text. `evaluation_runs.id` is a native `uuid` column (`IdentifierDBA`, `default=uuid.uuid7`); the text cast makes the predicate non-sargable against the uuid PK btree, so each page did a full scan + sort to locate the cursor — O(n) per page → O(n²) pagination overhead over the backfill.
- Resolution (applied locally, both OSS + EE, committed `571c73ada`, ruff clean): switched to native-uuid keyset — `WHERE id > CAST(:cursor AS uuid) ORDER BY id`, cursor seeded with the zero UUID. `SELECT id::text` retained so the Python cursor stays a plain string. The PK index now drives each page; pagination overhead collapses to O(log n) per page.
- Nuance — the PK index helps the _cursor_, not the _workload_: the backfill still touches every run once (the `jsonb_array_elements` step scan + LEFT JOIN in `_COMPUTE_CHUNK` is inherent O(n)), so the migration remains O(n) total. The fix only removes the quadratic re-scan the text cast added on top of that. The PK keyset's value here is bounded by design.
- Single-transaction half (wontfix — expected, by design): the migration intentionally runs in one transaction (Alembic `transaction_per_migration=True`) so the backfill is all-or-nothing. Chunking bounds per-statement size/lock scope and gives progress logging — not transaction scope. Per-batch `commit()` is deliberately not added. Both halves of the reviewer comment are therefore disposed: keyset fixed, single-transaction wontfix.
- Sources: PR #4341 thread, comment 3375211093 (@mmabrouk). User disposition 2026-06-08: single-transaction is expected; fix the `id::text` keyset. Fixed 2026-06-08.

### [CLOSED] UEL-039: SDK slice processor swallowed a failed scenario — dropped it from the run rollup with no errored status

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Correctness
- Files: `sdks/python/agenta/sdk/evaluations/runtime/processor.py` (`process_sources` / `_guarded_process_one`); test `sdks/python/oss/tests/pytest/unit/test_evaluations_runtime.py`.
- Summary: Scenario isolation was correct, but the `except` only logged — it neither appended to `processed` nor wrote an errored status, so a failed scenario dropped out of the run rollup (`has_errors` / `run_status` only saw appended items). Any single scenario error silently shrank the result set with no signal.
- Resolution (applied locally, committed, ruff clean): restructured per the revised fix (the original "edit the outer except" can't reach the scenario — it was local to `_process_one`). `_guarded_process_one` now mints the scenario itself; a `create_scenario` failure is logged and dropped (no scenario to record); a _processing_ failure marks the scenario errored via `edit_scenario(scenario=scenario, status=EvaluationStatus.ERRORS)` and appends `ProcessedScenario(scenario=scenario, has_errors=True)` under `processed_lock`, so it surfaces in the rollup. Added `test_sdk_source_slice_records_process_failure_as_error` asserting both scenarios appear in the rollup, the bad one is `has_errors=True`, and `edit_scenario` is called with ERRORS for it. The existing `create_scenario`-failure isolation test still passes (that path is still log-and-drop).
- Sources: PR #4341 thread, comment 3375239778 (@mmabrouk). Investigation 2026-06-08: fix needed restructuring (scope blocker). Fixed 2026-06-08.

### [CLOSED] UEL-040: Step-removal orphan check ran one `query_results` per affected scenario

- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Performance
- Files: `api/oss/src/core/evaluations/service.py` (step-removal orphan check, ~`:626-638`)
- Summary: After a step was removed, the orphan check looped over every affected scenario and ran `query_results` once each — one round trip per scenario where a single batched query answers the same question.
- Resolution (applied locally, committed `03ad0da4c`, ruff clean): one batched `query_results` over the full `affected_scenario_ids` list, building `scenarios_with_cells = {r.scenario_id for r in remaining if r.scenario_id}`, then `orphan_scenario_ids = [id for id in affected_scenario_ids if id not in scenarios_with_cells]`. N queries → 1. The per-scenario query used only `run_id` + `scenario_id`, so batching is clean (no per-scenario filter lost).
- Sources: PR #4341 thread, comment 3375254354 (@mmabrouk). User disposition 2026-06-08: fix it. Fixed 2026-06-08.

### [CLOSED] UEL-041: Rerun recovery path ran one `query_results` per non-seeded scenario

- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Performance
- Files: `api/oss/src/core/evaluations/tasks/processor.py` (`process_sources`: batched fetch ~`:746-760`, recovery `else` branch ~`:828`).
- Summary: In the rerun/recovery branch, each non-seeded scenario called `query_results` on its own to recover its input cells and context — one round trip per scenario on top of the earlier slice-scoped bulk fetch. N+1 sequential queries on a rerun over many scenarios. Not a correctness problem; the seeded/ingest path was unaffected (it skips the read).
- Resolution (applied locally, ruff clean): hoisted the per-scenario read into one batched `query_results` over the full non-seeded set (`scenario_ids=non_seeded_ids`), grouped into `input_cells_by_scenario` in memory; the loop's `else` branch now reads `input_cells_by_scenario.get(scenario_id, [])`. N+1 → 2 queries. The `.get(..., [])` preserves the empty-cells → `source_item is None` → `summary.skipped += 1` path; loop order and downstream batched execution unchanged.
- Caveat respected (the original reviewer fix missed it): the new batched fetch _omits `step_keys`_, unlike the slice-scoped `existing` probe — inputs must be recovered regardless of the slice's step scope (else a rerun scoped to non-input steps drops input cells and source reconstruction breaks). It is a distinct second batched fetch, not a merge with the first. Comment at the fetch site documents this.
- Sources: PR #4341 thread, comment 3375254454 (@mmabrouk). User disposition 2026-06-09: take it in this PR. Fixed 2026-06-09.

### [CLOSED] UEL-042: SDK async engine mostly serializes — blocking HTTP client under `asyncio.gather`

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Performance
- Files: `sdks/python/agenta/sdk/evaluations/` — `metrics.py`, `results.py`, `runs.py`, `scenarios.py`, `preview/utils.py` (`afetch_trace`).
- Summary: The SDK fanned out scenarios with `asyncio.gather`, but the save/refresh/edit/fetch calls went through the blocking `authed_api()`, each holding the event loop until it returned — so the concurrency mostly serialized. `afetch_trace` was the worst case (a `max_retries=30` × `delay=1.0` loop could block ~30s).
- Resolution (applied locally, committed `03ad0da4c`, ruff clean): swapped the eval-side adapters/helpers from the blocking `authed_api()` to the signature-compatible async `authed_async_api()` (all 13 call sites across the 5 files → `await authed_async_api()(...)`; imports updated). `.raise_for_status()` / `.json()` / `.text` / `.status_code` confirmed sync-safe on the httpx async Response. Lower-risk than `asyncio.to_thread`.
- Scope note: the broader concern that `authed_api`/`authed_async_api` are shared client utilities used beyond evals (managers, eval reads) is real, but the _eval-side swap_ is self-contained and was applied here. Any library-wide migration of the remaining `authed_api` consumers (managers, etc.) is a separate PR, as the reviewer noted — not tracked under this finding.
- Sources: PR #4341 thread, comment 3375244177 (@mmabrouk, flagged out-of-scope). Eval-side swap applied + committed 2026-06-08; lib-wide migration deferred to its own PR.

### [CLOSED] UEL-045: Slice-endpoint acceptance tests built an undispatchable topology and 409'd on a closed run

- Origin: test
- Lens: validation
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Testing
- Files: `api/oss/tests/pytest/acceptance/evaluations/test_run_slice_endpoints.py` (`_create_testset_evaluator_evaluation`, new `_create_mock_application`).
- Summary: 8 tests failed with HTTP 409 "Cannot modify a closed evaluation" on a freshly-created run's `/scenarios/add` / `/populate` / `/repeats/set`. Root cause (traced via container logs + git history, NOT a regression from this PR's fixes): the helper built a `testset → evaluator` (no application) topology, which `classify_steps_topology` defers as `potential`. At creation, `start` → `_fail_evaluation_run` (`service.py:2706`) sets `is_closed=True` + FAILURE synchronously, so every subsequent mutation correctly 409'd. The probe (read-only) tests passed; `TestClosedRunReturns409` passed only by accident (its explicit close was a no-op on an already-closed run). The fail-and-close chain (`_fail_evaluation_run`, the unsupported-topology branch) predates this PR — introduced in `dce50ec0b`.
- Resolution (applied locally, ruff clean, 17/17 pass serially): added `_create_mock_application` (mock URI `agenta:custom:mock:v0`, no LLM) and an `application_steps` entry to the helper, making it the supported `testset → application → evaluator` shape (`{testset, batch}`). The run now stays open → all mutating ops succeed, and `TestClosedRunReturns409` now exercises a real open→close→409 transition. Test-only change; no product code touched. No EE mirror of this test file.
- Follow-up: the underlying classifier asymmetry (why `testset → evaluator` is deferred while `testcases → evaluator` is supported) is tracked as the still-open [UEL-043].
- Sources: User full-suite run 2026-06-08 (8 failures); root-caused + fixed 2026-06-09.

### [CLOSED] UEL-037: `archive_queue` / `unarchive_queue` router handlers removed (dead code)

- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Completeness
- Files: `api/oss/src/apis/fastapi/evaluations/router.py` (removed handlers formerly at `:1736` / `:1760`)
- Summary: Both handlers were complete with permission checks but had no `add_api_route` / route path registering them — the user-facing archive/unarchive endpoints were intentionally removed, but the route handlers were left behind. Archive/unarchive is reserved for reconciliation, which goes through the _service_ layer, not the router.
- Resolution (applied locally): removed the two dead router handlers. The service methods `EvaluationsService.archive_queue` / `unarchive_queue` are kept — they are live, called by `_reconcile_default_queue` (`service.py:465`, `:471`). Confirmed the handlers were referenced nowhere (no `add_api_route`, no `self.archive_queue`/`self.unarchive_queue`); OSS-only (no EE evaluations router). ruff clean.
- Sources: PR #4341 thread, comment 3375254138 (@mmabrouk). User disposition 2026-06-08: endpoint deliberately removed, handler is leftover dead code → remove the handler, keep the service.

### [CLOSED] UEL-038: `delete_simple_queue(s)` missing the domain-exception decorator (500 instead of 409)

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Correctness
- Files: `api/oss/src/apis/fastapi/evaluations/router.py` (`delete_simple_queue`, `delete_simple_queues`)
- Summary: Both handlers carried only `@intercept_exceptions()` and lacked `@handle_evaluation_closed_exception()`, the decorator that maps evaluation domain exceptions to their HTTP responses (`DefaultQueueDeletionForbidden` → `DefaultQueueEditingForbiddenException` → 409). Every sibling mutation handler (`delete_queue`, run/result deletes) stacks both; these two were inconsistent, so a domain forbidden-delete would surface as a generic 500.
- Resolution (applied locally, ruff clean): added `@handle_evaluation_closed_exception()` beneath `@intercept_exceptions()` on both handlers, matching the established pattern.
- Note on reachability: through the `SimpleQueuesService.delete` path (`service.py:4394`), a default-queue delete is deliberately rerouted to `delete_run` (cascading the default queue away) rather than raising `DefaultQueueDeletionForbidden`, so the 500 was latent rather than currently hit via this exact endpoint. The decorator is still the correct fix — it restores parity with the other mutation handlers and maps the exception to 409 if the simple-delete logic ever surfaces the forbidden case. `delete_queue` itself does raise it (`service.py:2063`).
- Sources: PR #4341 thread, comment 3375254252 (@mmabrouk). User disposition 2026-06-08: fix it.

### [CLOSED] UEL-036: Closed-run check opens one DB connection per item in `set_metrics` and `create_queues`

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Performance
- Files: `api/oss/src/dbs/postgres/evaluations/dao.py` (`set_metrics`, `create_queues`)
- Summary: The closed-run check loops over each item and calls `_get_run_flags(...)` without `session`. `_get_run_flags` opens its own engine session when `session is None`, so a batch of N items opens N connections just to read run flags — under concurrent, high-volume writes this can exhaust the connection pool. `set_results` had already solved this (dedupe run ids, reuse one session, with the comment "so a fanned-out slice does not exhaust the connection pool"); two siblings were missed.
- Full-DAO sweep (per user request): audited every `_get_run_flags` call site in the DAO. All loop sites except two already passed a shared `session=` (`create_scenarios:906`, `set_results:1464`, plus the read/query loops at 1087/1195/1699/2167/2581). The single-call create paths (`create_scenario`, `create_result`, `create_queue` — one run per request) open one connection by design and are not the bug. The _two offenders_ were `set_metrics` (the comment's original target) and `create_queues` — the latter not flagged in the PR comment but identical in shape.
- Resolution (applied locally, ruff clean): both now open one `async with self.engine.session()`, dedupe `{x.run_id for x in items}`, pass `session=session` to `_get_run_flags`, and raise `EvaluationClosedConflict` per closed run — mirroring `set_results`. Re-swept: no loop call site in the DAO is left without a shared session. No EE evaluations DAO exists, so the fix is OSS-only.
- Sources: PR #4341 thread, comment 3375235286 (@mmabrouk, marked "minor"). Matches prior note `dao_one_connection_per_call`. User disposition 2026-06-08: fix it + sweep the whole DAO for the same issue → surfaced `create_queues` as a second instance.

Historical closed findings (UEL-001..033) are retained in `findings.old.md`.
