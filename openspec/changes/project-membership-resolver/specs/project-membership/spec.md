# Project membership

## Purpose

Give one answer to "is this user a member of this project, and with which role", in both editions, without workspaces.

## ADDED Requirements

### Requirement: One resolver decides project membership
`MembershipsService.resolve(user_id, project_id)`, or its uncached entry point `read_membership` (same policy and DAO read), SHALL be the only way the API decides project membership (CONTRACT.md section 2). It SHALL return a `ProjectMembership` or `None`. Permission checks and Bearer selection SHALL call one of them; the project list and fetch SHALL apply the same policy (`list_for_user`, `fetch_for_user`). No caller SHALL read `project_members` or `workspace_members` to decide membership.

#### Scenario: Workspace row deleted
- **WHEN** a member's `workspace_members` row is deleted
- **THEN** `resolve` SHALL return the same membership

### Requirement: The resolver has one uncached entry point
`MembershipsService.read_membership(user_id, project_id)` SHALL use the same policy and DAO read as `resolve`, without its cache. A caller SHALL use it only when another cache stores the result (the Bearer workspace-only and no-parameter branches cache their state).

#### Scenario: Workspace-only Bearer request
- **WHEN** a Bearer request names only a workspace or an organization
- **THEN** authentication SHALL check membership in the selected default project with `read_membership`, and SHALL send no `resolve_membership` cache command

### Requirement: Membership reads keep today's statement count
The project list query SHALL live in the memberships DAO, not in `db_manager.py`. Each membership read SHALL be one SQL statement: `resolve` and the project fetch read one row, and the project list reads all of a user's projects in one statement, whatever their number. A project row SHALL count as a membership by its presence, also when its role is null.

#### Scenario: Project list for a user in many projects
- **WHEN** a user who is a member of 12 projects in 3 organizations lists projects
- **THEN** the list SHALL be read with one SQL statement

### Requirement: Organization membership is required in both editions
`resolve` SHALL return `None` when the user has no `organization_members` row for the project's organization, even when a `project_members` row exists.

#### Scenario: Stale project row
- **WHEN** a user has a `project_members` row but no organization row
- **THEN** `resolve` SHALL return `None`

### Requirement: The edition policies apply as designed
The composition root SHALL build the resolver with `organization_wide` when `is_ee()` is false and `project_rows` when it is true. The resolver SHALL apply the rules of design D2. Core code SHALL NOT branch on the edition anywhere else for membership.

#### Scenario: OSS member without a project row
- **WHEN** an OSS organization member has no row for a project of the organization
- **THEN** `resolve` SHALL return a membership with the organization role and source `organization`

#### Scenario: OSS stale project role
- **WHEN** an OSS member's organization role is `editor` and an old project row says `viewer`
- **THEN** `resolve` SHALL return `editor`

#### Scenario: EE member removed from a project
- **WHEN** an EE organization member has no row for a project
- **THEN** `resolve` SHALL return `None`


### Requirement: The project list and Bearer selection use the resolver
`GET /projects` and `GET /projects/{project_id}` SHALL list the projects for which `resolve` returns a membership, with the resolved role as `user_role`. Bearer `?project_id=` SHALL be accepted only when `is_member` is true. Before the M4b accept step, the workspace-only `?workspace_id=` path SHALL keep its legacy check; from the accept step it SHALL check membership in the selected default project through `read_membership`.

#### Scenario: OSS project created by another member
- **WHEN** another member creates a project in an OSS organization
- **THEN** the user's project list SHALL include it with the user's organization role

#### Scenario: Bearer non-member
- **WHEN** a user who is not a member sends a Bearer request with `?project_id=`
- **THEN** the middleware SHALL answer 401 and SHALL NOT cache the denial

### Requirement: The demo feature is removed
The API SHALL NOT read `AGENTA_DEMOS` or `AGENTA_EXTRAS_DEMOS`, SHALL NOT add a user to a project at signup because of them, and SHALL NOT read or write `project_members.is_demo`. `ProjectMembership`, the project list response and the writers SHALL have no `is_demo` field or argument. The migration deletes the existing demo rows (membership-data-migration).

#### Scenario: Signup with AGENTA_DEMOS set
- **WHEN** `AGENTA_DEMOS` names an existing project and a new user signs up
- **THEN** the user SHALL have no row in that project or in its organization, and that project SHALL NOT be in the user's project list

#### Scenario: Former demo member
- **WHEN** an EE user had only a demo row in a project before the migration
- **THEN** after the migration `resolve` SHALL return `None` for that project

#### Scenario: Demo-only user in either edition
- **WHEN** a user who is not the owner has organization and workspace rows in an organization, and every project row of the user in that organization is a demo row, before the migration
- **THEN** after the migration the user SHALL have no organization, workspace or project row in that organization, `resolve` SHALL return `None` for every project of it in both editions, and a project created there later SHALL NOT seed the user
