# Role migration delta

## ADDED Requirements

### Requirement: Existing people on Hobby and Pro become admins
A data migration SHALL set role `admin` on organization and project membership rows and unused invitations of organizations on the Hobby and Pro plans, when the role is not `owner`, `admin` or `member`, or is null.

#### Scenario: Old viewer on Pro
- **WHEN** a person in a Pro organization stored as `viewer` uses the product after the migration
- **THEN** they SHALL be an admin and SHALL keep traces, analytics and evaluations.

#### Scenario: Business organization
- **WHEN** the migration runs
- **THEN** rows of organizations on other plans SHALL NOT change.

### Requirement: Stray owners become admins
On every EE plan, the data migration SHALL set role `admin` on organization and project membership rows whose role is `owner` and whose user is not the organization owner (`organizations.owner_id`), and on unused invitations whose role is `owner`. The organization owner's rows SHALL keep `owner`.

#### Scenario: Invited owner on Business
- **WHEN** a person on Business who is not the organization owner has a stored `owner` role and the migration runs
- **THEN** their role SHALL be `admin`, and they SHALL no longer delete projects.

#### Scenario: Real owner
- **WHEN** the migration runs
- **THEN** the rows of `organizations.owner_id` SHALL keep role `owner`.

### Requirement: OSS keeps its rows
OSS SHALL have no role migration. Old OSS rows SHALL keep their role names and permissions, `owner` rows included.

#### Scenario: Old viewer on OSS
- **WHEN** a stored viewer on OSS reads a project after the upgrade
- **THEN** they SHALL keep exactly the viewer permissions.
