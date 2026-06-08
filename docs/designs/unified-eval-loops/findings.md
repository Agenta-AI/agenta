# Unified Eval Loops Findings

Review scope: `feat/unified-eval-loops` branch (PR [#4341](https://github.com/Agenta-AI/agenta/pull/4341), base `release/v0.103.0`), synced against the open GitHub review threads.

Sources:

- GitHub PR #4341 review threads (9 comments, all from @mmabrouk, all currently unresolved). Pulled 2026-06-08.
- Per-finding re-verification against the current `feat/unified-eval-loops` checkout (each comment's claim was re-checked against the cited file/line before recording).
- Historical closed findings (UEL-001..033) retained in `findings.old.md`.

## Summary

- Status: 9 findings synced from PR #4341 review threads (UEL-034..042). 4 resolved this turn (UEL-035 keyset fix, UEL-036 connection-per-item in `set_metrics`+`create_queues`, UEL-037 dead-handler removal, UEL-038 decorator), 5 open pending disposition.
- Severity spread: 1 P1 (data loss on finalize), 1 P2 silent failure-drop in SDK, plus exception-mapping gap, connection-pool churn, three N+1 query paths. One reviewer-flagged out-of-scope (UEL-042, async-engine serialization).
- All 5 remaining open findings were independently re-investigated against current code on 2026-06-08 — all CONFIRMED. Two had their suggested fix corrected: UEL-039 (the failed `scenario` is local to `_process_one`, so the original "edit the outer except handler" fix can't reach it — needs restructuring), and UEL-041 (the batched input fetch must omit `step_keys`, unlike the step-scoped bulk fetch — a deliberate semantic difference). UEL-034 confirmed P1 with a permanent + silent delete; the `set_run_status` path (not the minimal patch) is the recommended fix.
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
- Evidence (verified 2026-06-08): `processor.py:295` fetches `current_run` and uses it for the status floor + `is_active` flag (`:323`, `:332-338`), but the finalize `edit_run` call at `:357` passes `data=run.data` (the stale caller snapshot). In `service.py` `edit_run` (`:742-770`): `:754` `prior_run = await self.fetch_run(...)` reads the CURRENT saved graph, `:755` `prior_step_keys = self._step_keys(prior_run)`, `:757` the DAO writes the passed (stale) `run.data`, then `_reconcile_run` (`:764`) computes `removed_step_keys = prior_step_keys - self._step_keys(run)` (`:582`) and `_prune_removed_steps` (`:591-643`) HARD-deletes the dropped step's results (`delete_results`, `:621-623`), orphan scenarios (`delete_scenarios`, `:641`), and flushes metrics. No soft-delete, no error surfaced (the processor's outer handler only logs). So a step added between the slice snapshot and finalize is overwritten out of the graph AND its data is permanently pruned.
- Cause: a status-only finalize routes through the full `edit_run` graph-reconcile path while carrying a stale graph snapshot.
- Suggested Fix: The finalize block's intent is purely status + `is_active` (confirmed by the surrounding comments and the fields it computes) — it never legitimately needs to write graph changes. So the **dedicated `set_run_status` path is the correct fix**: write only status + flags, skip graph reconcile + queue reconcile entirely. It must keep the concurrency-safe floor (read `current_run`, floor terminal-bad statuses) and use `current_run.flags` for `is_active` (mirroring `:332`). The minimal `data=current_run.data if current_run else run.data` patch *also* stops the prune, but is strictly weaker: it leaves every slice rewriting the full graph + re-running queue reconciliation, and re-opens the same data-loss class if the snapshot is ever reintroduced. Recommend `set_run_status`.
- Sources: PR #4341 thread, comment 3375193915 (@mmabrouk). Investigation 2026-06-08: CONFIRMED P1, permanent + silent.

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

### [OPEN] UEL-039: SDK slice processor swallows a failed scenario — drops it from the run rollup with no errored status

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: needs-user-decision
- Category: Correctness
- Files: `sdks/python/agenta/sdk/evaluations/runtime/processor.py:459-466` (`_guarded_process_one` except handler); scenario minted at `:143` inside `_process_one`; rollup at `:470` and `status.py:36-53` (`run_status`).
- Summary: Isolation is correct (one scenario's failure should not abort the slice), but the `except` only logs. It does not append to `processed` nor write an errored status via `edit_scenario`, so the failed scenario drops out of the run rollup (`has_errors = any(item.has_errors for item in processed)` at `:470`, and `run_status` in `status.py` only sees the appended items). Any single scenario that errors during an SDK evaluation (one bad input, one failed invocation) silently shrinks the result set with no signal and no error recorded against it.
- Evidence (verified 2026-06-08): handler at `:461-466` only calls `logger.error("[SLICE] scenario processing failed", ...)`; no `processed.append`, no `edit_scenario(status=ERRORS)`. `ProcessedScenario` (`status.py:8-16`) needs only `scenario` + `has_errors=True` (rest default). `EvaluationStatus.ERRORS` exists (`models/evaluations.py:37`). `edit_scenario` is an injected callable in scope at the processor top-level (`:106`, used at `:439-440`). The backend processor uses this same shared SDK handler, so it has the same gap — its in-loop `edit_scenario` at `:439-440` does fire on success/normal paths but NOT on the swallowed-exception path.
- Cause: failure path logs but neither records an errored scenario nor surfaces it to the rollup.
- Suggested Fix (REVISED — original fix has a scope blocker): the `scenario` is a **local inside `_process_one` (`:143`)**, so the `except` in the OUTER `_guarded_process_one` cannot reach it — you cannot naïvely call `edit_scenario(scenario=...)` from there. Restructure so the failure is handled where the scenario is in scope: catch inside `_process_one` (after `:143` mints the scenario), mark it errored via `edit_scenario(scenario=scenario, status=EvaluationStatus.ERRORS)`, and append an errored `ProcessedScenario(scenario=scenario, has_errors=True)` under `processed_lock`. Keep `_guarded_process_one` as a coarse last-resort shield for failures BEFORE the scenario is minted (e.g. `create_scenario` itself throwing) — those have no scenario to record, so logging is the only option, but they should still be counted (consider a sentinel errored entry or a slice-level error counter so the rollup is not silently short).
- Sources: PR #4341 thread, comment 3375239778 (@mmabrouk). Investigation 2026-06-08: CONFIRMED; fix needs restructuring (scope blocker), not a one-line handler edit.

### [OPEN] UEL-040: Step-removal orphan check runs one `query_results` per affected scenario

- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: needs-user-decision
- Category: Performance
- Files: `api/oss/src/core/evaluations/service.py:628-637` (loop over `affected_scenario_ids`)
- Summary: After a step is removed, the orphan check loops over every affected scenario and runs `query_results` once each to see whether any cells remain. On a run with many scenarios this is one round trip per scenario where a single query for the whole set would answer the same question. Not a correctness problem — step removal on a large run pays an avoidable cost.
- Evidence (verified 2026-06-08): `:628-635` — `for scenario_id in affected_scenario_ids: remaining = await self.query_results(result=EvaluationResultQuery(run_id=run.id, scenario_ids=[scenario_id]))`, a single-element list per iteration. `EvaluationResultQuery.scenario_ids` is `Optional[List[UUID]]` (`types.py:456`) and the DAO applies it via `.in_(...)` (`dao.py:1756-1759`), so the batched form is supported. The per-scenario query uses ONLY `run_id` + `scenario_id` (no extra per-scenario filter), so batching is clean.
- Cause: per-scenario query instead of a single batched fetch.
- Suggested Fix: Fetch remaining results for all `affected_scenario_ids` in one `query_results` call (pass the full list as `scenario_ids`), group by `scenario_id` in memory, treat a scenario with no remaining cells as an orphan. N queries → 1. No correctness caveat.
- Sources: PR #4341 thread, comment 3375254354 (@mmabrouk). Investigation 2026-06-08: CONFIRMED, batched API exists, no caveat.

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

### [OPEN] UEL-042: SDK async engine mostly serializes — blocking HTTP client under `asyncio.gather` (out of scope for this PR)

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: needs-user-decision
- Category: Performance
- Files: `sdks/python/agenta/sdk/evaluations/preview/utils.py:693` (`afetch_trace`); blocking calls in adapters `scenarios.py:30` (`aadd`) / `:132` (`aedit_scenario`), `results.py:33` (`apopulate`), `metrics.py:93` (`arefresh`); fan-out at `runtime/processor.py:468`.
- Summary: The SDK fans out scenarios with `asyncio.gather` (`processor.py:468`), but the calls that save results, refresh metrics, edit scenarios, and fetch traces all go through the blocking HTTP client (`authed_api()`), each holding the event loop until it returns — so the fanned-out work runs one call at a time and the concurrency mostly serializes. `afetch_trace` is the worst case: a retry loop of `max_retries=30` with `delay=1.0` means one slow/missing trace can block the whole loop ~30s while nothing else progresses.
- Evidence (verified 2026-06-08): `afetch_trace` (`utils.py:693`) is `async` but calls `authed_api()(...)` (`:709`) synchronously inside the loop — not awaited, not `to_thread`'d. Five adapter helpers (`aadd`, `aedit_scenario`, `apopulate`, `arefresh`, `afetch_trace`) all call the blocking `authed_api()`. `authed_async_api()` is defined (`sdk/utils/client.py:41`) with an identical `(method, endpoint, **kwargs)` signature and is **unused anywhere under `sdk/evaluations/`** (only referenced in `managers/apps.py`, `managers/shared.py`).
- Cause: blocking client under an async fan-out; predates this PR.
- Suggested Fix: Switch these adapters/helpers to `authed_async_api()` — lower-risk than `asyncio.to_thread`: signature-compatible, the helpers are already `async`, so the change is `response = await authed_async_api()(method=..., endpoint=...)`. `to_thread` is the fallback (doesn't address root cause, adds thread overhead). For the trace path, also revisit the 30s-per-cell retry budget. **Out-of-scope confirmed:** `authed_api`/`authed_async_api` are shared client utilities used well beyond evals (managers, eval reads), so this is a library-wide change that belongs in its own PR, as the reviewer noted.
- Sources: PR #4341 thread, comment 3375244177 (@mmabrouk, flagged out-of-scope). Investigation 2026-06-08: CONFIRMED; `authed_async_api()` exists + unused in evals; async-client swap is the lower-risk fix.

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
