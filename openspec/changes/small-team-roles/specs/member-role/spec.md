# Member role delta

## ADDED Requirements

### Requirement: Member permissions
The `member` role SHALL have the `developer` permissions without `VIEW_SPANS`, `VIEW_INVOCATIONS`, `EDIT_INVOCATIONS`, `VIEW_ANNOTATIONS`, `EDIT_ANNOTATIONS` and every evaluation permission. It SHALL keep `EDIT_SPANS` and `VIEW_BILLING`. It SHALL add `CREATE_WORKSPACE` and `EDIT_WORKSPACE`, so a Member creates and renames projects. It SHALL NOT have `DELETE_WORKSPACE`. `member` SHALL exist in the organization, workspace and project scopes, with no permissions at organization scope. An `AGENTA_ACCESS_ROLES` override SHALL NOT remove or rebind it. Its description SHALL say that it cannot read traces, analytics or evaluations.

#### Scenario: Member runs an agent
- **WHEN** a Member sends a chat message to an agent they may use
- **THEN** the run SHALL complete, its spans SHALL be stored, and the turn SHALL show tokens and cost.

#### Scenario: Members tab shows the role
- **WHEN** an admin opens the Members tab and a person has role `member`
- **THEN** the row SHALL show the Member description, not an error text.

#### Scenario: Member sets up a project
- **WHEN** a Member creates a project or renames one
- **THEN** the API SHALL allow it, and SHALL answer 403 when the Member deletes a project.

#### Scenario: Member asks for a trace
- **WHEN** a Member reads a span, a trace, analytics, or an invocation or annotation by trace id
- **THEN** the API SHALL answer 403.

#### Scenario: Member starts an evaluation
- **WHEN** a Member reads or starts an evaluation
- **THEN** the API SHALL answer 403.

### Requirement: Other roles keep trace access
Owner, admin and developer SHALL keep `VIEW_SPANS`. Admin SHALL gain `EDIT_BILLING`. No other existing catalog role SHALL change.

#### Scenario: Developer debugs
- **WHEN** a developer on Business reads a trace
- **THEN** the API SHALL return it.

### Requirement: Billing
Owner and admin SHALL edit billing. Every role SHALL keep `VIEW_BILLING`, because credit balances are read under it.

#### Scenario: Admin changes the plan
- **WHEN** an admin opens the billing portal
- **THEN** the API SHALL allow it, and a Member SHALL get 403.
