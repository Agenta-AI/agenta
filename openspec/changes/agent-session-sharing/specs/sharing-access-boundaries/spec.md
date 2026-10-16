## ADDED Requirements

### Requirement: Mandatory resource checks
Core services SHALL combine project capabilities with agent/session access. OSS and EE SHALL apply resource checks independently of entitlement or owner shortcuts.

#### Scenario: EE broad project grant
- **WHEN** project capability evaluation returns true through an entitlement or owner shortcut
- **THEN** the resource service SHALL still enforce the agent/session policy.

#### Scenario: List and direct read
- **WHEN** the same actor lists resources and fetches one by ID
- **THEN** the list predicate and direct-read decision SHALL agree before counts and pagination.

#### Scenario: Background execution
- **WHEN** a worker resumes a queued run after access is removed
- **THEN** the worker SHALL recheck authority before dispatch and before its next sensitive external action.

#### Scenario: Subagent
- **WHEN** an authorized run calls a second agent
- **THEN** the call SHALL require use of the called agent and SHALL NOT inherit its creator's general authority.

### Requirement: Layer ownership
Routers SHALL pass authenticated context; core SHALL decide access; DAOs SHALL apply SQL filters from typed read scopes. Generic updates SHALL NOT write access policy.

#### Scenario: Concurrent sharing update
- **WHEN** two users submit ownership or visibility changes
- **THEN** the service SHALL use a transaction and lock or version check to prevent stale authorization from overwriting newer policy.

#### Scenario: Future custom roles
- **WHEN** EE later supplies stored custom role definitions
- **THEN** resource services SHALL consume the existing capability resolver contract rather than hard-coded role names.

#### Scenario: Membership sync
- **WHEN** legacy synchronization runs after an explicit membership removal
- **THEN** it SHALL NOT restore that access or overwrite a deliberate role assignment.
