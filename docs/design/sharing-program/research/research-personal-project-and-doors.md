# Research appendix: personal-project-and-doors (M6)

Checked on 2026-10-22 against main `42ffe80bfe` (worktree `pr-7663-specs-design-c53b35`). Paths are relative to the repository root.

## Foreign keys that shape the move (verified)

- `api/oss/src/dbs/postgres/workflows/dbes.py`: `workflow_artifacts`, `workflow_variants`, `workflow_revisions` all have PK `(project_id, id)` and unique `(project_id, slug)`. Variants reference `(project_id, artifact_id)`. Revisions reference both `(project_id, artifact_id)` and `(project_id, variant_id)`. All composite, `ON DELETE CASCADE`, not deferrable, no update cascade. So: updating variants first breaks the revisions' variant FK, and updating revisions first has no target variant. The only valid order is insert target artifact and variants, move revisions, delete source parents. Artifacts have `folder_id` -> `folders.id` `ON DELETE SET NULL`.
- `api/oss/src/dbs/postgres/triggers/dbes.py`: `trigger_deliveries` references `(project_id, schedule_id)` -> `trigger_schedules` and `(project_id, subscription_id)` -> `trigger_subscriptions`, `ON DELETE CASCADE`. A schedule row cannot change project while its deliveries stay. Hence: keep the old schedule paused in the source, create a new paused schedule in the target. `trigger_schedules` has no FK to workflows today; the target agent is in `data.references`. M2 adds an `artifact_id` column. It must not be a cascading FK to `workflow_artifacts`, or deleting the source artifact would delete the kept source schedule and its history.
- `trigger_subscriptions` references `(project_id, connection_id)` -> `gateway_connections`, so subscriptions are tied to source connections and must stay in the source.
- `api/oss/src/dbs/postgres/sessions/attachments/dbes.py`: `session_attachments` references `(project_id, mount_id)` -> `mounts`, `ON DELETE CASCADE`. If an attachment pointed at a moved agent mount, moving the mount would break this FK. The move refuses that case.
- M3 `agent_access` (M3 design): PK `(project_id, artifact_id)`, FK to `workflow_artifacts (project_id, id)` `ON DELETE CASCADE`. It is updated to the target after the target artifact row exists.
- `api/oss/src/dbs/postgres/mounts/dbes.py`: `mounts` PK `(project_id, id)`, unique `(project_id, slug)`, bare `agent_id` and `session_id` columns. Storage key `mounts/<project_id>/<mount_id>/` in `api/oss/src/core/mounts/service.py` (M4 stores the prefix per row).
- No other table has an FK into the workflow tables (searched every `dbes.py`). Environments reference workflow revisions inside JSON data, not by FK.

## Active-run detection (verified)

- `api/oss/src/dbs/postgres/sessions/streams/dbes.py`: `session_streams` is the durable mirror of the Redis liveness nest (alive, running, attached) in `flags`; `updated_at` is the heartbeat; `turn_id` is the current turn. An orphan sweep already uses this. The move uses the same liveness instead of "turn without `end_time`", so crashed turns do not block a move forever.

## Keys, installations, identity (verified)

- `api/oss/src/middlewares/auth.py`: an API key request sets `user_id = created_by_id` (around line 1066). `verify_secret_token` copies run-credential claims and ignores `?project_id=`. Only Bearer honors `?project_id=` with a membership check.
- `api/oss/src/services/api_key_service.py`: `create_api_key(..., hidden=False)`; hidden keys were for starting apps from the backend. No current caller passes `hidden=True` (searched `api/oss/src`), so hidden keys are legacy rows only.
- `api/oss/src/dbs/postgres/channels/dbes.py`: `channel_connections` is project-scoped; `external_key` is unique across projects because ingress resolves the project from it. Channel turns run as the linked user or the agent creator in `api/oss/src/tasks/asyncio/channels/inbox.py` (several call sites).
- `created_by_id` columns are bare nullable UUIDs (`api/oss/src/dbs/postgres/shared/dbas.py`), so a service-account id fits without schema change. About 185 handlers call `UUID(request.state.user_id)` (grep count in `api/oss/src/apis`), which is why `user_id` is kept non-null.

## Runs and doors (verified)

- `api/oss/src/core/workflows/service.py` `_prepare_invoke` signs one `Secret` for one user and one project (around lines 3184-3230). A run never switches project; doors act on the server.
- `api/oss/src/apis/fastapi/tools/router.py`: a `workflow.*` reference tool resolves in `request.state.project_id` only.
- `sdks/python/agenta/sdk/agents/platform/op_catalog.py`: `query_workflows`, `query_spans` use the run credential. `PlatformConnection.authorization()` returns one credential (`connection.py`).
- `api/oss/src/core/events/types.py`: `EventType` exists for one event per gateway relay; door and move events follow the same pattern.
- `api/ee/src/core/access/entitlements/types.py`: `Gauge` has only `USERS`; there is no project-count limit today, so "exclude personal projects" has nothing to change yet.

## Permission shortcuts (verified)

- `api/oss/src/core/access/permissions/service.py`: EE no-RBAC shortcut and organization-owner shortcut both return true before the project role is read. The personal-project rule must run before both.
