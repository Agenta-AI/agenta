# RFC 0: Authorization consistency

## Scope

This RFC closes current authorization issues that would undermine session privacy and sharing. It
does not redesign every role or credential.

## Current issues

### Project management

Project create, rename, make-default, and delete routes have no active role checks. Matching UI
actions are also ungated.

References:

- `api/oss/src/routers/projects_router.py:198-347`
- `web/oss/src/components/pages/settings/Projects/index.tsx:68-124,195-266`

### Ownership and member management

Generic role assignment accepts `owner`, including self-promotion. Organization ownership transfer
does not update every Project membership, so a former owner can retain Project Owner bypass.
Member removal requires an exact Admin role and leaves personal API keys active.

References:

- `api/oss/src/routers/workspace_router.py:111-248`
- `api/oss/src/services/db_manager.py:1042-1094,1144-1224,1589-1697`
- `api/oss/src/core/access/permissions/service.py:335-348`

### Organization security

Domain and SSO endpoints check only Organization membership while the UI is owner-only. Provider
reads can return decrypted OIDC client secrets.

References:

- `api/ee/src/apis/fastapi/organizations/router.py:42-49,85-452`
- `api/ee/src/core/organizations/service.py:619-742,872-909`

### Viewer and secrets

Viewer receives `view_secret`, `view_webhooks`, and `run_service`. Vault and webhook reads can return
decrypted secret material. Viewer also receives `view_billing`, while the UI hides Billing from
non-owners.

References:

- `api/oss/src/core/access/permissions/types.py:178-204`
- `api/oss/src/apis/fastapi/vault/router.py:124-210`
- `api/oss/src/core/webhooks/service.py:311-338`

### Personal API keys

An API key stores a creator and one Project. It has no independent role. Authentication acts as the
creator and endpoint authorization uses the creator's current role. Member removal does not delete
these keys, and positive authentication or authorization results can remain cached.

References:

- `api/oss/src/models/db_models.py:338-376`
- `api/oss/src/services/api_key_service.py:53-106,198-251`
- `api/oss/src/middlewares/auth.py:798-874`

## Decisions

### Project capability

Add one `manage_projects` capability for create, rename, make-default, and delete. Default Owner and
Admin receive it. This keeps the initial fix small without coupling Project management to the
unrelated `edit_workspace` name or adding four permissions.

Apply the check in the backend and every Project action in the UI. Security-floor capabilities do
not use the EE non-RBAC allow-all bypass. A plan may hide role customization, but it cannot make
destructive tenant administration available to every member.

### Ownership transfer

- Reject `owner` in generic role assignment.
- Reject self role changes and self removal.
- The dedicated transfer operation atomically changes the Organization owner and every Workspace
  and Project role in that Organization for both users. The recipient becomes Owner. The former
  owner becomes Admin at every affected scope.
- Invalidate authorization caches in the same operation.
- Verify that the former owner loses all Owner bypass immediately.

### Member removal

Add `remove_user_from_workspace`. Default Owner and Admin receive it. One offboarding operation:

1. Reject owner and self removal.
2. Revoke the target's personal keys for affected Projects.
3. Remove Project and Workspace memberships.
4. Remove Organization membership only if no Workspace membership remains.
5. Invalidate action authorization and key authentication.
6. Block runtime credential refresh.

Later session grants and ownership hooks register with this operation. RFC 2 adds those hooks rather
than creating another removal path.

Once session audiences exist, offboarding also revokes grants to the member, freezes personal
sessions they own, clears their ownership authority from Project sessions, increments affected
access revisions, and closes affected streams. Membership removal rolls back if a registered
security hook fails.

Key authentication must check that the creator still exists and has matching Project and Workspace
membership. Cache entries need a revocable key identifier or generation. If that cannot be added in
the first patch, invalidate the full API-key authentication namespace after delete or offboarding.

### Organization security

Require `organization.owner_id` for every domain and SSO endpoint because that matches current UI
and Organization flag behavior. Stop returning stored client secrets. Return a presence flag;
omitting a secret during update leaves it unchanged.

Organization Admin permissions are deferred until Organization-scope RBAC exists.

### Immediate secret safety

- Remove plaintext reveal from Viewer.
- Vault list and normal reads return redacted values for callers without an explicit existing
  privileged path.
- Webhook and SSO secrets never return after creation.
- Keep runtime secret use separate from plaintext response serialization, even if the existing
  permission remains temporarily shared internally.

A later RFC can split metadata, use, reveal, and edit into separate capabilities. This RFC closes
the current response exposures without putting that wider migration on the session critical path.

### Viewer execution and billing

`run_service` and `view_billing` remain explicit product decisions. Instrument current use and
resolve the UI/API mismatch in separate changes. Session audience read enforcement does not depend
on either decision. Named Join access remains out of scope until execution semantics are defined.

### Security-floor checks

The EE entitlement allow-all path never bypasses `manage_projects`,
`remove_user_from_workspace`, ownership transfer, Organization-security owner checks,
session-sharing policy administration, or session instance-access checks. Entitlements can control
whether customers customize roles; they cannot disable these authorization boundaries.

## Migration

- Delete keys with a missing creator or missing matching Project membership.
- Detect Project Owner role assignments that do not match `organization.owner_id`; resolve them
  before generic Owner assignment is blocked.
- Preserve valid active-member keys and EE role configuration.
- Add `manage_projects` and `remove_user_from_workspace` to default Owner/Admin.
- Do not reinterpret custom secret permissions in this RFC.

## Verification

- Owner/Admin succeed and Viewer fails for every Project mutation in OSS and EE plans.
- The non-RBAC entitlement bypass does not bypass any enumerated security-floor check.
- Generic Owner assignment and self changes fail.
- Ownership transfer updates all membership scopes and invalidates old Owner access.
- Removed-member personal keys fail immediately at authentication.
- Organization security endpoints deny members and never return stored client secrets.
- Viewer vault and webhook responses contain no plaintext secret material.

## Deferred work

- Service-account principals.
- Organization Admin permissions.
- Viewer execution and billing policy.
- Full secret metadata/use/reveal/edit capability migration.
- Customer-facing role editor.
