# Scalability hardening — tasks

> Companion to `specs.md`. One worktree (`feat/scalability-hardening`). Four independent WPs; do them in
> any order — they touch disjoint files. Effort tags: Very Low · Low · Medium.

- **WP1 — S-1 runner per-box limit + per-project API limit.** Effort: Medium. Level: runner + API.
  - **Naming:** method `check_concurrency_cap` → `check_runner_concurrency_limit`; env
    `AGENTA_RUNNER_CONCURRENCY_LIMIT` for the runner value. Vocabulary is "limit," not "cap."
  - Runner (TS): in-flight counter + admission gate at `/invoke` and `/stream` in `server.ts`; reject at
    the limit with 429 (bounded queue optional). Value from `AGENTA_RUNNER_CONCURRENCY_LIMIT` (add to
    `api/oss/src/utils/env.py` via the shared `env` object), not a constant. Unit-test the admission gate
    (at-limit → 429; below → proceeds).
  - API: rename `check_concurrency_cap` → `check_runner_concurrency_limit`
    (`core/sessions/streams/service.py:330`) and update the call site (`apis/fastapi/sessions/router.py:237`)
    + any imports/tests; drop `project_id=None` in the `count_active` gate so it is per-project
    (`dbs/postgres/sessions/streams/dao.py`). Keep the golden-fixture contract green; leave no stale
    `check_concurrency_cap` reference.

- **WP2 — S-3 webhook partial-ack + deterministic delivery_id.** Effort: Low-Med. Level: API.
  - `tasks/asyncio/webhooks/dispatcher.py`: ack successes, dead-letter/retry only failures (partial-ack);
    stop raising for the whole batch on one failure.
  - Replace the per-pass `uuid7()` (`:271`) with a deterministic id from `(event_id, subscription_id)`.
  - Test: a batch with one failing delivery → successes are acked and not redelivered; same
    `(event_id, subscription_id)` → same `delivery_id` across passes.

- **WP3 — S-4 streams ON CONFLICT.** Effort: Very Low. Level: API.
  - `dbs/postgres/sessions/streams/dao.py`: `ON CONFLICT (project_id, session_id) DO NOTHING` + re-read,
    or catch `IntegrityError` → raise `EntityCreationConflict`. Test the concurrent first-touch race → 409
    (or clean re-read), never 500.

- **WP4 — R-1 enqueue-after-CAS.** Effort: Low. Level: API.
  - Move the workflow enqueue to after the interactions CAS returns a row (enqueue only on a winning
    transition). Test: two concurrent responds → exactly one enqueue.

## Verify
- API: from `api/` run `ruff format` then `ruff check --fix`; run the affected tests via `cd api && py-run-tests`.
- Runner: build/typecheck + the new admission-gate unit test (see `services/runner` scripts).
- Report real results; do NOT commit; do NOT deploy the stack.

## Constraints
- Env config via `api/oss/src/utils/env.py` + the shared `env` object, never raw `os.getenv`.
- Layering (Router→Service→DAO) applies to new domain code, not legacy routers.
- One terse comment line max, or none.
