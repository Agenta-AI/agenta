# Membership data migration

## Purpose

Count who changes access, give the rows the new rules need, block the release only on duplicate rows, and define edition switches.

## ADDED Requirements

### Requirement: The report lists access changes and does not write
`entrypoints/memberships_check.py --report` SHALL list P1 to P12 of design D6 per organization with ids and SHALL NOT write. It SHALL run from a checkout of the release branch; no deploy of the script SHALL be needed. P3 and P4 SHALL be reported only; the owner accepted the wider access.

#### Scenario: Multi-workspace organization
- **WHEN** an EE organization has two workspaces
- **THEN** the report SHALL list it under P4, and the migration and `--apply` SHALL proceed

#### Scenario: User without a workspace row
- **WHEN** an EE user has organization and project rows but no workspace row
- **THEN** the report SHALL list the user under P3

### Requirement: The migration repairs owner access and deletes demo rows
A `core_oss` data revision SHALL remove demo-only users from their organization, SHALL delete the `project_members` rows with `is_demo = true`, SHALL add an `owner` organization row for each organization owner without one (P1), SHALL add an `owner` project row for the organization owner in every project of the organization without one (P2a), and SHALL copy the workspace role into the organization role in single-workspace organizations, never for the owner (P6). It SHALL be idempotent.

#### Scenario: Owner without rows
- **WHEN** an organization owner has no organization row and no row in one project
- **THEN** after the revision the owner SHALL have both rows with role `owner` and SHALL be allowed in that project

#### Scenario: Demo rows deleted
- **WHEN** a user has a `project_members` row with `is_demo = true`
- **THEN** after the revision the row SHALL NOT exist

#### Scenario: Demo-only user loses the organization
- **WHEN** a user who is not the owner has organization and workspace rows and only demo project rows in an organization
- **THEN** after the revision the user SHALL have no organization or workspace row in that organization

#### Scenario: Mixed demo and real user keeps the organization
- **WHEN** a user has a demo row in one project and a real row in another project of the organization
- **THEN** after the revision the user SHALL keep the organization row, the workspace row and the real project row

#### Scenario: Role changed through the workspace endpoint
- **WHEN** a member was invited as `viewer` and later made `editor` through the workspace role endpoint
- **THEN** after the revision their organization role SHALL be `editor`

### Requirement: Apply adds the EE no-RBAC rows and removes duplicates
`--apply` SHALL delete every row of a duplicate `(project_id, user_id)` group of non-demo rows except the oldest by `(created_at, id)`, printing each deleted row with its role, and SHALL leave demo rows unchanged (the data revision deletes them). It SHALL then add the P2b rows, never for a user with a demo row in that organization, and only while the data revision has not run. It SHALL be idempotent. Per-member work in the script SHALL page and SHALL NOT assume small organizations.

#### Scenario: No-RBAC member without a row
- **WHEN** an EE workspace member of an organization without the RBAC entitlement has no row for a project and passes today
- **THEN** after `--apply` the member SHALL have a row with the workspace role and SHALL still pass

#### Scenario: P2b role in an organization with several workspaces
- **WHEN** a P2b row is added for a project in one of several workspaces
- **THEN** the row SHALL carry the role of the user's oldest row in that project's workspace

#### Scenario: Demo row and real row for one project
- **WHEN** a user has a demo row and a real row for one project, in either timestamp order, and `--apply` runs before the migration
- **THEN** after `--apply` and the migration the real row SHALL remain

#### Scenario: Rerun cannot restore demo access
- **WHEN** a former demo user of an EE organization without the RBAC entitlement has organization and workspace rows, `--apply` runs twice, the migration runs, and `--apply` runs again
- **THEN** the user SHALL have no project row in that organization

#### Scenario: Oldest duplicate kept
- **WHEN** a user has two rows for one project
- **THEN** after `--apply` only the row with the earliest `(created_at, id)` SHALL remain

### Requirement: Membership rows are unique
A revision SHALL create a unique index on `project_members (project_id, user_id)` concurrently. It SHALL stop with an instruction that names `--apply` while duplicates exist. The duplicate check SHALL run before the index build, so duplicates never leave an invalid index behind; if a build fails for another reason, the revision SHALL fail on the invalid index with an instruction that names `REINDEX INDEX CONCURRENTLY`, and a rerun SHALL leave a valid index.

#### Scenario: Duplicate rows stop the upgrade
- **WHEN** duplicate rows exist at upgrade time
- **THEN** the revision SHALL fail, no new pod SHALL start, and the error SHALL name the `--apply` command

#### Scenario: Duplicate insert
- **WHEN** a writer inserts a second row for the same user and project
- **THEN** the database SHALL reject it and the DAO SHALL treat the member as existing

### Requirement: OSS to EE conversion materializes the effective role
The switch runbook SHALL run `--materialize` after the EE adoption revision. The EE to OSS runbook SHALL state the access expansion.

#### Scenario: Stale row corrected
- **WHEN** an OSS user has organization role `editor` and a stale project row `viewer`, and the deployment switches to EE
- **THEN** after `--materialize` the row SHALL be `editor`

#### Scenario: EE to OSS
- **WHEN** an EE deployment switches to OSS
- **THEN** members without a row in a team project SHALL gain access with their organization role, and the runbook SHALL say so
