# SCIM 2.0 Implementation Plan

Tasks are ordered by dependency. Each task is independently implementable once its dependencies are done. No phase grouping — pick up any unblocked task.

## Dependency Graph

```
SCIM-001 → SCIM-002
SCIM-003 → SCIM-004 → SCIM-007 → SCIM-008 → SCIM-009
                                           ↓
SCIM-005 → SCIM-010 → SCIM-012 → SCIM-015 → SCIM-016
        ↘ SCIM-011 → SCIM-013 ↗
SCIM-006 ↗
SCIM-014 → SCIM-015
```

---

### SCIM-001: Add users.active column migration

**Depends on:** none
**Files to create/modify:**
- `api/oss/databases/postgres/migrations/core/versions/<new_revision>.py` (create)

**What to do:**
Add an Alembic migration that adds an `active` boolean column to the `users` table:
- `op.add_column("users", sa.Column("active", sa.Boolean(), nullable=False, server_default="true"))`
- Downgrade: `op.drop_column("users", "active")`

Use `uuid7()` as the revision id convention matching the rest of the migration chain. Set `down_revision` to the current head.

**Done when:**
Migration applies cleanly with `alembic upgrade head`. All existing rows have `users.active = TRUE` by default. Downgrade removes the column cleanly.

---

### SCIM-002: Add users.scim_external_id column migration

**Depends on:** SCIM-001
**Files to create/modify:**
- `api/oss/databases/postgres/migrations/core/versions/<new_revision>.py` (create)

**What to do:**
Add an Alembic migration for a new nullable `scim_external_id` column on `users`:
- `op.add_column("users", sa.Column("scim_external_id", sa.String(), nullable=True))`
- `op.create_index("ix_users_scim_external_id", "users", ["scim_external_id"])`
- Downgrade: drop index then drop column.

**Done when:**
Migration applies cleanly. Column is nullable. Index `ix_users_scim_external_id` exists and is queryable.

---

### SCIM-003: Create scim_tokens and scim_groups DB tables (migration)

**Depends on:** none
**Files to create/modify:**
- `api/ee/databases/postgres/migrations/versions/<new_revision>.py` (create)

**What to do:**
Add a single Alembic migration that creates two tables in the EE migration chain.

`scim_tokens`:
```
id               UUID PRIMARY KEY  (uuid7 server default)
organization_id  UUID NOT NULL UNIQUE FK → organizations.id ON DELETE CASCADE
hashed_token     VARCHAR NOT NULL
description      VARCHAR nullable
created_by_id    UUID FK → users.id
created_at       TIMESTAMP WITH TIME ZONE NOT NULL server_default now()
expires_at       TIMESTAMP WITH TIME ZONE nullable
```

`scim_groups`:
```
id               UUID PRIMARY KEY  (uuid7 server default)
organization_id  UUID NOT NULL FK → organizations.id ON DELETE CASCADE
entity_type      VARCHAR NOT NULL  -- 'organization' | 'workspace' | 'project'
entity_id        UUID NOT NULL
role             VARCHAR NOT NULL
display_name     VARCHAR NOT NULL
external_id      VARCHAR nullable
created_at       TIMESTAMP WITH TIME ZONE NOT NULL server_default now()
updated_at       TIMESTAMP WITH TIME ZONE NOT NULL server_default now()
UNIQUE (organization_id, entity_type, entity_id, role)
```

Downgrade drops both tables in reverse order.

**Done when:**
Both tables are created. UNIQUE constraint on `scim_tokens.organization_id` prevents duplicate tokens per org. UNIQUE constraint on `scim_groups` prevents duplicate group/role mappings. All FK constraints pass.

---

### SCIM-004: Add ScimTokenDBE and ScimGroupDBE (SQLAlchemy models)

**Depends on:** SCIM-003
**Files to create/modify:**
- `api/ee/src/dbs/postgres/scim/dbes.py` (create)

**What to do:**
Define two SQLAlchemy ORM models. Follow the mixin pattern used by existing EE DBEs such as `OrganizationProviderDBE`. Use `IdentifierDBA` (provides `id` with uuid7 default) and `LifecycleDBA` (provides `created_at`, `updated_at`) where appropriate.

`ScimTokenDBE(Base)`:
- `__tablename__ = "scim_tokens"`
- Columns: `id`, `organization_id`, `hashed_token`, `description`, `created_by_id`, `created_at`, `expires_at`
- Relationship: `organization` → `OrganizationDBE`

`ScimGroupDBE(Base)`:
- `__tablename__ = "scim_groups"`
- Columns: `id`, `organization_id`, `entity_type`, `entity_id`, `role`, `display_name`, `external_id`, `created_at`, `updated_at`
- Relationship: `organization` → `OrganizationDBE`

Both models must be importable from `api/ee/src/dbs/postgres/scim/dbes.py`. Register them in the EE metadata/Base so Alembic detects them.

**Done when:**
`from api.ee.src.dbs.postgres.scim.dbes import ScimTokenDBE, ScimGroupDBE` raises no import errors. FK references to `organizations` and `users` resolve correctly at import time.

---

### SCIM-005: Define SCIM DTOs

**Depends on:** none
**Files to create/modify:**
- `api/ee/src/core/scim/dtos.py` (create)

**What to do:**
Define Pydantic v2 `BaseModel` DTOs for the SCIM domain. These are internal data contracts — not API wire shapes (those go in `models.py`).

```python
class ScimTokenCreate(BaseModel):
    description: Optional[str] = None
    expires_at: Optional[datetime] = None

class ScimToken(BaseModel):
    id: UUID
    organization_id: UUID
    description: Optional[str]
    created_by_id: UUID
    created_at: datetime
    expires_at: Optional[datetime]

class ScimGroupCreate(BaseModel):
    organization_id: UUID
    entity_type: str  # 'organization' | 'workspace' | 'project'
    entity_id: UUID
    role: str
    display_name: str
    external_id: Optional[str] = None

class ScimGroup(BaseModel):
    id: UUID
    organization_id: UUID
    entity_type: str
    entity_id: UUID
    role: str
    display_name: str
    external_id: Optional[str]
    created_at: datetime
    updated_at: datetime

class ScimUserProvision(BaseModel):
    userName: str           # maps to email
    givenName: str
    familyName: str
    active: bool = True
    externalId: Optional[str] = None

class ScimUserUpdate(BaseModel):
    active: Optional[bool] = None
    givenName: Optional[str] = None
    familyName: Optional[str] = None

class ScimUserResult(BaseModel):
    id: UUID
    userName: str
    givenName: str
    familyName: str
    active: bool
    externalId: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]
```

**Done when:**
All DTOs importable. Pydantic v2 `model_rebuild()` passes. No cross-imports to API layer.

---

### SCIM-006: Define SCIM API request/response models (RFC 7643 shapes)

**Depends on:** none
**Files to create/modify:**
- `api/ee/src/apis/fastapi/scim/models.py` (create)

**What to do:**
Define Pydantic models matching RFC 7643 wire format. Field names must match the spec exactly — use camelCase where SCIM requires it (e.g., `externalId`, `userName`, `displayName`, `totalResults`).

```python
SCIM_USER_SCHEMA   = "urn:ietf:params:scim:schemas:core:2.0:User"
SCIM_GROUP_SCHEMA  = "urn:ietf:params:scim:schemas:core:2.0:Group"
SCIM_LIST_SCHEMA   = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
SCIM_PATCH_SCHEMA  = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
SCIM_ERROR_SCHEMA  = "urn:ietf:params:scim:api:messages:2.0:Error"

class ScimName(BaseModel):
    formatted: Optional[str]
    givenName: Optional[str]
    familyName: Optional[str]

class ScimEmail(BaseModel):
    value: str
    type: str = "work"
    primary: bool = True

class ScimMeta(BaseModel):
    resourceType: str
    created: Optional[datetime]
    lastModified: Optional[datetime]
    location: Optional[str]
    version: Optional[str]

class ScimUserResponse(BaseModel):
    schemas: List[str] = [SCIM_USER_SCHEMA]
    id: str
    externalId: Optional[str]
    userName: str
    name: ScimName
    emails: List[ScimEmail]
    active: bool
    meta: ScimMeta

class ScimGroupMember(BaseModel):
    value: str
    display: Optional[str]
    ref: Optional[str] = Field(None, alias="$ref")

class ScimGroupResponse(BaseModel):
    schemas: List[str] = [SCIM_GROUP_SCHEMA]
    id: str
    displayName: str
    members: List[ScimGroupMember] = []
    meta: ScimMeta

class ScimListResponse(BaseModel):
    schemas: List[str] = [SCIM_LIST_SCHEMA]
    totalResults: int
    startIndex: int
    itemsPerPage: int
    Resources: List[Any]

class ScimPatchOperation(BaseModel):
    op: str   # "add" | "remove" | "replace"
    path: Optional[str]
    value: Optional[Any]

class ScimPatchOp(BaseModel):
    schemas: List[str] = [SCIM_PATCH_SCHEMA]
    Operations: List[ScimPatchOperation]

class ScimError(BaseModel):
    schemas: List[str] = [SCIM_ERROR_SCHEMA]
    status: int
    detail: str
```

Configure model with `model_config = ConfigDict(populate_by_name=True)` to allow alias `$ref`.

**Done when:**
All models importable. `ScimListResponse(Resources=[...])` serializes correctly. `ScimGroupMember` serializes `$ref` field properly. Field names match RFC 7643 exactly.

---

### SCIM-007: Implement ScimDAO

**Depends on:** SCIM-004, SCIM-005
**Files to create/modify:**
- `api/ee/src/dbs/postgres/scim/dao.py` (create)
- `api/ee/src/dbs/postgres/scim/mappings.py` (create)

**What to do:**
Implement the DAO class and DBE-to-DTO mappings. Follow the same async session pattern as `OrganizationsDAO` or `WorkspacesDAO`.

Mappings in `mappings.py`:
```python
def scim_token_dbe_to_dto(dbe: ScimTokenDBE) -> ScimToken: ...
def scim_group_dbe_to_dto(dbe: ScimGroupDBE) -> ScimGroup: ...
```

DAO methods in `dao.py` (class `ScimDAO`):
```python
async def create_scim_token(
    self, *, org_id: UUID, hashed_token: str,
    description: Optional[str], created_by_id: UUID,
    expires_at: Optional[datetime]
) -> ScimToken

async def get_scim_token_by_org(self, *, org_id: UUID) -> Optional[ScimToken]

async def delete_scim_token(self, *, org_id: UUID) -> bool

async def create_scim_group(self, *, create: ScimGroupCreate) -> ScimGroup

async def get_scim_group(self, *, group_id: UUID) -> Optional[ScimGroup]

async def list_scim_groups(
    self, *, org_id: UUID,
    filter_str: Optional[str] = None,
    start_index: int = 1,
    count: int = 100,
) -> Tuple[List[ScimGroup], int]

async def delete_scim_group(self, *, group_id: UUID) -> bool
```

For `list_scim_groups`, support basic SCIM filter parsing: `displayName eq "..."` and `externalId eq "..."`. Apply `offset = start_index - 1` (SCIM uses 1-based indexing).

**Done when:**
All DAO methods implemented. Mappings return typed DTOs, not dicts. `list_scim_groups` returns `(items, total_count)` tuple. No raw dict returns from any method.

---

### SCIM-008: Implement require_scim_auth() FastAPI dependency

**Depends on:** SCIM-007
**Files to create/modify:**
- `api/ee/src/apis/fastapi/scim/utils.py` (create)

**What to do:**
Implement a FastAPI dependency that validates Bearer tokens from the `Authorization` header.

Token format: `{8-char-prefix}.{32-byte-hex}` — same convention as existing API keys. Store only the SHA-256 hash of the full raw token. The prefix is stored plaintext for lookup.

```python
async def require_scim_auth(
    request: Request,
    scim_dao: ScimDAO = Depends(get_scim_dao),
) -> UUID:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    raw_token = auth_header.removeprefix("Bearer ").strip()
    # Extract prefix (first 8 chars before ".")
    # Hash full raw_token with SHA-256
    # Look up ScimDAO.get_scim_token_by_org — iterate or index by prefix
    # Compare stored hashed_token with computed hash (constant-time compare)
    # Check expires_at: raise 401 if expired
    # Return organization_id from matched token
```

Use `hmac.compare_digest` for constant-time comparison to prevent timing attacks.

**Done when:**
Valid unexpired token returns `UUID` of the organization. Invalid token raises `HTTPException(401)`. Expired token raises `HTTPException(401)`. Missing `Authorization` header raises `HTTPException(401)`.

---

### SCIM-009: Implement SCIM token management API

**Depends on:** SCIM-008
**Files to create/modify:**
- `api/ee/src/apis/fastapi/scim/router.py` (create)
- `api/ee/src/main.py` (modify — wire router in `extend_main`)

**What to do:**
Create the SCIM router class following the `__init__` + `self.router.add_api_route(...)` pattern. Add two token management endpoints, mounted under `/api/organizations/{organization_id}/scim`:

`POST /token`:
1. Verify caller is OWNER or ADMIN of `organization_id` (reuse existing RBAC permission check from EE organizations).
2. Generate token: `prefix = secrets.token_hex(4)` (8 chars), `secret = secrets.token_hex(16)` (32 chars), `raw_token = f"{prefix}.{secret}"`.
3. Hash: `hashed = hashlib.sha256(raw_token.encode()).hexdigest()`.
4. Call `ScimDAO.delete_scim_token(org_id=organization_id)` to revoke any existing token (rotation).
5. Call `ScimDAO.create_scim_token(org_id=organization_id, hashed_token=hashed, ...)`.
6. Return `{"token": raw_token, "prefix": prefix}` — plaintext token shown once only.

`DELETE /token`:
1. Verify caller is OWNER or ADMIN.
2. Call `ScimDAO.delete_scim_token(org_id=organization_id)`.
3. Return `204 No Content`.

Wire into EE app in `extend_main()`:
```python
from api.ee.src.apis.fastapi.scim.router import ScimRouter
scim_router = ScimRouter()
app.include_router(scim_router.router, prefix="/api")
```

**Done when:**
`POST /api/organizations/{id}/scim/token` returns a plaintext token. That token can be used as a Bearer token in `require_scim_auth`. `DELETE /api/organizations/{id}/scim/token` revokes it (subsequent SCIM calls return 401). Non-OWNER/ADMIN callers receive 403.

---

### SCIM-010: Implement ScimService — user provisioning

**Depends on:** SCIM-007, SCIM-005
**Files to create/modify:**
- `api/ee/src/core/scim/service.py` (create)

**What to do:**
Implement `ScimService` with user lifecycle methods. The service depends on injected DAOs: `UsersDAO`, `OrganizationMembersDAO`, `ScimDAO`. Use existing OSS DAOs and follow the same async pattern.

```python
class ScimService:
    async def provision_user(
        self, *, org_id: UUID, data: ScimUserProvision
    ) -> ScimUserResult:
        # 1. Look up user by data.userName (= email) in users table
        # 2. If not found: create user row
        #    id=uuid7(), email=data.userName, uid=data.userName,
        #    username=data.givenName, active=True
        # 3. If data.externalId provided:
        #    Upsert UserIdentityDBE: method="scim", subject=data.externalId,
        #    domain=org.slug, user_id=user.id
        # 4. Add to organization_members with role="member" if not already present
        # 5. Return ScimUserResult

    async def deprovision_user(self, *, org_id: UUID, user_id: UUID) -> None:
        # 1. Set users.active = False
        # 2. Delete organization_members row where user_id + org_id
        # 3. Delete workspace_members rows for all workspaces in org
        # 4. Delete project_members rows for all projects in org
        # Do NOT delete the user row

    async def get_user(
        self, *, org_id: UUID, user_id: UUID
    ) -> Optional[ScimUserResult]:
        # Fetch user, verify they belong to org, return ScimUserResult

    async def list_users(
        self, *,
        org_id: UUID,
        filter_str: Optional[str] = None,
        start_index: int = 1,
        count: int = 100,
    ) -> Tuple[List[ScimUserResult], int]:
        # Parse SCIM filter expressions:
        #   userName eq "..."   → query by email
        #   externalId eq "..."  → query user_identities (method="scim", subject=value)
        #   emails.value eq "..." → same as userName
        # Scope to org members only
        # Return (items, total_count), 1-based start_index

    async def update_user(
        self, *, org_id: UUID, user_id: UUID, update: ScimUserUpdate
    ) -> ScimUserResult:
        # active=False → call deprovision_user
        # active=True  → set users.active=True, re-add org membership
        # givenName/familyName → update users table
```

**Done when:**
Provision round-trip: create user, add org membership, return result. Deprovision: sets active=False, removes memberships, does not delete user. `list_users` with `userName eq` filter returns matching user. `list_users` with `externalId eq` filter queries via `user_identities`. All return typed DTOs (no raw dicts).

---

### SCIM-011: Implement ScimService — group management

**Depends on:** SCIM-007, SCIM-005
**Files to create/modify:**
- `api/ee/src/core/scim/service.py` (modify)

**What to do:**
Add group management methods to `ScimService`. Groups in SCIM map to membership grants: a SCIM group represents "members of entity X with role Y".

```python
async def create_group(
    self, *, org_id: UUID, data: ScimGroupCreate
) -> ScimGroup:
    # Validate entity_id belongs to org_id for the given entity_type
    # Insert scim_groups row via ScimDAO
    # Return ScimGroup DTO

async def add_group_member(
    self, *, org_id: UUID, group_id: UUID, user_id: UUID
) -> None:
    # Fetch scim_group → get entity_type, entity_id, role
    # Based on entity_type:
    #   'organization' → upsert organization_members(org_id, user_id, role)
    #   'workspace'    → upsert workspace_members(workspace_id=entity_id, user_id, role)
    #   'project'      → upsert project_members(project_id=entity_id, user_id, role)
    # Idempotent: skip if already a member with same or higher role

async def remove_group_member(
    self, *, org_id: UUID, group_id: UUID, user_id: UUID
) -> None:
    # Fetch scim_group → get entity_type, entity_id, role
    # Delete corresponding membership row
    # Only remove the specific role granted by this group

async def replace_group_members(
    self, *, org_id: UUID, group_id: UUID, new_user_ids: List[UUID]
) -> None:
    # Fetch current members of the group (by querying memberships)
    # Compute diff: to_add = new_user_ids - current, to_remove = current - new_user_ids
    # Call add_group_member for each in to_add
    # Call remove_group_member for each in to_remove

async def delete_group(self, *, org_id: UUID, group_id: UUID) -> None:
    # Fetch all current members of the group
    # Remove their memberships (only if no other group grants same access)
    # Delete scim_groups row via ScimDAO
```

**Done when:**
`add_group_member` creates the correct membership row based on `entity_type`. `remove_group_member` deletes it. `replace_group_members` produces correct diff and applies it. `delete_group` cleans up memberships. All operations are idempotent (re-running produces same result).

---

### SCIM-012: Implement SCIM Users endpoints

**Depends on:** SCIM-010, SCIM-006, SCIM-008
**Files to create/modify:**
- `api/ee/src/apis/fastapi/scim/router.py` (modify)

**What to do:**
Add SCIM Users CRUD endpoints to the router. All routes require `require_scim_auth` dependency, which injects `org_id: UUID`. Mount at `/api/scim/v2`.

Helper: implement `user_result_to_scim_response(user: ScimUserResult, base_url: str) -> ScimUserResponse` in `utils.py`. Populates `meta.location = f"{base_url}/Users/{user.id}"`.

```
POST   /Users
  Body: RFC 7643 User object (parse userName, name.givenName, name.familyName, externalId, active)
  → ScimService.provision_user(org_id, ScimUserProvision(...))
  → 201 ScimUserResponse
  → 409 ScimError if userName already exists in org

GET    /Users
  Query params: filter (str), startIndex (int=1), count (int=100)
  → ScimService.list_users(org_id, filter_str, start_index, count)
  → 200 ScimListResponse

GET    /Users/{id}
  → ScimService.get_user(org_id, user_id)
  → 200 ScimUserResponse
  → 404 ScimError if not found

PUT    /Users/{id}
  Body: full RFC 7643 User object
  → ScimService.update_user with all fields from body
  → 200 ScimUserResponse

PATCH  /Users/{id}
  Body: ScimPatchOp
  → Parse Operations: handle op="replace" on "active", "name.givenName", "name.familyName"
  → Build ScimUserUpdate from operations, call ScimService.update_user
  → 200 ScimUserResponse

DELETE /Users/{id}
  → ScimService.deprovision_user(org_id, user_id)
  → 204 No Content
```

Set `Content-Type: application/scim+json` on all responses via a response class or middleware.

**Done when:**
All 6 endpoints return correct HTTP status codes. `POST /Users` with duplicate `userName` returns 409. `GET /Users?filter=userName eq "x@y.com"` returns matching user in `Resources`. `PATCH /Users/{id}` with `active=false` triggers deprovision. `DELETE /Users/{id}` returns 204.

---

### SCIM-013: Implement SCIM Groups endpoints

**Depends on:** SCIM-011, SCIM-006, SCIM-008
**Files to create/modify:**
- `api/ee/src/apis/fastapi/scim/router.py` (modify)

**What to do:**
Add SCIM Groups CRUD endpoints. All routes require `require_scim_auth`.

Helper: `group_to_scim_response(group: ScimGroup, members: List[ScimGroupMember], base_url: str) -> ScimGroupResponse`.

```
POST   /Groups
  Body: {"displayName": "...", "externalId": "...", "agenta:entityType": "workspace",
         "agenta:entityId": "...", "agenta:role": "editor"}
  Use a non-standard extension namespace (agenta:) for entity mapping fields
  → ScimService.create_group(org_id, ScimGroupCreate(...))
  → 201 ScimGroupResponse

GET    /Groups
  Query: filter, startIndex, count
  → ScimDAO.list_scim_groups(org_id, ...)
  → 200 ScimListResponse

GET    /Groups/{id}
  → ScimDAO.get_scim_group(group_id), verify belongs to org_id
  → 200 ScimGroupResponse (with current members)
  → 404 ScimError if not found

PUT    /Groups/{id}
  Body: full group with members list
  → Update displayName
  → ScimService.replace_group_members(org_id, group_id, [m.value for m in members])
  → 200 ScimGroupResponse

PATCH  /Groups/{id}
  Body: ScimPatchOp
  → Parse Operations:
      op="add",     path="members", value=[{value: user_id}] → add_group_member per entry
      op="remove",  path="members[value eq \"{id}\"]"        → remove_group_member
      op="replace", path="members"                           → replace_group_members
  → 200 ScimGroupResponse

DELETE /Groups/{id}
  → ScimService.delete_group(org_id, group_id)
  → 204 No Content
```

**Done when:**
`POST /Groups` creates a group and returns 201. `PATCH /Groups/{id}` with `op=add` on `members` creates the correct workspace/project/org membership row. `PATCH` with `op=remove` deletes the membership. `DELETE /Groups/{id}` returns 204 and removes the scim_groups row.

---

### SCIM-014: Implement ServiceProviderConfig and discovery endpoints

**Depends on:** SCIM-008
**Files to create/modify:**
- `api/ee/src/apis/fastapi/scim/router.py` (modify)

**What to do:**
Add three static discovery endpoints to the router. These do not require SCIM auth — they are publicly readable.

`GET /ServiceProviderConfig`:
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "patch":            {"supported": true},
  "bulk":             {"supported": false, "maxOperations": 0, "maxPayloadSize": 0},
  "filter":           {"supported": true, "maxResults": 200},
  "changePassword":   {"supported": false},
  "sort":             {"supported": false},
  "etag":             {"supported": false},
  "authenticationSchemes": [
    {
      "type": "oauthbearertoken",
      "name": "OAuth Bearer Token",
      "description": "Authentication scheme using the OAuth Bearer Token standard"
    }
  ]
}
```

`GET /ResourceTypes`:
Return array with User and Group resource type definitions following RFC 7643 §6.

`GET /Schemas`:
Return array with the core:2.0:User and core:2.0:Group schema definitions (attribute list per RFC 7643 §7).

All three return `Content-Type: application/scim+json`.

**Done when:**
`GET /api/scim/v2/ServiceProviderConfig` returns 200 with correct JSON. Okta SCIM provisioner test tool can connect and discover capabilities without error. `GET /ResourceTypes` returns both User and Group entries.

---

### SCIM-015: Wire SCIM router into EE app

**Depends on:** SCIM-012, SCIM-013, SCIM-014
**Files to create/modify:**
- `api/ee/src/main.py` (modify)
- `api/entrypoints/routers.py` (verify — no changes expected)

**What to do:**
In `extend_main()`, import and mount the SCIM router at the SCIM v2 base path:

```python
from api.ee.src.apis.fastapi.scim.router import ScimRouter

def extend_main(app: FastAPI) -> None:
    # ... existing EE extensions ...
    scim = ScimRouter()
    app.include_router(scim.router, prefix="/api/scim/v2")
```

The management endpoints (`/api/organizations/{id}/scim/token`) were already wired in SCIM-009 as part of the `ScimRouter` class — confirm prefix is correct and does not collide.

Verify `api/entrypoints/routers.py` does not need changes (SCIM is EE-only; OSS app should not mount these routes).

**Done when:**
`GET /api/scim/v2/ServiceProviderConfig` returns 200 on a running EE instance. All SCIM routes (`/api/scim/v2/Users`, `/api/scim/v2/Groups`, `/api/scim/v2/ServiceProviderConfig`, `/api/scim/v2/ResourceTypes`, `/api/scim/v2/Schemas`) appear in `/api/openapi.json` on the EE build. OSS build does not expose these routes.

---

### SCIM-016: Integration test — Okta-style provisioning flow

**Depends on:** SCIM-015
**Files to create/modify:**
- `api/tests/ee/scim/test_scim_provisioning.py` (create)

**What to do:**
Write an async pytest integration test that exercises the full SCIM provisioning round-trip against the test database. Use the same test fixtures and env file convention as other EE tests (`hosting/docker-compose/ee/.env.ee.dev`, run via `python run-tests.py` from `api/`).

Test steps in order:

1. **Token generation** — `POST /api/organizations/{org_id}/scim/token` as an org OWNER. Assert 200, token present in response body. Store token for subsequent calls.

2. **User creation** — `POST /api/scim/v2/Users` with Bearer token. Body: `{"schemas": [...], "userName": "test@example.com", "name": {"givenName": "Test", "familyName": "User"}, "active": true}`. Assert 201. Assert `users` table row created. Assert `organization_members` row created.

3. **User lookup by filter** — `GET /api/scim/v2/Users?filter=userName eq "test@example.com"`. Assert 200, `totalResults=1`, returned user matches.

4. **Deprovision via PATCH** — `PATCH /api/scim/v2/Users/{id}` with `Operations=[{op: "replace", path: "active", value: false}]`. Assert 200. Assert `users.active=False`. Assert `organization_members` row deleted.

5. **Reprovision via PATCH** — `PATCH /api/scim/v2/Users/{id}` with `active=true`. Assert 200. Assert `users.active=True`. Assert `organization_members` row re-created.

6. **Group creation** — `POST /api/scim/v2/Groups` with workspace entity mapping. Assert 201, `scim_groups` row created.

7. **Add group member** — `PATCH /api/scim/v2/Groups/{group_id}` with `op=add`, `path=members`, `value=[{value: user_id}]`. Assert 200. Assert `workspace_members` row created.

8. **Remove group member** — `PATCH /api/scim/v2/Groups/{group_id}` with `op=remove`, path targeting the member. Assert 200. Assert `workspace_members` row deleted.

9. **Delete group** — `DELETE /api/scim/v2/Groups/{group_id}`. Assert 204. Assert `scim_groups` row gone.

10. **Delete user (deprovision)** — `DELETE /api/scim/v2/Users/{id}`. Assert 204. Assert `users.active=False`, memberships removed.

**Done when:**
All 10 assertions pass against the test database with no manual setup. Tests are idempotent (can re-run). Invalid-token calls in the same test file return 401.
