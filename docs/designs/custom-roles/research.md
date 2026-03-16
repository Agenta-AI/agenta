# Custom Roles — Research: Current State of Codebase

## Built-in Roles

**Location**: `api/ee/src/models/shared_models.py`

Six roles defined in `WorkspaceRole` enum:

| Slug                 | Description |
|----------------------|-------------|
| `owner`              | Full workspace management |
| `workspace_admin`    | Manage settings & members, not delete |
| `editor`             | Edit content, no member management |
| `evaluator`          | Evaluate models + feedback |
| `deployment_manager` | Manage deployments only |
| `viewer`             | Read-only |

Permission mapping lives in `Permission.default_permissions(role)` — a hidden class method on the `Permission` enum. Cannot be introspected via API without special logic.

## Permission Enum

**Location**: `api/ee/src/models/shared_models.py`

~67 granular permissions across domains:

- General: `READ_SYSTEM`
- Applications: `VIEW_APPLICATIONS`, `EDIT_APPLICATIONS`, `CREATE_APP_VARIANT`, `DELETE_APP_VARIANT`, `MODIFY_VARIANT_CONFIGURATIONS`
- Service: `RUN_SERVICE`
- Webhooks: `VIEW_WEBHOOKS`, `EDIT_WEBHOOKS`
- Vault: `VIEW_SECRET`, `EDIT_SECRET`
- Tracing: `VIEW_SPANS`, `EDIT_SPANS`
- Folders: `VIEW_FOLDERS`, `EDIT_FOLDERS`
- API Keys: `VIEW_API_KEYS`, `EDIT_API_KEYS`
- Environments: `VIEW_ENVIRONMENTS`, `EDIT_ENVIRONMENTS`, `DEPLOY_ENVIRONMENTS`
- App Deployments: `VIEW_APP_ENVIRONMENT_DEPLOYMENT`, `EDIT_APP_ENVIRONMENT_DEPLOYMENT`, `CREATE_APP_ENVIRONMENT_DEPLOYMENT`
- Testsets: `VIEW_TESTSET/S`, `EDIT_TESTSET/S`, `CREATE_TESTSET`, `DELETE_TESTSET`
- Evaluations: `VIEW_EVALUATION`, `RUN_EVALUATIONS`, `EDIT_EVALUATION`, `CREATE_EVALUATION`, `DELETE_EVALUATION`, and runs/scenarios/results/metrics/queues variants
- Workspace: `VIEW_WORKSPACE`, `EDIT_WORKSPACE`, `CREATE_WORKSPACE`, `DELETE_WORKSPACE`, `MODIFY_USER_ROLES`, `ADD_USER_TO_WORKSPACE`
- Organization: `EDIT_ORGANIZATION`, `DELETE_ORGANIZATION`, `ADD_USER_TO_ORGANIZATION`
- Billing: `VIEW_BILLING`, `EDIT_BILLING`
- Workflows: `VIEW_WORKFLOWS`, `EDIT_WORKFLOWS`, `RUN_WORKFLOWS`
- Evaluators: `VIEW_EVALUATORS`, `EDIT_EVALUATORS`
- Queries: `VIEW_QUERIES`, `EDIT_QUERIES`
- Annotations: `VIEW_ANNOTATIONS`, `EDIT_ANNOTATIONS`
- Invocations: `VIEW_INVOCATIONS`, `EDIT_INVOCATIONS`
- Tools: `VIEW_TOOLS`, `EDIT_TOOLS`, `RUN_TOOLS`
- User: `RESET_PASSWORD`
- Deploy: `DEPLOY_APPLICATION`

## Role Storage in DB

**Location**: `api/ee/src/models/db_models.py`

Three member tables store the role as a plain string column:

```python
class OrganizationMemberDB(Base):
    __tablename__ = "organization_members"
    role = Column(String, nullable=False, server_default="member")

class WorkspaceMemberDB(Base):
    __tablename__ = "workspace_members"
    role = Column(String, default="viewer")

class ProjectMemberDB(Base):
    __tablename__ = "project_members"
    role = Column(String, default="viewer")
    is_demo = Column(Boolean, nullable=True)
```

No `roles` table exists. Roles are purely enum values stored as strings.

## Permission Check Pipeline

**Location**: `api/ee/src/utils/permissions.py`

Main entry point: `check_action_access(user_uid, project_id, permission, role)`

Flow:
1. Check demo member status → restricted access path
2. Check `RBAC` entitlement flag — if not entitled, grant full access (backward compat)
3. Check if org owner → full access bypass
4. Fetch project member record, read `role` string
5. Call `Permission.default_permissions(role)` → list of permissions
6. Check if required permission is in list

Result is cached under namespace `"check_action_access"` keyed by `(project_id, user_id, permission, role)`.

Cache is invalidated when workspace member roles are updated.

## Role Assignment Endpoints

**Location**: `api/ee/src/routers/workspace_router.py`

```
POST /{workspace_id}/roles/          # assign role — requires MODIFY_USER_ROLES
DELETE /{workspace_id}/roles/        # remove role — requires MODIFY_USER_ROLES
GET /permissions/                    # list all Permission enum values
```

When a role is assigned to a workspace member, it is synced to **all projects** in that workspace via `sync_workspace_members_to_project()`.

## Entitlement System

**Location**: `api/ee/src/core/entitlements/types.py`, `api/ee/src/utils/entitlements.py`

Existing flags:
```python
class Flag(str, Enum):
    HOOKS  = "hooks"
    RBAC   = "rbac"    # gates permission enforcement
    ACCESS = "access"
    DOMAINS = "domains"
    SSO    = "sso"
```

`RBAC` is checked in `check_action_access` — if false, all non-demo members get full access.

## Shared DBAs

**Location**: `api/oss/src/dbs/postgres/shared/dbas.py`

| Mixin          | Columns |
|----------------|---------|
| `IdentifierDBA`| `id` (UUID, PK, default uuid7) |
| `SlugDBA`      | `slug` (String, NOT NULL) |
| `HeaderDBA`    | `name`, `description` (String, nullable) |
| `LifecycleDBA` | `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` |
| `DataDBA`      | `data` (JSON) |

## Shared DTO Mixins

**Location**: `sdk/agenta/sdk/models/shared.py`

| Mixin       | Fields |
|-------------|--------|
| `Identifier`| `id: Optional[UUID]` |
| `Slug`      | `slug: Optional[str]` (URL-safe validated) |
| `Header`    | `name: Optional[str]`, `description: Optional[str]` |
| `Lifecycle` | `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` (all Optional) |

## Known Limitation (documented)

From `docs/designs/advanced-auth/IMPLEMENTATION_STATUS.md`:

> **Fixed RBAC Roles** — Cannot create custom roles. Impact: Limited permission granularity. Future: Implement custom role creation.

## Empty Design Directory

`docs/designs/custom-roles/` was empty on branch creation — this is the branch for implementing the feature.
