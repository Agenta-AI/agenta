# Research appendix: remove-workspaces-org-storage (M4)

Code facts that the M4 design relies on. Paths are relative to the repository root. Read on main at `42ffe80bfe`. Line numbers are hints, not contracts.

## Mount storage today

- `MountsService._storage_key` builds `[<namespace>/]mounts/<project_id>/<mount_id>/<path>` from the project id that the caller passes (`api/oss/src/core/mounts/service.py`). Every file operation calls it: materialize, attachments, session cleanup, list, read, stat, archive, write, folder, delete.
- STS signing uses the same key as the policy prefix (`sign_mount_credentials` in the same file). `ObjectStore.sign_temp_credentials` refuses to sign without a prefix-scoped session policy (`api/oss/src/core/store/storage.py`).
- The runner derives the durable working directory from the signed prefix and treats it as opaque (`services/runner/src/engines/sandbox_agent/environment-setup.ts`). No runner change is needed.
- The namespace is deployment configuration (`env.store.namespace`), passed to every `MountsService` (`api/entrypoints/routers.py`, `api/entrypoints/session_attachments.py`).
- `mounts` rows: primary key `(project_id, id)`, unique `(project_id, slug)` (`api/oss/src/dbs/postgres/mounts/dbes.py`). No stored location. `MountData` says the key is derived server-side (`api/oss/src/core/mounts/dtos.py`).
- The mount id comes from `IdentifierDBA.id` default `uuid7` at insert (`api/oss/src/dbs/postgres/shared/dbas.py`). Agent and session mounts use an upsert on `(project_id, slug)` that keeps the first row (`api/oss/src/dbs/postgres/mounts/dao.py`).
- Mount creation callers: `api/oss/src/apis/fastapi/mounts/router.py`, `api/oss/src/apis/fastapi/sessions/router.py`, `api/oss/src/core/apps/handlers.py`, `api/oss/src/core/sessions/attachments/service.py`.

## Workspaces today

Data model:
- `WorkspaceDB` (`api/oss/src/models/db_models.py`) belongs to an organization with a cascading foreign key.
- `ProjectDB.workspace_id` is `NOT NULL` with `ON DELETE CASCADE` to `workspaces.id`. Deleting a workspace row deletes its projects and everything under them.
- `WorkspaceMemberDB` with two non-unique indexes (`core_oss/versions/oss000000040_add_membership_and_api_key_indexes.py`).
- `api_keys` and `project_invitations` have no workspace column.
- Tracing spans, records, events and EE measurements have no workspace column. `WorkspaceScopeDBA` is unused (`api/oss/src/dbs/postgres/shared/dbas.py`).
- `projects.is_default` is unique per workspace in code only (`api/oss/src/services/db_manager.py`). An EE organization with several workspaces has several default projects.
- Signup creates the "Default" workspace, an owner workspace member and the default project (`api/oss/src/services/commoners.py`).

Auth and tokens (`api/oss/src/middlewares/auth.py`):
- Bearer auth reads `?workspace_id=`, resolves projects and default projects through workspaces, and denies when `project.workspace_id != workspace.id`. Its cache key includes the workspace id.
- API-key auth sets `workspace_id = project.workspace_id`.
- `sign_secret_token` writes a `workspace_id` claim. Callers: `api/oss/src/core/workflows/service.py` (two), `api/oss/src/apis/fastapi/access/router.py`, `api/oss/src/apis/fastapi/gateways/credentials_router.py`, `api/oss/src/apis/fastapi/gateways/mcps/router.py`.
- `_build_auth_context_from_state` returns no context unless `workspace_id` is set. `AuthScope.workspace_id` is required (`api/oss/src/utils/context.py`).
- `scope_type="workspace"` in `/access` compares with `auth_scope.workspace_id` (`api/oss/src/apis/fastapi/access/router.py`).

Routes and response shapes:
- `/workspaces/*` (`api/oss/src/routers/workspace_router.py`): `GET /`, `GET /roles/`, `GET /permissions/`, `POST|DELETE /{id}/roles/`, `DELETE /{id}/users/`.
- `/organizations/{org}/workspaces/*` (`api/oss/src/routers/organization_router.py`): invite, resend, accept, `POST /` (create), `PUT /{ws}` (rename; checks `EDIT_WORKSPACE`).
- Admin `/admin/simple/accounts/workspaces/*` (`api/oss/src/apis/fastapi/accounts/router.py`).
- `ProjectsResponse.workspace_id` and `workspace_name` (`api/oss/src/routers/projects_router.py`). `Organization.workspaces` and `OrganizationDetails.default_workspace` (a dict with the members and their workspace roles) (`api/oss/src/models/api/organization_models.py`).
- Invite emails carry `workspace_id`; admin emails link to `/w/{workspace.id}/p/{project.id}` (`api/oss/src/services/organization_service.py`). Session links use `/m/w/{workspace_id}/p/...` (`api/oss/src/apis/fastapi/sessions/utils.py`).

Role catalog:
- `SCOPES = ("organization", "workspace", "project")` (`api/oss/src/core/access/permissions/controls.py`). `GET /access/roles` returns one list per scope.
- EE `role_overrides.py` mirrors project roles into the `workspace` scope so that custom roles appear in the invite modal (`api/ee/src/core/access/permissions/role_overrides.py`, the "TEMP" block).

Classic app (`web/oss`) reads:
- `fetchAllWorkspaceRoles` reads the `workspace` key of `GET /access/roles` for the members table and the invite modal (`web/packages/agenta-entities/src/organization/workspaceApi.ts`; used by `web/oss/src/components/pages/settings/WorkspaceManage/cellRenderers.tsx` and `Modals/InviteUsersModal.tsx`).
- Role assign and unassign, invite, resend, accept and user removal call the workspace routes above with the `/w` segment as the workspace id.
- Workspace rename: `updateWorkspace` (`workspaceApi.ts`) and `useUpdateWorkspaceName` (`web/oss/src/state/workspace/hooks.ts`) exist, but no component calls the hook. No classic UI creates a workspace. `fetchWorkspaceDetails` and `fetchWorkspaceMembers` call routes that do not exist in the API (dead helpers).
- The classic app accepts an organization id in the `/w` segment (`web/oss/src/state/project/selectors/project.ts`).

`/m`:
- Requires `project.workspace_id === urlWorkspaceId` with no fallback (`web/mobile/src/features/context/useCurrentProject.ts`, `web/mobile/src/features/settings/useSettingsOrg.ts`, `web/mobile/src/features/nav/DrawerProjectSwitcher.tsx`).

SDK:
- `resolve_scopes` reads `workspace_id` from `GET /projects/current` (`sdks/python/agenta/sdk/utils/init.py`) and builds `/w/{workspace_id}/p/...` links (`sdks/python/agenta/sdk/engines/tracing/tracing.py`, `sdks/python/agenta/sdk/evaluations/runs.py`). It keeps working when the value is the organization id.

## EE meters today

- `MeterScope` requires `workspace_id` for a project or user scope (`api/ee/src/core/meters/types.py`). `compute_meter_id` hashes a `wrk=` part; its docstring forbids a change without a full re-backfill.
- `scope_from` fills `workspace_id` from `AuthScope` (`api/ee/src/core/access/entitlements/service.py`).
- The only non-organization quota is `TRACES_RETRIEVED`, daily, `Scope.USER` (`api/ee/src/core/access/entitlements/types.py`). Organization-scope meters have no `wrk` part.
- Only `TRACES_INGESTED` is reported to Stripe; it is organization-scoped.
- `MetersDAO.fetch` filters on `workspace_id` exactly (`api/ee/src/dbs/postgres/meters/dao.py`).
- The `meters` table exists only in the `core_ee` chain (`api/ee/databases/postgres/migrations/core_ee/versions/ee0000000002_adopt_oss_database.py`). `mounts`, `projects`, `workspaces` and `workspace_members` are in `core_oss`, which EE also runs (`api/AGENTS.md`, "which alembic chain").

## Membership methods (from M1)

M1 defines `MembershipsDAOInterface.set_member_role(organization_id, user_id, role)` and `remove_member(organization_id, user_id)`. Until M4, both (and `add_member`) also write the legacy `workspace_members` row. M4 removes those writes in the switch step.
