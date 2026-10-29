# Workspace removal delta

## ADDED Requirements

### Requirement: Projects belong to the organization only
After the contract step, `projects` SHALL have no `workspace_id` column, and `workspaces` and `workspace_members` SHALL NOT exist. The accept step SHALL drop the cascading foreign key from `projects.workspace_id` before any step deletes a workspace row. Shared schema changes SHALL be `core_oss` revisions only.

#### Scenario: Dropping workspace rows
- **WHEN** the contract migration drops the `workspaces` table
- **THEN** no project row SHALL be deleted, and no core table SHALL keep a `workspace_id` column.

### Requirement: Legacy member routes use the M1 mutations
After the switch step, no membership write SHALL create or update a row in `workspaces` or `workspace_members`; a removal SHALL still delete the member's legacy rows until the stop-reading step. `POST /workspaces/{id}/roles/` SHALL call `set_member_role` for organization `{id}`; `DELETE /workspaces/{id}/roles/` SHALL call it with role `viewer`; `DELETE /workspaces/{id}/users/` SHALL call `remove_member`. M4 SHALL add no other mutation method.

#### Scenario: Role change through a legacy route
- **WHEN** an organization owner calls `POST /workspaces/{organization_id}/roles/` to make a member an editor
- **THEN** `set_member_role` SHALL record the editor role, and no `workspace_members` row SHALL be written.

#### Scenario: Removal through a legacy route
- **WHEN** an organization owner calls `DELETE /workspaces/{organization_id}/users/` for a member
- **THEN** `remove_member` SHALL remove the member from the organization and its projects, and SHALL refuse the organization owner.

### Requirement: The organization id answers where a workspace id is expected
Until `/w` is retired, the API SHALL follow CONTRACT.md section 1 and the adapter table in design.md D6, and name fields SHALL follow the id. Until the stop-reading step, a legacy workspace id of the same organization SHALL also be accepted. From the switch step, links that Agenta builds SHALL use `/w/<organization_id>/p/<project_id>`, and responses, HTTP 410 and `AuthScope` SHALL follow design.md D6; the accept step only accepts the ids.

#### Scenario: Project list
- **WHEN** the classic app calls `GET /projects`
- **THEN** each item SHALL have `workspace_id` equal to its `organization_id`.

#### Scenario: Organization details
- **WHEN** the classic app calls `GET /organizations/{id}`
- **THEN** `default_workspace.id` SHALL equal the organization id, and each of its members SHALL carry the organization role.

#### Scenario: Mismatched organization
- **WHEN** a client sends `?workspace_id=<other organization id>&project_id=<project_id>`
- **THEN** authentication SHALL fail with HTTP 401.

#### Scenario: Project whose workspace belongs to another organization
- **WHEN** the switch migration finds a project of organization O1 whose workspace belongs to organization O2
- **THEN** it SHALL clear the project's `workspace_id`, and switch-step authentication SHALL never select that project or sign its credentials through a workspace or organization id of O2.

#### Scenario: Admin delete of a workspace alias
- **WHEN** an administrator deletes, through the admin API, a workspace id that a switch-step pod returned for an organization
- **THEN** Agenta SHALL delete nothing and SHALL NOT delete the organization.

#### Scenario: Invitation accepted through another organization
- **WHEN** a user accepts an invitation of organization O through `/organizations/O/workspaces/<id>/invite/accept` and `<id>` is neither O nor a workspace of O
- **THEN** Agenta SHALL refuse the request as an unknown invitation and SHALL write no membership.

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

#### Scenario: Credential with another organization
- **WHEN** a request carries an organization that is not the organization of its project, for example a run credential minted before the switch migration repaired the project
- **THEN** Agenta SHALL refuse it at the access decision.

#### Scenario: Token for an older pod
- **WHEN** a switch-step pod verifies a token signed by a contract-step pod
- **THEN** it SHALL find a `workspace_id` claim equal to the organization id and build its auth context.

### Requirement: One default project per organization
The switch step SHALL keep `is_default` on one project per organization (the default project of the `default`-type workspace, else of the oldest workspace), clear it on the others, and log each change. Project access SHALL NOT change.

#### Scenario: Two default writers at once
- **WHEN** two requests make two projects of one organization the default at the same time, or one does so while the switch migration runs
- **THEN** exactly one project of the organization SHALL keep `is_default`.

#### Scenario: Organization writes use the same default project
- **WHEN** an API key performs an organization-level write after the switch step
- **THEN** the default project that authorizes it SHALL be the one that the member routes and Bearer authentication select for that organization.

#### Scenario: EE organization with two workspaces
- **WHEN** the switch migration runs on an organization with two workspaces, each with a default project
- **THEN** only the default project of the `default`-type workspace SHALL keep `is_default`, and every member SHALL keep the same project access.

### Requirement: Readers pick one default project until the stop-reading step
From the switch step until the stop-reading step, switch-step readers SHALL pick the default project of an organization by the switch-step order when several projects carry `is_default` (an accept-step pod can set one during the switch rollout), and the stop-reading step SHALL run the same consolidation again.

#### Scenario: A second default written during the switch rollout
- **WHEN** an accept-step pod marks a project of a secondary workspace as default after the switch migration ran
- **THEN** switch-step readers SHALL still answer the default project of the `default`-type workspace, and the stop-reading step SHALL clear the second flag.

### Requirement: Legacy links in the main app are rewritten
`/m` SHALL resolve `/m/w/<segment>/p/<project_id>` by the project id and SHALL replace a segment that is not the project's organization id.

#### Scenario: Bookmark with an old workspace id
- **WHEN** a user opens `/m/w/<old workspace id>/p/<project_id>` for a project they can access
- **THEN** `/m` SHALL open `/m/w/<organization_id>/p/<project_id>`.

#### Scenario: Old bookmark during the switch rollout
- **WHEN** an accept-step pod answers the project's legacy workspace id and a switch-step pod answers its organization id
- **THEN** `/m` SHALL rewrite the segment to the organization id once and SHALL NOT rewrite it again.

### Requirement: Workspace removal is safe with old pods
The removal SHALL ship in four steps (accept, switch, stop reading, contract), each after the previous step runs on every pod. From the stop-reading step, no code SHALL read or write `workspaces`, `workspace_members`, `projects.workspace_id` or `meters.workspace_id`.

#### Scenario: Auth state cached by an accept-step pod
- **WHEN** a switch-step pod serves a Bearer or API key state that an accept-step pod cached with a legacy workspace id
- **THEN** the request SHALL carry the organization id where a workspace id is expected.

#### Scenario: Old pod during the switch rollout
- **WHEN** an accept-step pod receives a request with an organization id from a client served by a switch-step pod
- **THEN** it SHALL accept the id and serve the request.

#### Scenario: Project without a workspace on an accept-step pod
- **WHEN** an accept-step pod serves a project whose `workspace_id` is NULL
- **THEN** authentication SHALL succeed for a member, and every response and run credential SHALL carry the organization id where a workspace id is expected.

#### Scenario: Legacy workspace id of the same organization
- **WHEN** a client sends `?workspace_id=<a workspace of the project's organization>&project_id=<project_id>`
- **THEN** authentication SHALL succeed for a member of the project, and `workspace_id` in the auth context SHALL be the project's stored workspace id when it has one, else the project's organization id.

#### Scenario: Bearer request without parameters
- **WHEN** an accept-step pod selects a default project for a Bearer request with no `project_id` and no `workspace_id`
- **THEN** authentication SHALL require project membership from the resolver for that project, and a refusal SHALL NOT be cached

#### Scenario: Workspace-only Bearer request
- **WHEN** a user sends `?workspace_id=<organization id or legacy workspace id>` without `project_id`
- **THEN** authentication SHALL use the default project of that organization or workspace and SHALL require project membership from the resolver, not a `workspace_members` row.

#### Scenario: Default-project helpers before the switch
- **WHEN** a workspace has projects but no default project on an accept-step pod
- **THEN** the member routes SHALL keep today's project of that workspace and the Bearer workspace-only lookup SHALL use the organization default; the switch step SHALL make both answer the same project before it stops writing workspace rows.
