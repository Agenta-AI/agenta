# SCIM 2.0 Implementation — Design Proposal

**Audience:** Engineers implementing the feature.
**Scope:** EE-only. OSS is not affected.
**Standards:** RFC 7643 (SCIM Schema), RFC 7644 (SCIM Protocol).

---

## 1. Approach: Groups as Flat Access Boundaries

SCIM Groups map directly to Agenta's three-tier access model. Each SCIM Group represents a single `(entity_type, entity_id, role)` tuple. The canonical mapping is stored in a `scim_groups` registry table. The `displayName` follows a naming convention for human readability and IdP tooling, but it is not parsed at runtime — the DB row is authoritative.

**Why this approach:**

- Works with every IdP out of the box (Okta, Azure AD, Google Workspace, JumpCloud). No custom SCIM schema extensions are needed.
- Agenta's three-tier hierarchy (Org → Workspace → Project) is already flat from SCIM's perspective: membership is expressed as `user ∈ group`, and each group represents one access boundary at one role level.
- The hierarchy lives in Agenta's DB. SCIM only drives who is in which group; Agenta resolves what that means in terms of access.
- Group membership operations (`PATCH /Groups/{id}`) translate directly to existing membership create/delete flows.

**Trade-off:** Group proliferation in the IdP. A user who needs org-level access, workspace-level access, and project-level access requires three separate group assignments. This is a known consequence of flat group mapping and acceptable given that IdP group assignment is typically handled by automation or directory sync rules.

---

## 2. Group Naming Convention

`displayName` follows this pattern:

| `displayName` | Access granted |
|---|---|
| `agenta:org:{org_slug_or_id}:member` | Org member (role = `member`) |
| `agenta:org:{org_slug_or_id}:admin` | Org admin (role = `admin`) |
| `agenta:wrk:{workspace_slug_or_id}:viewer` | Workspace viewer |
| `agenta:wrk:{workspace_slug_or_id}:developer` | Workspace developer |
| `agenta:wrk:{workspace_slug_or_id}:editor` | Workspace editor |
| `agenta:wrk:{workspace_slug_or_id}:admin` | Workspace admin |
| `agenta:prj:{project_slug_or_id}:viewer` | Project viewer |
| `agenta:prj:{project_slug_or_id}:annotator` | Project annotator |
| `agenta:prj:{project_slug_or_id}:editor` | Project editor |
| `agenta:prj:{project_slug_or_id}:developer` | Project developer |

**Slug vs ID resolution:** The segment after the entity prefix (`org:`, `wrk:`, `prj:`) is resolved as follows:

1. If it is a valid UUID, look up by `id`.
2. Otherwise, treat it as a `slug` (requires workspaces and projects to have a `slug` column — see §3.3).

The `role` segment is optional. If omitted, the default role for the entity type is used:

- `organization` → `member`
- `workspace` → `viewer`
- `project` → `viewer`

Example: `agenta:wrk:eng-platform` resolves to workspace with slug `eng-platform` at role `viewer`.

These names surface in the IdP's group list and help administrators identify groups at a glance. The canonical source of truth is `scim_groups.entity_type + entity_id + role`. `displayName` is stored and returned but never parsed to derive access.

---

## 3. New Database Tables

### 3.1 `scim_tokens`

One token per organization. Stores the bearer credential the IdP uses to authenticate all SCIM requests to that org.

```sql
CREATE TABLE scim_tokens (
    id              UUID PRIMARY KEY,               -- uuid7
    organization_id UUID NOT NULL UNIQUE
                    REFERENCES organizations(id)
                    ON DELETE CASCADE,
    hashed_token    VARCHAR NOT NULL,               -- SHA-256 hex of full token
    description     VARCHAR,
    created_by_id   UUID NOT NULL
                    REFERENCES users(id),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at      TIMESTAMP WITH TIME ZONE
);
```

Notes:
- `UNIQUE (organization_id)` — one active token per org. Rotation replaces the row.
- `expires_at` is nullable. A null value means the token never expires.
- The plaintext token is never stored. It is returned once at creation time.

### 3.2 `scim_groups`

Registry mapping SCIM group IDs to Agenta access boundaries.

```sql
CREATE TABLE scim_groups (
    id              UUID PRIMARY KEY,               -- uuid7, also the SCIM group id
    organization_id UUID NOT NULL
                    REFERENCES organizations(id)
                    ON DELETE CASCADE,
    entity_type     VARCHAR NOT NULL,               -- 'organization' | 'workspace' | 'project'
    entity_id       UUID NOT NULL,
    role            VARCHAR NOT NULL,               -- Agenta role string (e.g. 'viewer', 'editor')
    display_name    VARCHAR NOT NULL,
    external_id     VARCHAR,                        -- IdP-side group ID, if provided by IdP
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT scim_groups_unique_boundary
        UNIQUE (organization_id, entity_type, entity_id, role)
);

CREATE INDEX ON scim_groups (organization_id);
CREATE INDEX ON scim_groups (external_id) WHERE external_id IS NOT NULL;
```

Notes:
- `id` is the value returned as the SCIM group's `id` field. It does not correspond to any `organizations`, `workspaces`, or `projects` PK.
- `entity_type` is an enum-like string constrained by application logic: `'organization'`, `'workspace'`, or `'project'`.
- `external_id` is the IdP's own stable identifier for the group, if supplied in `POST /Groups` or `PUT /Groups/{id}`. Used to support IdP-side group lookups.

### 3.3 Migrations on Existing Tables

#### `users` — add `active` flag

```sql
ALTER TABLE users
    ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
```

Used for SCIM deprovisioning. Setting `active = false` suspends the user without deleting the row or any historical data. Re-activation is possible. All authentication checks should gate on `users.active = true`.

#### `users` — add `scim_external_id` (optional dedup index)

```sql
ALTER TABLE users
    ADD COLUMN scim_external_id VARCHAR;

CREATE INDEX ON users (scim_external_id) WHERE scim_external_id IS NOT NULL;
```

This is a convenience column for fast lookup when the IdP sends `externalId` on `POST /Users`. The authoritative link is `user_identities` (`method='scim'`, `subject=<externalId>`). `scim_external_id` on `users` is a denormalized fast path.

#### `workspaces` and `projects` — add `slug` column

```sql
ALTER TABLE workspaces ADD COLUMN slug VARCHAR;
CREATE UNIQUE INDEX ON workspaces (organization_id, slug);

ALTER TABLE projects ADD COLUMN slug VARCHAR;
CREATE UNIQUE INDEX ON projects (workspace_id, slug);
```

Slugs are URL-safe identifiers (lowercase alphanumeric + hyphens). They allow group `displayName` patterns like `agenta:wrk:eng-platform:editor` without requiring IdP admins to know internal UUIDs. Slug uniqueness is scoped: workspace slugs are unique within an org; project slugs within a workspace.

If a workspace or project has no slug set, only UUID-based lookup is supported for that entity.

#### `organization_members`, `workspace_members`, `project_members` — no schema changes

SCIM group membership operations write to these tables through existing membership create/delete service methods. No new columns are required.

---

## 4. Authentication: SCIM Token

### Token Format

```
{8-char-prefix}.{64-char-hex}
```

Same pattern as existing API keys (`ApiKey` prefix type). The prefix is stored in plaintext for lookup. The full token is hashed (SHA-256) before storage. The token is returned once at creation time and never again.

### Validation Dependency

A FastAPI dependency `require_scim_auth` is injected on all `/scim/v2/*` routes:

```python
async def require_scim_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> UUID:
    """
    Validates the SCIM bearer token and returns the resolved organization_id.
    Raises HTTP 401 if the token is missing, malformed, expired, or not found.
    """
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing SCIM bearer token.")

    raw_token = authorization.removeprefix("Bearer ").strip()
    prefix, _, _ = raw_token.partition(".")
    hashed = hashlib.sha256(raw_token.encode()).hexdigest()

    token_row = await scim_token_dao.get_by_prefix_and_hash(
        db, prefix=prefix, hashed_token=hashed
    )
    if not token_row:
        raise HTTPException(status_code=401, detail="Invalid or expired SCIM token.")
    if token_row.expires_at and token_row.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=401, detail="SCIM token has expired.")

    return token_row.organization_id
```

This dependency does **not** touch `authentication_middleware` in OSS. It is a standalone FastAPI dependency used exclusively on SCIM routes.

### Token Management Endpoint

SCIM token creation/rotation is a separate, user-authenticated management endpoint (not under `/scim/v2/`). Only org OWNER or ADMIN may call it. Suggested placement: `POST /api/organizations/{organization_id}/scim-token`.

---

## 5. SCIM Endpoints

All paths are mounted at `/api/scim/v2`.

| Method | Path | RFC reference | Description |
|--------|------|---------------|-------------|
| `GET` | `/ServiceProviderConfig` | RFC 7643 §5 | Capabilities discovery. Declares supported operations and bulk=false. |
| `GET` | `/ResourceTypes` | RFC 7643 §6 | Lists `User` and `Group` resource types. |
| `GET` | `/Schemas` | RFC 7643 §7 | Returns schema definitions for User and Group. |
| `GET` | `/Users` | RFC 7644 §3.4.2 | List/filter users. Supports `filter`, `startIndex`, `count`. |
| `POST` | `/Users` | RFC 7644 §3.3 | Provision a new user or link an existing one. |
| `GET` | `/Users/{id}` | RFC 7644 §3.4.1 | Fetch user by internal SCIM id (`users.id`). |
| `PUT` | `/Users/{id}` | RFC 7644 §3.5.1 | Full replace. Implemented as a safe PATCH (only updatable fields are written). |
| `PATCH` | `/Users/{id}` | RFC 7644 §3.5.2 | Partial update: `name`, `email`, `active`. |
| `DELETE` | `/Users/{id}` | RFC 7644 §3.6 | Deprovision: sets `active=false`, removes all memberships in this org. |
| `GET` | `/Groups` | RFC 7644 §3.4.2 | List/filter groups registered in `scim_groups` for this org. |
| `POST` | `/Groups` | RFC 7644 §3.3 | Create a group: registers an `(entity_type, entity_id, role)` tuple in `scim_groups`. |
| `GET` | `/Groups/{id}` | RFC 7644 §3.4.1 | Fetch group with current member list. |
| `PUT` | `/Groups/{id}` | RFC 7644 §3.5.1 | Full replace of group metadata and members. |
| `PATCH` | `/Groups/{id}` | RFC 7644 §3.5.2 | Add/remove members. Drives membership table writes. |
| `DELETE` | `/Groups/{id}` | RFC 7644 §3.6 | Delete group: removes from `scim_groups`, removes all memberships for this group. |

`ServiceProviderConfig` must declare:

```json
{
  "bulk": { "supported": false },
  "filter": { "supported": true, "maxResults": 200 },
  "patch": { "supported": true },
  "changePassword": { "supported": false },
  "sort": { "supported": false },
  "etag": { "supported": false }
}
```

---

## 6. User Provisioning Flow

### `POST /scim/v2/Users`

1. Validate `Authorization: Bearer <token>` → resolve `organization_id`.
2. Parse request body. Required fields: `userName` (mapped to `email`), `name`.
3. Look up existing user by `email` in `users`. If found, proceed to step 5.
4. If not found, create a new `users` row (`uid` = `uuid7().hex`, `email`, `username` derived from `name.formatted` or `userName`).
5. Upsert a `user_identities` row: `method="scim"`, `subject=<externalId>` (if provided), `domain=<org.slug>`. If `externalId` is absent, use the internal `users.id` as `subject`.
6. If `active: false` is present in the payload, set `users.active = false`.
7. Return HTTP 201 with SCIM User resource:
   - `id` = `users.id`
   - `externalId` = value from `user_identities.subject` where `method="scim"`
   - `meta.resourceType` = `"User"`
   - `active` = `users.active`

### `PATCH /scim/v2/Users/{id}` — deprovisioning (`active: false`)

The IdP sends:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "active", "value": false }
  ]
}
```

Processing:

1. Validate token → resolve `organization_id`.
2. Look up `users` row by `id`. Return 404 if not found.
3. Set `users.active = false`.
4. Delete all membership rows for this `user_id` where the entity is scoped to this `organization_id`:
   - Delete from `organization_members` where `user_id = ? AND organization_id = ?`
   - Delete from `workspace_members` where `user_id = ? AND workspace_id IN (SELECT id FROM workspaces WHERE organization_id = ?)`
   - Delete from `project_members` where `user_id = ? AND project_id IN (SELECT id FROM projects WHERE organization_id = ?)`
5. Do **not** delete the `users` row or `user_identities` rows. The account can be reactivated.
6. Return HTTP 200 with the updated SCIM User resource (`active: false`).

### `PATCH /scim/v2/Users/{id}` — re-activation (`active: true`)

1. Set `users.active = true`.
2. Group membership is **not** automatically restored. The IdP must re-send group membership operations to re-assign access. This is intentional: access should be re-granted explicitly, not implicitly.
3. Return HTTP 200.

### `DELETE /scim/v2/Users/{id}`

Equivalent to `PATCH active=false`. Does not hard-delete the user row. Returns HTTP 204.

---

## 7. Group Membership Flow

### `POST /scim/v2/Groups` — group creation

1. Validate token → resolve `organization_id`.
2. Parse `displayName`. Optionally parse `entity_type`, `entity_id`, `role` from the name using the naming convention as a hint; fallback to requiring these in a `meta` or `urn:agenta:...` extension object if the IdP can send custom attributes. (See note below.)
3. Validate that `entity_id` exists and belongs to this `organization_id`.
4. Insert into `scim_groups`. Return HTTP 201 with `id = scim_groups.id`.

> **Note on group creation payload:** Pure SCIM clients (e.g., Okta) send only `displayName` and `members` on group push. To avoid requiring schema extensions for initial implementation, the canonical approach is: administrators pre-create groups via the Agenta management UI or API, which inserts into `scim_groups`. The IdP then syncs members into existing groups. Alternatively, accept a convention-compliant `displayName` and parse it. Either option should be documented in the integration guide.

### `PATCH /scim/v2/Groups/{id}` — member operations

The IdP sends one or more operations:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [{ "value": "<user-scim-id>" }]
    }
  ]
}
```

Processing per operation:

**`op=add`, `path=members`:**

For each `value` entry:
1. Look up `users.id` by SCIM user id.
2. Look up `scim_groups` row by group `id` → get `entity_type`, `entity_id`, `role`.
3. Call the appropriate membership create method:
   - `entity_type = 'organization'` → create `organization_members` row.
   - `entity_type = 'workspace'` → create `workspace_members` row.
   - `entity_type = 'project'` → create `project_members` row.
4. If membership already exists, treat as no-op (upsert or check-then-skip).

**`op=remove`, `path=members`:**

For each `value` entry:
1. Resolve user and group as above.
2. Delete the corresponding membership row.

**`op=replace`, `path=members`:**

1. Fetch the current member list for this group from the relevant membership table.
2. Compute diff: `to_add = new_set - current_set`, `to_remove = current_set - new_set`.
3. Apply adds and removes using the same logic as above.

All operations call existing membership service methods. The SCIM layer never writes directly to membership tables.

### Hierarchy cascade on membership add

When a user is added to a group at level K, they are automatically added to all **ancestor** levels with the default role for that level, if not already a member:

| Group entity type | Cascade targets |
| --- | --- |
| `project` | workspace the project belongs to (`viewer`), then org that workspace belongs to (`member`) |
| `workspace` | org that workspace belongs to (`member`) |
| `organization` | no cascade (top of hierarchy) |

The cascade is applied in order from outermost to innermost: org first, then workspace, then project. If the user is already a member at an ancestor level, the existing role is preserved (never downgraded by a cascade).

This ensures a user added to a project group always has the minimum access required to be visible in their workspace and org — no additional group assignments are needed for basic access resolution to work.

**Implementation note:** `ScimService.add_group_member()` calls `ensure_ancestor_memberships(user_id, entity_type, entity_id)` which walks up the hierarchy and upserts with the default role if the row does not exist.

### `DELETE /scim/v2/Groups/{id}`

1. Delete all membership rows for users linked to this group (the same scoped deletes as in user deprovisioning, but filtered to this `scim_groups.id`).
2. Delete the `scim_groups` row.
3. Return HTTP 204.

---

## 8. Folder Structure

```
api/ee/src/
├── apis/fastapi/scim/
│   ├── router.py       # Route registration. Injects require_scim_auth on all routes.
│   ├── models.py       # SCIM JSON schemas: ScimUser, ScimGroup, ScimListResponse,
│   │                   # ScimPatchOp, ScimError, ServiceProviderConfig, etc.
│   └── utils.py        # Filter expression parser (RFC 7644 §3.4.2.2),
│                       # displayName parser, SCIM↔internal field mapping.
│
├── core/scim/
│   ├── dtos.py         # ScimUserDTO, ScimGroupDTO, ScimTokenDTO,
│   │                   # ScimMembershipOperation, ScimProvisionResult.
│   ├── service.py      # Provisioning orchestration. Calls user service,
│   │                   # membership service, and SCIM DAOs. Never writes DB directly.
│   └── exceptions.py   # ScimError (base), ScimUserNotFound, ScimGroupNotFound,
│                       # ScimTokenInvalid, ScimConflict, ScimEntityNotFound.
│
└── dbs/postgres/scim/
    ├── dbes.py         # ScimTokenDBE (maps to scim_tokens),
    │                   # ScimGroupDBE (maps to scim_groups).
    ├── dao.py          # ScimTokenDAO, ScimGroupDAO. All DB access here.
    └── mappings.py     # DBE↔DTO mapping functions.
```

### Mounting

In `api/ee/src/main.py`, inside `extend_main(app)`:

```python
from api.ee.src.apis.fastapi.scim.router import ScimRouter

scim_router = ScimRouter(...)
app.include_router(scim_router.router, prefix="/api/scim/v2")
```

The `/api/scim/v2` prefix conforms to RFC 7644's requirement that all SCIM endpoints share a common base URI. Do not mount under `/api/v1/` or any existing versioned prefix.

### Exception handling

Define domain exceptions in `core/scim/exceptions.py`. Catch them at the router boundary and convert to SCIM error responses (RFC 7644 §3.12):

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "404",
  "detail": "User not found."
}
```

Never raise `HTTPException` from `core/scim/service.py`.

---

## 9. Out of Scope

The following are explicitly deferred:

| Item | Reason |
|------|--------|
| `POST /scim/v2/Bulk` | Complexity of transactional batch processing. `ServiceProviderConfig` must declare `bulk.supported: false`. |
| SCIM schema extensions (`urn:agenta:...`) | Not required for core provisioning flows. Standard schema covers all needed fields. |
| Bidirectional sync (Agenta → IdP) | SCIM protocol is IdP-initiated. Push from Agenta requires webhook infrastructure not currently present. |
| Group nesting | SCIM spec allows nested groups; Agenta's flat membership model has no concept for it. |
| SCIM audit log | Deferred. Provisioning events should eventually be emitted to the existing observability layer but are not a blocker. |
| OSS tier | SCIM is EE-only. No changes to `api/oss/`. |
| Password management (`PUT /scim/v2/Users/{id}/password`) | Agenta uses SSO/OIDC for authentication. Passwords are not managed in-app. `ServiceProviderConfig` must declare `changePassword.supported: false`. |
