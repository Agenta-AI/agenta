# Unified Eval Loops Findings

Review scope: `feat/unified-eval-loops` branch (PR [#4341](https://github.com/Agenta-AI/agenta/pull/4341), base `release/v0.103.0`), synced against the open GitHub review threads.

Sources:

- GitHub PR #4341 review threads (9 comments, all from @mmabrouk, all currently unresolved). Pulled 2026-06-08.
- Per-finding re-verification against the current `feat/unified-eval-loops` checkout (each comment's claim was re-checked against the cited file/line before recording).
- Historical closed findings (UEL-001..033) retained in `findings.old.md`.

## Summary

- Status: 12 findings total (UEL-034..045). 9 synced from PR #4341 review threads (UEL-034..042), 1 from a full-suite test run (UEL-045), 2 topology gaps surfaced during the UEL-045 root-cause (UEL-043, UEL-044).
- **Closed (9): UEL-034, UEL-035, UEL-036, UEL-037, UEL-038, UEL-039, UEL-040, UEL-042, UEL-045** — all `fixed`, applied locally (UEL-034/039/040/042 in `03ad0da4c`; UEL-035/037/038 in `571c73ada`; UEL-036 in `41741004d`; UEL-045 test-only, local). UEL-035's single-transaction half is wontfix-by-design; UEL-042's lib-wide migration is deferred to its own PR (eval-side swap done here).
- **Open (3): UEL-041** (P3 perf, batched rerun-recovery — scope decision), **UEL-043 + UEL-044** (P3 topology policy — product decision). All three are blocked on a user/product call, not on engineering; see Open Questions.
- Severity spread of closed work: 1 P1 (data loss on finalize), 4 P2 (SDK failure-drop, exception-mapping, connection-pool churn, async serialization, plus the test topology bug), 4 P3.
- GitHub threads: the 9 PR-comment findings (UEL-034..042) map to review threads still `unresolved` until the branch is pushed; the local fixes are committed but thread resolution waits on the push.
- Note: UEL-035 shares a migration file with the "default queue name backfill" fix but is a distinct concern, untouched by it.

## Notes

- Provenance is mixed: UEL-034..042 are comment-driven (each traces to one PR review thread, recorded in its `Sources` line); UEL-045 came from a full-suite test run; UEL-043/044 surfaced from design analysis during the UEL-045 root-cause. Each `Sources` line records the actual origin.
- Reviewer marked UEL-036 ("minor") and UEL-038 ("out of scope for this PR") with explicit scope hints; preserved in their severity/notes.
- The N+1 query findings (UEL-040 closed, UEL-041 open) and the connection-pool finding (UEL-036 closed) are performance/scaling issues, not correctness bugs — they bite only at scale (many scenarios, concurrent high-volume writes). UEL-042 (async serialization) is the same class.

## Open Questions

- UEL-043 (product decision): should `testset → evaluator` (no app) dispatch? The worker already runs it once dispatched, and `testcases → evaluator` is supported, so the gate is classifier policy. Resolve the asymmetry or document why the testset case needs an evaluator contract the raw-testcase case does not.
- UEL-044 (product decision): should `query → application` dispatch, mirroring the supported `testset → application`? This one carries a real blocker (source-trace links would misclassify as annotations), so it is harder than UEL-043.
- UEL-041 (scope): take the batched rerun-recovery fix in this PR, or defer? P3 perf, no correctness impact; the batched fetch must omit `step_keys` (deliberate semantic, unlike the step-scoped bulk fetch).

## Open Findings

### [OPEN] UEL-041: Rerun recovery path runs one `query_results` per non-seeded scenario

- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: needs-user-decision
- Category: Performance
- Files: `api/oss/src/core/evaluations/tasks/processor.py:803-812` (non-seeded `else` branch inside `for scenario_id in scenario_ids` at `:788`); existing bulk fetch at `:714-724`.
- Summary: In the rerun branch, each non-seeded scenario calls `query_results` on its own to recover its input cells and context. There is already a bulk fetch of existing cells earlier in the function (`:714-724`), so this adds one more round trip per scenario on top of it — N sequential queries on a rerun over many scenarios. Not a correctness problem; ingest and seeded paths are unaffected (they do not enter this branch).
- Evidence (verified 2026-06-08): `:803-812` — `else: input_cells = await self.evaluations_service.query_results(result=EvaluationResultQuery(run_id=run_id, scenario_id=scenario_id))` inside the per-scenario loop at `:788`. The earlier bulk fetch (`:714-724`) is scoped by `scenario_ids`, `step_keys`, AND `repeat_idxs`.
- Cause: per-scenario input-cell fetch instead of a single batched fetch.
- Suggested Fix (with caveat the original missed): batch the input-cell fetch for all non-seeded scenarios into one `query_results` call keyed by `scenario_ids=[all non-seeded ids]`, group by `scenario_id` in memory, hand each scenario its slice. **Caveat:** unlike the earlier bulk fetch, the per-scenario input query deliberately OMITS the `step_keys` filter — a comment at `:725-726` explains inputs must be recovered regardless of the slice's step scope. So the batched input fetch must also omit `step_keys` (fetch all input cells for the non-seeded set), not reuse the step-scoped bulk query. Two distinct batched fetches, by design.
- Sources: PR #4341 thread, comment 3375254454 (@mmabrouk). Investigation 2026-06-08: CONFIRMED; batched fix must preserve the deliberate no-`step_keys` semantics.

### [OPEN] UEL-043: `testset → evaluator` (no app) is deferred while `testcases → evaluator` is supported — inconsistent

- Origin: sync
- Lens: design
- Severity: P3
- Confidence: high
- Status: needs-user-decision
- Category: Product topology
- Files: `sdks/python/agenta/sdk/evaluations/runtime/topology.py:87-94` (supported `testcase → evaluator`) vs `:114-119` (deferred `testset → evaluator`); branch ordering at `:87` precedes `:114`. Doc: `docs/designs/unified-eval-loops/topologies.md:42-44` vs `:63-66`.
- Summary: The classifier dispatches `direct testcases → evaluator` (`{testcase, queue}`) but marks `testset → evaluator` (no app) as `potential`/undispatchable with reason "non-queue testcase-only evaluator execution needs an explicit evaluator contract". A testset is a named, versioned bag of testcases, so scoring testset-sourced testcases directly is the same operation as scoring a raw testcase batch. The worker slice processor already executes the `testset → evaluator` path to SUCCESS once dispatched (observed: run `019ea947-ad12`, 8 scenarios, all SUCCESS), so the gate is purely classifier policy, not an execution limit. Surfaced while root-causing the slice-endpoint test failures: a plain testset+auto-evaluator simple evaluation is auto-failed-and-closed at `start` (`service.py:2706` `_fail_evaluation_run`) because this branch returns no dispatch.
- Evidence (verified 2026-06-09): `classify_steps_topology` line 88 `if has_testcases: → Dispatch(source="testcase", mode="queue")`; line 114 `if has_testsets and has_evaluators and not has_applications: → status="potential"` (no dispatch). `has_testsets` vs `has_testcases` derive from input shape in `dbs/postgres/evaluations/utils.py:128/135` (`DIRECT_TESTCASE_STEP_KEYS` direct keys vs `TESTSET_REFERENCE_KEY` reference). Container logs confirm `start` → `_fail_evaluation_run` → `is_closed=True` for this topology.
- Cause: deliberate conservatism in the classifier (`dce50ec0b`); the testset-sourced evaluator path was deferred pending an "evaluator contract" that the testcase path does not require.
- Suggested Fix: decide whether `testset → evaluator` should dispatch (likely `{testset, batch}`, mirroring `testset → application → evaluator`). If yes, return a `Dispatch` at `:114` and verify against the slice processor (which already runs it). If no, document why the testset case needs a contract the raw-testcase case does not. Either way, resolve the asymmetry rather than leaving it implicit.
- Sources: @jp, 2026-06-09 ("if we support testcases > evaluator(s), we might as well want to support testset(s) > evaluator(s)").

### [OPEN] UEL-044: `query → application` is deferred while `testset → application` (batch inference) is supported — symmetric gap

- Origin: sync
- Lens: design
- Severity: P3
- Confidence: medium
- Status: needs-user-decision
- Category: Product topology
- Files: `sdks/python/agenta/sdk/evaluations/runtime/topology.py:103-112` (deferred `query → application`) vs `:137-143` (supported `testset → application`). Doc: `topologies.md:58-61` vs `:50-52`.
- Summary: The classifier supports `testset → application` (batch inference, `{testset, batch}`) but defers `query → application` as `potential`, with a concrete reason: "source trace links must not be attached as application links because that would classify the new application traces as annotations". The two are symmetric — a different input family (query traces vs testcases) seeding the same single-application invocation — so if testset-seeded batch inference is supported, query-seeded batch inference is a natural counterpart. Unlike UEL-043, this one carries a stated technical blocker (trace-link misclassification), so it is genuinely harder, not just policy.
- Evidence (verified 2026-06-09): line 103 `if has_queries and has_applications: → status="potential"` with the trace-link reason; line 137 `if has_testsets and has_applications and not has_evaluators and not has_queries: → Dispatch(source="testset", mode="batch")`. The deferred reason names a real seam (source-trace links vs application links and annotation classification).
- Cause: deferred on a real technical blocker (link classification), not just conservatism.
- Suggested Fix: scope the trace-link/annotation-classification issue named in the branch reason; if resolvable, add a `query → application` dispatch mirroring `testset → application`. Lower priority / more involved than UEL-043 because the blocker is substantive.
- Sources: @jp, 2026-06-09 ("also maybe query(ies) > application").

## Closed Findings

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
- Nuance — the PK index helps the *cursor*, not the *workload*: the backfill still touches every run once (the `jsonb_array_elements` step scan + LEFT JOIN in `_COMPUTE_CHUNK` is inherent O(n)), so the migration remains O(n) total. The fix only removes the quadratic re-scan the text cast added on top of that. The PK keyset's value here is bounded by design.
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
- Resolution (applied locally, committed, ruff clean): restructured per the revised fix (the original "edit the outer except" can't reach the scenario — it was local to `_process_one`). `_guarded_process_one` now mints the scenario itself; a `create_scenario` failure is logged and dropped (no scenario to record); a *processing* failure marks the scenario errored via `edit_scenario(scenario=scenario, status=EvaluationStatus.ERRORS)` and appends `ProcessedScenario(scenario=scenario, has_errors=True)` under `processed_lock`, so it surfaces in the rollup. Added `test_sdk_source_slice_records_process_failure_as_error` asserting both scenarios appear in the rollup, the bad one is `has_errors=True`, and `edit_scenario` is called with ERRORS for it. The existing `create_scenario`-failure isolation test still passes (that path is still log-and-drop).
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
- Scope note: the broader concern that `authed_api`/`authed_async_api` are shared client utilities used beyond evals (managers, eval reads) is real, but the **eval-side swap** is self-contained and was applied here. Any library-wide migration of the remaining `authed_api` consumers (managers, etc.) is a separate PR, as the reviewer noted — not tracked under this finding.
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
- Summary: Both handlers were complete with permission checks but had no `add_api_route` / route path registering them — the user-facing archive/unarchive endpoints were intentionally removed, but the route handlers were left behind. Archive/unarchive is reserved for reconciliation, which goes through the **service** layer, not the router.
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
- Full-DAO sweep (per user request): audited every `_get_run_flags` call site in the DAO. All loop sites except two already passed a shared `session=` (`create_scenarios:906`, `set_results:1464`, plus the read/query loops at 1087/1195/1699/2167/2581). The single-call create paths (`create_scenario`, `create_result`, `create_queue` — one run per request) open one connection by design and are not the bug. The **two offenders** were `set_metrics` (the comment's original target) and `create_queues` — the latter not flagged in the PR comment but identical in shape.
- Resolution (applied locally, ruff clean): both now open one `async with self.engine.session()`, dedupe `{x.run_id for x in items}`, pass `session=session` to `_get_run_flags`, and raise `EvaluationClosedConflict` per closed run — mirroring `set_results`. Re-swept: no loop call site in the DAO is left without a shared session. No EE evaluations DAO exists, so the fix is OSS-only.
- Sources: PR #4341 thread, comment 3375235286 (@mmabrouk, marked "minor"). Matches prior note `dao_one_connection_per_call`. User disposition 2026-06-08: fix it + sweep the whole DAO for the same issue → surfaced `create_queues` as a second instance.

Historical closed findings (UEL-001..033) are retained in `findings.old.md`.
