# Channel agent tool access delta

## Purpose

Expose channel capabilities to connected agents without exposing credentials, tenant identifiers, or authority over another agent's destinations.

## ADDED Requirements

### Requirement: Optional channel tools
Agenta SHALL expose each channel operation as an optional platform tool in the agent configuration. Destination listing and message search SHALL be read-only tools. Immediate send, exact-message scheduling, and schedule cancellation SHALL be write tools. Adding a `ChannelAgent` connection SHALL NOT silently add or allow these tools.

#### Scenario: Connected agent has no channel tools
- **WHEN** an agent is connected to Slack or Telegram but its configuration does not include a channel platform tool
- **THEN** that operation SHALL NOT be advertised to the model.

#### Scenario: Default read and write treatment
- **WHEN** the runner uses its read-allowing default and the agent has listing, search, and send tools
- **THEN** listing and search SHALL run as reads while send SHALL require the configured write decision.

### Requirement: Server-bound caller identity
Each channel tool call SHALL bind the running workflow artifact, variant, and revision identity from trusted run context and SHALL derive the project from the caller credential. Model-visible inputs SHALL NOT accept a project ID, channel-agent ID, connection ID, credential, or raw platform locator. The Channels service SHALL resolve eligible channel deployments from the bound identity before evaluating the requested destination.

#### Scenario: Agent uses a tool outside a channel session
- **WHEN** a connected agent calls a channel tool from Agenta chat or a scheduled run
- **THEN** Agenta SHALL resolve that running agent's eligible channel deployments without requiring an inbound channel event or channel-linked session.

#### Scenario: Caller attempts to retarget another agent
- **WHEN** tool arguments contain an undeclared identity or routing field for another project, connection, or channel agent
- **THEN** Agenta SHALL reject the request before channel data is read or changed.

### Requirement: Tool and resource authorization
A channel operation SHALL proceed only when both the tool execution decision and the current Channels grant permit it. Channels SHALL distinguish reply, search, proactive send, and direct-message initiation. Permission to reply to an inbound message SHALL NOT grant proactive send, search, or direct-message initiation.

#### Scenario: Reply permission without proactive-send permission
- **WHEN** an agent that may answer mentions attempts to send proactively to the same destination
- **THEN** Agenta SHALL refuse the send without calling the external platform.

#### Scenario: Tool allowed but destination denied
- **WHEN** the runner allows a send tool but the current Channels grant denies proactive send for its destination
- **THEN** the Channels service SHALL refuse delivery and record the policy decision.

### Requirement: Tenant isolation and audit
Every channel tool read and write SHALL remain within the authenticated project and the running agent's active deployments. Agenta SHALL record the operation, bound agent identity, destination reference when applicable, tool invocation identity, decision, time, and resulting delivery or query reference. Audit records SHALL NOT contain channel credentials.

#### Scenario: Opaque destination belongs to another project
- **WHEN** a tool call presents a destination token issued for another project
- **THEN** Agenta SHALL return a not-found or forbidden result without revealing its platform, name, installation, or grant state.

#### Scenario: Authorized send completes
- **WHEN** an immediate send is accepted and later reaches Slack or Telegram
- **THEN** its audit trail SHALL link the accepted tool call to the durable delivery and external receipt without storing the bot token.

### Requirement: First connection is not implicit authorization
Installing the first Slack app or binding the first Telegram chat SHALL establish provider connectivity only. An editor SHALL explicitly select agent tool access and destination-level actions before the agent can list, search, send, or schedule through tools.

#### Scenario: Fresh installation
- **WHEN** an editor completes a first Slack installation for a project
- **THEN** no connected agent SHALL gain channel tools or proactive destination grants until the editor explicitly configures them.
