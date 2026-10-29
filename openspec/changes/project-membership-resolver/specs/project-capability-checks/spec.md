# Project capability checks

## Purpose

Turn a project membership into a capability decision in one core service, with today's shortcuts, without workspaces or `db_manager`.

## ADDED Requirements

### Requirement: check_action_access keeps its signature
`check_action_access(user_uid, project_id=None, permission=None, role=None)` SHALL keep its signature, argument validation and return type. It SHALL pass a `Permission` or a `RoleRequirement` to `AccessService.check_capability` and return `Decision.allowed`. In M1, its existing cache SHALL stay under today's keys and SHALL hold only this capability result. M2 deletes this cache; from M2, no cache stores a decision (CONTRACT.md section 6). No call site SHALL change.

#### Scenario: Role check
- **WHEN** a handler calls `check_action_access(..., role=RequiredRole.ADMIN)`
- **THEN** `check_capability` SHALL receive `RoleRequirement(role="admin")` and the handler SHALL receive a boolean

### Requirement: Eligibility comes before every shortcut
`check_capability` SHALL deny with `not_member` when `resolve` returns `None`. The EE no-RBAC shortcut, the organization-owner shortcut and the project `owner` role SHALL apply only to a member, in that order, before the role catalog. Other denials SHALL use `missing_capability`.

#### Scenario: Organization owner without membership
- **WHEN** the organization owner has no organization row
- **THEN** the decision SHALL deny with `not_member`

#### Scenario: No-RBAC organization and a non-member
- **WHEN** an EE organization has no RBAC entitlement and the user is not a project member
- **THEN** the decision SHALL deny with `not_member`

#### Scenario: Project row with a null role
- **WHEN** an EE member's project row has a null role
- **THEN** the member SHALL be a member, the no-RBAC and organization-owner shortcuts SHALL apply, and every other role or permission check SHALL deny with `missing_capability`

#### Scenario: EE custom role
- **WHEN** `AGENTA_ACCESS_ROLES` gives a custom role a permission and an EE member has that role on the project
- **THEN** the decision SHALL allow that permission

### Requirement: Organization roles map to project capabilities by slug
For a membership with source `organization`, the decision SHALL evaluate the role slug in the `project` scope catalog. An undefined slug SHALL give no permissions and SHALL be logged.

#### Scenario: OSS organization viewer
- **WHEN** an OSS member has the organization role `viewer`
- **THEN** the decision SHALL use the project-scope `viewer` permissions

### Requirement: The new access core has a clean import boundary
The new modules of design "Interfaces" SHALL NOT import `db_manager`, `oss.src.models` or `ee.*`; the RBAC entitlement SHALL come through `RbacEnforcementInterface`. The guarded custom-role import in `controls.py` SHALL stay.

#### Scenario: Import check
- **WHEN** a test inspects the imports of the new modules
- **THEN** it SHALL find no `db_manager`, `oss.src.models` or `ee.` import

### Requirement: Every process wires the access service
Each process that calls `check_action_access` SHALL register one `AccessService` at startup. A call without a registered service SHALL raise.

#### Scenario: Worker without wiring
- **WHEN** a worker calls `check_action_access` before registration
- **THEN** the call SHALL raise and SHALL NOT allow

### Requirement: Project create, update and delete check a permission
`POST /projects` SHALL check `CREATE_WORKSPACE` on the default project of the request's workspace. `PATCH /projects/{id}` SHALL check `EDIT_WORKSPACE` and `DELETE /projects/{id}` SHALL check `DELETE_WORKSPACE`, both on the target project. Each check SHALL go through `check_action_access` (design D5a). A denied check SHALL answer 403 and SHALL write nothing.

#### Scenario: Viewer creates a project
- **WHEN** an organization member with the `viewer` role calls `POST /projects`
- **THEN** the request SHALL be refused with 403 and no project SHALL be created

#### Scenario: Editor renames a project
- **WHEN** a member with the `editor` role calls `PATCH /projects/{id}` with a new name
- **THEN** the request SHALL be refused with 403 and the name SHALL be unchanged

#### Scenario: Admin deletes a project
- **WHEN** an organization admin calls `DELETE /projects/{id}`
- **THEN** the request SHALL be refused with 403

### Requirement: Project routes keep the tenant checks
Create SHALL put the project in the request's organization and workspace, and SHALL answer 400 for a workspace outside the organization. Update and delete SHALL answer 404 when the resolver finds no membership in the target. Delete SHALL also keep today's check that the target is in the request's workspace.

#### Scenario: Non-member updates a project
- **WHEN** a user who is not a member of the target project calls `PATCH /projects/{id}` or `DELETE /projects/{id}`
- **THEN** the request SHALL be refused with 404
