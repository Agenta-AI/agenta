# Proposal: Minimal Role Cleanup with API Key Tightening

## 1. Target Role Model

Proposed steady-state role set:

- `owner`
- `admin`
- `manager`
- `evaluator`
- `auditor`

Proposed rename and normalization map:

| Current value | Proposed value |
| --- | --- |
| `owner` | `owner` |
| `editor` | `admin` |
| `deployment_manager` | `manager` |
| `evaluator` | `evaluator` |
| `viewer` | `auditor` |
| `workspace_admin` | `admin` |

Rationale:

- this preserves the requested renames
- this removes the extra `workspace_admin` role to satisfy the "minimally redefine what roles even are" objective
- this avoids carrying both `admin` and `workspace_admin` as nearly-overlapping concepts

## 2. Permission Strategy

Use the current permission enum as the primitive layer and make the minimal permission rebalance needed for the new role model.

Important design choice:

- do not create a new `use_api_keys` permission
- continue using `view_api_keys` and `edit_api_keys`
- treat API key use as derived behavior, per user clarification

## 3. Proposed Role Semantics

### `owner`

- top-level break-glass role
- diff versus one level up:
  - none; `owner` is the highest role
- diff versus one level down:
  - broader than `admin`
  - retains the highest-sensitivity capabilities that should not be delegated, especially full ownership and destructive or organization-level control

### `admin`

- merged successor for `editor` and `workspace_admin`
- should own member-management and most workspace-management actions
- should have `view_api_keys` and `edit_api_keys`
- diff versus one level up:
  - narrower than `owner`
  - does not retain the top-level ownership and break-glass capabilities reserved for `owner`
- diff versus one level down:
  - broader than `manager`
  - adds people-management and broader workspace-management authority beyond deployment-oriented responsibilities

### `manager`

- successor for `deployment_manager`
- remains deployment-oriented
- gains `view_api_keys` and `edit_api_keys`
- diff versus one level up:
  - narrower than `admin`
  - does not get member-management or the broader workspace-administration capabilities assigned to `admin`
- diff versus one level down:
  - broader than `evaluator`
  - gains deployment-oriented control and API key management that `evaluator` does not have

### `evaluator`

- role name stays `evaluator`
- remains evaluation-oriented
- loses API key visibility
- diff versus one level up:
  - narrower than `manager`
  - does not get deployment authority or API key management
- diff versus one level down:
  - broader than `auditor`
  - keeps evaluation-oriented capabilities that go beyond read-only access

### `auditor`

- successor for `viewer`
- remains read-oriented
- loses API key visibility
- diff versus one level up:
  - narrower than `evaluator`
  - does not keep evaluation-oriented capabilities and remains read-only
- diff versus one level down:
  - none; `auditor` is the lowest role

## 4. Proposed Minimal Permission Rebalance

The proposal intentionally minimizes unrelated permission churn.

| Target role | Baseline | Proposed API key behavior |
| --- | --- | --- |
| `owner` | current `owner` | keep view/edit |
| `admin` | current `workspace_admin` plus current `editor` responsibilities | keep view/edit |
| `manager` | current `deployment_manager` | add view/edit |
| `evaluator` | current `evaluator` | remove view |
| `auditor` | current `viewer` | remove view |

Everything outside API keys should stay as close as possible to the current behavior unless there is an explicit reason to change it.

Additional migration rule for API keys:

- do not grandfather API keys for downgraded roles
- delete API keys owned by users whose canonical post-migration role is `evaluator` or `auditor`
- after migration, only `owner`, `admin`, and `manager` should have surviving managed API keys

## 5. Backend Contract

### Canonical role names

The backend should expose only the new role names in steady state:

- API responses
- workspace roles list
- workspace member payloads
- invitation payloads

### Cutover rule

Do not add an API compatibility layer for old role strings.

The API layer should accept only the new canonical role names after this change:

- `owner`
- `admin`
- `manager`
- `evaluator`
- `auditor`

Old role values should be eliminated through database migration, code updates, and test/tooling updates rather than being accepted indefinitely at runtime.

## 6. Database Proposal

Persist only the new role strings in:

- `workspace_members.role`
- `project_members.role`
- `project_invitations.role`

Do not redesign `organization_members.role` in this change. It currently serves an organization-level `owner/member` concern and should remain separate unless there is a separate organization-role project.

Migration rule set:

- rewrite existing rows to the new canonical names
- map `workspace_admin` to `admin`
- update all code defaults from `viewer`/`editor` to `auditor`/`admin`
- delete API keys owned by users whose resulting role is `evaluator` or `auditor`

## 7. Frontend Proposal

Introduce two explicit frontend authorization surfaces:

### Organization-scoped entitlement helper

- `useOrganizationEntitlements()`
- `hasEntitlement(entitlement)`
- `hasPlan(plan)`

This should be the canonical frontend API for organization-level plan and entitlement checks.

### Project-scoped permission helper

Introduce a generic project-scoped permission helper that mirrors the entitlement helper shape, for example:

- `useProjectPermissions()`
- `hasPermission(permission)`
- `hasRole(role)`

Design goals:

- backend remains authoritative
- frontend reads already-resolved permissions from the current member payload whenever possible
- organization-scoped gating uses the entitlement helper rather than duplicating plan checks ad hoc
- frontend hides or disables affordances before the user hits a 403

Minimum UI changes:

- hide the `API Keys` settings item when the current user lacks `view_api_keys`
- block page access or show an access-denied state when the tab is forced manually
- show the API key table only for users with `view_api_keys`
- show generate/delete actions only for users with `edit_api_keys`
- rename visible role labels everywhere to `admin`, `manager`, `evaluator`, `auditor`

## 8. Tooling Scope

After backend changes:

- do not add client-side backward compatibility for old role names
- update in-repo test tooling and CLI flags to the new role names

## 9. Runtime Scope

Apply this cleanup in all environments:

- OSS and EE
- RBAC enabled and RBAC disabled

Important nuance:

- the role renames, data migration, frontend labels, and API key cleanup still apply everywhere
- under the current authorization model, the access-control effect will only materially change behavior in EE when RBAC is enabled
- when RBAC is not being consulted at runtime, the new role matrix may exist in code and data without changing effective access

## 10. Release Model

This change should ship as one single release.

- backend role and permission changes
- database migration
- frontend permission and UI changes
- test and tooling updates

There is no staged rollout, compatibility window, or phased cutover.
