# Personal projects delta

## Purpose

Give each user one private project per organization.

## ADDED Requirements

### Requirement: One personal project per organization and user
The system SHALL keep at most one live personal project for each (organization, user) and SHALL create it on first use, idempotently.

#### Scenario: Concurrent first use
- **WHEN** two requests for Alice's personal project arrive at the same time
- **THEN** both SHALL return the same project id.

### Requirement: Owner-only membership
For a personal project, the resolver SHALL return a membership only for a `human` principal that is the owner and a current member of the project's organization, with role `owner`. It SHALL NOT read `project_members`. This rule SHALL run before the organization-owner and EE no-RBAC shortcuts. Invitations and member changes on a personal project SHALL be refused.

#### Scenario: Organization owner
- **WHEN** the organization owner requests Alice's personal project, its agents, sessions, files or traces
- **THEN** every request SHALL be refused.

#### Scenario: EE plan without RBAC
- **WHEN** Bob reads Alice's personal project in an EE organization without the RBAC entitlement
- **THEN** the request SHALL be refused.

#### Scenario: Owner leaves the organization
- **WHEN** a schedule in Alice's personal project fires after Alice left the organization
- **THEN** the schedule SHALL pause, no run SHALL start, and the project data SHALL stay.

#### Scenario: Trace read by a team trace reader
- **WHEN** a user with `VIEW_SPANS` in every team project queries spans with Alice's personal project id
- **THEN** the request SHALL be refused.

### Requirement: New agents start in the personal project
Every create-agent path in `/m` SHALL ensure the creator's personal project and create the agent there.

#### Scenario: Create from a template
- **WHEN** Alice creates an agent from a template in `/m` while a team project is selected
- **THEN** the agent SHALL be created in Alice's personal project.

### Requirement: Personal project listing
`GET /projects` SHALL return the caller's own personal projects with `kind: personal` and no personal project of another user. The `/w` switcher SHALL hide personal projects.

#### Scenario: Project list
- **WHEN** Bob lists his projects
- **THEN** the list SHALL contain Bob's personal project and SHALL NOT contain Alice's.

### Requirement: Personal projects in EE
Usage in a personal project SHALL be metered in its organization. A plan limit on the number of projects SHALL exclude personal projects.

#### Scenario: Usage metering
- **WHEN** Alice's personal agent makes a model call
- **THEN** the usage SHALL count against her organization.
