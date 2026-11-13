# Platform Admin Account Contracts

Status: draft  
Last updated: 2026-04-13

## Purpose

This document defines the request and response contract shape for platform admin account operations.

The main rule is that account graph objects and narrower sub-endpoint objects must use the same DTOs. A user in `POST /admin/accounts/` is the same user object used by the user sub-endpoint. A user identity in `user_identities` is the same user identity object used by the identity sub-endpoint. The endpoint root changes, but the entity contracts do not.

The contract should stay entity-first and flat. Avoid inventing abstract response buckets such as `scopes` or `credentials` when the actual entities are known. The relevant entities are users, user identities, organizations, workspaces, projects, memberships, and API keys.

## Route Shape

Resource routes use plural nouns and trailing slashes. The request DTO name follows the path exactly.

| Entity surface | POST | POST request DTO | DELETE | DELETE request DTO |
| --- | --- | --- | --- | --- |
| Account graph | `POST /admin/accounts/` | `AdminAccountsCreate` | `DELETE /admin/accounts/` | `AdminAccountsDelete` |
| Simple account graph | `POST /admin/simple/accounts/` | `AdminSimpleAccountsCreate` | `DELETE /admin/simple/accounts/` | `AdminSimpleAccountsDelete` |
| Users | `POST /admin/simple/accounts/users/` | `AdminSimpleAccountsUsersCreate` | `DELETE /admin/simple/accounts/users/{user_id}/` | None; path ID (returns `AdminDeleteResponse`) |
| User identities | `POST /admin/simple/accounts/users/identities/` | `AdminSimpleAccountsUsersIdentitiesCreate` | `DELETE /admin/simple/accounts/users/{user_id}/identities/{identity_id}/` | None; path IDs |
| Organizations | `POST /admin/simple/accounts/organizations/` | `AdminSimpleAccountsOrganizationsCreate` | `DELETE /admin/simple/accounts/organizations/{organization_id}/` | None; path ID |
| Organization memberships | `POST /admin/simple/accounts/organizations/memberships/` | `AdminSimpleAccountsOrganizationsMembershipsCreate` | `DELETE /admin/simple/accounts/organizations/{organization_id}/memberships/{membership_id}/` | None; path IDs |
| Workspaces | `POST /admin/simple/accounts/workspaces/` | `AdminSimpleAccountsWorkspacesCreate` | `DELETE /admin/simple/accounts/workspaces/{workspace_id}/` | None; path ID |
| Workspace memberships | `POST /admin/simple/accounts/workspaces/memberships/` | `AdminSimpleAccountsWorkspacesMembershipsCreate` | `DELETE /admin/simple/accounts/workspaces/{workspace_id}/memberships/{membership_id}/` | None; path IDs |
| Projects | `POST /admin/simple/accounts/projects/` | `AdminSimpleAccountsProjectsCreate` | `DELETE /admin/simple/accounts/projects/{project_id}/` | None; path ID |
| Project memberships | `POST /admin/simple/accounts/projects/memberships/` | `AdminSimpleAccountsProjectsMembershipsCreate` | `DELETE /admin/simple/accounts/projects/{project_id}/memberships/{membership_id}/` | None; path IDs |
| API keys | `POST /admin/simple/accounts/api-keys/` | `AdminSimpleAccountsApiKeysCreate` | `DELETE /admin/simple/accounts/api-keys/{api_key_id}/` | None; path ID |

Delete rules:

- `DELETE /admin/accounts/` receives `AdminAccountsDelete` because the account graph has no `account_id`.
- `DELETE /admin/simple/accounts/` receives `AdminSimpleAccountsDelete` because the simple account graph also has no `account_id`.
- Every other DELETE route identifies the target by path ID and should not require a request body.
- There is no `account_id`.
- Do not add read/search endpoints in this first contract.
- Do not add PATCH endpoints in this first contract. If update semantics are needed, define them separately after the create/delete contracts are stable.

DTO naming rule:

- The request DTO is derived from the full path, not from an internal implementation shortcut.
- `POST /admin/accounts/` uses `AdminAccountsCreate`.
- `POST /admin/simple/accounts/` uses `AdminSimpleAccountsCreate`.
- `POST /admin/simple/accounts/users/identities/` uses `AdminSimpleAccountsUsersIdentitiesCreate`.
- Account-level create and delete responses intentionally share one response DTO per path family.

RPC action routes are terminal and do not use a trailing slash. The only RPC actions in this contract are:

- `POST /admin/simple/accounts/reset-password` with `AdminSimpleAccountsUsersResetPassword`
- `POST /admin/simple/accounts/transfer-ownership` with `AdminSimpleAccountsOrganizationsTransferOwnership`

## Reuse Rule

Every sub-endpoint should be a projection over the same DTOs used by the account graph.

Examples:

- `POST /admin/accounts/` accepts `users.{user_ref}` objects shaped as `AdminUserCreate`.
- `POST /admin/simple/accounts/users/` accepts `AdminSimpleAccountsUsersCreate`, a thin wrapper around `AdminUserCreate`.
- `POST /admin/simple/accounts/users/identities/` accepts `AdminSimpleAccountsUsersIdentitiesCreate`, a thin wrapper around `AdminUserIdentityCreate`.
- `POST /admin/simple/accounts/projects/memberships/` accepts `AdminSimpleAccountsProjectsMembershipsCreate`, a thin wrapper around `AdminProjectMembershipCreate`.
- `POST /admin/simple/accounts/api-keys/` accepts `AdminApiKeyCreate`, the same DTO represented in the flat `api_keys` map.
- `POST /admin/accounts/` can return `AdminUserRead` in the flat `users` map.
- `POST /admin/accounts/` can return flat `user_identities`, `organization_memberships`, `workspace_memberships`, `project_memberships`, and `api_keys` maps.

Do not create separate "simple user", "account user", and "project user" shapes unless the fields genuinely differ. Prefer one base DTO and endpoint-specific wrappers.

## Business Logic Invariants

These rules apply regardless of whether the request enters through the full account graph or a simple sub-endpoint.

### References And Reuse

- Any entity reference can point to a request-local `ref`, an existing `id`, or a stable `slug` where that entity supports slugs.
- If a request references an existing entity, the implementation should reuse it instead of recreating it.
- All references must be resolved and validated before dependent writes start.
- Validation errors should identify the exact request-local path, for example `projects.default.workspace_ref`.

### Dependency Rules

- Creating a workspace requires a valid organization.
- Creating a project requires a valid workspace. The organization should be derived from or validated against that workspace.
- Creating an organization membership requires a valid user and a valid organization.
- Creating a workspace membership requires a valid user and a valid workspace.
- Creating a project membership requires a valid user and a valid project.
- Creating an API key requires a valid user and a valid project.
- Creating a user identity requires a valid user.

### Simple User Bootstrap

`POST /admin/simple/accounts/users/` is allowed to be useful as a complete bootstrap operation, not merely a bare user insert.

Default behavior:

- Create the user.
- Create or reuse an organization.
- Create or reuse a workspace in that organization.
- Create or reuse a project in that workspace.
- Create organization, workspace, and project memberships for the user.
- Create one API key for the project when API key creation is enabled.
- Return the full flat account graph: user, user identity records, organization, workspace, project, memberships, and API key response.

The same defaults can be represented explicitly in `POST /admin/accounts/` by providing flat entity maps. The simple endpoint is just a convenience projection over that graph.

### API Keys

API key creation is intentionally simple:

- Validate the user.
- Validate the project.
- Create the API key for that user/project pair.
- Return the API key metadata and, only when allowed, the raw value once.

API key deletion is ID-based:

```http
DELETE /admin/simple/accounts/api-keys/{api_key_id}/
```

Deleting an API key must not delete the user, project, or memberships.

### Ownership Transfer

Ownership transfer is a role reassignment, not a new organization creation flow.

For transfer:

- Validate the source owner user.
- Validate the target owner user.
- Validate that both users have memberships across every scope being transferred.
- Set the target user's role to owner for each transferred scope.
- Set the source user's role to the target user's previous role for each transferred scope.
- Perform the role swap per scope atomically where practical.
- Return the affected flat account graph.

For an organization-level transfer, the required scope stack is the organization plus the relevant workspaces and projects. If a future project-level transfer is added, it must still validate the organization, workspace, and project membership chain for both users.

### Password Reset

Password reset only applies to email/password user identities.

Allowed:

- `method = "email:password"`

Not applicable:

- `email:otp`
- `social:google`
- `social:github`
- `social:*`
- `sso:*`
- concrete SSO provider methods

Reset-password must validate that the target user has an email/password identity before creating a reset flow. It must not create password reset flows for OTP, social, or SSO identities.

## Account Graph Create

Canonical endpoint:

```http
POST /admin/accounts/
```

Request DTO:

```ts
type AdminAccountsCreate = {
  options?: AdminAccountCreateOptions
  users?: Record<UserRef, AdminUserCreate>
  user_identities?: Record<UserIdentityRef, AdminUserIdentityCreate>
  organizations?: Record<OrganizationRef, AdminOrganizationCreate>
  workspaces?: Record<WorkspaceRef, AdminWorkspaceCreate>
  projects?: Record<ProjectRef, AdminProjectCreate>
  organization_memberships?: Record<MembershipRef, AdminOrganizationMembershipCreate>
  workspace_memberships?: Record<MembershipRef, AdminWorkspaceMembershipCreate>
  project_memberships?: Record<MembershipRef, AdminProjectMembershipCreate>
  api_keys?: Record<ApiKeyRef, AdminApiKeyCreate>
}
```

Response DTO:

```ts
type AdminAccountsResponse = {
  accounts: AdminAccountRead[]
  users: Record<UserRef, AdminUserRead>
  user_identities: Record<UserIdentityRef, AdminUserIdentityRead>
  organizations: Record<OrganizationRef, AdminOrganizationRead>
  workspaces: Record<WorkspaceRef, AdminWorkspaceRead>
  projects: Record<ProjectRef, AdminProjectRead>
  organization_memberships: Record<MembershipRef, AdminOrganizationMembershipRead>
  workspace_memberships: Record<MembershipRef, AdminWorkspaceMembershipRead>
  project_memberships: Record<MembershipRef, AdminProjectMembershipRead>
  api_keys?: Record<ApiKeyRef, AdminApiKeyResponse>
  errors?: AdminStructuredError[]
}

type AdminAccountsCreateResponse = AdminAccountsResponse
```

Notes:

- The keyed maps are for create-time references and deterministic programmatic provisioning.
- The response returns the same keys so callers can map request refs to created IDs.
- `accounts` is a convenience projection that groups the created user with the entities they can access.
- `api_keys` is an actual entity collection, not a generic credential bucket.
- Raw API keys only appear in `AdminApiKeyCreated`, and only in the create response.

## Account Graph Delete

Canonical endpoint:

```http
DELETE /admin/accounts/
```

This delete endpoint receives a request body because the account graph has no `account_id`.

Request DTO:

```ts
type AdminAccountsDelete = {
  target: AdminAccountsDeleteTarget
  dry_run?: boolean
  reason?: string
  confirm?: string
}

type AdminAccountsDeleteTarget = {
  user_ids?: string[]
  user_emails?: string[]
  organization_ids?: string[]
  workspace_ids?: string[]
  project_ids?: string[]
}
```

Response DTO:

```ts
type AdminAccountsDeleteResponse = AdminAccountsResponse
```

Rules:

- The target must resolve to actual entity IDs before deletion starts.
- `dry_run` should default to true for broad deletes until the implementation defines a safer default.

## Simple Account Graph Delete

Endpoint:

```http
DELETE /admin/simple/accounts/
```

This delete endpoint receives a request body because a simple account graph also has no `account_id`.

Request DTO:

```ts
type AdminSimpleAccountsDelete = {
  target: AdminSimpleAccountsDeleteTarget
  dry_run?: boolean
  reason?: string
  confirm?: string
}

type AdminSimpleAccountsDeleteTarget = {
  user_id?: string
  user_email?: string
  organization_id?: string
  workspace_id?: string
  project_id?: string
}
```

Response DTO:

```ts
type AdminSimpleAccountsDeleteResponse = AdminSimpleAccountsResponse
```

Rules:

- The target should resolve to one simple account graph before deletion starts.
- Non-aggregate DELETE endpoints identify their target in the path and return `AdminDeleteResponse`; they should not introduce separate request DTOs.

## ID-Based Delete Response

All DELETE endpoints other than `DELETE /admin/accounts/` and `DELETE /admin/simple/accounts/` identify their target in the path and return this response.

```ts
type AdminDeleteResponse = {
  dry_run: boolean
  deleted: AdminDeletedEntities
  skipped?: AdminDeletedEntities
  errors?: AdminStructuredError[]
}

type AdminDeletedEntities = {
  users?: AdminDeletedEntity[]
  user_identities?: AdminDeletedEntity[]
  organizations?: AdminDeletedEntity[]
  workspaces?: AdminDeletedEntity[]
  projects?: AdminDeletedEntity[]
  organization_memberships?: AdminDeletedEntity[]
  workspace_memberships?: AdminDeletedEntity[]
  project_memberships?: AdminDeletedEntity[]
  api_keys?: AdminDeletedEntity[]
}

type AdminDeletedEntity = {
  id: string
  ref?: string
}
```

## Options

```ts
type AdminAccountCreateOptions = {
  dry_run?: boolean
  idempotency_key?: string
  create_identities?: boolean
  create_api_keys?: boolean
  return_api_keys?: boolean
  seed_defaults?: boolean
  reason?: string
}
```

Rules:

- `create_api_keys` defaults to false for the target admin API unless a test fixture explicitly opts in.
- `return_api_keys` is valid only when `create_api_keys` is true.
- `return_api_keys` defaults to the same value as `create_api_keys` only if the endpoint is explicitly documented as a bootstrap/test fixture. Otherwise it should default to false.
- `create_identities` allows the request to create or link login identities when identity entries are present and the active auth configuration permits them.
- `dry_run` validates and plans without writing.

## Account Projection

```ts
type AdminAccountRead = {
  users: Record<UserRef, AdminUserRead>
  user_identities: Record<UserIdentityRef, AdminUserIdentityRead>
  organizations: Record<OrganizationRef, AdminOrganizationRead>
  workspaces: Record<WorkspaceRef, AdminWorkspaceRead>
  projects: Record<ProjectRef, AdminProjectRead>
  organization_memberships: Record<MembershipRef, AdminOrganizationMembershipRead>
  workspace_memberships: Record<MembershipRef, AdminWorkspaceMembershipRead>
  project_memberships: Record<MembershipRef, AdminProjectMembershipRead>
  api_keys?: Record<ApiKeyRef, AdminApiKeyRead>
}
```

The account projection groups flat entity DTO maps into one operational graph. It should not define new entity fields that are absent from the underlying entity DTOs, and it should not nest user identities under users or memberships under scopes.

Raw secrets are never returned from non-create responses:

- no passwords
- no raw API key values
- no OTP secrets
- no provider client secrets

## Users

Create DTO:

```ts
type AdminUserCreate = {
  email: string
  username?: string
  name?: string
  is_admin?: boolean
  is_root?: boolean
  metadata?: Record<string, unknown>
}
```

Read DTO:

```ts
type AdminUserRead = {
  id: string
  uid: string
  email: string
  username?: string
  name?: string
  is_admin?: boolean
  is_root?: boolean
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}
```

Rules:

- `email` must be globally unique where existing user creation requires that.
- `username` follows the existing username validator unless replaced by a platform policy.
- User identities are represented in the flat `user_identities` entity map, not nested under users.
- Passwords can appear only in create/update requests that explicitly create or rotate an email/password identity.
- Passwords must never appear in responses.

## User Identities

Create DTO:

```ts
type AdminUserIdentityCreate = {
  user_ref: EntityRef
  method: IdentityMethod
  subject: string
  domain?: string
  email?: string
  password?: string
  verified?: boolean
  provider_user_id?: string
  claims?: Record<string, unknown>
}
```

Read DTO:

```ts
type AdminUserIdentityRead = {
  id?: string
  user_id: string
  method: IdentityMethod
  subject: string
  domain?: string
  email?: string
  status: "created" | "linked" | "pending_confirmation" | "skipped" | "failed"
  verified?: boolean
  created_at?: string
  updated_at?: string
}
```

Identity method slugs should reuse the existing auth model:

```ts
type IdentityMethod =
  | "email:otp"
  | "email:password"
  | "email:*"
  | "social:google"
  | "social:github"
  | "social:*"
  | `sso:${string}:${string}`
  | `sso:${string}:*`
  | "sso:*"
```

Rules:

- `method` must pass the existing `MethodKind.is_valid_pattern` behavior.
- `subject` is required for stored identities.
- For `email:password`, `password` is allowed in create requests and must be validated by the effective password policy.
- For `email:otp`, identity creation is usually pending confirmation unless an explicit verified override is supported.
- For social and SSO identities, provider linking must be trusted and auditable.

## Organizations

Create DTO:

```ts
type AdminOrganizationCreate = {
  name: string
  slug?: string
  owner_user_ref?: UserRef
  metadata?: Record<string, unknown>
}
```

Read DTO:

```ts
type AdminOrganizationRead = {
  id: string
  name: string
  slug?: string
  owner_user_id?: string
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}
```

Rules:

- Organization naming and slug validation must happen before writes.
- Initial owner assignment can be represented by `owner_user_ref` or by an organization membership with an owner role, but the response should make the effective owner clear.
- Organization memberships are represented in the flat `organization_memberships` entity map, not nested under organizations.

## Workspaces

Create DTO:

```ts
type AdminWorkspaceCreate = {
  name: string
  slug?: string
  organization_ref: EntityRef
  metadata?: Record<string, unknown>
}
```

Read DTO:

```ts
type AdminWorkspaceRead = {
  id: string
  name: string
  slug?: string
  organization_id: string
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}
```

Rules:

- `organization_ref` can reference a request-local slug or an existing organization ID.
- Workspace memberships are represented in the flat `workspace_memberships` entity map, not nested under workspaces.

## Projects

Create DTO:

```ts
type AdminProjectCreate = {
  name: string
  slug?: string
  organization_ref: EntityRef
  workspace_ref: EntityRef
  is_default?: boolean
  metadata?: Record<string, unknown>
}
```

Read DTO:

```ts
type AdminProjectRead = {
  id: string
  name: string
  slug?: string
  organization_id: string
  workspace_id: string
  is_default?: boolean
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}
```

Rules:

- `organization_ref` and `workspace_ref` can reference request-local slugs or existing IDs.
- Project memberships are represented in the flat `project_memberships` entity map, not nested under projects.
- API keys are represented in the flat `api_keys` entity map, not nested under projects.
- Raw API key values never appear in `AdminProjectRead`; they only appear in API key response objects immediately after creation.

## Memberships

Organization membership create DTO:

```ts
type AdminOrganizationMembershipCreate = {
  organization_ref: EntityRef
  user_ref: EntityRef
  role: string
}
```

Workspace membership create DTO:

```ts
type AdminWorkspaceMembershipCreate = {
  workspace_ref: EntityRef
  user_ref: EntityRef
  role: string
}
```

Project membership create DTO:

```ts
type AdminProjectMembershipCreate = {
  project_ref: EntityRef
  user_ref: EntityRef
  role: string
}
```

Read DTOs:

```ts
type AdminOrganizationMembershipRead = {
  id: string
  organization_id: string
  user_id: string
  role: string
  created_at?: string
  updated_at?: string
}

type AdminWorkspaceMembershipRead = {
  id: string
  workspace_id: string
  user_id: string
  role: string
  created_at?: string
  updated_at?: string
}

type AdminProjectMembershipRead = {
  id: string
  project_id: string
  user_id: string
  role: string
  created_at?: string
  updated_at?: string
}
```

Rules:

- Membership DTOs are actual first-class entities in flat account graph maps.
- Tenant-local invitation and role-management APIs remain separate. These DTOs are for platform-admin bootstrap, recovery, and inspection.

## API Keys

Create DTO:

```ts
type AdminApiKeyCreate = {
  project_ref: EntityRef
  user_ref: EntityRef
  name?: string
  expires_at?: string
}
```

Read DTO:

```ts
type AdminApiKeyRead = {
  id?: string
  prefix: string
  name?: string
  project_id: string
  user_id: string
  expires_at?: string
  created_at?: string
  revoked_at?: string
}

type AdminApiKeyResponse = AdminApiKeyRead & {
  value?: string
  returned_once?: true
}
```

Created DTO:

```ts
type AdminApiKeyCreated = AdminApiKeyRead & {
  value: string
  returned_once: true
}
```

Rules:

- API keys are project/user entities.
- Account creation can generate one key per requested user/project scope when `options.create_api_keys` is true.
- `AdminApiKeyCreated.value` must only be returned immediately after creation.
- `AdminApiKeyResponse.value` is present only in create responses when `options.return_api_keys` is enabled.
- Logs and non-create responses must never include `value`.

## Simple Endpoint Projection

Simple endpoints should not introduce separate DTOs unless the shape genuinely differs. They should be wrappers over the canonical account graph DTOs.

Examples:

```ts
type AdminSimpleAccountsCreate = {
  options?: AdminAccountCreateOptions
  user: AdminUserCreate
  user_identities?: AdminUserIdentityCreate[]
  organization?: AdminOrganizationCreate
  workspace?: AdminWorkspaceCreate
  project?: AdminProjectCreate
  organization_memberships?: AdminOrganizationMembershipCreate[]
  workspace_memberships?: AdminWorkspaceMembershipCreate[]
  project_memberships?: AdminProjectMembershipCreate[]
  api_keys?: AdminApiKeyCreate[]
}

type AdminSimpleAccountsResponse = AdminAccountsResponse

type AdminSimpleAccountsCreateResponse = AdminSimpleAccountsResponse
```

Precision endpoints should use the same entity DTO at the root:

```ts
type AdminSimpleAccountsUsersCreate = {
  options?: AdminAccountCreateOptions
  user: AdminUserCreate
}

type AdminSimpleAccountsUsersIdentitiesCreate = {
  options?: AdminAccountCreateOptions
  user_ref: EntityRef
  user_identity: AdminUserIdentityCreate
}

type AdminSimpleAccountsOrganizationsCreate = {
  options?: AdminAccountCreateOptions
  organization: AdminOrganizationCreate
  owner?: AdminUserCreate
}

type AdminSimpleAccountsOrganizationsMembershipsCreate = {
  options?: AdminAccountCreateOptions
  membership: AdminOrganizationMembershipCreate
}

type AdminSimpleAccountsWorkspacesCreate = {
  options?: AdminAccountCreateOptions
  workspace: AdminWorkspaceCreate
}

type AdminSimpleAccountsWorkspacesMembershipsCreate = {
  options?: AdminAccountCreateOptions
  membership: AdminWorkspaceMembershipCreate
}

type AdminSimpleAccountsProjectsCreate = {
  options?: AdminAccountCreateOptions
  project: AdminProjectCreate
}

type AdminSimpleAccountsProjectsMembershipsCreate = {
  options?: AdminAccountCreateOptions
  membership: AdminProjectMembershipCreate
}

type AdminSimpleAccountsApiKeysCreate = {
  options?: AdminAccountCreateOptions
  api_key: AdminApiKeyCreate
}

type AdminSimpleAccountsUsersResetPassword = {
  // Each entry identifies one email:password identity to reset.
  // The service matches on method + subject (or email) and updates only the password.
  // No user ID in the path — the subject / email is the lookup key.
  user_identities: AdminUserIdentityCreate[]
}

// 204 No Content on success

type AdminSimpleAccountsOrganizationsTransferOwnership = {
  // Keyed map of org refs to transfer; omit to transfer all orgs owned by the source user.
  organizations?: Record<string, EntityRef>
  // Two-key dict: "source" (current owner) and "target" (new owner).
  users: { source?: EntityRef; target: EntityRef }
  include_workspaces?: "all" | string[]
  include_projects?: "all" | string[]
  reason?: string
  recovery?: boolean
}

type AdminSimpleAccountsOrganizationsTransferOwnershipResponse = AdminSimpleAccountsResponse
```

These requests should be normalized into `AdminAccountsCreate` before persistence.

Delete response DTOs:

```ts
type AdminSimpleAccountsUsersDeleteResponse = AdminDeleteResponse
type AdminSimpleAccountsUsersIdentitiesDeleteResponse = AdminDeleteResponse
type AdminSimpleAccountsOrganizationsDeleteResponse = AdminDeleteResponse
type AdminSimpleAccountsOrganizationsMembershipsDeleteResponse = AdminDeleteResponse
type AdminSimpleAccountsWorkspacesDeleteResponse = AdminDeleteResponse
type AdminSimpleAccountsWorkspacesMembershipsDeleteResponse = AdminDeleteResponse
type AdminSimpleAccountsProjectsDeleteResponse = AdminDeleteResponse
type AdminSimpleAccountsProjectsMembershipsDeleteResponse = AdminDeleteResponse
type AdminSimpleAccountsApiKeysDeleteResponse = AdminDeleteResponse
```

Simple DELETE endpoints do not have request DTOs in this contract because their target IDs are in the route path. If a delete needs `reason`, `dry_run`, or confirmation semantics later, define that consistently across all simple DELETE endpoints instead of adding one-off request bodies.

Use `memberships`, not `members`, for route segments and DTO names. A member is a user projection; a membership is the actual admin-managed entity that binds a user to an organization, workspace, or project with a role.

## References

```ts
type UserRef = string
type UserIdentityRef = string
type OrganizationRef = string
type WorkspaceRef = string
type ProjectRef = string
type MembershipRef = string
type ApiKeyRef = string

type EntityRef =
  | { ref: string }
  | { id: string }
  | { slug: string }
```

Rules:

- `ref` points to a request-local key in the canonical create payload.
- `id` points to an existing persisted entity.
- `slug` is allowed only where the entity type has a stable unique slug.
- References should be validated before writes.

## Error DTO

```ts
type AdminStructuredError = {
  code: string
  message: string
  details?: Record<string, unknown>
}
```

Examples:

- `account_already_exists`
- `invalid_reference`
- `duplicate_slug`
- `identity_method_disabled`
- `password_policy_failed`
- `api_key_return_without_creation`

Errors should identify the request-local reference where possible, for example `user_identities.alice_password` or `projects.default.workspace_ref`.

## Open Questions

1. Should `AdminAccountsResponse` return both keyed maps and the `accounts` projection, or should one be omitted to reduce payload size?
2. Should API keys be requested only through `options.create_api_keys`, or should explicit `api_keys` entries also be supported in the first slice?
3. Should organization owner assignment be modeled as `owner_user_ref`, an owner membership, or both?
4. Should simple endpoints accept bare entity DTOs or always wrap them under named fields like `{ "user": ... }`?
5. Which metadata fields are safe to expose for identities from external providers?
