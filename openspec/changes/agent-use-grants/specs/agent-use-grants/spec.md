## ADDED Requirements

### Requirement: No use grants until designed
Until a later change defines the granted-execution context, the session-to-grant linkage, and the runtime operations of a granted run, the system SHALL NOT let a principal that is not a member of a project run, read, or continue that project's agents or sessions through any grant mechanism.

#### Scenario: Marketing member addresses a Sales agent
- **WHEN** a Marketing member who is not a Sales member tries to start a session with a Sales agent
- **THEN** the system SHALL refuse the request with `not_member`
