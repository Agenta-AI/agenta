# SCIM 2.0 Implementation Research

Codebase research for implementing SCIM 2.0 on Agenta. Covers existing data model, gaps, reuse candidates, and placement conventions.

---

## 1. Data Model — What Already Exists

### Membership Tables

All in `api/ee/src/models/db_models.py` unless noted.

**`organization_members`**
- `id` — uuid7
- `user_id` — FK → `users`
- `organization_id` — FK → `organizations`
- `role` — String, default `"member"`

**`workspace_members`**
- `id`
- `user_id` — FK → `users`
- `workspace_id` — FK → `workspaces`
- `role` — String, default `"viewer"`
- `created_at`, `updated_at`

**`project_members`**
- `id`
- `user_id` — FK → `users`
- `project_id` — FK → `projects`
- `role` — String, default `"viewer"`
- `is_demo` — nullable bool
- `created_at`, `updated_at`

### User Tables

**`users`** (`api/oss/src/models/db_models.py`)
- `id` — uuid7
- `uid` — unique string
- `username`
- `email` — unique
- `created_at`, `updated_at`

**`user_identities`** (`api/oss/src/dbs/postgres/users/dbes.py`)
- `id`
- `user_id` — FK → `users` (CASCADE)
- `method` — String
- `subject` — String
- `domain` — nullable String
- Unique constraint on `(method, subject)`
- Indexes on `(user_id, method)` and `domain`

This is a federated identity link table. It already supports the shape needed to store SCIM external IDs via `method="scim"`, `subject=<externalId>`.

### Org / Workspace / Project Entities

All in `api/oss/src/models/db_models.py`.

**`organizations`**
- `id`, `name`, `description`, `slug`, `owner_id`
- `flags`, `tags`, `meta` — JSONB

**`workspaces`**
- `id`, `name`, `description`, `type`
- `organization_id` — FK → `organizations`

**`projects`**
- `id`, `project_name`
- `workspace_id` — FK
- `organization_id` — FK
- `is_default`

### SSO Infrastructure

In `api/ee/src/dbs/postgres/organizations/dbes.py`.

**`organization_providers`**
- `id`
- `organization_id` — FK
- `secret_id` — FK
- `slug`
- `flags` — JSONB (stores OIDC/SAML config)

**`organization_domains`**
- `id`
- `organization_id` — FK
- `slug` — unique when verified
- `flags` — JSONB (`is_verified`)
- `token`, `metadata`

### Authentication

In `api/oss/src/services/auth_service.py`.

Three token types checked in order by `authentication_middleware()`:

1. `ApiKey ` — prefix (8 chars, unique) + hex SHA256 of full key. Stored in `api_keys` table with `created_by_id` FK, `project_id` FK, `rate_limit`, `expiration_date`.
2. `Bearer ` — SuperTokens JWT
3. `Secret `

API keys are per-user, scoped to a project. There is no org-scoped machine credential type.

### Roles and RBAC

In `api/ee/src/models/shared_models.py` and `api/ee/src/utils/permissions.py`.

Six workspace roles: `OWNER`, `ADMIN`, `DEVELOPER`, `EDITOR`, `ANNOTATOR`, `VIEWER`.

72 granular permissions mapped via `Permission.default_permissions(role)`. Enforcement via `check_rbac_permission()`.

### Invitations

In `api/oss/src/services/organization_service.py`.

**`project_invitations`**
- `id`, `token` (unique), `email`, `used`, `role`, `user_id`, `project_id`, `expiration_date`

Invitation-based provisioning exists but is email-driven and per-project only.

---

## 2. What SCIM Needs That Doesn't Exist

### 1. No SCIM endpoints

Green-field. No `/scim/v2/*` routes exist anywhere in the codebase.

### 2. No service account / SCIM token

No table or concept for org-scoped machine credentials for SCIM callers. The existing auth middleware supports only per-user API keys tied to a project (`project_id` FK on `api_keys`). SCIM requires an org-scoped bearer token issued to an IdP, not tied to a human user or a specific project.

### 3. No soft-delete / deactivation

All membership tables (`organization_members`, `workspace_members`, `project_members`) use hard deletes. SCIM's deprovisioning model is `PATCH /Users/{id}` with `{ "active": false }`, not row removal. There is no `deleted_at` or `active` column on any membership or user table.

### 4. No SCIM group registry

No table mapping a SCIM Group ID to an `(entity_type, entity_id, role)` tuple. Groups in SCIM map to roles inside a workspace or project; there is no intermediate table to track this mapping or expose it to the IdP.

### 5. External ID tracking is partial

`user_identities` can hold `method="scim", subject=<externalId>` to link a SCIM `externalId` to an internal `user_id`. However, the membership tables (`organization_members`, `workspace_members`, `project_members`) have no `external_id` column for IdP-side reference on membership records themselves.

### 6. Invitation system does not support direct provisioning

SCIM creates users directly via `POST /Users`. The existing invitation flow (`project_invitations`) requires email confirmation by the invited user. These two flows are incompatible without a bypass path.

---

## 3. Existing Reuse Candidates

| Candidate | How to reuse |
|---|---|
| `UserIdentityDBE` | Store SCIM external ID as `method="scim"`, `subject=<externalId>`, `domain=<org_slug>`. Lookup by `(method, subject)` to resolve internal `user_id`. |
| `organization_providers` / `organization_domains` | SCIM token config can live alongside existing SSO config, or in a new `scim_tokens` table structured similarly to `organization_providers`. |
| `check_rbac_permission()` | Reuse for authorizing SCIM service account requests at the API boundary. |
| Membership create/delete flows | Wrap existing org/workspace/project membership service methods rather than writing direct DB calls from the SCIM router. |
| EE extension pattern (`extend_main`) | SCIM router mounts via the same `api/ee/src/main.py` `extend_main()` hook used by all other EE features. |

---

## 4. API Architecture Notes

### Where new SCIM code goes

Following the standard domain folder structure from `AGENTS.md`:

```
api/ee/src/apis/fastapi/scim/
    router.py       # route registration + handlers
    models.py       # SCIM request/response schemas (RFC 7643/7644 shapes)
    utils.py        # parsing, mapping, normalization

api/ee/src/core/scim/
    dtos.py         # domain data contracts
    service.py      # business orchestration

api/ee/src/dbs/postgres/scim/
    dbes.py         # SQLAlchemy entities (e.g., scim_tokens)
    dao.py          # Postgres implementation
    mappings.py     # DTO <-> DBE mapping
```

### Mounting

SCIM is EE-only. Mount at `/api/scim/v2` via `extend_main()` in `api/ee/src/main.py`. Reference: `api/entrypoints/routers.py` for how EE extends OSS.

### Authentication hook

`authentication_middleware()` is in OSS (`api/oss/src/services/auth_service.py`). SCIM token validation (`Bearer <scim_token>`) must either:

- Add a new token type prefix recognized by the middleware, or
- Implement a FastAPI dependency used only on SCIM routes that validates the token against an org-scoped `scim_tokens` table before delegating to normal RBAC.

The second option avoids modifying OSS auth code for an EE-only feature.

### Reference domain examples

For implementation patterns, copy from:

- `api/oss/src/apis/fastapi/workflows/` — router, models, utils
- `api/oss/src/core/workflows/` — service, dtos
- `api/oss/src/dbs/postgres/workflows/` — dbes, dao, mappings
- `api/ee/src/core/organizations/exceptions.py` — domain exception hierarchy pattern
