# Scalability hardening — specs

> Closes the two High scalability defects from the v3 assessment (S-1, S-3), plus the two cheap
> reliability residuals in the same neighborhood (S-4, R-1). Source: `big-agents-audit/big-agents-assessment-v3.md`.
> Scoped, independent fixes — no shared architecture, no dependency on the redaction or spine work.

## S-1 — Real per-box runner concurrency limit (High)

**Naming (decided):** use **"concurrency limit"**, not "cap." Rename the existing method
`check_concurrency_cap` → **`check_runner_concurrency_limit`** and use the env knob
**`AGENTA_RUNNER_CONCURRENCY_LIMIT`** for the runner's in-process value. (The existing `CONCURRENCY_CAP`
constant name may stay where it's a shared wire/contract constant, but the service method and the new env
var use "limit".)

**Problem.** A `CONCURRENCY_CAP=1000` constant exists (`services/runner/src/sessions/contract.ts:77`,
`api/oss/src/dbs/redis/sessions/contract.py:91`) and a `check_concurrency_cap` is wired — but it is a
**global** DB count that ignores its `project_id` arg (`count_active(project_id=None)`,
`core/sessions/streams/service.py:332`) and it gates only the **command** route
(`apis/fastapi/sessions/router.py:237`), **not** `/invoke`/`/stream`. The runner itself has **no
in-process in-flight counter, no admission gate, no rejection path** — the const is just a shared number.
One hot replica saturates and OOMs while the global count sits under the cap.

**Fix (belt-and-suspenders).**
1. **Per-process limit in the runner (TS):** an in-flight counter at the admission point of `/invoke` and
   `/stream`; reject with **429** (or bounded queue) when at the limit. Value from
   `AGENTA_RUNNER_CONCURRENCY_LIMIT`. Per-box protects the box.
2. **Per-project API limit:** rename `check_concurrency_cap` → `check_runner_concurrency_limit` and drop
   `project_id=None` so `count_active` gates per-project. Per-project protects the tenant. Update the call
   site (`apis/fastapi/sessions/router.py:237`) and any imports/tests referencing the old name.

Limit value comes from config (env `AGENTA_RUNNER_CONCURRENCY_LIMIT`), not a hard-coded constant. Anchors:
`services/runner/src/server.ts` admission points; `services/runner/src/sessions/contract.ts`; API side
`core/sessions/streams/service.py:330` (the method to rename), `apis/fastapi/sessions/router.py:237` (call
site), `api/oss/src/dbs/postgres/sessions/streams/dao.py` (`count_active`), env in
`api/oss/src/utils/env.py`.

**Done when:** a runner at the limit rejects new `/invoke`+`/stream` with 429 (unit-tested at the
admission point); the service method is `check_runner_concurrency_limit` and its count is per-project (no
`project_id=None`); the runner value reads `AGENTA_RUNNER_CONCURRENCY_LIMIT`; the existing golden-fixture
contract still holds; no stale `check_concurrency_cap` reference remains.

## S-3 — Webhook batch-poisoning re-dispatch (High)

**Problem.** On any single enqueue failure the dispatcher raises **after** already enqueuing many
deliveries; the worker then skips the ack for the whole Redis-Streams batch → the batch is redelivered →
duplicate `deliver_task.kiq()` for the ones that already succeeded. `delivery_id` is freshly minted per
pass (`dispatcher.py:271` `uuid7()`), so there is no dedup backstop.

**Fix.**
1. **Partial-ack:** ack the successes, dead-letter/retry only the failures — never fail the whole batch
   for one bad delivery.
2. **Deterministic `delivery_id`:** derive it from `(event_id, subscription_id)` (e.g. uuid5 over that
   tuple) so a redelivery **dedups** instead of firing a fresh id each pass.

Anchor: `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` (mint at :271, per-batch ack path).

**Done when:** one failing delivery in a batch does not cause the successful ones to redeliver;
`delivery_id` is stable across redelivery passes for the same `(event_id, subscription_id)`.

## S-4 — Streams first-touch check-then-insert → uncaught 500 (Low, Very-Low effort)

**Problem.** SEND is serialized by a Redis alive-lock, but the direct heartbeat/invoke first-touch path
can still double-`create()` (no `ON CONFLICT`). The `EntityCreationConflict`→409 mapping exists but is
never raised in the streams DAO, so an unlucky race surfaces as a generic 500.

**Fix.** `INSERT … ON CONFLICT (project_id, session_id) DO NOTHING` + re-read, **or** catch the
`IntegrityError` and raise `EntityCreationConflict` (→ mapped 409). Anchor:
`api/oss/src/dbs/postgres/sessions/streams/dao.py`.

**Done when:** a concurrent first-touch race yields a clean 409 (or a no-op re-read), never a 500.

## R-1 — Duplicate downstream enqueue on concurrent respond (Low)

**Problem.** The interactions CAS protects the DB row (real `UPDATE…WHERE status IN(...) RETURNING`), but
the workflow enqueue fires **before** the CAS flip, so two concurrent responds can both enqueue even
though only one wins the row.

**Fix.** Move the enqueue to **after** a successful CAS — enqueue only if the transition returned a row.

**Done when:** two concurrent responds enqueue the downstream workflow exactly once.

## Non-goals

S-2 (per-session HOME mount) is part of the deferred stateless-per-turn spine — **out of scope here**.
No new architecture; these are four contained fixes.
