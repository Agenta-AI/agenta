# Plan: RBAC Role Cleanup and API Key Access Tightening

## 1. Confirmed Decisions

- Canonical role set: `owner`, `admin`, `manager`, `evaluator`, `auditor`.
- `workspace_admin` is retired and mapped to `admin`.
- API key "use" remains derived behavior and no new permission is needed.
- There is no API compatibility layer for old role strings.
- Apply the code and data changes in all environments.
- The effective authorization impact will only materially change behavior where RBAC is actually enforced.

## 2. Backend Role and Permission Changes

- Update the canonical role definition in `api/ee/src/models/shared_models.py`.
- Update role descriptions returned by `/workspaces/roles`.
- Rework `Permission.default_permissions(role)` to enforce:
  - `owner`, `admin`, `manager` can manage API keys
  - `evaluator`, `auditor` cannot view API keys
- Replace direct comparisons against old role names across:
  - `api/ee/src/utils/permissions.py`
  - `api/ee/src/services/db_manager_ee.py`
  - `api/ee/src/services/workspace_manager.py`
  - `api/ee/src/services/organization_service.py`
  - `api/ee/src/services/commoners.py`
  - legacy literal definitions in `api/oss/src/services/admin_manager.py` and `api/ee/src/services/admin_manager.py`

## 3. Enforce Direct Cutover

- Accept only new canonical role names in API requests and responses.
- Remove old role literals from request validators, enums, fixtures, and UI options in the same change window.
- Add tests that verify old role inputs are rejected once the cutover lands.

## 4. Database Migration

- Create an Alembic data migration that rewrites:
  - `workspace_members.role`
  - `project_members.role`
  - `project_invitations.role`
- Migration mapping:
  - `editor` -> `admin`
  - `deployment_manager` -> `manager`
  - `viewer` -> `auditor`
  - `workspace_admin` -> `admin`
- Delete API keys owned by users whose canonical post-migration role is `evaluator` or `auditor`.
- Update code defaults so new inserts no longer emit old names.
- Add verification queries or migration tests to catch missed rows.

## 5. Frontend Permission Abstraction

- Add an organization-scoped entitlement helper in the web app.
- Expose helpers such as:
  - `useOrganizationEntitlements()`
  - `hasEntitlement(entitlement)`
  - `hasPlan(plan)`
- Add a generic project-scoped permission helper in the web app.
- Prefer a backend-derived permission source over re-encoding the permission matrix in the frontend.
- Expose helpers such as:
  - `hasPermission(permission)`
  - `hasRole(role)`

## 6. Frontend Product Changes

- Rename displayed role labels across settings/member-management screens.
- Update invite defaults from `editor` to `admin`.
- Update role-picker options and tooltips.
- Replace ad hoc entitlement/plan checks with `useOrganizationEntitlements()`, `hasEntitlement()`, and `hasPlan()` where relevant.
- Hide or block API Keys UI for users without `view_api_keys`.
- Hide create/delete controls for users without `edit_api_keys`.
- Update settings navigation so `API Keys` is not shown to `evaluator` and `auditor`.
- Add tab-routing guards so manually forcing `?tab=apiKeys` does not expose the page.

## 7. Tooling Scope

- Do not add any client-side backward compatibility for old role names.
- Update only in-repo callers, tests, and tooling to use canonical role names directly.

## 8. Runtime Scope

- Apply this cleanup in OSS and EE.
- Apply this cleanup whether RBAC entitlement is enabled or disabled.
- Treat role renames, data migration, frontend labels, and API key cleanup as universal changes.
- Expect effective authorization changes to matter primarily in EE when RBAC is enabled under the current runtime model.

## 9. Test Updates

### Backend tests

- Add or update unit tests for the role-permission matrix.
- Add API tests for `/keys`:
  - `owner` can list/create/delete
  - `admin` can list/create/delete
  - `manager` can list/create/delete
  - `evaluator` gets 403
  - `auditor` gets 403
- Add migration tests or verification queries proving API keys owned by `evaluator`/`auditor` users are removed.
- Add tests that old role inputs are rejected after the cutover.

### Frontend tests

- Add tests for settings sidebar visibility by role.
- Add tests for API Keys page visibility and action gating.
- Update member-management role labels and role-picker expectations.

### Tests/tooling

- Update:
  - `api/run-tests.py`
  - `api/pytest.ini`
  - `web/tests/README.md`
  - `web/tests/playwright/config/testTags.ts`
- Replace mixed old/new role terms with the final canonical set.

## 10. Review Checklist

- Product review on the final role taxonomy and semantics.
- API review on strict cutover behavior and migration sequencing.
- Frontend review on hiding vs disabling vs redirect behavior.
- Migration review on rollback behavior and invite-row handling.
- Review in-repo caller, test, and tooling changes that remain in scope.

## 11. Release Model

- Ship this work in one single release.
- Include backend role/permission changes, the database migration, frontend changes, and test/tooling updates together.
- Do not split the change into stages, checkpoints, or phased rollout steps.

## 12. Success Criteria

- Only `owner`, `admin`, and `manager` can manage API keys.
- API keys owned by `evaluator` and `auditor` users are removed as part of migration.
- API responses and UI use one canonical role vocabulary.
- Existing stored memberships and invitations are migrated cleanly.
- The frontend no longer exposes API Keys affordances to roles that lack permission.
