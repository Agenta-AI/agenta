# QA — `feat/unified-eval-loops`

This branch adds API and SDK surface (slice operations, queues, run-shape
mutation, concurrency, default queues). Most of it is not exposed in web or in
the SDK `evaluate()` path. The user-facing changes are: bug and regression
fixes, the concurrency controls in the New Evaluation modal, and a default
annotation queue created automatically for runs that have a human evaluator.

The goal of QA is to confirm existing evaluation flows still behave as on main,
and to check the new behaviors above. The branch also adds database migrations,
so EE testing is done before and after the migration.

## Package 1 — OSS sanity (local)

- [ ] Stack is healthy (api, worker, services, web, postgres, redis). If trace
      fetches flake, check the tracing worker with `docker logs` and restart it.
- [ ] Log in, create an app, run a playground invocation and confirm a trace.
      Create a testset and an API key.
- [ ] Run one evaluation of each kind from the New Evaluation modal: auto,
      custom, human, and a multi-evaluator run. Confirm scores and aggregated
      metrics.
- [ ] For the human evaluator run, confirm a default annotation queue is created.
- [ ] For the multi-evaluator run, confirm a later evaluator is not affected by
      an earlier one.
- [ ] Open Advanced Settings, confirm the concurrency fields render and reset,
      and that a run with non-default values completes.

## Package 2 — EE sanity (before and after migration)

Run an EE deployment on main and prepare state:

- [ ] Create some evaluation runs, including a human-evaluator run.

Switch to this branch and spin the deployment back up so the migrations run:

- [ ] Confirm the migrations ran with `docker logs`, and inspect the affected
      tables and rows directly in Postgres.
- [ ] Repeat Package 1 in EE.
- [ ] Creating a run or simple queue charges the run counter once and refunds on
      failure. An over-quota request is rejected without a leftover charge.

## Package 3 — Deep QA

Results should match main unless noted.

### Web

- [ ] Cover the combinations of evaluator kind, number of variants, and testset
      size. Confirm scores, metrics, and the results table.
- [ ] For a human-evaluator run, confirm the queue is created and populated, that
      annotating writes a score into metrics, and that the default queue cannot be
      deleted if that is surfaced.
- [ ] If live evaluations or annotation queues are reachable in web, confirm they
      ingest and bucket metrics over time.
- [ ] Confirm the concurrency panel behaves: defaults persist, reset works,
      changing the app resets it, changing the testset or variant preserves it.
- [ ] Run lifecycle from the UI: start, stop, view results, open, close. No run
      stays in a running state.
- [ ] Confirm an evaluator running after another still scores against the app
      output.

### SDK

- [ ] Run SDK evaluations with `aevaluate()`.

## Cross-cutting (OSS and EE)

- [ ] Evaluator order never changes any input or score.
- [ ] No run stays in a non-terminal status.
- [ ] Aggregated metrics match the per-scenario values.
- [ ] Runs created before the branch are intact after the migration.
- [ ] The tracing worker stays up across an evaluation run.
- [ ] `py-run-tests` passes in `api/`, `services/`, and `sdks/python/`.
