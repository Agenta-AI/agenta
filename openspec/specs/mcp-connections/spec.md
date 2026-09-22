# MCP connections

## Purpose

Describe the project-scoped Model Context Protocol (MCP) connection flow present on `main` at `5e36059503e8bb76500a7cec2caf5cb86e8ee01d`. MCP lets an agent discover and call tools on an external server. This is a bounded baseline, not a claim that every provider works. Proposed changes live under `openspec/changes/` until implemented and accepted.

## Requirements

### Requirement: Enter a server address
Agenta SHALL begin a new MCP connection by asking for an HTTP server URL. It SHALL probe that address before choosing an authorization screen. Settings, agent configuration, and in-chat connect requests SHALL share the connect journey.

#### Scenario: Add an unknown server
- **WHEN** a person starts a new MCP connection
- **THEN** the journey requests a server URL
- **AND** the probe distinguishes OAuth, no authentication, and inconclusive authentication without treating every authorization challenge as an API key requirement.

### Requirement: Preserve project connection identity
Agenta SHALL store connections in the current project with a stable identifier and slug. Agent configuration SHALL reference a connection rather than embed its credential value. Multiple connections to the same server SHALL retain separate OAuth grants.

#### Scenario: Connect two accounts
- **WHEN** two endpoints in one project authorize accounts at the same server
- **THEN** each endpoint has its own grant reference
- **AND** disconnecting one does not remove the other's grant.

### Requirement: Support manual header authentication
Agenta SHALL allow a person to select a named project secret and an HTTP header for manual authentication. The credential check SHALL distinguish rejection from network failure before reporting readiness.

#### Scenario: A token is refused
- **WHEN** the server returns an authentication failure to the credentialed check
- **THEN** the journey reports that refusal
- **AND** it does not label the connection ready.

### Requirement: Keep connection writes authorized
Agenta SHALL check project permissions before creating, connecting, disconnecting, or deleting an endpoint. OAuth callbacks SHALL be bound to the initiating person, project, and endpoint through a single-use expiring attempt.

#### Scenario: A different person presents a callback
- **WHEN** a callback does not belong to the authenticated person
- **THEN** the backend refuses it before exchanging an authorization code or writing a grant.
