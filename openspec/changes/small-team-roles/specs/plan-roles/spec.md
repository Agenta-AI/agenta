# Plan roles delta

## ADDED Requirements

### Requirement: Roles apply on every plan
The access check SHALL evaluate the stored role on every edition and plan. No plan SHALL let a member pass a project permission that their role lacks.

#### Scenario: Pro member and billing
- **WHEN** a Pro member calls a route that requires a permission their role lacks
- **THEN** the API SHALL answer 403.

### Requirement: Offered roles
OSS, Hobby and Pro SHALL offer `admin` and `member`. Plans with `Flag.RBAC` SHALL offer every catalog role except `owner`. `GET /access/roles` SHALL return the offered roles. Invite and assign routes SHALL refuse any other role. Removing a role SHALL demote to the plan's default role.

#### Scenario: Pro invite
- **WHEN** an admin opens the invite dialog on Pro
- **THEN** the dialog SHALL list Admin and Member, and an API invite as `viewer` SHALL be refused.

#### Scenario: Default role
- **WHEN** an invite on OSS, Hobby or Pro names no role
- **THEN** the role SHALL be `member`.

### Requirement: Owner changes by transfer
No invite or role change SHALL grant `owner`, on any edition or plan. Ownership SHALL change only through the transfer route. The role route already refuses `owner`. The invite route SHALL refuse it too.

#### Scenario: Assign owner
- **WHEN** a request assigns `owner` through the role route
- **THEN** the API SHALL refuse it.

#### Scenario: Invite as owner
- **WHEN** an invite names `owner`, on any edition or plan
- **THEN** the API SHALL refuse it and SHALL write no invitation.
