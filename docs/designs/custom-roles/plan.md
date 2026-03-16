# Custom Roles — Implementation Plan

## Phase 1 — Permissions & Entitlements

- [ ] Add `VIEW_ROLES`, `EDIT_ROLES`, `MANAGE_ROLES` to `Permission` enum (`api/ee/src/models/shared_models.py`)
- [ ] Update `default_permissions()` to include the new permissions for `owner` and `workspace_admin`
- [ ] Replace `MODIFY_USER_ROLES` guard in `POST /{workspace_id}/roles/` with `MANAGE_ROLES`
- [ ] Add `CUSTOM_ROLES` to `Flag` enum (`api/ee/src/core/entitlements/types.py`)
- [ ] Update plan entitlement config: Pro/Business → true (dev/test), Enterprise → true

## Phase 2 — Core Layer

- [ ] Create `api/ee/src/core/roles/types.py` — `RoleData`, `Role`, `RoleCreate`, `RoleEdit`, `RoleQuery`
- [ ] Create `api/ee/src/core/roles/exceptions.py` — `RoleError`, `RoleSlugReserved`, `RoleSlugConflict`, `RoleNotFound`
- [ ] Create `api/ee/src/core/roles/registry.py` — `AGENTA_ROLE_SLUG_PREFIX`, `BUILT_IN_ROLES` dict with all six `ag_*` built-ins
- [ ] Create `api/ee/src/core/roles/interfaces.py` — `WorkspaceRolesDAOInterface`
- [ ] Create `api/ee/src/core/roles/service.py` — `WorkspaceRolesService` (`list_roles`, `get_effective_permissions`, `create_role`, `edit_role`, `delete_role`)

## Phase 3 — Database Layer

- [ ] Create `api/ee/src/dbs/postgres/roles/dbes.py` — `WorkspaceRoleDBE`
- [ ] Create `api/ee/src/dbs/postgres/roles/mappings.py` — `WorkspaceRoleDBE` ↔ `Role` DTO
- [ ] Create `api/ee/src/dbs/postgres/roles/dao.py` — `WorkspaceRolesDAO` implementing `WorkspaceRolesDAOInterface`
- [ ] Write Alembic migration:
  - Create `workspace_roles` table
  - Migrate `organization_members.role`, `workspace_members.role`, `project_members.role` → `ag_` prefix

## Phase 4 — API Layer

- [ ] Create `api/ee/src/apis/fastapi/roles/models.py` — `RoleDataRequest`, `RoleCreateRequest`, `RoleEditRequest`, `RoleResponse`, `RolesListResponse`
- [ ] Create `api/ee/src/apis/fastapi/roles/utils.py` — request parsing / merge helpers
- [ ] Create `api/ee/src/apis/fastapi/roles/router.py` — all endpoints under `/workspaces/{workspace_id}/roles`
  - `GET /` — list roles (built-ins + custom)
  - `GET /reference` — fetch own role by slug/id (no permission required)
  - `GET /{role_id}` — single role
  - `POST /` — create custom role
  - `PUT /{role_id}` — full replace
  - `DELETE /{role_id}` — hard delete
- [ ] Wire `WorkspaceRolesDAO` + `WorkspaceRolesService` in EE DI entrypoint
- [ ] Mount `RolesRouter` in `api/ee/src/main.py`

## Phase 5 — Permission Check Extension

- [ ] Add `_resolve_role_permissions(role_slug, workspace_id)` in `api/ee/src/utils/permissions.py`
  - Registry lookup first (static, no cache)
  - Cache lookup keyed by `(workspace_id, role_slug)`
  - DAO fallback on cache miss
- [ ] Replace `Permission.default_permissions(member.role)` call in `check_action_access` with `_resolve_role_permissions`
- [ ] Invalidate `(workspace_id, role_slug)` cache entries in `edit_role` and `delete_role` service methods

## Phase 6 — Frontend

- [ ] Add `GET /workspaces/{workspace_id}/roles` API client call
- [ ] Add `GET /workspaces/{workspace_id}/roles/reference` API client call
- [ ] Create Settings → Roles page (`web/.../settings/roles/index.tsx`)
  - Built-in roles section (read-only, permissions grouped by domain)
  - Custom roles section (gated on `custom_roles` entitlement)
- [ ] Create / Edit role modal (`EnhancedModal`) with grouped permission checkboxes
- [ ] Delete role confirmation modal (show member count, reassign to `ag_viewer`)
- [ ] Extend Members page role selector to include custom roles from the workspace

## Key Files Reference

| File | Purpose |
|------|---------|
| `api/ee/src/models/shared_models.py` | `Permission` enum — add `VIEW_ROLES`, `EDIT_ROLES`, `MANAGE_ROLES` |
| `api/ee/src/core/entitlements/types.py` | `Flag` enum — add `CUSTOM_ROLES` |
| `api/ee/src/utils/permissions.py` | `check_action_access` — extend with `_resolve_role_permissions` |
| `agenta/sdk/models/shared.py` | `Identifier`, `Slug`, `Header`, `Lifecycle` DTO mixins (existing) |
| `api/oss/src/dbs/postgres/shared/dbas.py` | `IdentifierDBA`, `SlugDBA`, `HeaderDBA`, `LifecycleDBA`, `DataDBA` (existing) |
| `api/ee/src/core/roles/types.py` | `RoleData`, `Role`, `RoleCreate`, `RoleEdit`, `RoleQuery` |
| `api/ee/src/core/roles/registry.py` | `AGENTA_ROLE_SLUG_PREFIX`, `BUILT_IN_ROLES` |
| `api/ee/src/core/roles/interfaces.py` | `WorkspaceRolesDAOInterface` |
| `api/ee/src/core/roles/service.py` | `WorkspaceRolesService` |
| `api/ee/src/core/roles/exceptions.py` | `RoleError`, `RoleSlugReserved`, `RoleSlugConflict`, `RoleNotFound` |
| `api/ee/src/dbs/postgres/roles/dbes.py` | `WorkspaceRoleDBE` |
| `api/ee/src/dbs/postgres/roles/dao.py` | `WorkspaceRolesDAO` |
| `api/ee/src/dbs/postgres/roles/mappings.py` | `WorkspaceRoleDBE` ↔ `Role` DTO |
| `api/ee/src/apis/fastapi/roles/router.py` | HTTP endpoints |
| `api/ee/src/apis/fastapi/roles/models.py` | Request / response models |
| `api/ee/src/apis/fastapi/roles/utils.py` | Request parsing helpers |
| `api/ee/src/main.py` | Mount `RolesRouter`, wire DI |
| `web/.../settings/roles/index.tsx` | Frontend Roles settings page |

---

## Phase 7 — Org and Project Scope (future)

- [ ] Add `OrganizationRoleDBE` + migration + DAO
- [ ] Add `ProjectRoleDBE` + migration + DAO
- [ ] Add `OrganizationRolesService`, `ProjectRolesService`
- [ ] Extend `_resolve_role_permissions` to check org and project scope tables
- [ ] Add org/project role endpoints
