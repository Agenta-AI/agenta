# Slack agent deployment

## Purpose

Describe the agent-page connection controls in PR #6737 at `658d6f5edae34d861d141a38604ef7a12a7b69c8`. This user interface is more restrictive than the backend's multiple-agent relationship. See [source evidence](../../evidence.md).

## Requirements

### Requirement: Agent-page connection action
The agent page SHALL select a connection's default active channel agent, or its first active agent. Connecting the page's agent SHALL create a default channel agent when none exists, do nothing when its reference already matches, or retarget the selected channel agent's application reference when it differs.

#### Scenario: First agent
- **WHEN** the connection has no active channel agent
- **THEN** the action SHALL create a channel agent with slug `default`, the page's application reference, and the default flag.

#### Scenario: Connect another agent
- **WHEN** the selected channel agent references a different application
- **THEN** the action SHALL edit that row's reference rather than add a second channel agent.

### Requirement: Connection presentation
Desktop and mobile SHALL use the shared channel actions. The agent page SHALL present one chosen connection row per platform. Ranking SHALL prefer a connection answering as the current application before comparing connection status.

#### Scenario: Several Slack connections are returned
- **WHEN** the shared actions reload multiple Slack connections
- **THEN** they SHALL collapse them to one Slack row using the configured ranking.

### Requirement: Agent-page permission controls
The agent-page direct-message and group controls SHALL read and modify grants for the selected answering channel agent. Connection-level allowed users SHALL remain connection-wide.

#### Scenario: Change conversation access
- **WHEN** the user changes the direct-message or group setting
- **THEN** the shared actions SHALL apply the change to the answering channel agent's grants.
