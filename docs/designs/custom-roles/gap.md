# Custom Roles — Gap Analysis & Spec

## Scope Levels and Separate Entities

Roles exist at three levels. Each is a separate entity with its own table and DAO — no polymorphic `scope` column. The shared `Role` DTO is used for all three.

| Entity                | Table                 | Scope FK           |
|-----------------------|-----------------------|--------------------|
| `WorkspaceRoleDBE`    | `workspace_roles`     | `workspace_id`     |
| `OrganizationRoleDBE` | `organization_roles`  | `organization_id`  |
| `ProjectRoleDBE`      | `project_roles`       | `project_id`       |

**MVP ships workspace-scoped roles only.** Org and project variants follow identically.

**Permission resolution order** when checking access for a project action:
1. Project-scoped roles for the user in that project
2. Workspace-scoped roles for the user in the parent workspace
3. Organization-scoped roles for the user in the parent org
4. Organisation owner override (unchanged — full access bypass)

---

## What's Missing

### 1. No custom roles entity
No `workspace_roles` (or org/project variants) table. Roles are only enum values stored as strings in member records.

### 2. No built-in role registry
`Permission.default_permissions(role)` is a hidden method that cannot be returned via the API. Built-in roles have no canonical representation as data.

### 3. No role management permissions
The existing `MODIFY_USER_ROLES` permission covers assignment only. There are no permissions for listing/viewing roles or for creating/editing/deleting custom roles.

### 4. No `CUSTOM_ROLES` entitlement flag
The `Flag` enum has `RBAC` but no flag to gate custom role creation separately.

### 5. No role-aware permission resolution
`check_action_access` calls `Permission.default_permissions(role)` which only knows about the six built-in roles. Custom role slugs would return `[]`.

### 6. No Roles UI
No settings page for viewing or managing roles.

---

## Spec

### New Permissions

Add to `Permission` enum in `api/ee/src/models/shared_models.py`:

```python
VIEW_ROLES   = "view_roles"    # List all roles and inspect their permissions
EDIT_ROLES   = "edit_roles"    # Create / edit / delete custom roles
MANAGE_ROLES = "manage_roles"  # Assign / unassign roles to members
```

| Permission    | owner | workspace_admin | editor | evaluator | deployment_manager | viewer |
|---------------|:-----:|:---------------:|:------:|:---------:|:------------------:|:------:|
| VIEW_ROLES    | ✓     | ✓               |        |           |                    |        |
| EDIT_ROLES    | ✓     | ✓               |        |           |                    |        |
| MANAGE_ROLES  | ✓     | ✓               |        |           |                    |        |

Any authenticated member can fetch a role by reference (slug or id) if it is their own assigned role — no `VIEW_ROLES` required.

Replace `MODIFY_USER_ROLES` guard in the role-assignment endpoint with `MANAGE_ROLES`.

---

### New Entitlement Flag

Add to `Flag` enum in `api/ee/src/core/entitlements/types.py`:

```python
CUSTOM_ROLES = "custom_roles"
```

| Plan           | `rbac` | `custom_roles`       |
|----------------|:------:|:--------------------:|
| Free / OSS     | false  | false                |
| Pro / Business | true   | true (dev/test only) |
| Enterprise     | true   | true                 |

---

### Built-in Slug Migration

All built-in role slugs gain an `ag_` prefix. The `AGENTA_ROLE_SLUG_PREFIX = "ag_"` constant is the single guard used to reject custom role slugs that would collide with the reserved namespace.

| Old slug             | New slug                  |
|----------------------|---------------------------|
| `owner`              | `ag_owner`                |
| `workspace_admin`    | `ag_workspace_admin`      |
| `editor`             | `ag_editor`               |
| `evaluator`          | `ag_evaluator`            |
| `deployment_manager` | `ag_deployment_manager`   |
| `viewer`             | `ag_viewer`               |

Migration applies to `organization_members.role`, `workspace_members.role`, `project_members.role`.

---

### Built-in Roles Registry

**Location**: `api/ee/src/core/roles/registry.py`

A static `BUILT_IN_ROLES: Dict[str, Role]` dict returning `Role` DTO instances (same type as DB-stored custom roles). Built-ins have `id=None` and all lifecycle fields `None`. `is_builtin` is derived from `id is None`.

Replaces `Permission.default_permissions()`.

---

### Shared DTO

**Location**: `api/ee/src/core/roles/types.py`

```python
from agenta.sdk.models.shared import Identifier, Slug, Header, Lifecycle

class RoleData(BaseModel):
    permissions: List[Permission]

class Role(Identifier, Slug, Header, Lifecycle):
    data: RoleData = Field(default_factory=lambda: RoleData(permissions=[]))

    @property
    def is_builtin(self) -> bool:
        return self.id is None

class RoleCreate(Slug, Header):
    # slug must not start with AGENTA_ROLE_SLUG_PREFIX
    data: RoleData

class RoleEdit(Identifier, Header):
    data: RoleData

class RoleQuery(BaseModel):
    pass
```

Scope ID (`workspace_id`, `organization_id`, `project_id`) is **never inside the DTO** — it is passed as an explicit parameter to service and DAO methods.

---

### Database Entities

**MVP: workspace scope only.** Org and project variants follow identically.

**Location**: `api/ee/src/dbs/postgres/roles/`

```python
class WorkspaceRoleDBE(Base, IdentifierDBA, SlugDBA, HeaderDBA, LifecycleDBA, DataDBA):
    __tablename__ = "workspace_roles"
    __table_args__ = (
        UniqueConstraint("slug", "workspace_id", name="uq_workspace_role_slug"),
    )
    workspace_id = Column(UUID(as_uuid=True), nullable=False)
```

`data` JSON shape: `{ "permissions": ["view_applications", "..."] }`

Future:
```python
class OrganizationRoleDBE(Base, IdentifierDBA, SlugDBA, HeaderDBA, LifecycleDBA, DataDBA):
    __tablename__ = "organization_roles"
    organization_id = Column(UUID(as_uuid=True), nullable=False)

class ProjectRoleDBE(Base, IdentifierDBA, SlugDBA, HeaderDBA, LifecycleDBA, DataDBA):
    __tablename__ = "project_roles"
    project_id = Column(UUID(as_uuid=True), nullable=False)
```

#### Migration SQL

```sql
CREATE TABLE workspace_roles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          VARCHAR NOT NULL,
    name          VARCHAR,
    description   VARCHAR,
    workspace_id  UUID NOT NULL,
    data          JSON NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ,
    deleted_at    TIMESTAMPTZ,
    created_by_id UUID NOT NULL,
    updated_by_id UUID,
    deleted_by_id UUID,
    CONSTRAINT uq_workspace_role_slug UNIQUE (slug, workspace_id)
);
CREATE INDEX idx_workspace_roles_workspace_id ON workspace_roles (workspace_id);

UPDATE organization_members SET role = 'ag_' || role WHERE role NOT LIKE 'ag_%';
UPDATE workspace_members     SET role = 'ag_' || role WHERE role NOT LIKE 'ag_%';
UPDATE project_members       SET role = 'ag_' || role WHERE role NOT LIKE 'ag_%';
```

---

### DAO Interface

```python
# api/ee/src/core/roles/interfaces.py

class WorkspaceRolesDAOInterface(ABC):
    @abstractmethod
    async def create_role(self, *, workspace_id: UUID, role_create: RoleCreate, user_id: UUID) -> Optional[Role]: ...
    @abstractmethod
    async def fetch_role(self, *, role_id: UUID) -> Optional[Role]: ...
    @abstractmethod
    async def query_roles(self, *, workspace_id: UUID, query: RoleQuery) -> List[Role]: ...
    @abstractmethod
    async def edit_role(self, *, role_id: UUID, role_edit: RoleEdit, user_id: UUID) -> Optional[Role]: ...
    @abstractmethod
    async def delete_role(self, *, role_id: UUID, user_id: UUID) -> bool: ...
```

---

### Service

```python
# api/ee/src/core/roles/service.py

class WorkspaceRolesService:
    async def list_roles(self, *, workspace_id: UUID, include_builtin: bool = True) -> List[Role]: ...
    async def get_effective_permissions(self, *, workspace_id: UUID, role_slug: str) -> List[Permission]: ...
    async def create_role(self, *, workspace_id: UUID, role_create: RoleCreate, user_id: UUID) -> Role: ...
    async def edit_role(self, *, role_id: UUID, role_edit: RoleEdit, user_id: UUID) -> Role: ...
    async def delete_role(self, *, role_id: UUID, user_id: UUID) -> None: ...
```

---

### Service Exceptions

```python
# api/ee/src/core/roles/exceptions.py

class RoleError(Exception): pass
class RoleSlugReserved(RoleError): ...   # slug starts with ag_
class RoleSlugConflict(RoleError): ...   # slug already exists in scope
class RoleNotFound(RoleError): ...
```

---

### Permission Check Extension

`_resolve_role_permissions(role_slug, workspace_id)` replaces `Permission.default_permissions(role)`:

1. Check `BUILT_IN_ROLES` registry — static, no DB hit, no cache needed
2. Cache miss check: `(workspace_id, role_slug)` cache key
3. On miss: query `WorkspaceRolesDAO`, populate cache
4. Invalidate cache on role edit or delete

---

### API Endpoints

All mounted under `/workspaces/{workspace_id}/roles`:

| Method   | Path                     | Permission     | Entitlement    | Notes |
|----------|--------------------------|----------------|----------------|-------|
| `GET`    | `/`                      | `VIEW_ROLES`   | —              | List built-ins + custom |
| `GET`    | `/reference?slug=...`    | none (own role)| —              | Fetch by reference |
| `GET`    | `/{role_id}`             | `VIEW_ROLES`   | —              | Single role |
| `POST`   | `/`                      | `EDIT_ROLES`   | `CUSTOM_ROLES` | Create |
| `PUT`    | `/{role_id}`             | `EDIT_ROLES`   | `CUSTOM_ROLES` | Full replace |
| `DELETE` | `/{role_id}`             | `EDIT_ROLES`   | `CUSTOM_ROLES` | Hard delete |

### Request / Response Models

```python
class RoleDataRequest(BaseModel):
    permissions: List[str]

class RoleCreateRequest(BaseModel):
    slug:        str             # must not start with "ag_"
    name:        str
    description: Optional[str] = None
    data:        RoleDataRequest

class RoleEditRequest(BaseModel):
    id:          str             # repeated from path for consistency
    name:        str
    description: Optional[str] = None
    data:        RoleDataRequest

class RoleResponse(BaseModel):
    id:            Optional[str]
    slug:          str
    name:          Optional[str]
    description:   Optional[str]
    data:          RoleDataRequest
    created_at:    Optional[datetime]
    updated_at:    Optional[datetime]
    deleted_at:    Optional[datetime]
    created_by_id: Optional[str]
    updated_by_id: Optional[str]
    deleted_by_id: Optional[str]

class RolesListResponse(BaseModel):
    count: int
    roles: List[RoleResponse]
```

---

### Frontend

**Settings → Roles** tab (below Members):

- **Built-in Roles** — read-only cards: name, slug, description, permissions grouped by domain
- **Custom Roles** — same layout + New/Edit/Delete controls, gated on `custom_roles` entitlement

**Create / Edit Role modal** (`EnhancedModal`):
- Name (required), Slug (auto-fill, locked after create), Description (optional)
- Permissions: grouped checkboxes by domain
- Delete confirmation if role has active members → reassign to `ag_viewer`

---

## Open Questions

1. **Privilege escalation guard** — hard-reject assigning a role with more permissions than the assigner's own, or warn?
2. **Member count on delete** — block delete when members hold the role, or auto-reassign to `ag_viewer` with confirmation?
