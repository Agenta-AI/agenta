# Workspace removal delta

## ADDED Requirements

### Requirement: Projects belong to the organization only
After the contract step, `projects` SHALL have no `workspace_id` column, and `workspaces` and `workspace_members` SHALL NOT exist. The accept step SHALL drop the cascading foreign key from `projects.workspace_id` before any step deletes a workspace row. Shared schema changes SHALL be `core_oss` revisions only.

#### Scenario: Dropping workspace rows
- **WHEN** the contract migration drops the `workspaces` table
- **THEN** no project row SHALL be deleted, and no core table SHALL keep a `workspace_id` column.

### Requirement: Legacy member routes use the M1 mutations
After the switch step, no membership write SHALL touch `workspaces` or `workspace_members`. `POST /workspaces/{id}/roles/` SHALL call `set_member_role` for organization `{id}`; `DELETE /workspaces/{id}/roles/` SHALL call it with role `viewer`; `DELETE /workspaces/{id}/users/` SHALL call `remove_member`. M4 SHALL add no other mutation method.

#### Scenario: Role change through a legacy route
- **WHEN** an organization owner calls `POST /workspaces/{organization_id}/roles/` to make a member an editor
- **THEN** `set_member_role` SHALL record the editor role, and no `workspace_members` row SHALL be written.

#### Scenario: Removal through a legacy route
- **WHEN** an organization owner calls `DELETE /workspaces/{organization_id}/users/` for a member
- **THEN** `remove_member` SHALL remove the member from the organization and its projects, and SHALL refuse the organization owner.

### Requirement: The organization id answers where a workspace id is expected
Until `/w` is retired, the API SHALL follow CONTRACT.md section 1 and the adapter table in design.md D6, and name fields SHALL follow the id. Until the contract step, a legacy workspace id of the same organization SHALL also be accepted. Links that Agenta builds SHALL use `/w/<organization_id>/p/<project_id>`.

#### Scenario: Project list
- **WHEN** the classic app calls `GET /projects`
- **THEN** each item SHALL have `workspace_id` equal to its `organization_id`.

#### Scenario: Organization details
- **WHEN** the classic app calls `GET /organizations/{id}`
- **THEN** `default_workspace.id` SHALL equal the organization id, and each of its members SHALL carry the organization role.

#### Scenario: Mismatched organization
- **WHEN** a client sends `?workspace_id=<other organization id>&project_id=<project_id>`
- **THEN** authentication SHALL fail with HTTP 401.

### Requirement: The workspace role scope stays for the classic app
Until `/w` is retired, the role catalog SHALL keep the `workspace` scope, and `GET /access/roles`, `GET /workspaces/roles/` and `GET /workspaces/permissions/` SHALL keep their responses.

#### Scenario: Invite modal roles
- **WHEN** the classic invite modal reads the `workspace` key of `GET /access/roles`
- **THEN** it SHALL receive the same role list as before the change.

### Requirement: Workspace create and rename are unsupported
`POST /organizations/{org}/workspaces/` and `PUT /organizations/{org}/workspaces/{ws}` SHALL return HTTP 410 with the message "Workspaces were removed. Projects belong to the organization." They SHALL NOT create a project or rename the organization.

#### Scenario: Rename through the workspace route
- **WHEN** a client calls `PUT /organizations/{org}/workspaces/{org}` with a new name
- **THEN** Agenta SHALL return HTTP 410, and the organization name SHALL NOT change.

### Requirement: Run credentials carry no workspace in core
`AuthScope` SHALL have no `workspace_id`. Signed tokens SHALL keep a `workspace_id` claim equal to the organization id while `/w` lives. Readers SHALL ignore it after the contract step.

#### Scenario: Token for an older pod
- **WHEN** a switch-step pod verifies a token signed by a contract-step pod
- **THEN** it SHALL find a `workspace_id` claim equal to the organization id and build its auth context.

### Requirement: One default project per organization
The switch step SHALL keep `is_default` on one project per organization (the default project of the `default`-type workspace, else of the oldest workspace), clear it on the others, and log each change. Project access SHALL NOT change.

#### Scenario: EE organization with two workspaces
- **WHEN** the switch migration runs on an organization with two workspaces, each with a default project
- **THEN** only the default project of the `default`-type workspace SHALL keep `is_default`, and every member SHALL keep the same project access.

### Requirement: Legacy links in the main app are rewritten
`/m` SHALL resolve `/m/w/<segment>/p/<project_id>` by the project id and SHALL replace a segment that is not the project's organization id.

#### Scenario: Bookmark with an old workspace id
- **WHEN** a user opens `/m/w/<old workspace id>/p/<project_id>` for a project they can access
- **THEN** `/m` SHALL open `/m/w/<organization_id>/p/<project_id>`.

### Requirement: Workspace removal is safe with old pods
The removal SHALL ship in three steps (accept, switch, contract), each after the previous step runs on every pod.

#### Scenario: Old pod during the switch rollout
- **WHEN** an accept-step pod receives a request with an organization id from a client served by a switch-step pod
- **THEN** it SHALL accept the id and serve the request.
