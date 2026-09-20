# Slack agent deployment delta

## MODIFIED Requirements

### Requirement: Agent-page connection action
Connecting an agent to Slack SHALL find or create a deployment for the current application in the chosen shared connection. It SHALL NOT replace another deployment's application reference. An existing connection default SHALL remain unchanged; the first channel agent SHALL become the default when none exists. Repeating a deployment request for the same application and connection SHALL reuse that deployment.

#### Scenario: First agent
- **WHEN** the connection has no active channel agent
- **THEN** deployment SHALL create the page's channel agent, assign a unique slug, and make it the default.

#### Scenario: Connect another agent
- **WHEN** another application is already deployed through the connection
- **THEN** deployment SHALL add the page's agent without changing the existing agent's reference, grants, conversations, or default status.

#### Scenario: Retry the same deployment
- **WHEN** the same application requests deployment again, including a concurrent duplicate request
- **THEN** Agenta SHALL return or resume its existing deployment without creating duplicate agents or user groups.

### Requirement: Connection presentation
Desktop and mobile SHALL use the same deployment behavior. The agent page SHALL show the current application's Slack deployment, its connection, handle, and provisioning state. Connection management SHALL list all deployed agents. Where multiple eligible installations exist, deployment SHALL require an explicit connection selection rather than silently retarget a ranked row.

#### Scenario: Several Slack connections are returned
- **WHEN** the application is deployed in one of several Slack installations
- **THEN** the page SHALL identify that deployment and SHALL NOT mistake another installation's default agent for it.

#### Scenario: Multiple agents share one app
- **WHEN** connection management is opened
- **THEN** it SHALL list each deployed agent and its handle without presenting them as separate Slack apps.

#### Scenario: Provisioning fails
- **WHEN** Slack reports a handle collision, missing scope, unsupported plan, or denied permission
- **THEN** the interface SHALL show the specific blocker and a retry or reauthorization action without claiming that the handle is active.

### Requirement: Agent-page permission controls
The agent-page direct-message and group controls SHALL read and modify grants for the current application's deployment. Connection-level allowed users SHALL remain connection-wide and SHALL be labeled as affecting all agents on that installation.

#### Scenario: Change conversation access
- **WHEN** an editor changes research's direct-message or group setting
- **THEN** the action SHALL change research's grants and leave triage's grants unchanged.

#### Scenario: Shared sender restriction
- **WHEN** an editor changes the connection's allowed users
- **THEN** the interface SHALL explain that the restriction applies to all agents using that installation.

## ADDED Requirements

### Requirement: Remove one deployment without uninstalling the app
Removing one agent's Slack deployment SHALL stop that agent's channel activity and disable only its managed address. It SHALL preserve the shared connection and other deployments. Disconnecting the whole installation SHALL be a separate, explicit action showing all affected agents. Removing the default agent SHALL NOT silently select a replacement.

#### Scenario: Remove one of two agents
- **WHEN** an editor removes research while triage remains deployed
- **THEN** research SHALL stop receiving turns, its managed group SHALL enter disablement, and triage SHALL retain its token, grants, and conversations.

#### Scenario: Remove the default agent
- **WHEN** the removed deployment was the connection default
- **THEN** the interface SHALL show that no connection default is configured until an editor explicitly chooses one.

#### Scenario: Disconnect the shared installation
- **WHEN** an editor selects installation disconnect
- **THEN** Agenta SHALL display all affected deployments and require confirmation before disabling the shared connection.
