# Unified Eval Loops Findings

Review scope: `feat/unified-eval-loops` branch (PR [#4341](https://github.com/Agenta-AI/agenta/pull/4341), base `release/v0.103.0`), synced against the open GitHub review threads.

Sources:

- GitHub PR #4341 review threads (9 comments, all from @mmabrouk, all currently unresolved). Pulled 2026-06-08.
- Per-finding re-verification against the current `feat/unified-eval-loops` checkout (each comment's claim was re-checked against the cited file/line before recording).
- Historical closed findings (UEL-001..033) retained in `findings.old.md`.

## Summary

- Status: 9 open findings synced from PR #4341 review threads (UEL-034..042). All re-verified as present in current code.
- Severity spread: 1 P1 (data loss on finalize), 2 P2 (silent failure-drop in SDK; migration single-transaction/lock footprint), 6 P2/P3 (dead code, exception-mapping gap, connection-pool churn, three N+1 query paths). One is flagged by the reviewer as out-of-scope for this PR (UEL-038, async-engine serialization).
- All 9 GitHub threads are `unresolved` / not `outdated`; none have been replied to. Left open pending user disposition — no threads resolved in this sync.
- Note: UEL-035 (migration single-transaction + `id::text` keyset) lives in the same migration file as the in-progress "default queue name backfill" fix, but is a distinct concern (transaction/lock footprint, not the `name` column) and is untouched by that fix.

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

### [OPEN] UEL-035: Backfill migration runs as one long transaction; text-cast keyset defeats the PK index

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: needs-user-decision
- Category: Migration
- Files: `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py:282` (batch loop), `:44` (keyset query). EE copy mirrors this.
- Summary: The loop chunks work by `BATCH_SIZE` but never commits. Alembic runs with `transaction_per_migration=True` (see `migrations/core/env.py`), so nothing commits until `upgrade()` returns — every flag update, created queue, and archived queue stays inside a single open transaction for the full run. On a large `evaluation_runs` table this holds locks the whole time, grows the WAL, and risks a statement/lock timeout that rolls back everything. The header comment calling this "chunked and safe to re-run" is misleading for the lock/transaction footprint. Separately, the keyset query casts `id::text` and orders by text, which prevents the `uuid` PK index from being used, so each page scans + sorts the whole table.
- Evidence: No `connection.commit()` in the loop body; `cursor = ids[-1]` then loops. `_NEXT_RUN_IDS` uses `WHERE id::text > :cursor ORDER BY id::text`.
- Cause: per-statement chunking does not bound the transaction; text-cast comparison is not index-sargable on a `uuid` column.
- Suggested Fix: Add `connection.commit()` after each batch (each step is idempotent — create uses an existence check, archive is a conditional update, flag write is a deterministic merge — so per-batch commits are safe and a mid-run failure resumes cleanly). Page on native `id` (`WHERE id > :cursor ORDER BY id`, seeded with the zero UUID) so the PK index is used.
- Alternatives: Keep single-transaction if the target installs are known-small, but then drop the "safe to re-run / chunked" framing from the header comment.
- Sources: PR #4341 thread, comment 3375211093 (@mmabrouk). Note: distinct from the in-progress `name` backfill fix on this same file.

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

### [OPEN] UEL-037: `archive_queue` / `unarchive_queue` handlers are defined but never registered (dead code)

- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: needs-user-decision
- Category: Completeness
- Files: `api/oss/src/apis/fastapi/evaluations/router.py:1736` (`archive_queue`), `:1760` (`unarchive_queue`)
- Summary: Both handlers are complete with permission checks, but nothing registers them — no `add_api_route` and no `/archive` or `/unarchive` path anywhere in the router, so neither endpoint is reachable. Not a runtime bug, but misleading: handlers that look live but are wired to nothing cost the next reader time, and the permission checks imply an intended lifecycle endpoint that someone may assume works.
- Evidence: `grep` for `/archive` / `/unarchive` route strings returns nothing; the only hits are the handler defs and the service calls inside them.
- Cause: routes never added (or removed) after the handlers were written.
- Suggested Fix: Either register `/{id}/archive` and `/{id}/unarchive` via `add_api_route` (per the AGENTS.md lifecycle convention), or remove both handlers until the routes are needed.
- Sources: PR #4341 thread, comment 3375254138 (@mmabrouk).

### [OPEN] UEL-038: Deleting a default queue returns 500 instead of 409 (missing exception-mapping decorator)

- Origin: sync
- Lens: verification
- Severity: P2
- Confidence: high
- Status: needs-user-decision
- Category: Correctness
- Files: `api/oss/src/apis/fastapi/evaluations/router.py:2931` (`delete_simple_queue`), `:2957` (`delete_simple_queues`)
- Summary: Both delete handlers carry only `@intercept_exceptions()` and are missing `@handle_evaluation_closed_exception()`, the decorator that translates evaluation domain exceptions into proper HTTP responses. The delete path can raise `DefaultQueueDeletionForbidden`; without the translating decorator that surfaces as a generic 500 instead of the intended 409, reading to the user as a crash rather than a clear "cannot delete the default queue" message. The run/result delete handlers above stack both decorators.
- Evidence: line 2930 `@intercept_exceptions()` directly above `async def delete_simple_queue` (2931); no `@handle_evaluation_closed_exception()` present. Same for `delete_simple_queues` (2956/2957).
- Cause: missing decorator on these two handlers.
- Suggested Fix: Add `@handle_evaluation_closed_exception()` beneath `@intercept_exceptions()` on both handlers.
- Sources: PR #4341 thread, comment 3375254252 (@mmabrouk).

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

None in this sync. Historical closed findings (UEL-001..033) are retained in `findings.old.md`.
