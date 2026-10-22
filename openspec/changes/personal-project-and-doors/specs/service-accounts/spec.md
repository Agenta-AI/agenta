# Service accounts delta

## Purpose

Give API keys and installations a non-human owner.

## ADDED Requirements

### Requirement: Service account principal
`PrincipalKind` SHALL include `service_account`. A service account SHALL belong to one team project with one role. The resolver SHALL treat it as a member of that project only, with its stored role and no shortcut. A deleted service account SHALL have no access. Service accounts, service keys and installations SHALL NOT be created in a personal project.

#### Scenario: Own role
- **WHEN** a service account with role `viewer` calls an edit route in its project
- **THEN** the request SHALL be refused with 403.

#### Scenario: Other project
- **WHEN** a service account calls a route in another project of its organization
- **THEN** the request SHALL be refused.

### Requirement: Personal and service API keys
Every API key SHALL have an owner principal: its user (personal key) or a service account (service key). A personal key SHALL act within its user's current membership and role in the key's project. The key creator SHALL be audit only. Resources created with a personal key SHALL have no owner. Every organization-scoped decision SHALL refuse a personal key. A key request SHALL carry the key as `RunAuthority.source`, `origin = api` and the key id as `origin_id`.

#### Scenario: Personal key after removal
- **WHEN** Bob's personal key is used after Bob was removed from the key's project
- **THEN** the request SHALL be refused.

#### Scenario: Service key after its creator leaves
- **WHEN** a service key created by Alice is used after Alice left the organization
- **THEN** the request SHALL succeed with the service account's role.

#### Scenario: Personal key of an organization admin
- **WHEN** an organization admin's personal key calls an organization credential route
- **THEN** the request SHALL be refused.

### Requirement: Authentication source liveness
`RunAuthority.source` SHALL NOT grant access. Before a stored authority is used (schedule or subscription dispatch, evaluation dispatch, queued input or command, approval resume), the server SHALL refuse it when its source key is deleted or expired, or its source binding or connection is inactive.

#### Scenario: Deleted key behind a schedule
- **WHEN** the service key that created a schedule is deleted before the schedule fires
- **THEN** the schedule SHALL pause and no run SHALL start.

### Requirement: Installations owned by a service account
Every channel connection SHALL reference a service account in its project. An installation turn SHALL run as that service account, with the binding as source and as `origin_id`, and with the M2 installation restrictions.

#### Scenario: Slack turn
- **WHEN** a Slack user writes to an installed agent
- **THEN** the turn SHALL run as the connection's service account, limited to the bound agent.

### Requirement: One-time account creation
The migration SHALL create one service account per (project, creator of a non-hidden key) with the creator's effective role, and one installation service account per project with installations. It SHALL revoke and report keys whose creator has no access, and SHALL write the report before it changes access.

#### Scenario: CI key after migration
- **WHEN** a CI key created by an editor is used after the migration
- **THEN** the request SHALL succeed with editor capabilities as the new service account.

### Requirement: Stored references rewritten
The migration SHALL rewrite every stored M2 reference of kind `api_key` or `installation` (schedules, subscriptions, evaluation runs, queued inputs and commands, parked interactions, turns) by the design's mappings, keeping the key or binding as source. After none remains and Secret tokens signed with an M2 kind can no longer be valid, `PrincipalKind` SHALL be `human | service_account`.

#### Scenario: Hidden key
- **WHEN** a schedule's stored principal is a hidden key
- **THEN** after the migration its principal SHALL be the key creator as `human`, with the key as source.

#### Scenario: Parked approval across the migration
- **WHEN** an approval parked by an installation run is answered after the migration
- **THEN** the resumed run SHALL carry the installation service account and the binding as source.

### Requirement: Service account management
Members with `MANAGE_SERVICE_ACCOUNTS` SHALL manage service accounts and their keys. Deleting a service account SHALL revoke its keys in the same transaction.

#### Scenario: Delete revokes keys
- **WHEN** an admin deletes a service account that has two keys
- **THEN** both keys SHALL be refused on their next use.
