# Role management delta

## ADDED Requirements

### Requirement: Members tab shows and changes roles
The /m Members tab SHALL show each person's role, read from `organization_members.role`. Every role write SHALL update `organization_members.role` and `project_members.role` together, as `set_member_role` and the migration do. A person with `MODIFY_USER_ROLES` SHALL be able to change a role to any offered role. The owner row SHALL have no control.

#### Scenario: Owner demotes a migrated admin
- **WHEN** an owner changes a migrated admin to Member
- **THEN** the next trace read by that person SHALL answer 403.

### Requirement: Docs match behavior
The access control docs SHALL describe the roles each plan offers, that roles apply on every plan, and how to change a role in the app.

#### Scenario: Reader checks Pro
- **WHEN** a reader looks up roles on Pro
- **THEN** the docs SHALL say that Pro has the roles Owner, Admin and Member, that only Admin and Member can be invited or assigned, and that Owner changes only by transfer.
