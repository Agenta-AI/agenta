# Unified Eval Loops Findings

Review scope: `feat/unified-eval-loops` branch (PR [#4341](https://github.com/Agenta-AI/agenta/pull/4341), base `release/v0.103.0`), synced against the open GitHub review threads.

Sources:

- GitHub PR #4341 review threads (9 comments, all from @mmabrouk, all currently unresolved). Pulled 2026-06-08.
- Per-finding re-verification against the current `feat/unified-eval-loops` checkout (each comment's claim was re-checked against the cited file/line before recording).
- Historical closed findings (UEL-001..033) retained in `findings.old.md`.

## Summary

- Status: 9 findings synced from PR #4341 review threads (UEL-034..042). 3 resolved this turn (UEL-035 keyset fix, UEL-037 dead-handler removal, UEL-038 decorator), 6 open pending disposition.
- Severity spread: 1 P1 (data loss on finalize), 1 P2 silent failure-drop in SDK, plus exception-mapping gap, connection-pool churn, three N+1 query paths. One reviewer-flagged out-of-scope (UEL-042, async-engine serialization).
- GitHub threads: all 9 remain `unresolved` / not `outdated` and none replied to — code fixes applied locally are not yet pushed, so threads stay open until the branch is updated.
- Note: UEL-035 lives in the same migration file as the in-progress "default queue name backfill" fix, but is a distinct concern and untouched by that fix.

## Notes

- This sync is comment-driven: every finding traces to one PR review thread (provenance recorded in each `Sources` line via the comment id). No independent scan was run beyond re-verifying each cited location.
- Reviewer marked UEL-036 ("minor") and UEL-038 ("out of scope for this PR") with explicit scope hints; preserved in their severity/notes.
- The three N+1 query findings (UEL-040, UEL-041, UEL-042) and the connection-pool finding (UEL-036) are all performance/scaling issues, not correctness bugs — they bite only at scale (many scenarios, concurrent high-volume writes).

## Open Questions

- UEL-034: prefer the small fix (`data=current_run.data`) or the cleaner `set_run_status` path that never routes a status-only update through `edit_run`? The reviewer offered both; the second avoids the graph-mutation-as-side-effect class entirely.
- UEL-038: confirm this is deferred to its own PR (reviewer says "not asking for a change in this PR"). If deferred, should it be tracked as a separate issue rather than carried in this PR's findings?
- UEL-037: register the `/{id}/archive` + `/{id}/unarchive` routes now (lifecycle endpoints intended), or remove both handlers until needed? Depends on whether the queue archive/unarchive lifecycle is in scope for this release.

## Open Findings

### [OPEN] UEL-034: Stale graph snapshot on per-slice finalize can permanently delete a newly-added step's data

- Origin: sync
- Lens: verification
- Severity: P1
- Confidence: high
- Status: needs-user-decision
- Category: Correctness
- Files: `api/oss/src/core/evaluations/tasks/processor.py:357` (finalize write; `data=run.data` at the `edit_run` call ~line 357)
- Summary: The post-slice finalize re-reads `current_run` for the status floor and `is_active` flag, but still passes `run.data` (the caller's pre-slice graph snapshot) to `edit_run`. `edit_run` → `_reconcile_run` → `_prune_removed_steps` reads `prior_step_keys` from a fresh fetch and deletes results/scenarios/metrics for any step present in the saved graph but missing from the passed graph. If the run's graph changes between the slice snapshot and finalize (e.g. a user adds an evaluator step mid-run), this write carries the stale graph and the reconcile permanently and silently prunes the new step's data.
- Evidence: `current_run` is fetched (~line 295) and used for status/flags, but the `edit_run` call passes `data=run.data`. Confirmed line ~357/368 still reads `data=run.data`.
- Cause: status-only finalize routes through the full `edit_run` graph-reconcile path while carrying a stale graph.
- Suggested Fix: Minimal — `data=current_run.data if current_run else run.data`, keeping `prior_step_keys` and the written graph in sync so the prune is a no-op unless the graph really changed. Cleaner — add a dedicated `set_run_status` path that writes status + flags only and never touches the graph or queue reconciliation, so a status-only finalize cannot mutate the graph as a side effect. Also removes the per-slice cost of rewriting the full graph + re-running queue reconciliation when nothing changed.
- Sources: PR #4341 thread, comment 3375193915 (@mmabrouk).

### [OPEN] UEL-035: Text-cast keyset (`id::text`) defeats the PK index on the backfill pagination

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: in-progress (keyset fixed locally; single-transaction half resolved as wontfix-by-design — see below)
- Category: Migration / Performance
- Files: `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py:41` (`_NEXT_RUN_IDS`). EE copy mirrors this.
- Summary: The original keyset query cast `id::text` and ordered by text. `evaluation_runs.id` is a native `uuid` column (`IdentifierDBA`, `default=uuid.uuid7`). The text cast makes the predicate non-sargable against the uuid PK btree, so each page does a full scan + sort of the table — turning keyset pagination's intended O(page) per step into O(n), i.e. O(n²) over the whole backfill. Separately, text ordering of UUIDs only coincidentally agrees with native uuid byte-ordering when every id is in identical canonical lowercase hex form (which `uuid7` guarantees), so it was not actively skipping rows — but it relied on that representational coincidence rather than the column's real type.
- Evidence: was `WHERE id::text > :cursor ORDER BY id::text`; `id` is `Column(UUID(as_uuid=True), default=uuid.uuid7)` in `IdentifierDBA`.
- Cause: text-cast comparison is not index-sargable on a `uuid` column.
- Resolution (applied locally, both OSS + EE, ruff clean): switched to native-uuid keyset — `WHERE id > CAST(:cursor AS uuid) ORDER BY id`, cursor seeded with the zero UUID `00000000-0000-0000-0000-000000000000`. `SELECT id::text` is retained so the Python cursor stays a plain string that casts cleanly back. The PK index now drives each page.
- Nuance — the PK index helps the *cursor*, not the *workload*: the index fix only speeds up the page-advance step (`WHERE id > cursor ORDER BY id LIMIT n` finding where the next page starts). It does **not** remove a full table scan from the migration. The heavy per-chunk work is `_COMPUTE_CHUNK` — the `jsonb_array_elements` step scan over each run's graph plus the LEFT JOIN to `evaluation_queues` — and a backfill has to visit every run exactly once regardless, so a full pass over `evaluation_runs` is inherent and unavoidable. What the old `id::text` keyset added on top of that was an O(n) full scan + sort *per page* just to locate the cursor (→ O(n²) total pagination overhead); the fix collapses that overhead to O(log n) per page. So the value of the PK keyset here is bounded: it removes the quadratic re-scan caused by the text cast, but the migration is still O(n) total because it deliberately touches every row once. The index does not turn this into a cheap partial-table operation, and was never going to.
- On the reviewer's single-transaction half (wontfix — expected): the migration intentionally runs in one transaction (Alembic `transaction_per_migration=True`) so the whole backfill is all-or-nothing. Chunking is only there to bound per-statement size, per-statement lock scope, and to give progress logging — not to bound the transaction. Per-batch `connection.commit()` is deliberately not added; the all-or-nothing guarantee is the desired behavior. (Header comment's "chunked / safe to re-run" framing is about idempotent re-runs of the whole migration, which still holds.)
- Sources: PR #4341 thread, comment 3375211093 (@mmabrouk). User disposition 2026-06-08: single-transaction is expected; investigate + fix the `id::text` keyset.

### [OPEN] UEL-036: `set_metrics` closed-run check opens one DB connection per metric

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: needs-user-decision
- Category: Performance
- Files: `api/oss/src/dbs/postgres/evaluations/dao.py:1910` (`set_metrics`; loop at ~1936)
- Summary: `set_metrics` loops over every metric and calls `_get_run_flags(...)` without passing `session`. `_get_run_flags` opens its own engine session when `session is None`, so a batch of N metrics opens N connections just to read run flags. Under concurrent, high-volume metric writes this can exhaust the connection pool. `set_results` already solved this exact case (dedupe run ids, reuse one session, with a comment that it does so "so a fanned-out slice does not exhaust the connection pool"); `set_metrics` did not get the same treatment.
- Evidence: lines 1936-1939 — `for metric in metrics: run_flags = await _get_run_flags(project_id=..., run_id=metric.run_id)` with no `session=`.
- Cause: closed-run check not hoisted/deduped into a single shared session.
- Suggested Fix: Mirror `set_results` — open one `async with self.engine.session()`, dedupe `{m.run_id for m in metrics}`, pass `session=session` to `_get_run_flags`, raise `EvaluationClosedConflict` per closed run.
- Sources: PR #4341 thread, comment 3375235286 (@mmabrouk, marked "minor"). Matches prior note `dao_one_connection_per_call`.

### [OPEN] UEL-039: SDK slice processor swallows a failed scenario — drops it from the run rollup with no errored status

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: needs-user-decision
- Category: Correctness
- Files: `sdks/python/agenta/sdk/evaluations/runtime/processor.py:460` (`_guarded_process_one` except handler, ~lines 459-466)
- Summary: Isolation is correct (one scenario's failure should not abort the slice), but the `except` only logs. It does not append to `processed` nor write an errored status via `edit_scenario`, so the failed scenario drops out of the run rollup (`has_errors = any(item.has_errors for item in processed)` and the rest of the status computation only see successes). Any single scenario that errors during an SDK evaluation (one bad input, one failed invocation) silently shrinks the result set with no signal that one failed and no error recorded against it.
- Evidence: the handler logs `[SLICE] scenario processing failed` and returns; no `processed.append(...)`, no `edit_scenario(status=ERRORS)`. `_process_one` mints the scenario before invoking, so a scenario reference is available to mark errored.
- Cause: failure path logs but does not record the scenario as errored.
- Suggested Fix: Two parts — (1) capture the minted scenario and, in the handler, call `edit_scenario(scenario=scenario, status=EvaluationStatus.ERRORS)` when one was already created; (2) append an errored `ProcessedScenario` (under `processed_lock`) so the rollup counts it.
- Sources: PR #4341 thread, comment 3375239778 (@mmabrouk).

### [OPEN] UEL-040: Step-removal orphan check runs one `query_results` per affected scenario

- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: needs-user-decision
- Category: Performance
- Files: `api/oss/src/core/evaluations/service.py:629` (loop over `affected_scenario_ids`)
- Summary: After a step is removed, the orphan check loops over every affected scenario and runs `query_results` once each to see whether any cells remain. On a run with many scenarios this is one round trip per scenario where a single query for the whole set would answer the same question. Not a correctness problem — step removal on a large run pays an avoidable cost.
- Evidence: `for scenario_id in affected_scenario_ids: remaining = await self.query_results(... scenario_ids=[scenario_id] ...)`.
- Cause: per-scenario query instead of a single batched fetch.
- Suggested Fix: Fetch remaining results for all `affected_scenario_ids` in one `query_results` call (pass the full list), group by `scenario_id` in memory, treat a scenario with no remaining cells as an orphan. N queries → 1.
- Sources: PR #4341 thread, comment 3375254354 (@mmabrouk).

### [OPEN] UEL-041: Rerun recovery path runs one `query_results` per non-seeded scenario

- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: needs-user-decision
- Category: Performance
- Files: `api/oss/src/core/evaluations/tasks/processor.py:804` (non-seeded branch inside the `for scenario_id in scenario_ids` loop, ~line 802)
- Summary: In the rerun branch, each non-seeded scenario calls `query_results` on its own to recover its input cells and context. There is already a bulk fetch of existing cells earlier in the function, so this adds one more round trip per scenario on top of it — N sequential queries on a rerun over many scenarios. Not a correctness problem; ingest and seeded paths are unaffected (they do not enter this branch).
- Evidence: `else: input_cells = await self.evaluations_service.query_results(... scenario_id=scenario_id ...)` inside the per-scenario loop.
- Cause: per-scenario input-cell fetch instead of a single batched fetch.
- Suggested Fix: Batch the input-cell fetch for all non-seeded scenarios into one `query_results` call, group rows by `scenario_id` in memory, hand each scenario its slice — mirroring the bulk existing-cells fetch the function already does.
- Sources: PR #4341 thread, comment 3375254454 (@mmabrouk).

### [OPEN] UEL-042: SDK async engine mostly serializes — blocking HTTP client under `asyncio.gather` (out of scope for this PR)

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: needs-user-decision
- Category: Performance
- Files: `sdks/python/agenta/sdk/evaluations/preview/utils.py:693` (`afetch_trace`, the clearest example); pattern spans the result/metric/scenario/trace adapters.
- Summary: The SDK fans out scenarios with `asyncio.gather`, but the calls that save results, refresh metrics, edit scenarios, and fetch traces all go through the blocking HTTP client (`authed_api()`), each holding the event loop until it returns — so the fanned-out work runs one call at a time and the concurrency mostly serializes. `afetch_trace` is the worst case: a retry loop of `max_retries=30` with a delay means one slow/missing trace can block the whole loop ~30s while nothing else progresses. SDK evaluations run slower than the design intends; runs with many test cases or slow traces run much slower. Not a crash — lost parallelism.
- Evidence: adapters call the blocking `authed_api()`; `authed_async_api()` exists in the codebase but is currently unused. `afetch_trace` wraps the blocking call in a `max_retries=30` retry loop.
- Cause: blocking client under an async fan-out; predates this PR.
- Suggested Fix: Switch these adapters/helpers to `authed_async_api()`, or run the blocking call on a worker thread via `asyncio.to_thread`, to restore engine concurrency. For the trace path, revisit the 30s-per-cell retry budget. Reviewer explicitly defers this to its own change (touches shared client code; predates this PR).
- Sources: PR #4341 thread, comment 3375244177 (@mmabrouk, flagged out-of-scope).

## Closed Findings

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

Historical closed findings (UEL-001..033) are retained in `findings.old.md`.
