# Research: Current RBAC and API Key State

## 1. Current RBAC Source of Truth

The EE RBAC model is currently centered in `api/ee/src/models/shared_models.py`.

- `WorkspaceRole` currently defines:
  - `owner`
  - `viewer`
  - `editor`
  - `evaluator`
  - `workspace_admin`
  - `deployment_manager`
- `Permission.default_permissions(role)` defines the effective permission matrix for those roles.

Permission evaluation is currently performed in `api/ee/src/utils/permissions.py`.

- Authorization is checked against `project_members.role`
- organization owners bypass project-role checks
- project `owner` also bypasses granular permission checks
- when RBAC entitlement is disabled, non-demo members get broad allow behavior
- demo members remain restricted even when RBAC entitlement is off

This means role changes only matter today when RBAC is actually consulted.

## 2. Current Role Matrix Relevant to API Keys

Current API key permissions from `Permission.default_permissions(role)`:

| Current role | `view_api_keys` | `edit_api_keys` | Notes |
| --- | --- | --- | --- |
| `owner` | yes | yes | Has every permission |
| `viewer` | yes | no | Can currently see API keys |
| `editor` | yes | yes | Can currently create/delete API keys |
| `evaluator` | yes | no | Can currently see API keys |
| `deployment_manager` | yes | no | Can currently see but not edit API keys |
| `workspace_admin` | yes | yes | Can currently create/delete API keys |

Implications:

- API key visibility is broader than the target state
- API key editing is currently available to `editor` and `workspace_admin`, but not `deployment_manager`
- the requested target state would reduce access for `viewer` and `evaluator`, and broaden edit access for `deployment_manager` if it maps to `manager`

## 3. Role Persistence in the Database

Role values are stored as plain strings, not DB enums.

Relevant tables:

- `api/ee/src/models/db_models.py`
  - `workspace_members.role`
  - `project_members.role`
  - `organization_members.role` for organization-level membership only
- `api/oss/src/models/db_models.py`
  - `project_invitations.role`

Important details:

- `workspace_members.role` defaults to `viewer`
- `project_members.role` defaults to `viewer`
- `project_invitations.role` is required and stores the invitation role string
- `organization_members.role` uses a different taxonomy with default `member`, not the workspace/project role set

Migration impact:

- schema changes are light because the columns are already strings
- data migration still matters because persisted values, invitations, and mirrored memberships all contain old role names

## 4. Role Duplication and Sync

Workspace/project roles are duplicated deliberately.

Evidence:

- `api/ee/src/services/db_manager_ee.py::sync_workspace_members_to_project`
- `api/ee/src/services/db_manager_ee.py::add_user_to_workspace_and_org`
- `api/ee/src/services/db_manager_ee.py::update_user_roles`

Current behavior:

- workspace members are mirrored into all projects in the workspace
- updating a workspace role also updates mirrored project roles
- invitation acceptance and add-user flows propagate one role string into workspace and project membership rows

This means a role rename needs to update:

- database rows
- sync code
- invite defaults
- any code that compares against hard-coded string values

## 5. API Key Backend Behavior

### CRUD permissions

`api/oss/src/routers/api_key_router.py` gates API key endpoints as follows:

- `GET /keys` -> `Permission.VIEW_API_KEYS`
- `POST /keys` -> `Permission.EDIT_API_KEYS`
- `DELETE /keys/{key_prefix}` -> `Permission.EDIT_API_KEYS`

### "Use" behavior

`api/oss/src/services/auth_service.py::verify_apikey_token`:

- validates the raw API key
- resolves it to `created_by_id` and `project_id`
- hydrates `request.state.user_id`, `project_id`, `workspace_id`, and `organization_id`

There is no separate `use_api_keys` permission today.

Practical meaning:

- using an API key inherits whatever endpoint-level authorization exists for the key creator's current membership
- key usage is not modeled as a distinct action in `Permission`

## 6. Current Frontend Authorization Shape

There is no general frontend `hasPermission(project, role(user))` helper today.

What exists:

- `web/oss/src/hooks/useWorkspacePermissions.ts`
  - only exposes `canInviteMembers`, `canModifyRoles`, and `isOrgOwner`
  - hard-codes `owner` and `workspace_admin`
- `web/oss/src/components/pages/settings/WorkspaceManage/*`
  - uses that hook for invite/member-role management
- `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx`
  - uses `canInviteMembers` for the "Invite Teammate" link

What does not exist:

- a generic permission hook for project-scoped actions
- a reusable frontend permission API similar to entitlements
- UI-level hiding for API key settings based on `view_api_keys` or `edit_api_keys`

## 7. Current API Key Frontend Behavior

The API Keys interface is currently visible as a normal settings tab.

Evidence:

- `web/oss/src/components/Sidebar/SettingsSidebar.tsx`
  - always includes `API Keys`
- `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx`
  - always resolves the `apiKeys` tab
- `web/oss/src/components/pages/settings/APIKeys/APIKeys.tsx`
  - always renders list/create/delete controls
  - relies on backend 403s rather than pre-hiding the UI

So the current state is backend-enforced but not frontend-guided.

## 8. Current Role Labels and Defaults in UI Flows

Examples of current role assumptions in the web UI:

- `web/oss/src/components/pages/settings/WorkspaceManage/Modals/InviteUsersModal.tsx`
  - invite default role is `editor`
  - "owner" is filtered out of the picker
- `web/oss/src/components/pages/settings/WorkspaceManage/cellRenderers.tsx`
  - role editing uses the role list returned by the backend

Examples of current role assumptions in backend flows:

- `api/ee/src/services/workspace_manager.py`
  - invite default role is `editor`
- `api/oss/src/services/organization_service.py`
  - legacy invitation flow defaults to `editor`
- `api/ee/src/services/commoners.py`
  - demo role default is `viewer`

## 9. Current Test and Tooling Assumptions

Role names are embedded in test tooling.

Examples:

- `api/run-tests.py`
  - use `owner`, `admin`, `editor`, `viewer`
- `api/pytest.ini`
  - define `role_owner`, `role_admin`, `role_editor`, `role_viewer`
- `web/tests/README.md`
  - exposes `--permission <owner|editor|viewer>`
- `web/tests/playwright/config/testTags.ts`
  - defines `Owner`, `Editor`, `Viewer`

This is already inconsistent with the backend, which still uses `workspace_admin` rather than `admin`.

## 10. Key Observations

- The authoritative RBAC matrix already exists in one place, but role strings are duplicated across many layers.
- API key management is already modeled with `view_api_keys` and `edit_api_keys`; the problem is role assignment and UI visibility, not missing permission primitives.
- The frontend does not yet have the generic project-scoped permission helper implied by the requested `hasPermission(project, role(user))` model.
- Because role values are stored as strings, the database migration is mainly a data migration and compatibility problem, not a type-system problem.
- `workspace_admin` is the largest unresolved role in the requested target model. It is both part of the current RBAC matrix and part of operational flows such as workspace-admin notification emails.
