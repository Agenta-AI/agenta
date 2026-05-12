# Platform Admin Expansion Pack

Status: draft  
Last updated: 2026-04-13

## Summary

This expansion pack focuses only on platform-level account administration.

Companion documents:

- [Platform Admin Account Contracts](contracts.md) is a draft, unreviewed contract note for request/response DTOs and business rules. It should guide implementation planning, but it is not yet approved as the final API contract.
- [Platform Admin Implementation Plan](implementation-plan.md) breaks the work down by API routers, API models, core DTOs, core service orchestration, and tests.

The current relevant account admin endpoints are:

- `POST /admin/account`
- `POST /admin/accounts`

Other admin endpoints, such as evaluations and billing, are intentionally out of scope here.

Target direction for the account bootstrap surface:

- `POST /admin/accounts/` is the canonical fully implemented graph/batch account creation endpoint.
- `POST /admin/simple/accounts/` is the simple single-account endpoint.
- The simple endpoint must be an internal wrapper over the canonical `create_accounts` implementation, not a separate persistence path.
- `create_accounts` should cover initial users, programmatic organization creation, owner assignment/reassignment, default seeding, and naming/slug validation.
- Account creation should optionally create project API keys for users across created/assigned project scopes and return those raw keys once when the request opts in.
- Request and response DTOs should be entity-first and reused across flat account graph payloads and narrower sub-endpoints.
- New noun/resource endpoints should be plural and should include trailing slashes.
- RPC-style action endpoints are the exception: the action segment is terminal and does not use a trailing slash.
- Singular account endpoints and non-trailing-slash collection endpoints are not part of the target API.
- Password validation should be explicitly configurable with `AGENTA_PASSWORD_PATTERN`; if unset, Agenta falls back to SuperTokens defaults.
- More platform admin endpoints will be added later.

Vocabulary note:

- In this document, "account" is intentionally broader than a single `UserDB` row.
- A platform admin account operation may touch the user identity plus the user's scope graph: organization, workspace, project, memberships, defaults, and credentials.
- "User" refers to the Agenta user record.
- "Identity" refers to a login identity/provider credential that lets the user sign in, for example email/password, email/OTP, OIDC, or another SuperTokens-backed provider identity.
- "Scopes" refers to organizations, workspaces, projects, and memberships.
- Short-term API naming should optimize for this operational meaning, even if internal persistence uses separate user/org/workspace/project tables.

## Current Implementation Snapshot

### Admin Authentication

All paths containing `/admin/` are routed through the admin token branch in `api/oss/src/services/auth_service.py`.

Required header:

```http
Authorization: Access <AGENTA_AUTH_KEY>
```

The middleware does not accept normal bearer tokens or API keys for admin paths. Successful validation only sets `request.state.admin = True`.

### Password Rules

Frontend implementation:

- `web/oss/src/components/pages/auth/EmailPasswordAuth/index.tsx` only marks password as required.
- `web/oss/src/components/pages/auth/EmailPasswordSignIn/index.tsx` only marks password as required.
- There is no custom regex, strength meter, or visible requirement list.

Backend implementation:

- `api/oss/src/core/auth/supertokens/config.py` configures SuperTokens email/password auth but does not define a custom password validator.
- `api/oss/src/utils/validators.py` covers email/username style validation, not password policy.

Current effective behavior:

- Agenta delegates password validation to SuperTokens defaults.
- Password requirements are not visible to users before submission.
- Failed password validation only appears after SuperTokens rejects the sign-up request.

Target behavior:

- Add `AGENTA_PASSWORD_PATTERN` as an optional backend env var.
- If `AGENTA_PASSWORD_PATTERN` is set, backend SuperTokens password validation uses it.
- If `AGENTA_PASSWORD_PATTERN` is unset, backend preserves SuperTokens default validation behavior.
- Frontend should receive enough policy metadata to show requirements before submit.
- The default/fallback policy should be documented in Agenta code/docs instead of being implicit.

Proposed env var:

```env
AGENTA_PASSWORD_PATTERN=
```

Example:

```env
AGENTA_PASSWORD_PATTERN=^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$
```

Optional companion metadata:

```env
AGENTA_PASSWORD_PATTERN_PRETTY="Use at least 8 characters with uppercase, lowercase, number, and special character."
```

`AGENTA_PASSWORD_PATTERN` is the only source of truth for validation. `AGENTA_PASSWORD_PATTERN_PRETTY` is optional display copy for the configured regex, because regexes are not reliably translatable into useful user-facing requirements. If omitted, the UI can show the documented SuperTokens-default text when `AGENTA_PASSWORD_PATTERN` is also omitted, or a generic configured-policy message when only a custom pattern is available.

### User And Identity Provisioning

Current admin account creation creates Agenta user rows directly. It does not consistently create matching SuperTokens/login identities that allow the created users to sign in through the configured auth flow.

Target behavior:

- `POST /admin/accounts/` should be able to create Agenta users and, when requested/allowed, corresponding SuperTokens identities.
- Whether identity creation is possible depends on the request body and the active auth environment configuration.
- Account creation should distinguish user records from login identities.
- Scope creation remains about organizations, workspaces, projects, and memberships.

Existing identity model:

- Identity method slugs are defined by `api/oss/src/core/auth/types.py::MethodKind`.
- The same shape is duplicated for organization policy typing in `api/oss/src/core/organizations/types.py`.
- User identities are stored in `user_identities` with `method`, `subject`, `domain`, and `user_id`.
- `method + subject` is unique.
- Session payloads carry `user_identities` and `session_identities`.

Supported method slug shapes:

| Method slug | Meaning |
| --- | --- |
| `email:otp` | Email OTP/passwordless identity. |
| `email:password` | Email/password identity. |
| `email:*` | Policy wildcard for any email-based method. |
| `social:google` | Google OAuth identity. |
| `social:github` | GitHub OAuth identity. |
| `social:*` | Policy wildcard for any social provider. |
| `sso:{organization_slug}:{provider_slug}` | Specific organization SSO provider identity. |
| `sso:{organization_slug}:*` | Policy wildcard for any SSO provider in one organization. |
| `sso:*` | Policy wildcard for any SSO provider. |

Runtime mappings already used by auth overrides:

- SuperTokens passwordless consume-code creates `method = "email:otp"` with `subject = email`.
- SuperTokens email/password sign-in/sign-up creates `method = "email:password"` with `subject = email`.
- Third-party `third_party_id = "google"` maps to `method = "social:google"`.
- Third-party `third_party_id = "github"` maps to `method = "social:github"`.
- Dynamic SSO provider IDs are already shaped as `sso:{organization_slug}:{provider_slug}` and are used directly as the identity method.

Identity provisioning scenarios:

1. **Email/password**
   - Request `method` should be `email:password`.
   - If the request includes an `email:password` identity and password value, create the SuperTokens email/password identity programmatically.
   - Validate the password through the effective password policy.
   - Create or upsert `user_identities(method="email:password", subject=email, domain=domain)`.
   - The user should be able to sign in after creation.

2. **Email/OTP**
   - Request `method` should be `email:otp`.
   - If the active auth method is OTP, the account graph can create the Agenta user and scopes.
   - The login identity should generally be completed through email confirmation/OTP flow.
   - A pending identity may use `method="email:otp"` and `subject=email`, but verified session identity only happens after OTP completion.
   - Admin creation may mark the identity as expected/pending, but should not silently bypass email verification unless an explicit override is requested and allowed.

3. **Social providers**
   - Request `method` should use existing social slugs, for example `social:google` or `social:github`.
   - `subject` should be the provider user ID, matching SuperTokens `third_party_user_id`.
   - `domain` should be derived from the verified email domain where available.
   - Programmatic linking should only happen when the provider identity is trusted.

4. **SSO providers**
   - Request `method` should use `sso:{organization_slug}:{provider_slug}`.
   - `subject` should be the provider user ID or stable subject claim.
   - `domain` should be the verified email domain where available.
   - Provider identity verification/linking should be explicit in the request body or derived from trusted provider claims.
   - Programmatic verification may be allowed for trusted/admin-provided identities, but it must be explicit and auditable.

Suggested account-create input shape:

```json
{
  "users": {
    "alice": {
      "email": "alice@example.com",
      "name": "Alice",
      "identities": [
        {
          "method": "email:password",
          "subject": "alice@example.com",
          "domain": "example.com",
          "email": "alice@example.com",
          "password": "provided-by-admin",
          "verified": true
        }
      ]
    }
  },
  "organizations": {},
  "workspaces": {},
  "projects": {}
}
```

Rules:

- Identity creation is optional per user.
- If no identity is provided, create only the Agenta user and scope graph.
- If an identity is provided but disabled by env/auth configuration, return a structured validation error before writing.
- Identity `method` must pass `MethodKind.is_valid_pattern`.
- `subject` is required for all stored identities.
- Do not return passwords in responses.
- Do not log passwords.
- Responses should report identity provisioning state, for example `created`, `linked`, `pending_confirmation`, or `skipped`.

### `POST /admin/account`

Implementation: `api/oss/src/routers/admin_router.py`  
Operation ID: `create_account`

This is the single-account convenience bootstrap endpoint used by API, SDK, and services tests.

It creates:

- one user
- one organization
- one default workspace
- one default project
- one API key returned as `ApiKey ...`
- in EE, one subscription for the created organization

Request body is optional. Missing fields are populated with random test defaults:

- `user.name`
- `user.email`
- `scope.name`
- EE `subscription.plan`

The effective flow is:

1. Generate an 8-character random prefix.
2. Fill missing user/scope/subscription defaults.
3. Reject an existing email with `409`.
4. Create a user via `create_new_user`.
5. Create a legacy organization/workspace/project graph through `legacy_create_organization`.
6. In EE, create a subscription.
7. Create an API key for the created/default project.
8. Return `{ user, scopes }`.

Important behavior:

- `scope.name` is currently populated but not used for naming the created organization, workspace, or project.
- The organization name is hard-coded to `"Organization"`.
- The user is created directly in the application DB with a generated `uid`; it is not created by SuperTokens in this route.
- Unexpected exceptions are returned as `404 "Could not create account."`, which hides server-side failures.
- This endpoint is simple and practical for tests, but it is not a general admin account-management API.

### `POST /admin/accounts`

Implementation: `api/oss/src/routers/admin_router.py`  
Operation ID: `create_accounts`

This is the structured batch bootstrap endpoint. It accepts dictionaries keyed by local slugs:

- `users`
- `organizations`
- `workspaces`
- `projects`
- EE only: `organization_memberships`
- EE only: `workspace_memberships`
- EE only: `project_memberships`

The effective flow is:

1. Create or reuse users by email.
2. Create organizations.
3. Resolve workspace `organization_ref.slug` into an organization ID.
4. Create workspaces.
5. Resolve project `organization_ref.slug` and `workspace_ref.slug`.
6. Create projects.
7. In EE, create organization/workspace/project memberships.
8. In EE, create credentials for each project membership.
9. Return project scopes keyed by user slug and project slug.

Important behavior:

- The endpoint commits each entity step independently through service helpers.
- It is not transactional; a mid-flight failure can leave partial data.
- User creation is idempotent by email, but organization/workspace/project creation is not idempotent.
- Missing slug references become internal exceptions and collapse into `500 "Could not create accounts."`.
- In EE, credentials are only returned for project memberships.
- In OSS, this route appears stale. The router calls `create_organization(request=request)`, while the OSS admin manager implementation requires a `created_by_id` argument. Even after fixing that, scope construction is currently inside the EE-only branch.

## Endpoint Comparison

| Endpoint | Purpose | Shape | Returns credentials | OSS status | EE status |
| --- | --- | --- | --- | --- | --- |
| `POST /admin/account` | Legacy single-account bootstrap | Convenience object, optional body | Yes | Functional | Functional, plus subscription |
| `POST /admin/accounts` | Legacy graph bootstrap | Batch dictionaries keyed by slugs | EE project memberships only | Likely broken/stale | Functional but fragile |
| `POST /admin/accounts/` | Target canonical graph creation endpoint | Batch dictionaries keyed by slugs | Flag-controlled, for requested project scopes | To implement fully | To harden |
| `POST /admin/simple/accounts/` | Target simple single-account wrapper | Convenience object, optional body | Flag-controlled through canonical create | To wrap canonical graph creation | To wrap canonical graph creation |

Endpoint naming rule for new work:

- Use plural nouns.
- Use trailing slashes for noun/resource routes and collections, for example `POST /admin/accounts/`, `DELETE /admin/accounts/`, and `POST /admin/simple/accounts/users/`.
- Use no trailing slash only when the final path segment is one of the explicitly allowed RPC actions: `reset-password` or `transfer-ownership`.
- Do not add new singular endpoints.
- Do not add new non-trailing-slash collection endpoints.
- Existing singular or non-trailing collection endpoints are legacy only and should not be exposed as target OpenAPI/SDK routes.

## Problems To Fix Before Expanding

### 1. Mixed Purpose

The current admin account endpoints are test fixtures exposed as API endpoints. They combine account creation, scope creation, credential generation, default resource creation, and, in EE simple-account bootstrap, subscription setup.

Expansion should separate:

- bootstrap helpers
- account CRUD
- scope graph CRUD
- credential actions
- deferred maintenance actions

### 2. Incomplete OSS Path For `create_accounts`

The OSS branch should either:

- be fixed to create users, organizations, workspaces, projects, owner scopes, and credentials, or
- explicitly reject `POST /admin/accounts/` with a clear `501`/`400` until supported.

Returning a broad `500` from a stale implementation is not acceptable for an admin surface.

### 3. Batch Creation Failure Semantics

`create_accounts` does not need to be stricter than the normal creation flows around transactionality. The important part is that platform admins can understand what will be written and what was written if a batch fails.

Recommended behavior:

- validate all slugs and references before writing
- create the graph in dependency order
- avoid obvious half-batches caused by preventable validation errors
- return structured error details
- report created/reused/skipped entities clearly if a mid-flight failure leaves partial data

### 4. Error Model

Current errors are broad strings:

- `"Could not create account."`
- `"Could not create accounts."`
- `"Already exists."`

The platform admin API should return structured errors:

```json
{
  "error": {
    "code": "account_already_exists",
    "message": "Account already exists.",
    "details": {
      "email": "alice@example.com"
    }
  }
}
```

### 5. Invisible Password Policy

Password constraints are enforced implicitly by SuperTokens defaults. Agenta does not expose those rules in the UI and does not define them in backend configuration.

Recommended behavior:

- Backend owns the effective password policy.
- `AGENTA_PASSWORD_PATTERN` overrides the default policy.
- Unset `AGENTA_PASSWORD_PATTERN` preserves SuperTokens defaults.
- Frontend displays the effective policy before submit.
- Backend returns a structured password validation error code when policy validation fails.

## Expansion Goals

1. Make platform admin operations explicit and discoverable.
2. Preserve existing test bootstrap compatibility.
3. Support account graph create/delete flows first; read/search can be defined later.
4. Defer maintenance actions until the account create/delete contract is reviewed.
5. Use structured request/response models and structured errors.
6. Align OSS and EE behavior where practical, while keeping EE-only capabilities explicit.
7. Make password policy explicit and visible without breaking SuperTokens default behavior.

## Non-Goals

- Replacing normal user-facing organization/workspace/project APIs.
- Allowing normal API keys to administer the platform.
- Preserving the existing singular `/admin/account` route as part of the target admin API.
- Moving normal organization-owner operations into platform admin. Inviting users, revoking organization access, changing organization roles, and similar tenant-local actions stay in organization/workspace/project APIs unless there is a clear platform-level override case.

## Platform Admin Scope Triage

### Short-Term Account Surface

The near-term surface should be account-centric and cover create, delete, API-key creation/deletion, reset password, and ownership transfer. Read/search and generic edit are intentionally deferred until the create/delete contracts are reviewed.

| Operation | Endpoint | Notes |
| --- | --- | --- |
| Create graph accounts | `POST /admin/accounts/` | Canonical create operation for users, optional login identities, and org/workspace/project scopes. |
| Delete graph accounts | `DELETE /admin/accounts/` | Body-based delete because there is no `account_id`; target is selected by actual entity identifiers. |
| Create simple account | `POST /admin/simple/accounts/` | Simple wrapper over `POST /admin/accounts/`. |
| Delete simple account | `DELETE /admin/simple/accounts/` | Body-based delete because the simple account graph also has no `account_id`. |
| Create/delete simple entity | `POST`/`DELETE /admin/simple/accounts/{entity}/...` | Precision layer for users, user identities, organizations, workspaces, projects, memberships, and API keys. |
| Transfer organization ownership | `POST /admin/simple/accounts/organizations/{organization_id}/transfer-ownership` | Swap source/target owner roles across the relevant organization/workspace/project stack. |
| Reset password | `POST /admin/simple/accounts/users/{user_id}/reset-password` | Only applies to email/password user identities. |

There is no `account_id`. An account is an operational graph/projection, not a persisted entity. Account-level delete uses a body selector; entity-level deletes use real entity IDs in the path.

### Missing Short-Term Details

These were not explicit in the loose list but matter for the first implementation:

1. **Validation and dry-run**
   - Create, transfer, and delete should support validation before mutation.
   - For now this should be a `dry_run` flag on body-based account create/delete requests.

2. **Audit reason**
   - Transfer ownership, reset password, and delete should require or accept `reason`.
   - Platform admin actions should be auditable.

3. **Idempotency**
   - Create and delete should support an idempotency key or deterministic slug/email behavior.
   - This matters for tests and programmatic provisioning.

4. **Credential behavior**
   - Account creation can create API keys for users across every created/assigned project scope.
   - API key creation should be flag-controlled in the request, for example `options.create_api_keys: true`.
   - For each created or assigned project scope, create an API key for the user tied to that project scope.
   - Create can return raw API keys once, in the same response that created them.
   - Raw API key material should be returned only when API key creation is enabled and response-return is enabled. If separate flags are used, `options.return_api_keys` should be valid only when `options.create_api_keys` is true.
   - Non-create responses should only return credential metadata, never raw API key material.
   - Regenerating credentials should be a separate explicit action if needed.
   - Login identity secrets, such as passwords, should never be returned.

   Suggested account-create option shape:

   ```json
   {
     "options": {
       "create_api_keys": true,
       "return_api_keys": true
     }
   }
   ```

   Suggested response placement should follow the flat contract maps:

   ```json
   {
     "api_keys": {
       "alice_default_project_key": {
         "project_id": "...",
         "user_id": "...",
         "prefix": "ag_...",
         "value": "ApiKey ...",
         "returned_once": true
       }
     }
   }
   }
   ```

5. **Default seeding behavior**
   - Create/simple create should define whether default project resources, environments, evaluators, and testsets are seeded.
   - The simple wrapper should not have a separate seeding path.

6. **Naming and slug validation**
   - Create should validate names/slugs before writing anything.
   - Slug conflicts should be structured errors, not generic `500`s.

7. **Identity provisioning**
   - Create should specify whether to create only Agenta users or also create/link SuperTokens identities.
   - Behavior must be driven by request body plus active auth env configuration.
   - Email/password can be created programmatically if a password is supplied and passes policy.
   - Email/OTP likely stays pending/confirmation-driven unless an explicit verified override is supported.
   - External provider identities require explicit trusted linking semantics.

### First Slice

These are platform-level enough to include in the initial expansion.

1. **Initialize the first admin/root/owner**
   - Use the existing environment-driven bootstrap/root-account mechanism if present.
   - Document the env contract and make behavior explicit.
   - Keep this separate from normal tenant owner flows.

2. **Create initial users and organizations programmatically**
   - This belongs in `POST /admin/accounts/`.
   - It should create users, optional login identities, organizations, workspaces, projects, memberships, credentials, and default seeded resources in one coherent graph operation.
   - It should enforce naming and slug rules up front.

3. **Control organization creation globally**
   - Global disable/enable belongs in env configuration.
   - "Admins only can create organizations" also belongs in env/platform policy.
   - Tenant join behavior belongs in organization flags/policies.

4. **Assign, transfer, or reassign ownership**
   - Initial owner assignment belongs in `create_accounts`.
   - Owner transfer/reassignment should be an explicit admin operation and should also be representable in account graph bootstrap.
   - This matters for recovery cases where an owner is unavailable.

5. **Hard-delete organizations**
   - Hard delete is the near-term organization destructive operation.
   - It must be explicit, confirmed, scoped, and ideally support dry-run.
   - Merge/archive/suspend should not be first-slice work.

6. **Reset password**
   - This is platform-admin appropriate because it targets the user identity, not only the user's membership in one organization.
   - It should be scoped to one user and return/generate a reset flow through the existing auth provider.

7. **Global listing and tenant search**
   - Defer read/search endpoint design until the create/delete contract is reviewed.
   - Do not introduce `/query` endpoints in the first contract.

8. **Password policy**
   - Add `AGENTA_PASSWORD_PATTERN`.
   - Preserve SuperTokens defaults when unset.
   - Surface visible policy feedback to users.

### Already Covered Elsewhere

These should not become first-slice platform admin endpoints unless a platform override is explicitly needed.

- User invitation, revocation, organization role assignment, suspension, and reactivation inside a tenant.
- Organization-level verified/unverified domain management.
- Restricting signup and join behavior through organization flags/policies.
- Organization policies for who can create projects, invite users, manage sharing, or access resources.
- API keys and permissions exports, except for platform-level listing/revocation needs.
- Retention policies and destructive entity actions where those already exist per entity.
- Quotas, limits, feature flags, plan gates, and edition gates where already covered by entitlements/subscriptions.
- Audit/event logs inside organizations.
- Workflow/config/testset soft-delete and retention where covered by Git-backed entity behavior.
- Data residency where handled by cloud deployment region.

### Later

These require new primitives or are broad enough to defer.

- Organization merge.
- Organization archive/suspend/reactivate. This likely needs organization-level `is_active` or similar state first.
- User/account suspend/reactivate across the platform. This likely needs a first-class user active/suspended state.
- Session reset or force logout.
- Impersonation.
- Break-glass admin access beyond the existing root-account checks.
- IP allowlists and broader network restrictions.
- Webhook-specific approved domains or network policies.
- Secret-management policy and platform secret rotation.
- Platform data export and restore from backup.
- License status, seat usage, billing, subscriptions, and usage reporting.
- Permission introspection for custom roles, beyond standard-role permission checks.

## Proposed Expansion Pack

### Pack A: Account Bootstrap

Make `POST /admin/accounts/` the real implementation and route all simplified account creation through it.

The request and response models for this pack are defined in [Platform Admin Account Contracts](contracts.md). The main contract rule is that the flat `accounts` graph and the simple sub-endpoints use the same entity DTOs. For example, `user_identities` inside account creation uses the same user identity DTO that the identity-focused endpoint uses.
The contract is still draft. The current direction is flat entity maps: `users`, `user_identities`, `organizations`, `workspaces`, `projects`, memberships, and `api_keys`.

| Method | Path | Action |
| --- | --- | --- |
| `POST` | `/admin/accounts/` | Canonical graph/batch account creation. Fully implemented in OSS and EE. |
| `DELETE` | `/admin/accounts/` | Canonical graph/batch account deletion with a selector body. |
| `POST` | `/admin/simple/accounts/` | Simple single-account creation. Internally builds a graph request and calls `create_accounts`. |
| `DELETE` | `/admin/simple/accounts/` | Simple account deletion with a selector body. |

Optional simple precision paths:

| Method | Path | Action |
| --- | --- | --- |
| `POST` | `/admin/simple/accounts/users/` | Simple user-focused account operation. |
| `DELETE` | `/admin/simple/accounts/users/{user_id}/` | Delete one user-focused account entity by ID. |
| `POST` | `/admin/simple/accounts/users/identities/` | Simple user identity operation using the flat `user_identities` DTO. |
| `DELETE` | `/admin/simple/accounts/users/{user_id}/identities/{identity_id}/` | Delete one user identity by ID. |
| `POST` | `/admin/simple/accounts/organizations/` | Simple organization-focused account operation. |
| `DELETE` | `/admin/simple/accounts/organizations/{organization_id}/` | Delete one organization by ID. |
| `POST` | `/admin/simple/accounts/organizations/memberships/` | Simple organization membership operation. |
| `DELETE` | `/admin/simple/accounts/organizations/{organization_id}/memberships/{membership_id}/` | Delete one organization membership by ID. |
| `POST` | `/admin/simple/accounts/workspaces/` | Simple workspace-focused account operation. |
| `DELETE` | `/admin/simple/accounts/workspaces/{workspace_id}/` | Delete one workspace by ID. |
| `POST` | `/admin/simple/accounts/workspaces/memberships/` | Simple workspace membership operation. |
| `DELETE` | `/admin/simple/accounts/workspaces/{workspace_id}/memberships/{membership_id}/` | Delete one workspace membership by ID. |
| `POST` | `/admin/simple/accounts/projects/` | Simple project-focused account operation. |
| `DELETE` | `/admin/simple/accounts/projects/{project_id}/` | Delete one project by ID. |
| `POST` | `/admin/simple/accounts/projects/memberships/` | Simple project membership operation. |
| `DELETE` | `/admin/simple/accounts/projects/{project_id}/memberships/{membership_id}/` | Delete one project membership by ID. |
| `POST` | `/admin/simple/accounts/api-keys/` | Simple project/user API key operation. |
| `DELETE` | `/admin/simple/accounts/api-keys/{api_key_id}/` | Delete one API key by ID. |

These paths should still be wrappers over the canonical graph operation. They are useful when a caller wants simple request bodies but clearer vocabulary about which scope is being targeted. Avoid making these separate persistence flows.

Use `memberships`, not `members`, for the simple paths because the platform admin object is the membership edge: user, scope, role, and lifecycle metadata. `members` would be a user-centric projection, while these endpoints create or inspect the actual membership entity.

Implementation rules:

- `create_accounts` owns all persistence, validation, identity provisioning, membership setup, default resource setup, and credential creation.
- `create_account` must not duplicate user/org/workspace/project creation logic.
- `create_account` should normalize its optional simple request into a one-user graph request, call `create_accounts`, and project the graph response back into the simple response shape.
- `create_accounts` should support owner assignment and owner reassignment/transfer semantics as part of the graph contract.
- `create_accounts` should enforce naming and slug rules before writing any entities.
- `create_accounts` should validate requested identities against active auth configuration before writing any entities.
- `create_accounts` should support `options.create_api_keys`.
- `create_accounts` should support `options.return_api_keys` if raw key return needs to be gated separately from creation.
- These flags should default to false for the target admin API unless a test fixture explicitly opts in.
- When API key creation is enabled, OSS and EE must create API keys for each requested user/project scope.
- When API key return is enabled, OSS and EE must return the raw keys once in the create response.
- When API key creation is disabled, the response should omit raw credentials and may include credential metadata only.
- Existing tests should migrate to `/admin/simple/accounts/` for simple bootstrap and `/admin/accounts/` for graph bootstrap.

### Pack B: Account Deletion

Add account graph deletion after creation behavior is stable.

| Method | Path | Action |
| --- | --- | --- |
| `DELETE` | `/admin/accounts/` | Delete one or more account graphs by selector body. |
| `DELETE` | `/admin/simple/accounts/` | Delete one simple account graph by selector body. |

Deletion rules:

- `DELETE /admin/accounts/` and `DELETE /admin/simple/accounts/` are the only delete routes in this surface that should receive request bodies.
- All other delete routes should identify the target by path ID.
- Deletion responses should use the same account-level response shape as account creation at the account graph level.
- Broad deletes should support `dry_run`, `reason`, and confirmation.

### Pack C: Account Actions

Add only the two RPC-style account actions currently in scope.

| Method | Path | Action |
| --- | --- | --- |
| `POST` | `/admin/simple/accounts/users/{user_id}/reset-password` | Force a password reset flow for one user identity. |
| `POST` | `/admin/simple/accounts/organizations/{organization_id}/transfer-ownership` | Transfer/reassign organization ownership. |

Notes:

- Reset password only applies to email/password identities.
- Transfer ownership swaps source/target roles after validating memberships across the relevant organization/workspace/project stack.
- Tenant-local invitation/revocation/role changes stay in organization/workspace/project APIs.

### Pack D: Deferred Reads And Updates

Do not add read/search endpoints, `/query` endpoints, or PATCH endpoints in the first contract. Define them separately after create/delete semantics are reviewed.

### Pack E: Ownership And Recovery

Keep platform admin focused on ownership recovery instead of duplicating tenant membership management.

| Method | Path | Action |
| --- | --- | --- |
| `POST` | `/admin/simple/accounts/organizations/{organization_id}/transfer-ownership` | Transfer ownership to an existing member or reassign owner in recovery cases. |

Normal membership management remains tenant-local. Platform admin owner transfer and reassignment both use `transfer-ownership`; recovery cases are represented in the request body and must be audited with a reason.

### Pack F: Credentials

Keep API key DTOs explicit, while avoiding new project-local API key admin routes. API key creation belongs in the account graph and the simple account projection.

| Method | Path | Action |
| --- | --- | --- |
| `POST` | `/admin/accounts/` | Create API keys while creating or assigning project scopes when `options.create_api_keys` is true. |
| `POST` | `/admin/simple/accounts/api-keys/` | Simple project/user API key creation wrapper over the canonical account graph. |

Do not introduce new project-local admin API key routes unless they already exist in the product surface and are intentionally adopted. Raw API key material should only be returned on creation from `POST /admin/accounts/` or `POST /admin/simple/accounts/api-keys/` when key return is enabled.

### Pack G: Safe Maintenance

Do not define maintenance routes in the first account contract.

### Pack H: Password Policy

Make password validation configurable and visible while preserving existing behavior by default.

Backend requirements:

- Add `AGENTA_PASSWORD_PATTERN` to env configuration.
- Add optional `AGENTA_PASSWORD_PATTERN_PRETTY` for user-facing requirement copy.
- Compile and validate the regex at startup if present.
- Wire the pattern into SuperTokens email/password password validation.
- If the pattern is unset, do not install a custom password validator; allow SuperTokens defaults to apply.
- Expose password policy metadata through an existing auth discovery/config endpoint or a new auth policy endpoint.

Frontend requirements:

- Read password policy metadata from backend-provided runtime config.
- Show requirements in sign-up flows before submit.
- Validate locally when a pattern is available and safe to expose.
- Always keep backend validation authoritative.

Suggested response shape:

```json
{
  "password": {
    "source": "custom",
    "pattern": "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
    "rules_text": "Use at least 8 characters with uppercase, lowercase, number, and special character."
  }
}
```

When `AGENTA_PASSWORD_PATTERN` is unset:

```json
{
  "password": {
    "source": "supertokens_default",
    "pattern": null,
    "rules_text": "Use at least 8 characters with uppercase, lowercase, number, and special character."
  }
}
```

The backend should not depend on frontend validation. Frontend validation is for feedback only.

## Recommended Implementation Order

The detailed task breakdown belongs in [Platform Admin Implementation Plan](implementation-plan.md). At this level, the order is:

1. Finalize the draft contracts enough to freeze route names and DTO names for the first implementation slice.
2. Add API request/response models matching those DTO names.
3. Add core DTOs and a platform account service that orchestrates existing services/managers.
4. Implement `POST /admin/accounts/` and `DELETE /admin/accounts/`.
5. Implement `POST /admin/simple/accounts/` and `DELETE /admin/simple/accounts/` as wrappers over the account service.
6. Implement the simple entity POST/DELETE endpoints as graph projections.
7. Implement the two RPC actions: `reset-password` and `transfer-ownership`.
8. Migrate API/SDK/service tests away from legacy singular/non-trailing paths.

## Compatibility Strategy

Existing tests should keep passing while new endpoints are introduced.

Migration path:

1. Add the new plural/trailing collection endpoints and slashless RPC action endpoints.
2. Update simple bootstrap tests to use `/admin/simple/accounts/`.
3. Update graph bootstrap tests to use `/admin/accounts/`.
4. Update generated SDK names to distinguish simple bootstrap from graph bootstrap.
5. Treat old `/admin/account` and non-trailing `/admin/accounts` as legacy migration paths only, not target OpenAPI/SDK routes.
6. Remove or hide legacy paths after clients are migrated.

## Open Questions

1. Should bootstrap endpoints be included in public OpenAPI output?
2. Should account creation also create SuperTokens users, or is DB-only creation acceptable for admin/test bootstrap?
3. Should custom password patterns be exposed to the frontend directly, or should the frontend only receive normalized requirement flags and copy?
4. Should `AGENTA_PASSWORD_PATTERN` apply to password reset/change flows as well as sign-up?
5. What is the exact env var name for first-admin/root-account bootstrap?
6. What is the exact policy model for admins-only organization creation?
7. Does owner reassignment require the new owner to already be an organization member, or can the operation also add membership?
8. For email/OTP identities, should admin creation ever mark identities verified, or should it always require email confirmation?
9. For external provider identities, what request fields are trusted enough to link a provider identity programmatically?
10. Should identity provisioning be atomic with scope graph creation, or can identity failures produce a partial account with `identity.status = pending`?
