# Unified Eval Loops — Branch Breakdown

Diff base: `release/v0.100.9`

This branch is not a clean PR stack. It is a feature branch with several rounds
of implementation, refactors, follow-up fixes, and test backfills. The earlier
`breakdown.md` tried to impose a speculative split that does not line up well
with the actual diff.

This version is grounded in the current branch contents and groups changes by
reviewable change-cluster rather than by an idealized incremental history.

## Scope excluded from this breakdown

These changed files are auto-generated and should not drive the review split:

- Fern / generated API clients
- `docs/docs/reference/api/**`

Those files should be regenerated after the code-facing API is settled.

## Size, excluding generated churn

The full branch touches 595 files, but the biggest bucket is generated output:

- `docs/docs/reference/api/**`: 291 files
- Fern / generated clients: large follow-on churn across `clients/` and `web/packages/agenta-api-client/`

What remains is still a substantial branch centered on four real code streams:

1. Unified eval loops core: OSS runtime, evaluation API/persistence, and Python SDK parity
2. Access-control refactor and scope/auth wiring
3. EE admin/org/events follow-ons
4. Small web UI and local infra adjustments

## Chunk 1 — Unified eval loops core: OSS runtime, evaluation API, persistence, and SDK parity

This is the core of the branch.

The old evaluation execution path is replaced with a new runtime-oriented
structure in the OSS API, the evaluation domain model and queue semantics are
reworked around that runtime, and the Python SDK gains a parallel runtime so
local `evaluate()` and server-side execution use the same concepts.

What actually changed:

- OSS runtime package:
  - `api/oss/src/core/evaluations/runtime/models.py`
  - `api/oss/src/core/evaluations/runtime/topology.py`
  - `api/oss/src/core/evaluations/runtime/planner.py`
  - `api/oss/src/core/evaluations/runtime/tensor.py`
  - `api/oss/src/core/evaluations/runtime/sources.py`
  - `api/oss/src/core/evaluations/runtime/adapters.py`
  - `api/oss/src/core/evaluations/runtime/executor.py`
  - `api/oss/src/core/evaluations/runtime/cache.py`
  - `api/oss/src/core/evaluations/runtime/runner.py`
  - `api/oss/src/core/evaluations/runtime/locks.py`
- Task orchestration rewritten around:
  - `api/oss/src/core/evaluations/tasks/run.py`
  - `api/oss/src/core/evaluations/tasks/processor.py`
  - `api/oss/src/core/evaluations/tasks/query.py`
- Legacy task paths removed or hollowed out:
  - `api/oss/src/core/evaluations/tasks/legacy.py` deleted
  - `api/oss/src/core/evaluations/tasks/live.py` largely replaced
  - `api/oss/src/core/evaluations/tasks/batch.py` reduced
- Core service contracts updated:
  - `api/oss/src/core/evaluations/interfaces.py`
  - `api/oss/src/core/evaluations/types.py`
  - `api/oss/src/core/evaluations/utils.py`
  - `api/oss/src/core/evaluations/service.py`
- Worker wiring updated:
  - `api/oss/src/tasks/taskiq/evaluations/worker.py`
  - `api/entrypoints/worker_evaluations.py`
- Evaluation API layer:
  - `api/oss/src/apis/fastapi/evaluations/models.py`
  - `api/oss/src/apis/fastapi/evaluations/router.py`
  - `api/oss/src/apis/fastapi/evaluations/utils.py`
- Evaluation persistence:
  - `api/oss/src/dbs/postgres/evaluations/dbes.py`
  - `api/oss/src/dbs/postgres/evaluations/dao.py`
  - `api/oss/src/dbs/postgres/evaluations/utils.py`
- Default queue migrations:
  - `api/oss/databases/postgres/migrations/core/versions/a1d2e3f4a5b6_add_default_evaluation_queues.py`
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py`
  - EE mirror migrations under `api/ee/databases/postgres/migrations/core/versions/`
- Service-level behavior changes visible from commits and tests:
  - default queue creation/backfill
  - one active default queue invariant
  - archive/unarchive rules
  - closed-run conflict handling
  - run/queue query flags
  - refresh-metrics dispatch behavior
  - batch query to evaluator finalization fixes
  - concurrency data on runs

The branch history shows this was not a single clean implementation. It was
implemented, then corrected by several follow-up fixes:

- default queue lifecycle/policy
- closed-run 409 behavior
- evaluator-run finalization
- refresh metrics dispatch
- exact source-family resolution

Tests backing this cluster:

- `api/oss/tests/pytest/acceptance/evaluations/_flow_helpers.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_closed_run_guard.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_default_queue_lifecycle.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_default_queue_policy.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_flows_modify.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_flows_run.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_metrics_flow.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_metrics_refresh.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_simple_evaluations_workflows.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py`
- `api/oss/tests/pytest/unit/evaluations/test_cache_split_utils.py`
- `api/oss/tests/pytest/unit/evaluations/test_query_eval_loops.py`
- `api/oss/tests/pytest/unit/evaluations/test_queue_dao_serialization.py`
- `api/oss/tests/pytest/unit/evaluations/test_run_flag_matrix.py`
- `api/oss/tests/pytest/unit/evaluations/test_run_flags.py`
- New SDK runtime package:
  - `sdks/python/agenta/sdk/evaluations/runtime/__init__.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/models.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/topology.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/planner.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/adapters.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/executor.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/processor.py`
- Preview evaluation path updated:
  - `sdks/python/agenta/sdk/evaluations/preview/evaluate.py`
  - `sdks/python/agenta/sdk/evaluations/results.py`
  - `sdks/python/agenta/sdk/models/evaluations.py`
- Supporting runtime/engine adjustments:
  - `sdks/python/agenta/sdk/engines/running/errors.py`
  - `sdks/python/agenta/sdk/engines/running/handlers.py`
  - `sdks/python/agenta/sdk/engines/running/interfaces.py`
  - `sdks/python/agenta/sdk/engines/running/utils.py`
  - `sdks/python/agenta/sdk/middlewares/running/vault.py`
  - `sdks/python/agenta/sdk/middlewares/routing/auth.py`
  - `sdks/python/agenta/sdk/managers/applications.py`
  - `sdks/python/agenta/sdk/managers/evaluators.py`
  - `sdks/python/agenta/sdk/litellm/mocks/__init__.py`

Tests added or expanded:

- `sdks/python/oss/tests/pytest/acceptance/evaluations/test_evaluate_flow.py`
- `sdks/python/oss/tests/pytest/integration/test_evaluate_orchestration.py`
- `sdks/python/oss/tests/pytest/unit/test_evaluate_specs.py`
- `sdks/python/oss/tests/pytest/unit/test_evaluations_runtime.py`
- `sdks/python/oss/tests/pytest/utils/test_mock_v0.py`
- `sdks/python/oss/tests/pytest/acceptance/integrations/test_vault_secrets.py`

Review note:
This is not three independent chunks. The OSS runtime, evaluation API/queue
behavior, and SDK runtime are one feature stream and should be reviewed
together. If anyone ever needs to split it further, the only sensible seam is:

- runtime internals and task orchestration
- product-facing evaluation API/persistence semantics
- SDK parity and test coverage

## Chunk 2 — Access-control refactor and scope/auth wiring

Separate from evaluations, the branch also refactors access control and pushes
more explicit scope/auth wiring through OSS and EE.

This stream is real, but it is not the main story of the branch.

What actually changed:

- New EE access package:
  - `api/ee/src/core/access/controls.py`
  - `api/ee/src/core/access/entitlements/*`
  - `api/ee/src/core/access/permissions/*`
- Old EE entitlement code removed or reduced:
  - `api/ee/src/core/entitlements/controls.py`
  - `api/ee/src/core/entitlements/service.py`
- OSS access endpoint added:
  - `api/oss/src/apis/fastapi/access/router.py`
- EE access endpoint override:
  - `api/ee/src/apis/fastapi/access/router.py`
- Auth/helper wiring updates:
  - `api/oss/src/core/auth/helper.py`
  - `api/oss/src/core/auth/service.py`
  - `api/oss/src/core/auth/supertokens/overrides.py`
  - `api/oss/src/core/auth/turnstile.py`
- Broad router touch-ups consistent with scope/auth propagation:
  - multiple files in `api/oss/src/apis/fastapi/*/router.py`
- Related DAO/service touch-ups:
  - `api/oss/src/dbs/postgres/blobs/dao.py`
  - `api/oss/src/dbs/postgres/events/dao.py`
  - `api/oss/src/dbs/postgres/folders/dao.py`
  - `api/oss/src/dbs/postgres/git/dao.py`
  - `api/oss/src/dbs/postgres/secrets/*`
  - `api/oss/src/dbs/postgres/tools/dao.py`
  - `api/oss/src/dbs/postgres/tracing/dao.py`
  - `api/oss/src/dbs/postgres/users/dao.py`
  - `api/oss/src/dbs/postgres/webhooks/dao.py`
  - `api/oss/src/dbs/postgres/shared/dbas.py`

EE follow-on files tied to the new access package:

- `api/ee/src/core/meters/*`
- `api/ee/src/core/subscriptions/*`
- `api/ee/src/dbs/postgres/meters/dao.py`
- `api/ee/src/dbs/postgres/subscriptions/dao.py`
- `api/ee/src/apis/fastapi/billing/router.py`
- `api/ee/src/middlewares/throttling.py`

Tests:

- `api/ee/tests/pytest/unit/test_access_controls.py`
- `api/ee/tests/pytest/unit/test_controls_env_override.py`
- `api/ee/tests/pytest/unit/test_billing_router.py`
- `api/ee/tests/pytest/unit/test_billing_settings.py`
- `api/ee/tests/pytest/unit/test_compute_meter_id.py`
- `api/ee/tests/pytest/unit/test_meters_dao_fetch.py`
- `api/ee/tests/pytest/unit/test_meters_dao_strict_soft.py`
- `api/ee/tests/pytest/unit/test_meters_types.py`
- `api/ee/tests/pytest/unit/test_period_from.py`
- `api/ee/tests/manual/test_billing_period.py`

Review note:
This stream can be reviewed independently from unified eval loops, but the branch
interleaves it with the evaluation work.

## Chunk 3 — EE org/events/admin cleanup and service-layer drift correction

There is a smaller EE-focused stream that cleans up admin/event/organization
paths and updates some legacy service code while the branch was open.

What actually changed:

- EE API/service/DAO changes:
  - `api/ee/src/apis/fastapi/events/router.py`
  - `api/ee/src/apis/fastapi/organizations/router.py`
  - `api/ee/src/apis/fastapi/spans/router.py`
  - `api/ee/src/core/events/service.py`
  - `api/ee/src/core/tracing/service.py`
  - `api/ee/src/core/workspaces/types.py`
  - `api/ee/src/dbs/postgres/events/dao.py`
  - `api/ee/src/dbs/postgres/organizations/dao.py`
  - `api/ee/src/dbs/postgres/tracing/dao.py`
  - `api/ee/src/main.py`
- Legacy EE service churn:
  - `api/ee/src/services/admin_manager.py`
  - `api/ee/src/services/commoners.py`
  - `api/ee/src/services/db_manager_ee.py`
  - `api/ee/src/services/organization_service.py`
  - `api/ee/src/services/workspace_manager.py`
  - `api/ee/src/services/converters.py` deleted
  - `api/ee/src/services/db_manager.py` deleted
  - `api/ee/src/services/email_helper.py` deleted
  - `api/ee/src/services/selectors.py` deleted
  - `api/ee/src/services/templates/send_email.html` removed

This cluster also has a small OSS-parity trail in old routers/services:

- `api/oss/src/routers/*`
- `api/oss/src/services/*`
- `api/oss/src/models/api/workspace_models.py`

Review note:
This is the noisiest non-evaluation chunk because it mixes cleanup, naming,
deletions, and parity fixes. It is better described as branch hygiene plus EE
admin follow-ons than as a single intentional feature.

## Chunk 4 — Local infra, worker, and web follow-ons

The branch also includes a set of supporting changes that are real but smaller.

Infra and worker support:

- `api/oss/src/utils/lazy.py`
- `api/oss/src/utils/caching.py`
- `api/oss/src/utils/emailing.py`
- `api/oss/src/utils/env.py`
- `api/oss/src/dbs/postgres/shared/engine.py`
- `api/oss/src/dbs/redis/shared/engine.py`
- `api/oss/src/middlewares/analytics.py`
- `api/oss/src/middlewares/auth.py`
- `api/oss/src/tasks/asyncio/events/worker.py`
- `api/oss/src/tasks/asyncio/tracing/worker.py`
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py`
- `api/entrypoints/routers.py`
- `api/entrypoints/worker_events.py`
- `api/entrypoints/worker_tracing.py`
- `api/entrypoints/worker_webhooks.py`
- `services/entrypoints/main.py`
- `services/oss/src/managed.py`
- `hosting/docker-compose/oss/docker-compose.dev.yml`
- `hosting/docker-compose/ee/docker-compose.dev.yml`

Frontend follow-ons:

- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/AdvancedSettings.tsx`
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/NewEvaluationModalInner.tsx`
- `web/oss/src/components/pages/evaluations/NewEvaluation/assets/constants.ts`
- `web/oss/src/components/pages/evaluations/NewEvaluation/types.ts`
- `web/oss/src/services/evaluations/api/index.ts`
- `web/packages/agenta-entities/src/secret/api/api.ts`
- package/lockfile churn under `web/`

The frontend part is small and clearly downstream of the evaluation API changes:
it exposes advanced evaluation settings, including concurrency-related fields,
and updates the request payload shape.

## Docs in this branch

Non-generated design docs are a separate stream and should be reviewed as docs,
not as evidence of the implementation split:

- `docs/designs/unified-eval-loops/**`
- `docs/designs/unify-evals-and-queues/**`
- `docs/designs/eval-loops/**`
- `docs/designs/access-controls-refactor-plan.md`
- `docs/designs/scope-only-routers-plan.md`
- `docs/designs/third-party-subsystem-access.md`

## Recommended review order

If someone needs to review this branch as it exists today, this is the least
confusing order:

1. Chunk 1: Unified eval loops core
2. Chunk 2: Access-control refactor and scope/auth wiring
3. Chunk 3: EE org/events/admin cleanup and service-layer drift correction
4. Chunk 4: Local infra, worker, and web follow-ons
5. Design docs

## Bottom line

The branch is mostly not “many small independent features.” It is:

- one large unified-eval-loops stream spanning OSS runtime, evaluation API/persistence, and SDK parity
- one medium access-control/scope stream
- one smaller EE/admin cleanup stream
- one thin frontend/infra follow-on stream

That is the shape the breakdown should reflect.
