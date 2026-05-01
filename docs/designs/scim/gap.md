# SCIM 2.0 Gap Analysis

This document maps the delta between the current codebase state and SCIM 2.0 compliance. P0 items are blocking for initial IdP integration. P1 items are required for production readiness. P2 items are explicitly deferred.

---

## 1. Missing API Endpoints

| Gap | Current State | Required State | Severity |
|-----|---------------|----------------|----------|
| No `/scim/v2/Users` (CRUD) | None | `POST/GET/PUT/PATCH/DELETE /scim/v2/Users` | P0 |
| No `/scim/v2/Groups` (CRUD) | None | `POST/GET/PUT/PATCH/DELETE /scim/v2/Groups` | P0 |
| No `/scim/v2/ServiceProviderConfig` | None | `GET` returns capabilities JSON | P0 |
| No `/scim/v2/ResourceTypes` | None | `GET` returns resource type registry | P1 |
| No `/scim/v2/Schemas` | None | `GET` returns SCIM schema definitions | P1 |
| No Bulk endpoint | None | `/scim/v2/Bulk` | P2 (deferred) |

---

## 2. Missing Authentication Mechanism

| Gap | Current State | Required State | Severity |
|-----|---------------|----------------|----------|
| No org-scoped SCIM token | API keys are per-user, per-project | `scim_tokens` table + `require_scim_auth()` FastAPI dependency | P0 |
| No SCIM token management API | None | `POST/DELETE /organizations/{id}/scim-token` | P0 |
| Token not in auth middleware | OSS `auth_middleware` handles `ApiKey` + Bearer (SuperTokens) | `require_scim_auth()` injected on SCIM routes only (does not modify OSS middleware) | P0 |

---

## 3. Missing Database Tables

| Gap | Current State | Required State | Severity |
|-----|---------------|----------------|----------|
| No `scim_tokens` table | None | `scim_tokens(id, org_id FK, hashed_token, description, created_by_id FK, created_at, expires_at)` | P0 |
| No `scim_groups` registry | None | `scim_groups(id, org_id FK, entity_type, entity_id, role, display_name, external_id)` | P0 |

---

## 4. Missing Schema Migrations on Existing Tables

| Gap | Current State | Required State | Severity |
|-----|---------------|----------------|----------|
| `users` table has no `active` flag | Hard deletes only | `users.active BOOLEAN NOT NULL DEFAULT TRUE` | P0 |
| `users` table has no `scim_external_id` | None | `users.scim_external_id VARCHAR` nullable, indexed | P1 |
| Membership tables have no soft-delete | Hard deletes only | SCIM deprovisioning sets `active=false` then cleans memberships; no column needed on membership tables (`user.active=false` is sufficient) | P0 |

---

## 5. Missing Service Logic

| Gap | Current State | Required State | Severity |
|-----|---------------|----------------|----------|
| No user creation from SCIM | Users created via auth only | `ScimService.provision_user()` — create/link user, upsert `UserIdentityDBE`, respect `active` flag | P0 |
| No group membership write | Memberships via invitation only | `ScimService.add_member()` / `remove_member()` wrapping existing membership DAOs | P0 |
| No filter parsing | None | SCIM filter parser (`userName eq`, `emails.value eq`, `externalId eq`) per RFC 7644 §3.4.2 | P0 |
| No PATCH operation processor | None | Process `Operations` array (`add`/`remove`/`replace`) for User and Group resources | P0 |
| No deprovisioning flow | Hard delete | `active=false` + membership removal scoped to org | P0 |

---

## 6. Missing SCIM Models (Request/Response Shapes)

| Gap | Current State | Required State | Severity |
|-----|---------------|----------------|----------|
| No SCIM User schema | None | Pydantic model matching RFC 7643 §4.1: `id`, `externalId`, `userName`, `name{formatted,givenName,familyName}`, `emails[]`, `active`, `meta` | P0 |
| No SCIM Group schema | None | Pydantic model: `id`, `displayName`, `members[{value, display}]`, `meta` | P0 |
| No SCIM `ListResponse` | None | `totalResults`, `startIndex`, `itemsPerPage`, `Resources[]` | P0 |
| No SCIM `PatchOp` | None | `Operations[{op, path, value}]` | P0 |
| No SCIM Error response | None | `schemas: urn:ietf:params:scim:api:messages:2.0:Error`, `status`, `detail` | P0 |

---

## 7. Behavioral Gaps

| Gap | Current State | Required State | Severity |
|-----|---------------|----------------|----------|
| No user lookup by `externalId` | None | `Users GET ?filter=externalId eq "..."` using `user_identities` table | P0 |
| No user lookup by `userName`/email | None | `Users GET ?filter=userName eq "..."` against `users.email` | P0 |
| No idempotent user creation | `POST` always fails on duplicate | `POST /Users` must return `409 Conflict` on duplicate `userName` | P0 |
| No group membership diffing | None | `PATCH Groups` replace op must diff current vs new members and reconcile | P0 |
| `users.active=false` does not remove org memberships atomically | N/A | Deprovisioning must remove memberships in the org scope that issued the SCIM request | P1 |

---

## 8. Out of Scope / Explicitly Deferred

| Item | Reason |
|------|--------|
| Bulk operations (`/scim/v2/Bulk`) | Complexity; major IdPs work fine without bulk |
| SCIM audit log | No audit table exists; defer to observability integration |
| Bidirectional sync (Agenta → IdP) | SCIM push from Agenta not requested |
| Custom schema extensions | Core schema covers Agenta's attributes |
| OSS tier | SCIM is EE-only, mount via `extend_main` |
