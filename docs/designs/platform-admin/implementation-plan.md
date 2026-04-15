# Platform Admin Implementation Plan

Status: draft  
Last updated: 2026-04-13

## Purpose

This is a task breakdown for implementing the platform admin account surface. It is not a calendar plan.

Inputs:

- [Platform Admin Expansion Pack](expansion-pack.md)
- [Platform Admin Account Contracts](contracts.md)

Both design documents are still draft. Treat their DTOs and route shapes as working contracts until reviewed.

## Architecture Boundary

The first implementation should have four layers:

1. **API routers**
   - Own FastAPI routes, status codes, dependency injection, and request context.
   - Do not contain graph orchestration logic.

2. **API request/response models**
   - Own HTTP-facing Pydantic models.
   - Names should match the route contract, for example `AdminAccountsCreate`, `AdminSimpleAccountsCreate`, and `AdminSimpleAccountsUsersIdentitiesCreate`.

3. **Core DTOs**
   - Own internal typed objects passed into the service layer.
   - Mirror the HTTP models closely, but keep them independent enough to avoid route-specific coupling in business logic.

4. **Core service**
   - Own validation, reference resolution, orchestration, response assembly, and error mapping.
   - Use existing services, managers, and helpers for persistence and side effects.
   - Do not introduce a platform-admin DAO in the first slice.

Persistence rule:

- Do not add a new DAO for platform admin accounts.
- Use existing user, organization, workspace, project, membership, auth, and API key services/managers.
- Add small adapter functions only when needed to normalize existing service behavior.

## Proposed Files

API layer:

- `api/oss/src/apis/fastapi/platform_admin/accounts/router.py`
- `api/oss/src/apis/fastapi/platform_admin/accounts/models.py`
- `api/oss/src/apis/fastapi/platform_admin/accounts/__init__.py`

Core layer:

- `api/oss/src/core/platform_admin/accounts/dtos.py`
- `api/oss/src/core/platform_admin/accounts/service.py`
- `api/oss/src/core/platform_admin/accounts/errors.py`
- `api/oss/src/core/platform_admin/accounts/__init__.py`

Router wiring:

- Mount the new router under `/admin` from `api/entrypoints/routers.py`.
- Keep legacy `api/oss/src/routers/admin_router.py` only as a compatibility bridge during migration.

This file layout can be adjusted to match local conventions during implementation, but the layer separation should remain.

## Task 1: Freeze The First Route Surface

Confirm the first route set from the draft contract:

| Method | Path |
| --- | --- |
| `POST` | `/admin/accounts/` |
| `DELETE` | `/admin/accounts/` |
| `POST` | `/admin/simple/accounts/` |
| `DELETE` | `/admin/simple/accounts/` |
| `POST` | `/admin/simple/accounts/users/` |
| `DELETE` | `/admin/simple/accounts/users/{user_id}/` |
| `POST` | `/admin/simple/accounts/users/identities/` |
| `DELETE` | `/admin/simple/accounts/users/{user_id}/identities/{identity_id}/` |
| `POST` | `/admin/simple/accounts/organizations/` |
| `DELETE` | `/admin/simple/accounts/organizations/{organization_id}/` |
| `POST` | `/admin/simple/accounts/organizations/memberships/` |
| `DELETE` | `/admin/simple/accounts/organizations/{organization_id}/memberships/{membership_id}/` |
| `POST` | `/admin/simple/accounts/workspaces/` |
| `DELETE` | `/admin/simple/accounts/workspaces/{workspace_id}/` |
| `POST` | `/admin/simple/accounts/workspaces/memberships/` |
| `DELETE` | `/admin/simple/accounts/workspaces/{workspace_id}/memberships/{membership_id}/` |
| `POST` | `/admin/simple/accounts/projects/` |
| `DELETE` | `/admin/simple/accounts/projects/{project_id}/` |
| `POST` | `/admin/simple/accounts/projects/memberships/` |
| `DELETE` | `/admin/simple/accounts/projects/{project_id}/memberships/{membership_id}/` |
| `POST` | `/admin/simple/accounts/api-keys/` |
| `DELETE` | `/admin/simple/accounts/api-keys/{api_key_id}/` |
| `POST` | `/admin/simple/accounts/users/{user_id}/reset-password` |
| `POST` | `/admin/simple/accounts/organizations/{organization_id}/transfer-ownership` |

Do not add `/query` endpoints, PATCH endpoints, singular endpoints, or non-trailing collection endpoints in this first slice.

## Task 2: Define API Models

Create HTTP-facing Pydantic models for every route request and response in the first route surface.

Account graph models:

- `AdminAccountsCreate`
- `AdminAccountsDelete`
- `AdminAccountsResponse`
- `AdminAccountsCreateResponse = AdminAccountsResponse`
- `AdminAccountsDeleteResponse = AdminAccountsResponse`

Simple account models:

- `AdminSimpleAccountsCreate`
- `AdminSimpleAccountsDelete`
- `AdminSimpleAccountsResponse`
- `AdminSimpleAccountsCreateResponse = AdminSimpleAccountsResponse`
- `AdminSimpleAccountsDeleteResponse = AdminSimpleAccountsResponse`

Simple entity create models:

- `AdminSimpleAccountsUsersCreate`
- `AdminSimpleAccountsUsersIdentitiesCreate`
- `AdminSimpleAccountsOrganizationsCreate`
- `AdminSimpleAccountsOrganizationsMembershipsCreate`
- `AdminSimpleAccountsWorkspacesCreate`
- `AdminSimpleAccountsWorkspacesMembershipsCreate`
- `AdminSimpleAccountsProjectsCreate`
- `AdminSimpleAccountsProjectsMembershipsCreate`
- `AdminSimpleAccountsApiKeysCreate`

Action models:

- `AdminSimpleAccountsUsersResetPassword`
- `AdminSimpleAccountsUsersResetPasswordResponse`
- `AdminSimpleAccountsOrganizationsTransferOwnership`
- `AdminSimpleAccountsOrganizationsTransferOwnershipResponse`

Shared entity models:

- users
- user identities
- organizations
- workspaces
- projects
- organization memberships
- workspace memberships
- project memberships
- API keys
- structured errors

Model rules:

- Keep account graph maps flat.
- Use `user_identities`, not nested `users[].identities`.
- Use flat membership maps, not nested memberships under organizations, workspaces, or projects.
- Keep API keys as a flat entity map.
- Return raw API key values only in create responses when explicitly enabled.

## Task 3: Define Core DTOs

Create core DTOs that correspond to the API models.

The core DTOs should:

- Preserve flat entity maps.
- Preserve request-local refs.
- Preserve existing IDs/slugs for reuse.
- Carry options such as `dry_run`, `create_identities`, `create_api_keys`, `return_api_keys`, `seed_defaults`, and `reason`.
- Represent validation errors independently from FastAPI/HTTP.

Do not put persistence logic in DTOs.

## Task 4: Build The Core Service Skeleton

Create a platform admin account service with methods shaped around the route surface:

```python
create_accounts(dto) -> AdminAccountsResponseDTO
delete_accounts(dto) -> AdminAccountsResponseDTO
create_simple_accounts(dto) -> AdminSimpleAccountsResponseDTO
delete_simple_accounts(dto) -> AdminSimpleAccountsResponseDTO
create_user(dto) -> AdminAccountsResponseDTO
delete_user(user_id) -> AdminDeleteResponseDTO
create_user_identity(dto) -> AdminAccountsResponseDTO
delete_user_identity(user_id, identity_id) -> AdminDeleteResponseDTO
create_organization(dto) -> AdminAccountsResponseDTO
delete_organization(organization_id) -> AdminDeleteResponseDTO
create_organization_membership(dto) -> AdminAccountsResponseDTO
delete_organization_membership(organization_id, membership_id) -> AdminDeleteResponseDTO
create_workspace(dto) -> AdminAccountsResponseDTO
delete_workspace(workspace_id) -> AdminDeleteResponseDTO
create_workspace_membership(dto) -> AdminAccountsResponseDTO
delete_workspace_membership(workspace_id, membership_id) -> AdminDeleteResponseDTO
create_project(dto) -> AdminAccountsResponseDTO
delete_project(project_id) -> AdminDeleteResponseDTO
create_project_membership(dto) -> AdminAccountsResponseDTO
delete_project_membership(project_id, membership_id) -> AdminDeleteResponseDTO
create_api_key(dto) -> AdminAccountsResponseDTO
delete_api_key(api_key_id) -> AdminDeleteResponseDTO
reset_password(user_id, dto) -> AdminSimpleAccountsUsersResetPasswordResponseDTO
transfer_ownership(organization_id, dto) -> AdminSimpleAccountsOrganizationsTransferOwnershipResponseDTO
```

The method list can be reduced if wrappers normalize into fewer internal functions, but the route behavior should remain explicit and testable.

## Task 5: Reference Resolution And Validation

Implement a reference resolver inside the service.

It should resolve:

- request-local refs
- existing persisted IDs
- stable slugs where supported

Validation rules:

- Workspace creation requires a valid organization.
- Project creation requires a valid workspace, and its organization must match or be derived from that workspace.
- Organization membership creation requires a valid user and organization.
- Workspace membership creation requires a valid user and workspace.
- Project membership creation requires a valid user and project.
- API key creation requires a valid user and project.
- User identity creation requires a valid user.

The resolver should produce structured validation errors before dependent writes start.

## Task 6: Implement Account Graph Creation

Implement `POST /admin/accounts/` through the core service.

Flow:

1. Validate options.
2. Resolve reusable existing entities.
3. Validate all references.
4. Create or reuse users.
5. Create or link user identities when enabled and allowed.
6. Create or reuse organizations.
7. Create or reuse workspaces.
8. Create or reuse projects.
9. Create memberships.
10. Create API keys when enabled.
11. Assemble `AdminAccountsResponse`.

Use existing services/managers for each write. Do not add a DAO.

## Task 7: Implement Simple Account Creation

Implement `POST /admin/simple/accounts/` as a wrapper over account graph creation.

Default behavior:

- Create the user.
- Create or reuse an organization.
- Create or reuse a workspace in that organization.
- Create or reuse a project in that workspace.
- Create organization, workspace, and project memberships for the user.
- Create one API key for the project when API key creation is enabled.
- Return `AdminSimpleAccountsResponse`, using the same shape as account graph responses.

The simple endpoint should normalize into `AdminAccountsCreate` and call the same core service method.

## Task 8: Implement Simple Entity Creation

Each simple entity POST endpoint should normalize into the account graph DTO and call the core service.

Examples:

- `POST /admin/simple/accounts/users/` creates a graph with one user and default dependent entities where configured.
- `POST /admin/simple/accounts/users/identities/` validates the user, then creates or links one `user_identity`.
- `POST /admin/simple/accounts/projects/` validates organization/workspace dependencies, then creates one project.
- `POST /admin/simple/accounts/api-keys/` validates user/project, then creates one API key.

Do not create separate persistence paths for simple endpoints.

## Task 9: Implement Deletion

Implement account-level deletion first:

- `DELETE /admin/accounts/`
- `DELETE /admin/simple/accounts/`

Then implement ID-based deletion for simple entities:

- user
- user identity
- organization
- organization membership
- workspace
- workspace membership
- project
- project membership
- API key

Rules:

- Account-level deletes use selector bodies.
- ID-based deletes use route IDs and should not need request bodies.
- Broad deletes should support `dry_run`, confirmation, and `reason`.
- Deletion should define SuperTokens cleanup for users and user identities.

## Task 10: Implement Reset Password

Implement:

```http
POST /admin/simple/accounts/users/{user_id}/reset-password
```

Rules:

- Validate that the target user exists.
- Validate that the user has an `email:password` identity.
- Reject OTP, social, and SSO identities as not applicable.
- Use the existing password reset/auth provider mechanism.
- Return the action response without returning passwords.

## Task 11: Implement Ownership Transfer

Implement:

```http
POST /admin/simple/accounts/organizations/{organization_id}/transfer-ownership
```

Rules:

- Validate source owner user.
- Validate target user.
- Validate both users have memberships across every transferred scope.
- Set target role to owner.
- Set source role to the target user's previous role for each scope.
- Apply role swaps per scope atomically where practical.
- Return the affected flat account graph.

Use existing membership services/managers. Do not add a DAO.

## Task 12: Wire API Routers

Add route handlers that:

- Accept API request models.
- Convert request models to core DTOs.
- Call the core service.
- Convert core DTO responses to API response models.
- Map structured service errors to HTTP errors.

Keep router methods thin.

## Task 13: Compatibility And Migration

Keep existing tests passing while migrating:

- `POST /admin/account` remains legacy only during migration.
- Existing non-trailing `POST /admin/accounts` remains legacy only during migration.
- Target OpenAPI/SDK should expose plural/trailing collection paths.
- New tests should use `POST /admin/simple/accounts/` for simple bootstrap and `POST /admin/accounts/` for graph bootstrap.

## Task 14: Tests

Unit tests:

- DTO validation.
- Reference resolution.
- Dependency validation.
- API key user/project validation.
- Workspace organization validation.
- Project workspace validation.
- Membership user/scope validation.
- Reset-password identity-method validation.
- Ownership-transfer membership and role-swap validation.

API tests:

- `POST /admin/accounts/`
- `DELETE /admin/accounts/`
- `POST /admin/simple/accounts/`
- `DELETE /admin/simple/accounts/`
- all simple entity POST/DELETE endpoints
- reset-password RPC
- transfer-ownership RPC

Regression tests:

- Existing API/SDK/service tests that use `create_account` or `create_accounts`.
- OSS and EE behavior where capabilities differ.

## Task 15: Explicit Non-Tasks

Do not implement in this slice:

- `/query` endpoints
- generic PATCH endpoints
- project-local admin API key routes
- platform-admin DAO
- billing, evaluation, run, or workflow admin expansion
- organization archive/suspend/reactivate
- organization merge
- impersonation
- session reset/force logout
- maintenance reset endpoints
