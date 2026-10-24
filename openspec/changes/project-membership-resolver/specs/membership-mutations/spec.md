# Membership mutations

## Purpose

Write memberships through the service writers, with defined meanings for the legacy endpoints, and never re-add removed rows or change rows outside the requested write.

## ADDED Requirements

### Requirement: Memberships are written only through the service writers
`MembershipsDAOInterface` SHALL expose `set_member_role`, `remove_member`, `create_project` and `transfer_ownership` as its only writes, each in one transaction under a per-organization lock, with the semantics of design D4. `sync_workspace_members_to_project` and the `db_manager` membership writers SHALL be removed.

#### Scenario: Role change after a removal in EE
- **WHEN** an admin tool removed an EE user's row from one project and the user's role is later changed
- **THEN** the removed row SHALL stay removed

#### Scenario: Missing project row in EE
- **WHEN** an EE member has rows in two of three projects and an admin assigns `editor`
- **THEN** the two rows SHALL become `editor` and no third row SHALL be created

#### Scenario: Invite accept
- **WHEN** a user accepts an invitation with role `annotator`
- **THEN** the organization row, the workspace mirror row and a row in every team project of the organization SHALL carry `annotator`

#### Scenario: Remove the organization owner
- **WHEN** a caller removes the organization owner
- **THEN** `remove_member` SHALL refuse and change nothing

### Requirement: Project creation and seeding are one operation
`create_project` SHALL insert the project and one row per current organization member with the organization role in one transaction. A failure SHALL leave neither the project nor any row. `POST /projects` and the default project of a new workspace SHALL both use it.

#### Scenario: EE project creation
- **WHEN** an EE member creates a project in an organization with five members
- **THEN** the project SHALL have five rows, each with that member's organization role

#### Scenario: New workspace
- **WHEN** the organization owner creates a workspace in an organization with three members
- **THEN** the workspace's default project SHALL have three rows, each with the member's organization role

#### Scenario: Seeding fails
- **WHEN** the row insert fails after the project insert
- **THEN** the project SHALL NOT exist

### Requirement: Ownership transfer seeds the new owner
`transfer_ownership` SHALL, in one transaction, swap the two users' organization and workspace roles, swap their project roles in every project where both have a row (the rule of the admin transfer tool), insert an `owner` row for the new owner in every project of the organization where the new owner has no row, and set `organizations.owner_id`. The service SHALL then invalidate the access caches of both users for every project of the organization.

#### Scenario: New owner without project rows
- **WHEN** ownership of an EE organization moves to a member who has no row in one project
- **THEN** the new owner SHALL have an `owner` row in that project and SHALL be allowed there at once

#### Scenario: Former owner's project roles swap
- **WHEN** the former owner has an `owner` row and the new owner an `editor` row in one project
- **THEN** after the transfer the new owner SHALL have `owner` and the former owner `editor` there, as with the admin transfer tool

#### Scenario: Transfer fails
- **WHEN** a step of the transfer fails
- **THEN** `owner_id`, the roles and the project rows SHALL be unchanged

### Requirement: Legacy endpoints authorize through check_action_access
The legacy role, remove and update-workspace endpoints SHALL authorize with `check_action_access` on the workspace's default project and SHALL NOT read workspace membership.

#### Scenario: Remove by a non-admin
- **WHEN** a user without the admin role calls the remove endpoint
- **THEN** the endpoint SHALL answer 403

### Requirement: Mutations invalidate the access caches
After each writer commits, the service SHALL invalidate the `check_action_access`, `verify_bearer_token` and `resolve_membership` caches for each affected user and every project of the organization, through the one helper `invalidate_access_caches`, as in design D8.

#### Scenario: Role change takes effect
- **WHEN** an admin changes a member's role
- **THEN** the member's next decision SHALL use the new role

#### Scenario: Admin add clears a cached denial
- **WHEN** a user's denied check is cached and an admin tool adds the user's membership
- **THEN** the user's next check SHALL use the new membership

#### Scenario: Removal clears the membership cache
- **WHEN** a member with a cached `resolve_membership` entry is removed from the organization
- **THEN** `invalidate_access_caches` SHALL delete that entry for the member in every project of the organization

### Requirement: Mutations are logged without secrets
Each writer SHALL log one structured event with the organization id, the actor user id, its subject and the changed role or count. The subject is the target user id for `set_member_role` and `remove_member` (absent when only invitations were removed, with the invitation count instead), the new project id and the seeded row count for `create_project`, and the previous and new owner ids for `transfer_ownership`. The event SHALL NOT contain an email address or a credential value.

#### Scenario: Role change logged
- **WHEN** an admin changes a member's role
- **THEN** the log SHALL hold one `[memberships] role set` event with ids and roles, and no email
