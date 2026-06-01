# Unified Eval Loops — PR Breakdown

This document categorises every change on `feat/unified-eval-loops` (relative to
`release/v0.100.9`) into candidate PRs. 665 committed files + 998 staged files
are involved. The split is designed so each PR can be reviewed, merged, and
deployed independently (or in the stated order where a dependency exists).

---

## How to read this

- **Status** column: `committed` = already in HEAD; `staged` = in index but not
  yet committed; `both` = files in both states across the category.
- **Blocks / blocked by** rows indicate sequencing constraints.
- File counts are approximate (some files touch multiple categories; they are
  assigned to the primary one).

---

## PR A — Infra: lazy init, caching, engine wiring, middleware

**Theme:** Non-feature plumbing that everything else builds on.

| Area | Files |
|---|---|
| `api/oss/src/utils/lazy.py` | new lazy-init helper |
| `api/oss/src/utils/caching.py` | shared caching utilities |
| `api/oss/src/utils/env.py` | new env vars wired in |
| `api/oss/src/dbs/postgres/shared/engine.py` | engine-level changes |
| `api/oss/src/dbs/redis/shared/engine.py` | Redis engine-level changes |
| `api/oss/src/middlewares/__init__.py`, `analytics.py`, `auth.py` | middleware refactor |
| `api/ee/databases/postgres/migrations/core/env.py` | migration env wiring |
| `api/ee/databases/postgres/migrations/tracing/env.py` | tracing migration env |
| `api/oss/databases/postgres/migrations/core/utils.py` | migration utils |
| `api/ee/databases/postgres/migrations/core/utils.py` | EE migration utils |
| `api/entrypoints/routers.py` | router composition updates |
| `api/entrypoints/worker_*.py` (4 files) | worker entrypoint wiring |
| `services/entrypoints/main.py` | services entrypoint |
| `hosting/docker-compose/*/docker-compose.dev.yml` | dev compose updates |
| `.github/workflows/01-create-release-branch.yml` | CI: release branch workflow |
| `.github/workflows/09-helm-publish.yml` (deleted) | CI: helm publish removed |
| `.gitignore`, `.pre-commit-config.yaml` | tooling config |
| `AGENTS.md` | contributor guide updates |
| `api/check_deps.py` | dep check updates |

**Status:** committed + staged  
**Blocks:** all other API PRs

---

## PR B — Data migrations: slug repair, env reference slugs, org backfill

**Theme:** Standalone DB migrations that fix data-integrity issues. Can go out
independently as they are safe no-op when data is already clean.

| Area | Files |
|---|---|
| `api/oss/databases/postgres/migrations/core/versions/c4d5e6f7a8b9_strip_workflow_revision_data_extras.py` | strip extra data |
| `api/oss/databases/postgres/migrations/core/versions/d5e6f7a8b9c0_repair_retrieval_slug_corruption.py` | retrieval slug repair |
| `api/oss/databases/postgres/migrations/core/versions/e6f7a8b9c0d2_backfill_environment_reference_slugs.py` | env ref slugs |
| `api/oss/databases/postgres/migrations/core/versions/f7a8b9c0d1e2_backfill_oss_organization_slug.py` | org slug backfill |
| `api/oss/databases/postgres/migrations/core/data_migrations/` (4 files) | data migration scripts |
| EE mirror versions of the above (3 files) | same migrations in EE chain |

**Status:** committed + staged  
**Blocks:** none  
**Note:** Verify OSS + EE chains each have exactly one head after merge (`python3 find_head.py core`).

---

## PR C — EE: access-control, entitlements, permissions refactor (EE-only)

**Theme:** The `api/ee/src/core/access/` module is new — a structured refactor of
the EE access/entitlement/permission checks into sub-packages. Includes the new
OSS `/access` router that exposes the permissions-check endpoint.

| Area | Files |
|---|---|
| `api/ee/src/core/access/__init__.py` | new package |
| `api/ee/src/core/access/controls.py` | control knobs |
| `api/ee/src/core/access/entitlements/` (4 files) | entitlement service + types |
| `api/ee/src/core/access/permissions/` (4 files) | permission service + types |
| `api/ee/src/core/entitlements/controls.py`, `service.py` | existing entitlement layer touched |
| `api/oss/src/apis/fastapi/access/__init__.py`, `router.py` | new OSS access router |
| `api/ee/src/apis/fastapi/access/router.py` | EE override of access router |
| `api/oss/src/core/auth/helper.py`, `service.py`, `supertokens/overrides.py`, `turnstile.py` | auth helpers updated |
| `api/ee/tests/pytest/unit/test_access_controls.py` | access unit tests |
| Fern client: `access/client.ts`, `requests/CheckPermissionsRequest.ts` | TS client for /access |
| Python client: `access/client.py`, `raw_client.py` | Python client |

**Status:** committed  
**Blocked by:** PR A (entrypoint wiring)

---

## PR D — EE: billing, meters, subscriptions overhaul (EE-only)

**Theme:** Billing-tier and metering changes to support evaluation usage quotas and
concurrency caps. These are EE-only and only affect the billing/metering layer.

| Area | Files |
|---|---|
| `api/ee/src/core/meters/interfaces.py`, `service.py`, `types.py` | meter model updates |
| `api/ee/src/core/subscriptions/service.py`, `settings.py`, `types.py` | subscription tier updates |
| `api/ee/src/dbs/postgres/meters/dao.py` | meter DAO |
| `api/ee/src/dbs/postgres/subscriptions/dao.py` | subscription DAO |
| `api/ee/src/apis/fastapi/billing/router.py` | billing router |
| `api/ee/src/middlewares/throttling.py` | throttle by meter |
| `api/ee/tests/pytest/unit/test_billing_router.py`, `test_billing_settings.py`, `test_compute_meter_id.py`, `test_controls_env_override.py`, `test_meters_dao_*.py`, `test_meters_types.py`, `test_period_from.py`, `test_scope_from.py` | billing unit tests |
| `api/ee/tests/manual/test_billing_period.py` | manual billing test |

**Status:** committed  
**Blocked by:** PR A

---

## PR E — EE: org/workspace/events admin layer

**Theme:** Organisation management, workspace models, and audit/event plumbing
mostly in EE legacy service layer.

| Area | Files |
|---|---|
| `api/ee/src/core/events/service.py` | event service |
| `api/ee/src/core/tracing/service.py` | tracing service (EE) |
| `api/ee/src/core/workspaces/types.py` | workspace types |
| `api/ee/src/dbs/postgres/events/dao.py` | events DAO |
| `api/ee/src/dbs/postgres/organizations/dao.py` | org DAO |
| `api/ee/src/dbs/postgres/tracing/dao.py` | tracing DAO (EE) |
| `api/ee/src/main.py` | EE main extension |
| `api/ee/src/models/api/workspace_models.py` | workspace API models |
| `api/ee/src/routers/organization_router.py`, `workspace_router.py` | legacy routers |
| `api/ee/src/services/admin_manager.py`, `commoners.py`, `converters.py`, `db_manager.py`, `db_manager_ee.py`, `email_helper.py`, `organization_service.py`, `selectors.py`, `workspace_manager.py` | service layer |
| `api/ee/src/services/templates/send_email.html` | email template |
| `api/ee/src/apis/fastapi/organizations/router.py` | org router |
| OSS mirrors: `api/oss/src/services/*`, `api/oss/src/routers/*`, `api/oss/src/models/api/*` | OSS org/workspace parity |
| `api/ee/tests/pytest/unit/services/test_db_manager_ee.py` | db manager test |
| `api/ee/tests/pytest/unit/test_events_retention.py`, `test_admin_retention_routers.py` | event retention tests |

**Status:** committed  
**Blocked by:** PR A

---

## PR F — API: cross-domain router scope/auth wiring (OSS)

**Theme:** Nearly every existing OSS router has been touched to add
scope-enforcement, updated auth patterns, or parameter wiring. These are
individually small but wide-reaching changes. Grouped as one "safe no-behaviour-
change" PR.

| Area | Files |
|---|---|
| `api/oss/src/apis/fastapi/annotations/router.py` | scope wiring |
| `api/oss/src/apis/fastapi/applications/router.py` | scope wiring |
| `api/oss/src/apis/fastapi/environments/router.py`, `utils.py` | scope + env utils |
| `api/oss/src/apis/fastapi/evaluators/router.py` | scope wiring |
| `api/oss/src/apis/fastapi/events/router.py` | events router |
| `api/oss/src/apis/fastapi/folders/router.py` | folders router |
| `api/oss/src/apis/fastapi/invocations/router.py` | invocations router |
| `api/oss/src/apis/fastapi/legacy_variants/router.py` | legacy variants |
| `api/oss/src/apis/fastapi/otlp/router.py` | OTLP router |
| `api/oss/src/apis/fastapi/queries/router.py` | queries router |
| `api/oss/src/apis/fastapi/testcases/router.py` | testcases router |
| `api/oss/src/apis/fastapi/testsets/router.py` | testsets router |
| `api/oss/src/apis/fastapi/tools/router.py` | tools router |
| `api/oss/src/apis/fastapi/traces/router.py` | traces router |
| `api/oss/src/apis/fastapi/tracing/router.py` | tracing router |
| `api/oss/src/apis/fastapi/vault/router.py` | vault router |
| `api/oss/src/apis/fastapi/webhooks/router.py` | webhooks router |
| `api/oss/src/apis/fastapi/workflows/router.py` | workflows router |
| `api/oss/src/core/accounts/service.py` | accounts service |
| `api/oss/src/core/secrets/services.py` | secrets service |
| `api/oss/src/core/events/streaming.py`, `utils.py` | event streaming |
| `api/oss/src/core/tracing/streaming.py` | tracing streaming |
| `api/oss/src/core/workflows/service.py` | workflow service |
| `api/oss/src/dbs/postgres/blobs/dao.py`, `events/dao.py`, `folders/dao.py`, `git/dao.py`, `secrets/dao.py`, `secrets/mappings.py`, `tools/dao.py`, `tracing/dao.py`, `users/dao.py`, `webhooks/dao.py` | DAO scope enforcement |
| `api/oss/src/dbs/postgres/shared/dbas.py` | shared DBA mixins |
| `api/oss/src/tasks/asyncio/events/worker.py`, `tracing/worker.py`, `webhooks/dispatcher.py` | asyncio task workers |
| `api/oss/tests/pytest/acceptance/accounts/test_actions.py` | account tests |
| `api/oss/tests/pytest/unit/auth/test_helper.py` | auth helper tests |
| `api/oss/tests/pytest/unit/events/test_events_utils.py` | events utils test |
| `api/oss/tests/legacy/old_tests/unit/test_llm_apps_service.py`, `vault_router/conftest.py` | legacy test cleanup |
| `api/oss/tests/pytest/unit/test_llm_apps_service.py` | llm apps test |
| SDK: `sdks/python/agenta/sdk/middlewares/routing/auth.py`, `running/vault.py`, `managers/applications.py`, `evaluators.py`, `engines/running/*` | SDK auth/vault/manager updates |
| `examples/python/evaluators/ag/secrets_check.py` | evaluator example |

**Status:** committed + staged  
**Blocked by:** PR A, PR C

---

## PR G — API: evaluation queues — default queue lifecycle + DB migrations

**Theme:** Introduces the concept of a *default evaluation queue* (auto-created
per-project). New DB columns, Alembic migrations, service-level policy
enforcement (archive/unarchive guard for default queue), and the
`DefaultQueueDataInvalid / DefaultQueueDemotionForbidden / DefaultQueueDeletionForbidden`
exception hierarchy.

| Area | Files |
|---|---|
| `api/oss/databases/postgres/migrations/core/versions/a1d2e3f4a5b6_add_default_evaluation_queues.py` | new queue schema |
| `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py` | backfill existing projects |
| EE mirrors of both migrations | EE chain |
| `api/ee/databases/postgres/migrations/core/data_migrations/applications_workflow.py` | EE data migration helper |
| `api/oss/src/core/evaluations/types.py` (partial) | new exception types + `EvaluationRunDataConcurrency` |
| `api/oss/src/core/evaluations/service.py` (partial) | default queue policy + `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS` toggle |
| `api/oss/src/dbs/postgres/evaluations/dbes.py` | `is_default` column on queue DBE |
| `api/oss/src/dbs/postgres/evaluations/dao.py` (partial) | default-queue DAO helpers |
| `api/oss/tests/pytest/acceptance/evaluations/test_default_queue_lifecycle.py` | lifecycle acceptance test |
| `api/oss/tests/pytest/acceptance/evaluations/test_default_queue_policy.py` | policy acceptance test |
| Fern/Python client: `EvaluationQueueFlags.ts`, `EvaluationQueueQuery.ts`, `SimpleQueueKind.ts`, `FetchDefaultQueueRequest`, `ArchiveQueueRequest`, `UnarchiveQueueRequest` | client types |

**Status:** committed  
**Blocked by:** PR A, PR F  
**Note:** Alembic chains must stay linear; run `find_head.py core` in both OSS and EE after merge.

---

## PR H — API: unified eval runtime — topology, planner, tensor, sources, executor (core)

**Theme:** The heart of the branch. Introduces the new
`api/oss/src/core/evaluations/runtime/` sub-package that replaces the old
monolithic `tasks/batch.py` and `tasks/live.py` (which are deleted / shrunk to
stubs).

| Area | Files |
|---|---|
| `api/oss/src/core/evaluations/runtime/models.py` | `TopologyDecision`, dispatch labels |
| `api/oss/src/core/evaluations/runtime/planner.py` | step normalizer + graph planner |
| `api/oss/src/core/evaluations/runtime/topology.py` | `classify_run_topology` dispatcher |
| `api/oss/src/core/evaluations/runtime/tensor.py` | execution tensor / cartesian-product logic |
| `api/oss/src/core/evaluations/runtime/sources.py` | `resolve_queue_source_batches` |
| `api/oss/src/core/evaluations/runtime/executor.py` | executor interface |
| `api/oss/src/core/evaluations/runtime/adapters.py` | adapter layer (app invoke, evaluator invoke) |
| `api/oss/src/core/evaluations/runtime/cache.py` | runtime result cache |
| `api/oss/src/core/evaluations/runtime/locks.py` | concurrency locks (updated) |
| `api/oss/src/core/evaluations/runtime/runner.py` | `TaskiqEvaluationTaskRunner` (new) |
| `api/oss/src/core/evaluations/tasks/run.py` | `process_evaluation_run` dispatcher |
| `api/oss/src/core/evaluations/tasks/processor.py` | `process_evaluation_source_slice`, `process_testset_source_run` |
| `api/oss/src/core/evaluations/tasks/query.py` | `process_query_source_run` |
| `api/oss/src/core/evaluations/tasks/batch.py` | shrunk / legacy stub |
| `api/oss/src/core/evaluations/tasks/live.py` | shrunk / legacy stub (was 859 lines, now much smaller) |
| `api/oss/src/core/evaluations/tasks/legacy.py` | legacy adapter shim (deleted ~2225 lines) |
| `api/oss/src/core/evaluations/interfaces.py` | DAO interface additions |
| `api/oss/src/core/evaluations/utils.py` | runtime utility helpers |
| `api/oss/src/tasks/taskiq/evaluations/worker.py` | taskiq worker wired to new runner |
| `api/oss/src/core/evaluations/service.py` (partial) | `evaluations_task_runner` wiring |

**Status:** committed  
**Blocked by:** PR G (needs default queue model)

---

## PR I — API: evaluation service — closed-run guard, step removal, metrics refresh, run flags

**Theme:** Service-level behavioral changes: guard against modifying a closed run,
step-removal semantics, metrics-refresh endpoint, `EvaluationRunFlags` /
`EvaluationRunDataConcurrency` model additions, and evaluation query loops.

| Area | Files |
|---|---|
| `api/oss/src/core/evaluations/types.py` (rest of changes) | `EvaluationRunFlags`, `EvaluationClosedConflict`, concurrency model |
| `api/oss/src/apis/fastapi/evaluations/models.py` | API request/response models |
| `api/oss/src/apis/fastapi/evaluations/router.py` | new endpoints: `open_run`, `open_runs`, `query_runs`, `query_queues`, `start/stop/open simple evaluation`, `unarchive_queue` |
| `api/oss/src/apis/fastapi/evaluations/utils.py` | router utilities |
| `api/oss/src/dbs/postgres/evaluations/dao.py` (rest) | DAO for new query patterns |
| `api/oss/src/dbs/postgres/evaluations/utils.py` | DB utility helpers |
| `api/oss/tests/pytest/acceptance/evaluations/test_closed_run_guard.py` | closed-run guard test |
| `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_flows_modify.py` | modification flow test |
| `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_flows_run.py` | run flow test |
| `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_metrics_flow.py` | metrics flow test |
| `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_metrics_refresh.py` | metrics refresh test |
| `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_step_removal.py` | step removal test |
| `api/oss/tests/pytest/acceptance/evaluations/test_simple_evaluations_workflows.py` | simple eval workflows |
| `api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py` | queue basics test |
| `api/oss/tests/pytest/acceptance/evaluations/_flow_helpers.py` | shared test helpers |
| `api/oss/tests/pytest/acceptance/loadables/test_loadable_strategies.py` | loadable strategies test |
| `api/oss/tests/pytest/unit/evaluations/test_cache_split_utils.py` | cache unit test |
| `api/oss/tests/pytest/unit/evaluations/test_query_eval_loops.py` | query loop unit test |
| `api/oss/tests/pytest/unit/evaluations/test_queue_dao_serialization.py` | queue serialization test |
| `api/oss/tests/pytest/unit/evaluations/test_run_flag_matrix.py` | run flag matrix test |
| `api/oss/tests/pytest/unit/evaluations/test_run_flags.py` | run flags unit test |
| `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py` | topology planner test |
| `api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py` | lock unit test |
| Fern/Python client: `EvaluationRunData.ts`, `EvaluationRunFlags.ts`, `EvaluationRunQueryFlags.ts`, `EvaluationRunDataConcurrency.ts`, `SimpleEvaluationData.ts`, `EvaluationQueueQueryFlags.ts` | client types |
| Python client: `evaluations/client.py`, `raw_client.py` + new types | Python client |

**Status:** committed  
**Blocked by:** PR H

---

## PR J — SDK: Python evaluation runtime (agenta SDK)

**Theme:** Mirrors the API runtime changes in the Python SDK's own
`evaluations/runtime/` package. Enables SDK-side topology classification and
evaluation orchestration.

| Area | Files |
|---|---|
| `sdks/python/agenta/sdk/evaluations/runtime/__init__.py` | package init |
| `sdks/python/agenta/sdk/evaluations/runtime/models.py` | SDK-side models |
| `sdks/python/agenta/sdk/evaluations/runtime/planner.py` | SDK planner (mirrors API) |
| `sdks/python/agenta/sdk/evaluations/runtime/topology.py` | `classify_steps_topology` |
| `sdks/python/agenta/sdk/evaluations/runtime/adapters.py` | SDK adapters |
| `sdks/python/agenta/sdk/evaluations/runtime/executor.py` | SDK executor |
| `sdks/python/agenta/sdk/evaluations/runtime/processor.py` | SDK processor |
| `sdks/python/agenta/sdk/evaluations/preview/evaluate.py` | preview/experimental evaluate entry |
| `sdks/python/agenta/sdk/evaluations/results.py` | result types |
| `sdks/python/agenta/sdk/models/evaluations.py` | shared models |
| `sdks/python/agenta/sdk/litellm/mocks/__init__.py` | litellm mock for tests |
| `sdks/python/oss/tests/pytest/acceptance/evaluations/test_evaluate_flow.py` | SDK eval flow test |
| `sdks/python/oss/tests/pytest/integration/test_evaluate_orchestration.py` | integration test |
| `sdks/python/oss/tests/pytest/integration/conftest.py`, `__init__.py` | test fixtures |
| `sdks/python/oss/tests/pytest/unit/test_evaluate_specs.py` | unit specs test |
| `sdks/python/oss/tests/pytest/unit/test_evaluations_runtime.py` | runtime unit test |
| `sdks/python/oss/tests/pytest/utils/test_mock_v0.py` | mock utility test |
| SDK vault/secrets tests: `test_vault_secrets.py`, vault `conftest.py` | vault acceptance test |
| `sdks/python/oss/tests/legacy/new_tests/vault_router/conftest.py` | legacy vault conftest |

**Status:** committed  
**Blocked by:** PR H (shares topology model)

---

## PR K — Web frontend: Fern client — evaluation types + queue requests

**Theme:** The Fern-generated client additions for the new evaluation endpoints.
This is a generated-code PR and should stay thin.

| Area | Files |
|---|---|
| `web/packages/agenta-api-client/src/generated/api/resources/evaluations/client/Client.ts` | new eval methods |
| `web/packages/agenta-api-client/src/generated/api/resources/evaluations/client/requests/ArchiveQueueRequest.ts` | archive queue request |
| `web/packages/agenta-api-client/src/generated/api/resources/evaluations/client/requests/FetchDefaultQueueRequest.ts` | fetch default queue |
| `web/packages/agenta-api-client/src/generated/api/resources/evaluations/client/requests/UnarchiveQueueRequest.ts` | unarchive queue |
| `web/packages/agenta-api-client/src/generated/api/resources/evaluations/client/requests/index.ts` | barrel |
| `web/packages/agenta-api-client/src/generated/api/resources/access/client/Client.ts` | access client |
| `web/packages/agenta-api-client/src/generated/api/resources/access/client/requests/CheckPermissionsRequest.ts` | permissions request |
| `web/packages/agenta-api-client/src/generated/api/resources/access/client/requests/index.ts` | barrel |
| `web/packages/agenta-api-client/src/generated/api/resources/workspaces/client/Client.ts` | workspace client updates |
| `web/packages/agenta-api-client/src/generated/api/types/EvaluationQueue*.ts` (3 files) | queue type definitions |
| `web/packages/agenta-api-client/src/generated/api/types/EvaluationRun*.ts` (4 files) | run type definitions |
| `web/packages/agenta-api-client/src/generated/api/types/SimpleEvaluationData.ts` | simple eval data type |
| `web/packages/agenta-api-client/src/generated/api/types/SimpleQueueKind.ts` | queue kind enum |
| `web/packages/agenta-api-client/src/generated/api/types/index.ts` | barrel re-exports |
| `web/packages/agenta-entities/src/secret/api/api.ts` | secrets API (entities) |
| `web/packages/agenta-playground-ui/package.json` | package.json bump |
| `web/packages/agenta-playground/package.json` | package.json bump |

**Status:** committed  
**Blocked by:** PR I (needs final API shapes)

---

## PR L — Web frontend: evaluation UI — run creation, concurrency settings

**Theme:** The frontend changes to the evaluation-creation flow: concurrency
setting in `AdvancedSettings`, updated `NewEvaluationModalInner`, new type/
constant definitions, and the service-layer API call updates.

| Area | Files |
|---|---|
| `web/oss/src/components/pages/evaluations/NewEvaluation/Components/AdvancedSettings.tsx` | concurrency UI |
| `web/oss/src/components/pages/evaluations/NewEvaluation/Components/NewEvaluationModalInner.tsx` | modal inner update |
| `web/oss/src/components/pages/evaluations/NewEvaluation/assets/constants.ts` | constants |
| `web/oss/src/components/pages/evaluations/NewEvaluation/types.ts` | types |
| `web/oss/src/services/evaluations/api/index.ts` | API service calls |

**Status:** committed  
**Blocked by:** PR K

---

## PR M — Web packages: @agenta/entities — evaluation + queue + workflow entities (staged)

**Theme:** Large staged additions to `@agenta/entities` covering the new
evaluation, queue, ETL, and workflow entity state. Includes molecules, atoms, API
functions, unit tests. This is the largest staged chunk.

| Area | Files |
|---|---|
| `web/packages/agenta-entities/src/evaluation/` (many files) | eval entity state |
| `web/packages/agenta-entities/src/queue/` (many files) | queue entity state |
| `web/packages/agenta-entities/src/etl/` | ETL primitives |
| `web/packages/agenta-entities/src/workflow/core/`, `state/` | workflow entity additions |
| `web/packages/agenta-entities/tests/unit/adaptive-pacing.test.ts` | adaptive pacing test |
| `web/packages/agenta-entities/tests/unit/add-matching-traces-to-queue.test.ts` | queue trace test |
| `web/packages/agenta-entities/tests/unit/etl-primitives.test.ts` | ETL unit test |
| `web/packages/agenta-entities/tests/unit/export-matching-traces.test.ts` | trace export test |
| `web/packages/agenta-entities/tests/unit/tier-queue-cap.test.ts` | tier cap test |
| `web/packages/agenta-entities/tsconfig.json` | tsconfig update |

**Status:** staged  
**Blocked by:** PR K, PR M depends on Fern types from K

---

## PR N — Web packages: @agenta/ui — DrillIn, TypeChip, InfiniteVirtualTable, CellRenderers, EnhancedDrawer (staged)

**Theme:** UI component additions and improvements. The `DrillIn` component system
is new; `TypeChip` is a new component; `InfiniteVirtualTable` gets type-chip
feature and smart-resize hooks; `CellRenderers` extended; `EnhancedDrawer` added.
These are shared primitives with no evaluation-specific logic.

| Area | Files |
|---|---|
| `web/packages/agenta-ui/src/drill-in/` (many files) | DrillIn component system |
| `web/packages/agenta-ui/src/type-chip/TypeChip.tsx`, `index.ts` | TypeChip component |
| `web/packages/agenta-ui/src/drawer/EnhancedDrawer.tsx`, `index.ts` | EnhancedDrawer |
| `web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipColumns.tsx`, `useTypeChipFeature.tsx`, `useSmartResizableColumns.ts` | IVT hooks |
| `web/packages/agenta-ui/src/InfiniteVirtualTable/utils/detectColumnTypes.ts` | column type detection |
| `web/packages/agenta-ui/src/InfiniteVirtualTable/components/InfiniteVirtualTableInner.tsx`, `common/ResizableTitle.tsx`, `features/InfiniteVirtualTableFeatureShell.tsx`, `index.ts`, `types.ts` | IVT core |
| `web/packages/agenta-ui/src/CellRenderers/` (5 files) | cell renderer additions |
| `web/packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx`, `ChatMessageList.tsx` | chat message editor |
| `web/packages/agenta-ui/src/Editor/plugins/code/index.tsx` | editor code plugin |
| `web/packages/agenta-ui/src/components/presentational/field/FieldHeader.tsx`, `inputs/LabeledField.tsx` | presentational components |
| `web/packages/agenta-ui/package.json` | package.json bump |

**Status:** staged  
**Blocks:** PR O, PR P (consume DrillIn + TypeChip)

---

## PR O — Web packages: @agenta/entity-ui — testcase table, DrillIn wiring, commit modal (staged)

**Theme:** Entity-UI layer additions: `TestcaseTable`, `TestcaseDataEditor`,
`TestcaseDrawer`, `DrillInView` schema controls, `EntityTable`, `EntityCommitModal`
update, testcase primitive value utils.

| Area | Files |
|---|---|
| `web/packages/agenta-entity-ui/src/testcase/TestcaseTable.tsx` | testcase table |
| `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx`, `.types.ts`, `.utils.ts` | data editor |
| `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx` | drawer |
| `web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx` | drill-in renderer |
| `web/packages/agenta-entity-ui/src/testcase/TestcasePrimitiveValue.utils.ts` | primitive utils |
| `web/packages/agenta-entity-ui/src/testcase/codeFormat.ts` | code formatting |
| `web/packages/agenta-entity-ui/src/testcase/useTestcaseDrawerNavigation.ts` | nav hook |
| `web/packages/agenta-entity-ui/src/testcase/index.ts` | barrel |
| `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/MessagesSchemaControl.tsx`, `PromptSchemaControl.tsx`, `TextInputControl.tsx` | schema controls |
| `web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx` | playground config |
| `web/packages/agenta-entity-ui/src/adapters/variantAdapters.ts` | variant adapters |
| `web/packages/agenta-entity-ui/src/index.ts` | barrel update |
| `web/packages/agenta-entity-ui/src/modals/commit/components/EntityCommitModal.tsx` | commit modal |
| `web/packages/agenta-entity-ui/src/shared/EntityTable.tsx` | shared entity table |

**Status:** staged  
**Blocked by:** PR N (DrillIn primitives)

---

## PR P — Web packages: @agenta/playground + playground-ui (staged)

**Theme:** Playground state and UI updates to support the new eval loop UI: new
execution runner, trace-ref resolution, turn message adapter, variable control
adapter, focus drawer, playground outputs.

| Area | Files |
|---|---|
| `web/packages/agenta-playground/src/state/controllers/playgroundController.ts` | controller |
| `web/packages/agenta-playground/src/state/controllers/traceRefResolution.ts` | trace ref resolution |
| `web/packages/agenta-playground/src/state/execution/executionRunner.ts` | execution runner |
| `web/packages/agenta-playground/src/state/execution/reducer.ts` | reducer |
| `web/packages/agenta-playground/src/state/execution/selectors.ts` | selectors |
| `web/packages/agenta-playground/src/state/helpers/extractAndLoadChatMessages.ts` | chat helpers |
| `web/packages/agenta-playground/src/index.ts` | barrel |
| `web/packages/agenta-playground/.gitignore` | gitignore |
| `web/packages/agenta-playground/vitest.config.ts` | vitest config |
| `web/packages/agenta-playground/tests/unit/traceRefResolution.test.ts` | unit test |
| `web/packages/agenta-playground-ui/src/components/ExecutionItems/assets/ExecutionRow/SingleLayout.tsx` | execution row layout |
| `web/packages/agenta-playground-ui/src/components/FocusDrawer/components/GenericDrawer.tsx` | generic drawer |
| `web/packages/agenta-playground-ui/src/components/FocusDrawer/index.tsx` | focus drawer |
| `web/packages/agenta-playground-ui/src/components/PlaygroundOutputs/index.tsx` | playground outputs |
| `web/packages/agenta-playground-ui/src/components/TurnMessageHeaderOptions/index.tsx` | turn header options |
| `web/packages/agenta-playground-ui/src/components/adapters/TurnMessageAdapter.tsx` | message adapter |
| `web/packages/agenta-playground-ui/src/components/adapters/VariableControlAdapter.tsx` | variable adapter |
| `web/packages/agenta-playground-ui/src/components/index.ts` | barrel |
| `web/packages/agenta-playground-ui/src/context/PlaygroundUIContext.tsx` | UI context |
| `web/packages/agenta-playground-ui/src/index.ts` | barrel |

**Status:** staged  
**Blocked by:** PR N (DrillIn), PR M (entities state)

---

## PR Q — Web app: OSS + EE application layer — eval run details, testcase table, observability, deployments, DrillIn, audit log (staged)

**Theme:** All remaining staged changes in `web/oss/src/` and `web/ee/src/`. This
is the consumer layer that wires together the packages above into real pages.
Can be split further (e.g. observability vs eval run details vs deployments) if
needed.

**Sub-areas:**

- **EvalRunDetails** (`web/oss/src/components/EvalRunDetails/`) — 30 files: new
  table, metric atoms, scenario column atoms/steps
- **SharedDrawers** (`web/oss/src/components/SharedDrawers/`) — 18 files: testcase
  drawer integration, shared drawer plumbing
- **TestcasesTableNew** (`web/oss/src/components/TestcasesTableNew/`) — 14 files:
  new testcase table component
- **State: entities** (`web/oss/src/state/entities/`) — 11 files: entity-level
  state atoms
- **State: newObservability** (`web/oss/src/state/newObservability/`) — 7 files
- **DrillInView** (`web/oss/src/components/DrillInView/`) — 6 files: app-layer
  DrillIn consumers
- **DeploymentsDashboard** (`web/oss/src/components/DeploymentsDashboard/`) — 6
  files
- **EE: AuditLog** (`web/ee/src/components/pages/settings/AuditLog/`) — 6 files:
  audit log page
- **EE: PostSignupForm** (`web/ee/src/components/PostSignupForm/`) — 7 files: post-
  signup flow
- **Pages / routing** — misc page-level wiring
- **web/pnpm-lock.yaml** — lockfile update (goes with any of the above)
- **web/tests/playwright/** — test fixture updates

**Status:** staged  
**Blocked by:** PR N, PR O, PR P, PR M (all package work must land first)

---

## PR R — Docs: API reference auto-update

**Theme:** Fully generated `docs/docs/reference/api/` files. ~389 changed MDX/JSON
files. This goes in a separate PR so it doesn't pollute the signal/noise ratio of
every other PR.

| Area | Files |
|---|---|
| `docs/docs/reference/api/` (all `.api.mdx`, `.json`, `sidebar.ts`) | generated API reference |

**Status:** committed  
**Blocks:** none (documentation only)

---

## PR S — Design docs: unified-eval-loops research + plans (already in docs/)

**Theme:** The design artefacts for this feature. Not blocking anything but good
to land alongside or just after the core implementation.

| Area | Files |
|---|---|
| `docs/designs/unified-eval-loops/` (12 files) | breakdown, proposal, research, plan, gap, operations, etc. |
| `docs/designs/unify-evals-and-queues/` (6 files) | predecessor design docs |
| `docs/designs/access-controls-refactor-plan.md` | access-control design |
| `docs/designs/scope-only-routers-plan.md` | scope-only routers design |
| `docs/designs/third-party-subsystem-access.md` | subsystem access doc |
| `docs/designs/eval-loops/` (4 files) | earlier eval-loops designs |

**Status:** committed  
**Blocks:** none

---

## Suggested merge order

```
A (infra)
├─ B (data migrations, standalone)
├─ S (design docs, standalone)
├─ R (API ref, standalone)
├─ C (EE access) → F (router scope) → G (default queues)
│                                        └─ H (runtime core) → I (service + API) → J (SDK)
│                                                                  └─ K (Fern client) → L (eval UI)
├─ D (EE billing)
└─ E (EE org/workspace)
                        → N (UI primitives) → O (entity-ui) → P (playground)
                                             └─ M (entities) ┘
                                                               └─ Q (app layer)
```

PRs that are fully independent from the eval runtime path (B, R, S, D, E) can be
opened immediately in any order.
