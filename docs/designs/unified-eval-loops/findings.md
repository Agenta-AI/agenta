# Unified Eval Loops Findings

Review scope: full `feat/unified-eval-loops` branch diff against `main`, with emphasis on the most recent `evals<>queues implementation` commit (`603820f5a`).

Sources:

- Fresh deep scan of code, docs, tests, and migrations on the active checkout.
- User-provided full pytest failure output from the API suite: 41 failed, 1344 passed, 8 skipped.
- Full reread of every document in `docs/designs/unified-eval-loops/` during the current applicability audit.
- Targeted local checks:
  - `pytest -q ee/tests/pytest/unit/test_controls_env_override.py::TestNoOverride::test_billing_pricing_accepts_legacy_agenta_pricing_alias ee/tests/pytest/unit/test_controls_env_override.py::TestNoOverride::test_billing_pricing_accepts_legacy_stripe_pricing_alias` passed locally.
  - Targeted auth/meters/db-manager tests reproduced the stale monkeypatch failures from UEL-024.
  - Targeted evaluation-runtime tests could not collect in the local shell because `agenta.sdk.evaluations.runtime` was not importable from that invocation; the user-provided full-suite output remains the validation source for those failures.
- Design references: `docs/designs/unified-eval-loops/{proposal,plan,gap,research,step-removal-semantics}.md`.
- Extension references: `docs/designs/unify-evals-and-queues/{proposal,plan,gap,unify-evals-extension-synthesis,unify-evals-extension-verbatim,research}.md`.
- Existing closed findings (UEL-001..UEL-006) retained below for history; reviewed only after the independent pass.

## Notes

- No local full-suite test execution was performed while auditing these findings; findings marked `reproduced` either come from the user-provided full-suite output or from the targeted local checks listed above.
- Findings below were re-checked against current code. Where runtime confirmation is still missing, the finding flags it and may need handoff to `test-codebase`.
- The branch carries two intertwined design tracks: unified evaluation loops (planner / source resolvers / tensor slice / runnable executor) and the evals×queues unification (default queue lifecycle + flag redefinitions). Findings cover both.
- Do not fix test-hook drift by adding broad production proxy objects. Prefer direct test injection/patching where the code already supports it, or add narrow compatibility helpers with a clear production purpose.

## Open Questions

- Should the legacy migration that mass-creates default queues for all existing runs gate on `has_human`/policy in a single pass, or is the runtime "first-edit reconciles" lag acceptable? See UEL-010.
- Is destructive `remove_step` + `prune` still the chosen lifecycle per `step-removal-semantics.md`? If so, when is the missing implementation expected? See UEL-014.
- For source-backed queues, should the public `SimpleQueueData.kind` report the source family (`queries` / `testsets`) or the executable scenario family (`traces` / `testcases`)? The failing tests expect executable scenario family, while the design docs emphasize separating source-family flags from queue eligibility. See UEL-021.
- Should legacy unit tests keep monkeypatching module-level `posthog` / `engine` symbols, or should they be updated to patch dependency factories / constructor injection? See UEL-024.

## Open Findings

### [OPEN] UEL-021: Source-backed simple queues are classified as `queries` / `testsets`, but runtime and tests expect `traces` / `testcases`

- ID: `UEL-021`
- Origin: `test`
- Lens: `validation`
- Severity: `P1`
- Confidence: `high`
- Status: `reproduced`
- Area: `Evaluations / Simple Queues`
- Summary: Query-backed and testset-backed simple queues currently keep `SimpleQueueKind.QUERIES` / `SimpleQueueKind.TESTSETS` as their queue kind, while the runtime dispatch works on resolved trace/testcase scenario items. The provided test run shows both unit and acceptance failures where query-backed queues are expected to expose `kind="traces"` and dispatch trace slices, and testset-backed queues are expected to expose `kind="testcases"` and dispatch testcase slices.
- Evidence:
  - `oss/tests/pytest/unit/evaluations/test_query_eval_loops.py::test_simple_queue_create_dispatches_each_query_source_with_step_key` observed `created_queue.data.kind == "queries"` but expected `"traces"`.
  - `oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py::test_create_source_backed_queue_preserves_repeats_and_assignments` observed `"testsets"` but expected `"testcases"`.
  - Acceptance tests for creating source-backed queues returned zero queued items where one was expected.
  - `api/oss/src/core/evaluations/service.py` maps queue data with `_get_source_kind()` returning `SimpleQueueKind.QUERIES` for `queue.data.queries` and `SimpleQueueKind.TESTSETS` for `queue.data.testsets`.
  - `SimpleQueuesService._parse_queue()` reports `kind=self._get_kind(run)`, so the source family leaks into the public simple-queue response.
- Files:
  - `api/oss/src/core/evaluations/service.py`
  - `api/oss/src/core/evaluations/types.py`
  - `api/oss/tests/pytest/unit/evaluations/test_query_eval_loops.py`
  - `api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py`
- Cause: The model conflates two different concepts: source declaration family (`queries` / `testsets`) and resolved executable item family (`traces` / `testcases`). Source-backed queue creation preserves source revision IDs correctly, but public queue kind and downstream dispatch checks are using the source family where tests expect the resolved family.
- Explanation: A query-backed queue is created from query revisions, but the work assigned to reviewers/evaluators is trace scenarios. Similarly, a testset-backed queue resolves testset revisions into testcase scenarios. The API needs to preserve both facts without using one field for both.
- Suggested Fix:
  - Keep `queries` / `testsets` fields as source references.
  - Return `kind="traces"` for query-backed queues and `kind="testcases"` for testset-backed queues, or introduce an explicit `source_kind` field if the source family must be exposed.
  - Ensure source-backed queue runs are marked/queryable consistently so `query(kind="traces")` and `query(kind="testcases")` include them.
  - Add regression tests for query-backed and testset-backed queue creation, fetch, query, and add-source rejection behavior.
- Alternatives:
  - If product wants `kind` to mean source family, update the tests and API docs. That would be a deliberate contract change and should not be inferred from the current implementation.
- Sources:
  - Provided pytest output.
  - Local inspection of `SimpleQueuesService`.

### [OPEN] UEL-022: Source-backed queue dispatch enters the source-slice processor with `has_queries` / `has_testsets`, but the processor accepts only direct-source flags

- ID: `UEL-022`
- Origin: `test`
- Lens: `validation`
- Severity: `P1`
- Confidence: `high`
- Status: `reproduced`
- Area: `Evaluations / Simple Queues`
- Summary: Source-backed queue creation resolves query revisions into trace batches and testset revisions into testcase batches, then dispatches those batches through the same source-slice processor used by direct trace/testcase queues. The dispatch wrapper accepts source-backed flags (`has_queries` / `has_testsets`), but `process_evaluation_source_slice()` still treats `require_queue=True` as requiring direct-source flags only (`has_traces` / `has_testcases`). Query-backed and testset-backed queues can therefore pass the first dispatch gate and fail inside the slice processor.
- Evidence:
  - `oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py::test_create_simple_queue_from_queries` failed with `assert 0 == 1`.
  - `oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py::test_create_simple_queue_from_testsets` failed with `assert 0 == 1`.
  - `oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py::test_simple_evaluation_queue_batches_dispatch_through_slice_processor` failed because a queue-shaped run fixture with source-backed input was rejected by dispatch.
  - `SimpleEvaluationsService.dispatch_trace_slice()` permits `run.flags.has_traces or run.flags.has_queries`.
  - `SimpleEvaluationsService.dispatch_testcase_slice()` permits `run.flags.has_testcases or run.flags.has_testsets`.
  - `api/oss/src/core/evaluations/tasks/source_slice.py` rejects `require_queue=True` unless `run.flags.has_traces or run.flags.has_testcases`; it does not accept `has_queries` / `has_testsets`.
  - `SimpleQueuesService._dispatch_source_batches()` resolves query/testset-backed source batches and calls `dispatch_trace_slice()` / `dispatch_testcase_slice()` with `input_step_key=batch.step_key`, so those batches eventually reach the stricter source-slice guard.
- Files:
  - `api/oss/src/core/evaluations/service.py`
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`
  - `api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py`
- Cause: The queue dispatch layer was partially updated for source-backed queues, but the source-slice processor still equates "queue batch" with direct trace/testcase source flags.
- Explanation: A query-backed source batch is executable as trace items, but the run still carries `has_queries` because the input step references a query revision. A testset-backed source batch is executable as testcase items, but the run still carries `has_testsets`. The source-slice processor needs to validate the actual batch request plus input step, not only the direct-source family flags.
- Suggested Fix:
  - Update `process_evaluation_source_slice()` queue validation so source-backed queue batches are allowed when `input_step_key` points to a `query_revision` or `testset_revision` input step and the concrete `trace_ids` / `testcase_ids` are present.
  - Alternatively, pass `require_queue=False` for source-backed queue dispatches after validating the source batch in `SimpleQueuesService._dispatch_source_batches()`.
  - Keep direct ad-hoc trace/testcase queues guarded by `has_traces` / `has_testcases`.
  - Add tests for query-backed and testset-backed source batch dispatch through the actual source-slice processor.
- Alternatives:
  - Persist additional resolved-source flags (`has_traces` for query-backed queues and `has_testcases` for testset-backed queues) alongside source-family flags. This would make the current guard pass, but it blurs the design's separation between source family and resolved executable item family.
- Sources:
  - Provided pytest output.
  - Local inspection of `SimpleEvaluationsService.dispatch_*`, `SimpleQueuesService._dispatch_source_batches()`, and `tasks/source_slice.py`.

### [OPEN] UEL-023: Backend runtime adapters have two compatibility regressions: `WorkflowServiceRequestData` shape and cached-runner `semaphore`

- ID: `UEL-023`
- Origin: `test`
- Lens: `validation`
- Severity: `P2`
- Confidence: `high`
- Status: `reproduced`
- Area: `Evaluations / Runtime Adapters`
- Summary: Two adapter tests fail for separate compatibility reasons. `BackendWorkflowRunner` now puts `interface` and `configuration` on the outer `WorkflowServiceRequest`, while the unit test expects them on `workflow_request.data`. `BackendCachedRunner` always forwards `semaphore=...` to the wrapped runner, but simple runner implementations may expose `execute_batch(requests)` only.
- Evidence:
  - `test_backend_workflow_runner_invokes_application_through_workflow_service` fails with `AttributeError: 'WorkflowRequestData' object has no attribute 'interface'`.
  - `test_backend_cached_runner_preserves_partial_hit_order` fails with `TypeError: BatchRunner.execute_batch() got an unexpected keyword argument 'semaphore'`.
  - Local inspection confirms `WorkflowServiceRequestData` is constructed with only `revision`, `parameters`, `testcase`, `inputs`, `trace`, and `outputs`.
  - Local inspection confirms `BackendCachedRunner.execute_batch()` calls `self.runner.execute_batch(missing, semaphore=semaphore)` unconditionally.
- Files:
  - `api/oss/src/core/evaluations/runtime/adapters.py`
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`
- Cause: The adapter boundary is not using a single explicit protocol. Some callers/tests still expect the older request data shape and a simpler batch runner signature.
- Explanation: These are not the same bug. The request-shape issue needs a contract decision with the workflow service DTOs. The `semaphore` issue can be fixed either by standardizing the runner protocol or by making `BackendCachedRunner` only wrap runners that implement the full protocol.
- Suggested Fix:
  - Define the expected `WorkflowServiceRequest` shape once and update either the test or the adapter to match it. Avoid mutating Pydantic DTOs ad hoc to add fields that the model does not declare.
  - Define a runner protocol for `execute_batch(requests, semaphore=None)` and update test runners to implement it, or make `BackendCachedRunner` tolerant of wrapped runners that do not accept `semaphore`.
  - Add a small protocol-focused unit test for cached partial-hit order and semaphore forwarding.
- Alternatives:
  - If the outer `interface` / `configuration` fields are canonical, close the data-shape assertion as stale and update the test to assert `workflow_request.interface` and `workflow_request.configuration`.
- Sources:
  - Provided pytest output.
  - Local inspection of `BackendWorkflowRunner` and `BackendCachedRunner`.

### [OPEN] UEL-024: Unit tests patch legacy module globals that no longer exist after dependency lookup refactors

- ID: `UEL-024`
- Origin: `test`
- Lens: `validation`
- Severity: `P2`
- Confidence: `high`
- Status: `reproduced`
- Area: `Compatibility / Tests`
- Summary: Several unit tests fail before exercising behavior because they patch module-level globals (`auth_helper.posthog`, `meters.dao.engine`, `db_manager_ee.engine`) that no longer exist. The production code now lazy-loads or constructor-loads dependencies through `_load_posthog()` / `get_transactions_engine()`.
- Evidence:
  - Auth helper tests fail with `AttributeError: module 'oss.src.core.auth.helper' has no attribute 'posthog'`.
  - Meter DAO tests fail with `AttributeError: module 'ee.src.dbs.postgres.meters.dao' has no attribute 'engine'`.
  - Workspace invitation removal test fails with `AttributeError: module 'ee.src.services.db_manager_ee' has no attribute 'engine'`.
  - Local inspection shows `auth.helper` imports `_load_posthog()` and assigns no module-level `posthog`.
  - Local inspection shows `MetersDAO.__init__()` accepts `engine: TransactionsEngine = None` and defaults to `get_transactions_engine()`, so tests can inject a mock engine directly.
  - Local inspection shows `remove_user_from_workspace()` calls `get_transactions_engine()` locally, and the same test file already has helper coverage that patches that function in earlier tests.
- Files:
  - `api/oss/src/core/auth/helper.py`
  - `api/ee/src/dbs/postgres/meters/dao.py`
  - `api/ee/src/services/db_manager_ee.py`
  - `api/oss/tests/pytest/unit/auth/test_helper.py`
  - `api/ee/tests/pytest/unit/test_meters_dao_strict_soft.py`
  - `api/ee/tests/pytest/unit/services/test_db_manager_ee.py`
- Cause: Test monkeypatch targets drifted after implementation changed dependency lookup style. The tests still patch old module-level handles instead of the current seam.
- Explanation: This is a test compatibility problem unless the module-level globals are part of an intentional public contract. Adding broad production proxy globals just to satisfy monkeypatches makes the code worse and hides the real dependency seam.
- Suggested Fix:
  - Update auth tests to patch `_load_posthog()` or a small `_get_posthog_client()` helper if one is introduced.
  - Update meter DAO tests to pass `MetersDAO(engine=mock_engine)` where `mock_engine.session()` returns the fake context.
  - Update `db_manager_ee` pending-invite test to patch `get_transactions_engine()` consistently with the existing `_patch_core_session()` helper in the same file.
  - Do not add broad module-level engine proxy objects to production DAO/service code.
- Alternatives:
  - Add narrow compatibility aliases only if external code, not just tests, imports those module globals. No evidence of that exists in the provided failures.
- Sources:
  - Provided pytest output.
  - Local inspection of the affected modules and tests.

### [OPEN] UEL-025: Legacy billing pricing alias tests are environment-sensitive because the subprocess helper inherits canonical pricing env

- ID: `UEL-025`
- Origin: `test`
- Lens: `validation`
- Severity: `P3`
- Confidence: `medium`
- Status: `candidate`
- Area: `Environment / Billing Settings`
- Summary: Tests that set legacy `AGENTA_PRICING` or `STRIPE_PRICING` expected those values to populate `env.billing.pricing`, but the user-provided suite output observed a canonical/default Stripe price instead. Local inspection shows `BillingSettings.pricing` already honors legacy aliases after `AGENTA_BILLING_PRICING`, and targeted local execution of both legacy alias tests passed when no canonical pricing env was present. The remaining issue is test isolation: the subprocess helper starts from `dict(os.environ)`, so inherited `AGENTA_BILLING_PRICING` can legitimately mask legacy aliases.
- Evidence:
  - `test_billing_pricing_accepts_legacy_agenta_pricing_alias` observed `price_1QmIwGB54aDbaYx3xE5J7WHA` instead of `price_agenta`.
  - `test_billing_pricing_accepts_legacy_stripe_pricing_alias` observed the same default/canonical price instead of `price_stripe`.
  - `api/oss/src/utils/env.py` uses `_load_json_env_dict_first("AGENTA_BILLING_PRICING", "AGENTA_PRICING", "STRIPE_PRICING")`.
  - `api/ee/tests/pytest/unit/test_controls_env_override.py::_run()` copies the full parent environment before applying `env_extra`.
  - Targeted local run of the two alias tests passed with `2 passed`, confirming the production alias order works when canonical env is absent.
- Files:
  - `api/oss/src/utils/env.py`
  - `api/ee/tests/pytest/unit/test_controls_env_override.py`
- Cause: The code path gives canonical env precedence by design, and the test helper does not scrub canonical env when validating legacy fallback.
- Explanation: The production precedence appears correct: canonical `AGENTA_BILLING_PRICING` should beat legacy aliases. The test helper should isolate env vars if it wants to validate legacy alias fallback.
- Suggested Fix:
  - In `_run()` / `_ok()` test helpers, explicitly remove `AGENTA_BILLING_PRICING` when a legacy-alias test is running, or construct the subprocess env from a controlled minimal baseline.
  - Add one explicit test that canonical env wins when both canonical and legacy aliases are present.
- Alternatives:
  - If product wants legacy aliases to override canonical pricing, change `_load_json_env_dict_first()` order. This would contradict the existing canonical precedence test.
- Sources:
  - Provided pytest output.
  - Local inspection of `BillingSettings`.
  - Targeted local pytest run.

### [OPEN] UEL-026: Events acceptance tests hit the EE audit permission/entitlement gate and need fixture alignment

- ID: `UEL-026`
- Origin: `test`
- Lens: `validation`
- Severity: `P2`
- Confidence: `medium`
- Status: `candidate`
- Area: `Events / Acceptance`
- Summary: Four events acceptance tests expected HTTP 200 but received 403. Current code shows `POST /events/query` is gated in EE by both `Permission.VIEW_EVENTS` and the `Flag.AUDIT` entitlement. The acceptance fixture uses `cls_account["credentials"]` without asserting that account has event-view permission and audit entitlement, so the failures are likely fixture/plan setup unless response bodies or logs show a different 403 source.
- Evidence:
  - `oss/tests/pytest/acceptance/events/test_events_basics.py::TestEventsBasics::test_query_events_returns_valid_response` failed with `assert 403 == 200`.
  - The same 403 pattern appears for event type, unknown event type, and windowing-limit query tests.
  - `api/oss/src/apis/fastapi/events/router.py` calls `check_action_access(... permission=Permission.VIEW_EVENTS)` and raises `FORBIDDEN_EXCEPTION` when false.
  - The same route calls `check_entitlements(key=Flag.AUDIT)` and returns `NOT_ENTITLED_RESPONSE(Tracker.FLAGS)` when false.
  - `api/oss/tests/pytest/unit/events/test_events_router_audit.py` already encodes allow/deny behavior for this gate.
- Files:
  - `api/oss/tests/pytest/acceptance/events/test_events_basics.py`
  - `api/oss/src/apis/fastapi/events/router.py`
  - `api/oss/tests/pytest/unit/events/test_events_router_audit.py`
- Cause: Acceptance account setup likely does not guarantee the event-view permission and audit entitlement required by the route.
- Explanation: This is not evidence of an events DAO/service bug. It is a mismatch between acceptance expectations and the route's current EE access policy.
- Suggested Fix:
  - Update the acceptance fixture to use an account/plan with `VIEW_EVENTS` and `AUDIT`, or assert 403 when the fixture lacks audit access.
  - Log or assert the response body in the acceptance tests so permission denial and entitlement denial are distinguishable.
  - Keep the existing unit coverage for audit allow/deny behavior.
- Alternatives:
  - If OSS acceptance runs should bypass EE audit gating, ensure the test environment is actually OSS or conditionally skip/adjust the events acceptance tests under EE without audit entitlement.
- Sources:
  - Provided pytest output.
  - Local inspection of events router and unit tests.

### [OPEN] UEL-009: Inferred-flag derivation is shared between migration and runtime, with brittle heuristics

- ID: `UEL-009`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Soundness`
- Summary: The DAO-side helper `_make_run_flags` (`api/oss/src/dbs/postgres/evaluations/utils.py:73-138`) is the canonical place that derives the eight `has_*` flags from `run.data.steps`. It is invoked from `create_run_flags` / `edit_run_flags`, which the DAO calls inside `create_run` / `create_runs` / `edit_run` / `edit_runs`. The data migration (`a2b3c4d5e6f8`) duplicates the same heuristic in SQL. Both rely on two fragile rules: (1) substring matching of reference keys for `has_queries` / `has_testsets`, and (2) hardcoded step.key literals `{"traces", "query-direct", "testcases", "testset-direct"}` with empty references for `has_traces` / `has_testcases`.
- Evidence:
  - `api/oss/src/dbs/postgres/evaluations/utils.py:104-136` walks `run.data.steps`, resets the eight `has_*` flags, and recomputes them from step shape.
  - Lines 113-116 set `has_traces=True` if `step.key.lower() in {"traces", "query-direct"}` and refs are empty; same idiom for `has_testcases` with `{"testcases", "testset-direct"}`.
  - Lines 118-124 set `has_queries=True` if any reference key contains the substring `"query"`; `has_testsets=True` if it contains `"testset"`. A reference key like `query_anchor`, `subquery`, or `testset_metadata` would falsely trigger either flag.
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py:24-39` uses the same literals to backfill `has_traces` / `has_testcases` on existing rows.
  - `docs/designs/unified-eval-loops/research.md:316-323` and `docs/designs/unify-evals-and-queues/unify-evals-extension-synthesis.md:30-33` explicitly identify "synthetic step-key inspection" as a target for removal under the new model.
  - `api/oss/tests/pytest/unit/evaluations/test_run_flags.py:61-111` locks in the current heuristic (steps named `"traces"` / `"testcases"` with empty refs are expected to produce `has_traces=True` / `has_testcases=True`).
- Impact:
  - Runtime and migration agree on the heuristic, so the backfill is internally consistent with new inserts. The risk is structural, not immediate.
  - Any caller that constructs a direct-source input step with a non-matching `step.key` (e.g. `"my_traces_source"`) will silently produce `has_traces=False`. Downstream dispatch checks (`SimpleQueuesService._get_kind`, `dispatch_trace_slice`, `dispatch_testcase_slice`) will then misclassify or refuse the run.
  - Any future reference key containing the substring `"query"` or `"testset"` (e.g. a hypothetical `query_anchor` or `testset_metadata` ref on an unrelated step) would incorrectly flip `has_queries` / `has_testsets` to `True`.
  - The two heuristics live in two languages (Python and SQL). A future change to the rule must be applied in both places to keep backfilled and runtime rows consistent.
- Files:
  - `api/oss/src/dbs/postgres/evaluations/utils.py`
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py`
  - `api/oss/tests/pytest/unit/evaluations/test_run_flags.py`
- Cause: There is no structural marker on a step that identifies its source family. Until one exists, both the migration and the DAO must infer from `step.key` / `step.references` shape.
- Suggested Fix:
  - Introduce a structured marker on `EvaluationRunDataStep` for source family (e.g. a `source_kind: Literal["query","testset","trace","testcase"]` field, or a sentinel reference `{"direct_source": Reference(...)}`) and have both the DAO and the migration read it.
  - Until then, harden the substring match by enforcing exact reference-key membership (`"query_revision" in references` rather than substring-on-key) and lock the direct-source step keys in a single shared constant referenced from both Python and the migration.
  - Add a unit test that asserts `has_queries` does NOT trigger for a fake reference key like `"some_query_anchor"`.
- Alternatives:
  - Accept the heuristic as the persistent rule and document it as a contract; gate any future step-key changes through a versioning check.

### [OPEN] UEL-010: Backfill creates default queues for every existing run, bypassing the conditional policy

- ID: `UEL-010`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Migration`
- Summary: The backfill migration inserts a `flags.is_default=true` queue for every existing run that does not already have one, regardless of `has_human` or `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS`. The runtime policy in `_reconcile_default_queue` archives default queues for runs that should not have them, but it only fires on the next `create_run`/`edit_run`. Until then the database contains stale active default queues.
- Evidence:
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py:43-71` inserts unconditionally, only checking the absence of an existing default queue.
  - `api/oss/src/core/evaluations/service.py:408` policy is `should_exist = EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS or has_human`. With the env constant hardcoded `False` (UEL-007), the steady-state policy requires `has_human=True` for auto-only runs to retain a default queue.
  - `api/oss/src/core/evaluations/service.py:433-438` archives default queues that should not exist, but only on run edits.
- Impact:
  - For environments where `has_human=False` is the majority, the migration creates many auto-only default queues that will only get archived on the next edit. Until then, `fetch_default_queue` returns active queues that the runtime would not have created.
  - Queue analytics, "queues with no work" views, and simple-queue eligibility checks will see inconsistent state across the fleet during the lag window.
  - The backfilled rows also default to `status='running'` regardless of run status, which is misleading for `success`/`failure` runs.
- Files:
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py`
- Cause: The migration favors symmetry (every run gets a queue) over conformance with the runtime policy.
- Suggested Fix:
  - Mirror the runtime policy in the migration: only insert default queues for runs that satisfy `has_human OR <env policy>`. Archive existing default queues for runs that no longer qualify.
  - Alternatively, run a one-shot data fix immediately after the migration that calls `_reconcile_default_queue` for each run.
  - Set `status` to a more neutral value (e.g., `pending`) or carry over the run's status when creating queues during backfill.
- Alternatives:
  - Keep the unconditional behavior and document the lag explicitly. This is acceptable if `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS` is going to be flipped `True` in deployment, but the constant is currently `False`.

### [OPEN] UEL-011: No tests cover default-queue reconciliation, archive/unarchive, or `_validate_default_queue_data`

- ID: `UEL-011`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Testing`
- Summary: The evals×queues unification adds a lot of new behavior — `_reconcile_default_queue`, `archive_queue`, `unarchive_queue`, `_validate_default_queue_data`, `_sync_run_queue_flag_for_default_queue`, default-queue lookup, partial unique index — but pytest coverage is zero.
- Evidence:
  - `grep -rn "default queue\|default_queue\|is_default" api/oss/tests/pytest/` returns no relevant hits (matches are all unrelated workspace/project `is_default`).
  - `grep -rn "reconcile_default_queue\|archive_queue\|unarchive_queue\|fetch_default_queue\|EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS" api/oss/tests/` returns nothing.
  - Existing acceptance tests in `test_simple_queues_basics.py` cover queue creation and source-family resolution but do not exercise default-queue lifecycle.
- Impact:
  - The entire unified-queues lifecycle is unverified. UEL-008/UEL-009/UEL-010/UEL-013 in particular would have been caught by basic coverage.
  - Future refactors of `_reconcile_default_queue` have no safety net.
- Files:
  - `api/oss/tests/pytest/` (no relevant tests)
  - `api/oss/tests/pytest/unit/evaluations/test_run_flags.py` (covers other flag aspects but not queue reconciliation)
- Cause: The implementation was prioritized over tests; the design (`unify-evals-and-queues/gap.md` §Tests) lists exactly these as required test cases.
- Suggested Fix:
  - Add unit tests for `_reconcile_default_queue` under all four state transitions (`required+missing`, `required+archived`, `required+active`, `not required+active`).
  - Add tests for `archive_queue`/`unarchive_queue` returning `None` when the queue is missing, raising for closed runs, and syncing `run.flags.is_queue`.
  - Add tests for `_validate_default_queue_data` rejecting `user_ids`, `scenario_ids`, `step_keys`, `batch_size`, `batch_offset` on `is_default=True` queues, both in create and edit paths.
  - Add a DAO/integration test asserting that the partial unique index `ux_evaluation_queues_default_per_run` prevents two default queues per run (including archived rows).
  - Add a regression test for `delete_queue`/`delete_queues` raising "default queues must be archived, not hard deleted".
- Alternatives:
  - Cover the same surface through acceptance tests over the HTTP routes (`/queues/{id}/archive`, `/runs/{id}/default-queue`). Reduces unit-level reach but covers HTTP wiring at the same time.

### [OPEN] UEL-012: `@suppress_exceptions()` on `archive_queue`/`unarchive_queue` swallows `EvaluationClosedConflict`

- ID: `UEL-012`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: The new DAO methods `archive_queue` and `unarchive_queue` raise `EvaluationClosedConflict` when the parent run is closed, but their `@suppress_exceptions()` decorator catches the exception and returns `None`. The router decorator `@handle_evaluation_closed_exception()` never receives the exception, so closed-run mutations silently return an empty response instead of a 409.
- Evidence:
  - `api/oss/src/dbs/postgres/evaluations/dao.py:2649-2684` — `archive_queue` is wrapped with `@suppress_exceptions()` and raises `EvaluationClosedConflict` at 2676.
  - `api/oss/src/dbs/postgres/evaluations/dao.py:2686-2723` — same shape for `unarchive_queue`.
  - `api/oss/src/utils/exceptions.py:97-128` — `suppress_exceptions` catches `Exception` unless explicitly in `exclude`. No DAO method in this file uses `exclude=[EvaluationClosedConflict]`.
  - `api/oss/src/apis/fastapi/evaluations/router.py:1758-1803` — both routes use `@handle_evaluation_closed_exception()`, expecting the exception to propagate.
- Impact:
  - Archiving or unarchiving a queue whose parent run is closed returns `count=0` to the client instead of the 409 error the rest of the router uses for the same situation. Users cannot distinguish "queue not found" from "run closed".
  - The conflict is logged through `[SUPPRESSED]` rather than surfaced; UI cannot react.
  - The pattern matches a pre-existing convention on `main` (e.g., `edit_queue`), so it is not strictly a regression, but the new archive/unarchive paths inherit and propagate it.
- Files:
  - `api/oss/src/dbs/postgres/evaluations/dao.py`
  - `api/oss/src/apis/fastapi/evaluations/router.py`
  - `api/oss/src/utils/exceptions.py`
- Cause: `@suppress_exceptions()` was copied from neighboring queue methods without adjusting `exclude`.
- Suggested Fix:
  - Change `@suppress_exceptions()` to `@suppress_exceptions(exclude=[EvaluationClosedConflict])` on `archive_queue`, `unarchive_queue`, `edit_queue`, `edit_queues`, and any other DAO method that raises `EvaluationClosedConflict`.
  - Add a regression test that archives a queue against a closed run and asserts a 409 response.
- Alternatives:
  - Move the closed-run check into the service layer (so it never goes through `@suppress_exceptions`). This is the cleaner long-term direction per `AGENTS.md` ("typed domain exceptions at the service boundary"), but is a larger refactor.

### [OPEN] UEL-020: `is_queue` is recomputed only at the service layer; the DAO neither resets nor derives it

- ID: `UEL-020`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Soundness`
- Summary: The DAO helper `_make_run_flags` resets the eight `has_*` flags on every `create_run` / `edit_run` and re-derives them from `run.data.steps`. It does not touch `is_queue`, which is computed only by `_reconcile_default_queue` and `_sync_run_queue_flag_for_default_queue` at the service layer. Any caller that bypasses the service and writes to the DAO directly (or any future caller that constructs `EvaluationRunFlags(is_queue=True)` and calls `edit_run`) can plant a stale `is_queue` value that survives until reconciliation runs again. The same asymmetry means the DAO has no invariant to detect or correct a desynced `is_queue` on read.
- Evidence:
  - `api/oss/src/dbs/postgres/evaluations/utils.py:94-102` resets only `has_queries`, `has_testsets`, `has_traces`, `has_testcases`, `has_evaluators`, `has_custom`, `has_human`, `has_auto`. `is_queue` is left to whatever the caller passed (or the row already had).
  - `api/oss/src/core/evaluations/service.py:440-447` writes `is_queue` based on `has_human AND default_queue.deleted_at IS NULL`, only inside `_reconcile_default_queue`.
  - `api/oss/src/core/evaluations/service.py:1818-1849` writes `is_queue` only when the changed queue is `is_default=True`.
  - `api/oss/src/core/evaluations/service.py:511-533` and `587-635` are the only paths that chain reconcile after a run write. A caller using `evaluations_dao.edit_run` directly will skip reconcile entirely.
  - Design contract: `is_queue` is "active default queue exists AND active human evaluator work exists" (`docs/designs/unify-evals-and-queues/unify-evals-extension-synthesis.md:40-55`). This is a derived fact that should not be persistable by the DAO without re-derivation.
- Impact:
  - In the current codebase, every write path goes through the service, so reconcile fires. The persisted value is correct in practice.
  - Any new code that writes via the DAO (background jobs, EE extensions, future operations like `add_step`/`remove_step`) must remember to call reconcile or it will leave `is_queue` stale.
  - There is no DAO-layer invariant test that flags a desynced row, so a regression can go unnoticed.
- Files:
  - `api/oss/src/dbs/postgres/evaluations/utils.py`
  - `api/oss/src/core/evaluations/service.py`
- Cause: `is_queue` depends on facts outside `run.data.steps` (the existence and lifecycle of a default queue), which the DAO does not load. Service-layer reconciliation was added later as the single source of truth.
- Suggested Fix:
  - Document the invariant in `utils.py` (`# is_queue is service-derived; do not write directly`) and add a service-layer regression test that calls `edit_run` with `is_queue=True` on a run that should not be queue-eligible and asserts reconciliation flips it back.
  - Alternatively, move `is_queue` out of the persisted flag and compute it on read in the service layer, so it cannot be wrong.
- Alternatives:
  - Keep `is_queue` persisted but enforce reconciliation as part of every `edit_run` call (e.g. wrap the DAO call inside a service decorator that always runs reconcile afterward).

### [OPEN] UEL-014: Step lifecycle operations (`add_step`, `remove_step`, `prune`) are absent

- ID: `UEL-014`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: `docs/designs/unified-eval-loops/step-removal-semantics.md` chose **destructive** `remove_step` + `prune` as the lifecycle policy and listed `add_step`, `remove_step`, `add_scenario`, `remove_scenario`, `probe(slice)`, `populate(slice, results)`, `prune(slice)`, `process(slice)`, `refresh_metrics`, `set_flag` as the canonical operation surface (`proposal.md:367-381`). None of these exist in the API or service.
- Evidence:
  - `api/oss/src/apis/fastapi/evaluations/router.py` (verified through subagent map) has no `add_step`, `remove_step`, `probe`, `prune`, `populate`, `process`, `set_flag` route. The closest in-process method is `TensorSliceOperations` (see UEL-015).
  - `api/oss/src/core/evaluations/service.py` exposes `create_results`, `query_results`, `delete_results`, `refresh_metrics`, run/queue CRUD, but no graph-mutation API.
  - `docs/designs/unified-eval-loops/step-removal-semantics.md:1-20` declares destructive remove+prune as the chosen model.
- Impact: Without the operation surface, graph evolution still requires recreating runs or in-place edits without prune cascades, which is the very fragmentation the design was meant to resolve. UI/API affordances for managing steps after creation cannot be built.
- Files:
  - `api/oss/src/apis/fastapi/evaluations/router.py`
  - `api/oss/src/core/evaluations/service.py`
- Cause: Implementation prioritized planner/runtime/queue plumbing; the operation API surface remains future work per the plan, but is not labeled as deferred in this branch.
- Suggested Fix:
  - Track the operation API as an explicit follow-up. Either ship it in this branch or extend `gap.md` to mark it as a known-pending item.
  - When implementing, follow the AGENTS.md domain conventions (`apis/fastapi/<domain>/router.py` + `core/<domain>/service.py` + `dbs/postgres/<domain>/dao.py`).
- Alternatives:
  - Resolve as `needs-user-decision` if the team prefers to land the unification without the operation surface and ship it as a follow-up PR.

### [OPEN] UEL-015: `TensorSliceOperations.process` only refreshes metrics; the documented `process(slice)` contract is unimplemented

- ID: `UEL-015`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: `TensorSliceOperations.process` is the only in-process implementation of the design's central `process(slice)` operation. It does not plan, execute, or populate cells — it only calls `evaluations_service.refresh_metrics(...)` and returns an empty `ProcessSummary`. The actual planner/executor pipeline runs only through `tasks/source_slice.py` and `tasks/run.py`, which are full-batch entrypoints rather than slice-aware.
- Evidence:
  - `api/oss/src/core/evaluations/runtime/tensor.py:151-169`: `process` body is `await refresh_metrics(...)` then `return ProcessSummary()`. No planner/runner invocation.
  - `docs/designs/unified-eval-loops/proposal.md:160-208` describes `process(run, slice)` as the full plan-and-execute loop.
  - `tasks/source_slice.py:174-566` implements something close to the contract but is keyed on `run_id`/`source_items`/`testcase_ids`/`trace_ids`, not on the canonical `TensorSlice` shape.
- Impact:
  - Slice-aware retries, partial re-execution by `(scenario_ids, step_keys, repeat_idxs)`, and the "probe-before-write" workflow described in `gap.md` §"Execution Gaps" are not yet possible.
  - The current `process` reads like a complete implementation (it does mutate metrics) but silently does almost nothing. Callers may believe they have executed a slice when they have only refreshed metrics.
- Files:
  - `api/oss/src/core/evaluations/runtime/tensor.py`
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
- Cause: The slice operation surface was scaffolded ahead of the planner/runner wiring needed to make `process(slice)` operational.
- Suggested Fix:
  - Either route `process(slice)` through the source-slice processor by translating `TensorSlice` into the parameters that `process_evaluation_source_slice` already accepts, or rename `TensorSliceOperations.process` to clarify that it is only a metrics refresh.
  - Add a unit test that asserts the documented behavior (execute auto cells in the slice, populate result cells, return a non-empty `ProcessSummary`).
- Alternatives:
  - Mark this method explicitly as `metrics-refresh-only` and provide a separate `execute(slice)` method when planner integration lands. Keep the contract honest.

### [OPEN] UEL-016: Service raises bare `ValueError` for default-queue policy violations instead of typed domain exceptions

- ID: `UEL-016`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Consistency`
- Summary: `_validate_default_queue_data` and `delete_queue`/`delete_queues` raise bare `ValueError` for policy violations (`"default queues cannot filter scenarios, steps, assignments, or batches"`, `"default queues must be archived, not hard deleted"`, `"default queues cannot be demoted"`). `AGENTS.md` explicitly forbids this pattern: domain exceptions must be defined in `core/<domain>/types.py` (or `dtos.py`) so the API boundary can convert them to structured HTTP responses.
- Evidence:
  - `api/oss/src/core/evaluations/service.py:1661-1663`, `1754`, `1795`, `1900`, `1919` raise `ValueError(...)` directly.
  - `AGENTS.md` §"Domain-level exceptions" requires `Folder`/`Tracing`-style domain exception classes per domain, with base classes and structured context.
  - `api/oss/src/core/evaluations/types.py:44-75` only defines `EvaluationClosedConflict`; no `DefaultQueueModificationError`/`InvalidDefaultQueueData`/`DefaultQueueDeletionForbidden` types exist.
- Impact: Clients see generic 500 or HTTP-422 responses instead of typed 409/422 with structured context. Future logic that needs to react to a specific failure mode (`except DefaultQueueModificationError:`) cannot do so cleanly.
- Files:
  - `api/oss/src/core/evaluations/service.py`
  - `api/oss/src/core/evaluations/types.py`
- Cause: Policy validators were added inline as the simplest possible guards.
- Suggested Fix:
  - Introduce `class DefaultQueueError(Exception)` base and concrete subclasses (`DefaultQueueDataInvalid`, `DefaultQueueDemotionForbidden`, `DefaultQueueHardDeleteForbidden`) in `types.py`.
  - Replace `raise ValueError(...)` with these types and convert them in the router (or via a decorator) to typed HTTP errors.
  - Add a regression test asserting the HTTP status code and detail message.
- Alternatives:
  - Leave as `ValueError` until other domain exceptions land. This is consistent with some other parts of the evaluations service but inconsistent with the recommended pattern.

### [OPEN] UEL-017: Source-aware queue runs may transiently flip run status during multi-batch dispatch

- ID: `UEL-017`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `medium`
- Status: `open`
- Category: `Correctness`
- Summary: `process_evaluation_source_slice` writes the run status (`RUNNING`/`SUCCESS`/`ERRORS`/`FAILURE`) at the end of each invocation when `update_run_status=True`. For source-aware queues that dispatch multiple batches (`_dispatch_source_batches` triggers several slice runs), each batch can flip the status before subsequent batches arrive, producing a `SUCCESS` -> `RUNNING` -> `SUCCESS` thrash.
- Evidence:
  - `api/oss/src/core/evaluations/tasks/source_slice.py:527-563` writes `run.status = run_status` after the slice, gated only by `severity` ordering against the **current** persisted value (not against in-flight slice arrivals).
  - `api/oss/src/core/evaluations/tasks/run.py:109-148` and `tasks/source_slice.py:174-205` are invoked once per slice, not once per run.
  - Source-aware queue creation in `SimpleQueuesService._dispatch_source_batches` (referenced at `service.py:3730-3743`) ships multiple slices for a single run.
- Impact: Operators observing a run during multi-batch dispatch may see status oscillate. Idempotent observers and frontend status displays may flicker. The severity rule at line 543-547 floors at the higher status, but only against the previously persisted status — not against still-pending parallel slices.
- Files:
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
- Cause: Status update logic was written for the single-slice case and re-used for multi-slice dispatch without coordination.
- Suggested Fix:
  - Pass an explicit `expected_total_slices` / `slice_index` (or a "this is the last slice" flag) into `process_evaluation_source_slice`, and only update the run status on the final slice.
  - Alternatively, move run-status reconciliation out of the slice loop into a separate run-finalize task that aggregates across slices.
- Alternatives:
  - Document the thrash and accept it. Cheaper but degrades the UX promise of the unified loop.

### [OPEN] UEL-018: SDK runtime drops extra runner outputs silently when batch is longer than planned cells

- ID: `UEL-018`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `medium`
- Status: `open`
- Category: `Correctness`
- Summary: `process_evaluation_source_slice` zips `batch_cells` with `executions` and only handles the case where there are fewer executions than cells (closed UEL-004). When the runner returns **more** executions than planned cells (a contract violation in the other direction), the trailing executions are silently discarded.
- Evidence:
  - `sdks/python/agenta/sdk/evaluations/runtime/source_slice.py:182-204` iterates `zip(batch_cells, executions)`, naturally truncating to the shorter sequence.
  - Lines 216-230 handle only `len(executions) < len(batch_cells)` (`batch_cells[len(executions):]`).
  - The mismatch flag at line 216 still sets `scenario_has_errors=True`, but no per-extra-cell logging happens.
- Impact: Low — the contract violation is "extra outputs from the runner," which should be rare. But the silent drop means there is no audit trail for the extra outputs. Closed UEL-004 fixed only the under-return direction.
- Files:
  - `sdks/python/agenta/sdk/evaluations/runtime/source_slice.py`
- Cause: The fix for UEL-004 covered the under-count case explicitly; the over-count case was not added.
- Suggested Fix:
  - When `len(executions) > len(batch_cells)`, log a structured warning that includes the extra outputs' summaries.
  - Optionally, persist a marker result row for the unused executions or surface them in the `ProcessedScenario.metrics`.
- Alternatives:
  - Treat extra outputs as a hard error (raise). More aggressive but symmetric with UEL-004.

### [OPEN] UEL-019: Source-resolver `query_revision` lookup ignores resolver returning `None` and falls through to the next resolver

- ID: `UEL-019`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `medium`
- Status: `open`
- Category: `Soundness`
- Summary: `resolve_queue_source_batches` iterates resolvers in order and stops as soon as one returns a non-empty batch. If a `query_revision` reference resolves to zero trace IDs, the function returns `None` and the loop tries the testset resolver next, which silently does the wrong thing if the same step (somehow) had both refs.
- Evidence:
  - `api/oss/src/core/evaluations/runtime/sources.py:229-244` iterates `[QueryRevisionTraceResolver, TestsetRevisionTestcaseResolver]` and `break`s on the first truthy batch.
  - A step has either a `query_revision` or a `testset_revision` reference under current design, so the fall-through is harmless in practice — but if a future step carries both refs (a possibility under mixed-source planning), the second resolver would win silently.
  - The first resolver returns `None` whenever `trace_ids` is empty (line 106-107) instead of returning an empty batch, which conflates "no traces" with "wrong resolver".
- Impact: Low today (single-ref steps), but the resolver chain is brittle to future graph extensions and to legitimately empty query results.
- Files:
  - `api/oss/src/core/evaluations/runtime/sources.py`
- Cause: The resolver chain was modeled as "first-match wins" rather than "first-applicable wins".
- Suggested Fix:
  - Split the resolver protocol into `applies(step)` and `resolve(step)`; iterate until `applies` returns `True`, and treat empty results as a real empty batch (or a structured error).
  - Return `ResolvedSourceBatch(kind=..., step_key=..., trace_ids=[])` for empty query results so the loop sees the resolver applied.
- Alternatives:
  - Document the assumption "exactly one source reference per input step" and add a planner-level validator that rejects steps violating it.

## Closed Findings

### [CLOSED] UEL-008: `has_traces`/`has_testcases` flags are never set on run creation

- ID: `UEL-008`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `stale`
- Category: `Correctness`
- Summary: Original claim was that the runtime never writes `has_traces`/`has_testcases`/`has_human`/etc. on run creation.
- Resolution:
  - Retracted. A deeper trace of the DAO showed that `EvaluationsDAO.create_run`, `create_runs`, `edit_run`, and `edit_runs` all call `create_run_flags(_run)` / `edit_run_flags(run, base_flags=...)`, which delegate to `_make_run_flags` in `api/oss/src/dbs/postgres/evaluations/utils.py:73-138`. That helper resets the eight `has_*` flags and recomputes them from `run.data.steps` on every write that carries a step graph.
  - The service-layer `_make_evaluation_run_flags` (3308-3337) does pass all eight `has_*` as explicit `False`, but the DAO overrides them with the derived values. The derived values are correct for the canonical step shapes used by `_make_evaluation_run_data` and `SimpleQueuesService._make_run_data`.
  - The reported runtime symptom (`dispatch_trace_slice` short-circuit, `_get_kind` returning `None`) does not occur, because by the time those checks run, the DAO has already populated `has_traces` / `has_testcases` / `has_queries` / `has_testsets` correctly.
  - Existing coverage in `api/oss/tests/pytest/unit/evaluations/test_run_flags.py:13-111` locks in the inference for the four families.
  - The residual concerns about the inference's brittleness (synthetic step-key + substring matching) are tracked in the rewritten UEL-009.

### [CLOSED] UEL-013: `SimpleQueuesService.create` forces `is_queue=False` and never re-derives via reconciliation

- ID: `UEL-013`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `medium`
- Status: `stale`
- Category: `Correctness`
- Summary: Original claim was that `SimpleQueuesService.create` would leave `is_queue=False` because `has_human` was never set, so `_reconcile_default_queue` would never create a default queue.
- Resolution:
  - Retracted. The DAO `create_run` runs `_make_run_flags`, which walks the constructed annotation steps and sets `has_human=True` when any annotation step has `origin="human"`. `SimpleQueuesService._make_run_data` defaults list-shaped evaluator inputs to `origin="human"` (service.py:4096-4099). For dict-shaped inputs, the explicit origin is honored.
  - `EvaluationsService.create_run` then runs `_reconcile_default_queue(run=created_run)` with the DAO-derived `has_human`. When `has_human=True`, the default queue is created and `is_queue=True` is written via a follow-up `edit_run`.
  - The explicit `EvaluationRunFlags(is_queue=False)` the service passes on create is consumed by `_make_run_flags`'s explicit-update merge and then reconciled, so the persisted value is correct.
  - End-state: human-evaluator simple queues do reach `is_queue=True`; auto-only "queues" intentionally do not, per design (`unify-evals-extension-synthesis.md:174-181`).
  - The layering question — that `is_queue` is service-only and the DAO does not enforce it — is split out as UEL-020.

### [CLOSED] UEL-007: `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS` ships as `False` for local-dev UX

- ID: `UEL-007`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `wontfix`
- Category: `Consistency`
- Summary: The global default-queue policy toggle is a Python module-level constant (`False`) inside `service.py`, not an environment variable through `oss/src/utils/env.py`.
- Files:
  - `api/oss/src/core/evaluations/service.py`
- Resolution:
  - Wontfix per user decision: the constant is intentionally shipped as `False` so local development exercises the human-evaluator-conditional default-queue UX path. The `env` wiring (and the matching unit test) can be revisited when product flips the policy.

### [CLOSED] UEL-004: Runnable batch length mismatches can silently drop planned cells

- ID: `UEL-004`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: The shared source-slice loop zipped planned cells with runner results and did not verify that the runner returned one execution per requested cell.
- Files:
  - `sdks/python/agenta/sdk/evaluations/runtime/source_slice.py`
  - `sdk/tests/pytest/unit/test_evaluations_runtime.py`
- Resolution:
  - Fixed by making `process_evaluation_source_slice` treat runner result-count mismatches as explicit scenario errors.
  - Missing trailing planned cells are now logged as failed result cells with a contract-violation message instead of disappearing from persistence.
  - Added focused SDK unit coverage for a two-repeat auto evaluator batch where the runner returns only one execution.
- Sources:
  - The over-return direction is now tracked separately as UEL-018.

### [CLOSED] UEL-005: Trace-backed queue slices do not load trace context before evaluator execution

- ID: `UEL-005`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Direct trace batches entered the unified runtime as `ResolvedSourceItem(trace_id=...)` only, so auto evaluators could receive no source trace, inputs, outputs, or span link.
- Files:
  - `api/oss/src/core/evaluations/runtime/sources.py`
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`
- Resolution:
  - Fixed by hydrating direct trace source items through `tracing_service` before converting them to SDK source items.
  - The resolver now populates `trace`, root `span_id`, `inputs`, and `outputs` from `ag.data` when the source trace is available.
  - Added focused unit coverage for direct source resolution and for `process_evaluation_source_slice(trace_ids=[...])` forwarding hydrated source context to the SDK runtime.

### [CLOSED] UEL-006: Source-trace links are hard-coded as `invocation`

- ID: `UEL-006`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `medium`
- Status: `wontfix`
- Category: `Consistency`
- Summary: The SDK runtime emits upstream links under the key `invocation`.
- Files:
  - `sdks/python/agenta/sdk/evaluations/runtime/source_slice.py`
  - `api/oss/src/core/evaluations/runtime/adapters.py`
- Resolution:
  - Wontfix per user decision: the invocation link key is the workflow contract, and the key for the invocation step should be `invocation`.

### [CLOSED] UEL-003: Dict-revision regression test asserts fields that the request model drops

- ID: `UEL-003`
- Origin: `mixed`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Testing`
- Summary: The staged unit test for dict-shaped evaluator revisions fails because it asserts `workflow_request.interface` and `workflow_request.configuration`, but the active `WorkflowServiceRequest` alias is `WorkflowInvokeRequest`, whose declared payload surface is `data`.
- Resolution:
  - Fixed by updating the regression test to assert preserved evaluator metadata through `workflow_request.data.revision["data"]` and `workflow_request.data.parameters`, matching the current SDK request model.

### [CLOSED] UEL-001: Backend evaluator runner receives dumped revisions but reads them like DTOs

- ID: `UEL-001`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Backend auto-annotation execution can invoke evaluators with an empty `interface` and `configuration` because the shared runtime dumps revisions to dictionaries before handing them to `BackendEvaluatorRunner`.
- Resolution:
  - Fixed by making `BackendEvaluatorRunner` read revision, nested `data`, and `flags` from both dict-shaped and DTO-shaped objects.
  - Added a focused unit case for dict-shaped evaluator revisions in `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`.

### [CLOSED] UEL-002: Startup instrumentation uses raw prints in the FastAPI module

- ID: `UEL-002`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `high`
- Status: `wontfix`
- Category: `Compatibility`
- Summary: `api/entrypoints/routers.py` now emits startup timing with top-level `print()` calls during module import.
- Resolution:
  - Wontfix per user decision.
