# Research appendix: project-membership-resolver (M1)

Code read at `42ffe80bfe` in worktree `pr-7663-specs-design-c53b35`. Paths are relative to `api/`. Line numbers are a snapshot and will drift.

## Today's permission check

`check_action_access` (`oss/src/core/access/permissions/service.py:160-217`) reads the cache, then `get_user_org_and_workspace_id` (`oss/src/services/db_manager.py:2562`) and `check_rbac_permission` (`service.py:220-346`):

1. Load project, workspace, organization through `db_manager`.
2. `check_user_access_to_workspace` (`service.py:105-157`): deny unless the user is an organization member, a workspace member, and the workspace is in the user's list. This is the only organization gate.
3. Read one `project_members` row (`db_manager.get_project_member`, `:2537`). The row may be missing. Soft-deleted rows count (`:2546`).
4. EE, not demo: no RBAC entitlement -> allow (also without a project row).
5. Organization owner -> allow (also without a project row).
6. Project role `owner` -> allow.
7. Exact role, or the role's permissions in the `project` scope catalog.

## Other membership readers

- Bearer `?project_id=`: `oss/src/middlewares/auth.py:901-917`, `project_member_exists` (`db_manager.py:165`). Cache namespace `verify_bearer_token` (`auth.py:747`).
- Project list and get: `oss/src/routers/projects_router.py:122, 172, 251, 306`, `fetch_project_memberships_by_user_id` (`db_manager.py:147`).
- Direct `check_rbac_permission` callers: `oss/src/routers/workspace_router.py:237` (remove user, `RequiredRole.ADMIN`), `oss/src/routers/organization_router.py:641` (update workspace, `EDIT_WORKSPACE`).
- EE organization access: `ee/src/apis/fastapi/organizations/router.py:44-45`, `check_user_org_access`.

## Membership writers

| Writer | Code | Rows |
| --- | --- | --- |
| Organization creation | `oss/src/services/commoners.py:147-207` | org, workspace "Default", project "Default", all `owner` |
| Invite accept | `oss/src/services/organization_service.py:457` -> `db_manager.add_user_to_workspace_and_org` (`:861-954`) | org, workspace, every project of the workspace |
| Domain auto-join | `oss/src/core/auth/service.py:456-540` | org, workspace, project, all `viewer` |
| Demo | `commoners.py:77-88` | org `viewer`, workspace and project `DEMO_ROLE`, `is_demo=True` |
| Project creation | `db_manager.create_workspace_project` (`:1436-1500`) commits the project (`:1493`), then `sync_workspace_members_to_project` (`:1543-1599`) | copies every workspace member; overwrites differing roles |
| Role change | `db_manager.update_user_roles` (`:1602-1712`), from `workspace_router.py:150, 210` | projects of ONE workspace (`fetch_projects_by_workspace`); sync when rows are missing; never writes the org role |
| Remove member | `db_manager.remove_user_from_workspace` (`:1157-1245`) | workspace, non-owner project rows, org row, invitations |
| Ownership transfer | `db_manager.transfer_organization_ownership` (`:1002-1117`) | swaps org and workspace roles, not project roles |
| Admin tools | `db_manager.py:2730, 2776, 2960-3200`, `oss/src/core/accounts/service.py:479-532` | direct inserts, deletes, role swaps |

## Facts used in the design

- Every organization gets one workspace "Default" (`commoners.py:164`); `create_workspace_db_object` (`db_manager.py:2750`) can create more.
- Organization-scope `viewer` has no permissions (`oss/src/core/access/permissions/controls.py:44-60`). Role slugs are equal across the three scopes.
- Custom roles: `build_role_controls()` in `controls.py` imports `ee.src.core.access.permissions.role_overrides` behind `is_ee()`.
- `project_members` has non-unique indexes only (`oss000000040`).
- `check_action_access` is called 402 times in 38 files.
- Cache: Redis only; L1 in-process cache is disabled (`oss/src/utils/caching.py:30-35`). `AGENTA_CACHE_TTL = 300` s. `check_action_access` calls `get_cache` without `ttl`, so reads do not renew. `invalidate_cache` deletes by pattern (`caching.py:459`). Writers invalidate per project today (for example `db_manager.py:855`).
- Bearer default-project selection uses the default workspace (`auth.py:861-868`); that is routing, kept until M4.
- Soft-deleted membership rows count as members today (`db_manager.py:2546`).
