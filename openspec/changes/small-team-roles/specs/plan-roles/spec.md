# Plan roles delta

## ADDED Requirements

### Requirement: Roles apply on every plan
The access check SHALL evaluate the stored role on every edition and plan. No plan SHALL let a person pass a project permission that their role lacks.

#### Scenario: Person on Pro and billing
- **WHEN** a person in a Pro organization calls a route that requires a permission their role lacks
- **THEN** the API SHALL answer 403.

### Requirement: Offered roles
OSS, Hobby and Pro SHALL offer `admin` and `member`. Business, Agenta AI and self-hosted Enterprise SHALL offer every catalog role except `owner`. On EE, `Flag.RBAC` SHALL decide which list a plan gets. `GET /access/roles` SHALL return the offered roles. Invite and assign routes SHALL refuse any other role. The floor role is the role an invite gets when it names no role, and the role that removing a role writes. It SHALL be `member` on OSS, Hobby and Pro, and `viewer` on plans with `Flag.RBAC`.

#### Scenario: Pro invite
- **WHEN** an admin opens the invite dialog on Pro
- **THEN** the dialog SHALL list Admin and Member, and an API invite as `viewer` SHALL be refused.

#### Scenario: Floor role on Pro
- **WHEN** an invite on OSS, Hobby or Pro names no role
- **THEN** the role SHALL be `member`.

#### Scenario: Floor role on Business
- **WHEN** an admin on Business removes a person's role
- **THEN** the role SHALL be `viewer`.

### Requirement: Owner changes by transfer
No invite or role change SHALL grant `owner`, on any edition or plan. Ownership SHALL change only through the transfer route. The role route already refuses `owner`. The invite route SHALL refuse it too.

#### Scenario: Assign owner
- **WHEN** a request assigns `owner` through the role route
- **THEN** the API SHALL refuse it.

#### Scenario: Invite as owner
- **WHEN** an invite names `owner`, on any edition or plan
- **THEN** the API SHALL refuse it and SHALL write no invitation.

### Requirement: Resend checks the role
Resending an invitation SHALL run the offered-role check that invite runs, before the API creates an invitation or sends an email. The API SHALL answer 400 for a role the plan does not offer, `owner` included, and 503 when the plan cannot be read. Resend SHALL NOT change the seat gauge.

#### Scenario: Resend an owner invitation
- **WHEN** an admin resends an invitation stored as `owner`
- **THEN** the API SHALL answer 400, SHALL create no invitation and SHALL send no email.

#### Scenario: Resend with the plan unreadable
- **WHEN** an admin resends an invitation and the plan cannot be read
- **THEN** the API SHALL answer 503.

### Requirement: Accepting an owner invitation
Accepting an unused invitation stored as `owner` SHALL grant `admin`. Only the transfer route SHALL grant `owner`. Accepting an invitation with any other stored role SHALL grant that role as stored.

#### Scenario: Accept an owner invitation
- **WHEN** a person accepts an unused invitation stored as `owner`
- **THEN** the person SHALL become `admin`.

#### Scenario: Accept an old viewer invitation on OSS
- **WHEN** a person accepts an invitation stored as `viewer` on OSS
- **THEN** the person SHALL become `viewer`.

### Requirement: Plan without a subscription
An EE organization with no subscription, or with an undefined plan, SHALL be offered every catalog role except `owner`, and its floor role SHALL be `viewer`.

#### Scenario: Organization without a subscription
- **WHEN** an admin opens the invite dialog for an EE organization with no subscription
- **THEN** the dialog SHALL list every role except Owner, and an invite with no role SHALL get `viewer`.
