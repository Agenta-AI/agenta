# Channel agent tool access delta

## Purpose

Let a connected agent use channel tools from any run while the server, not the model, decides which bots it speaks for and what it may reach.

## ADDED Requirements

### Requirement: Channel tools are ordinary platform tools
Agenta SHALL offer `list_channel_destinations`, `send_channel_message`, `read_channel_messages`, and `search_channel_messages` as platform tools that an agent author adds to the agent's tool list. Listing, reading, and searching SHALL be marked read-only. Sending SHALL be a write. Connecting a bot SHALL NOT change the agent's tool list. The send tool SHALL follow the agent's normal tool permission (`ask` or `allow`) with no channel-specific approval step.

#### Scenario: Agent without channel tools
- **WHEN** an agent is connected to Slack but its tool list contains no channel tool
- **THEN** the model SHALL NOT be offered any channel tool.

#### Scenario: Default permission mode
- **WHEN** the runner uses its default read-allowing mode and the agent has all four channel tools
- **THEN** list, read, and search SHALL run without a prompt, and send SHALL ask for approval.

#### Scenario: Automation with send allowed
- **WHEN** an automation runs an agent whose send tool permission is `allow`
- **THEN** the agent SHALL be able to post without an interactive approval.

#### Scenario: Automation with send set to ask
- **WHEN** an automation runs an agent whose send tool still asks and nobody can answer
- **THEN** the send SHALL NOT be posted.

### Requirement: The server binds the caller's identity
Each channel tool call SHALL carry the running agent's workflow artifact ID from trusted run context. It SHALL derive the project from the caller's credential. Tool input SHALL NOT accept a project ID, connection ID, channel-agent ID, credential, or raw Slack or Telegram identifier. The service SHALL find the running agent's bots by matching the artifact against active `ChannelAgent` references in the project.

#### Scenario: Tool used outside a channel thread
- **WHEN** a connected agent calls a channel tool from Agenta chat or from an automation
- **THEN** Agenta SHALL resolve the agent's bots without needing an inbound channel event.

#### Scenario: Model adds a routing field
- **WHEN** the tool arguments contain a field that is not in the tool's schema, such as a connection ID
- **THEN** Agenta SHALL reject the call before reading or changing any channel data.

#### Scenario: Agent has no connected bot
- **WHEN** an agent with channel tools runs but no active bot is bound to it
- **THEN** the list SHALL return no destinations, and send, read, and search SHALL refuse with a message that no bot is connected.

#### Scenario: Two bots on one connection bound to the same agent
- **WHEN** two active bot bindings on the same connection match the running agent
- **THEN** Agenta SHALL refuse the call with a configuration error rather than choose one.

### Requirement: Authorization is checked at every call
Every call SHALL re-resolve the running agent's bots, the connection state, the destination, and the bot's settings at the moment it runs. Nothing learned in an earlier call SHALL grant access. The caller's credential SHALL need the `run_channels` permission in the project.

#### Scenario: Setting turned off between calls
- **WHEN** an admin turns off "Can post outside the conversation" after the agent listed its destinations
- **THEN** the next send SHALL be refused without calling Slack or Telegram.

#### Scenario: Connection archived
- **WHEN** a destination's connection is archived, switched off, or unverified
- **THEN** every tool call that names that destination SHALL be refused.

#### Scenario: Caller lacks the permission
- **WHEN** the run's credential belongs to a project member without `run_channels`
- **THEN** every channel tool route SHALL return forbidden.

### Requirement: Project isolation
Every channel tool call SHALL stay inside the authenticated project and the running agent's bots. A destination, thread, message, or person ID from another project, or from a bot the agent is not bound to, SHALL be treated as not found. The response SHALL NOT reveal its platform, name, or existence.

#### Scenario: Destination ID from another project
- **WHEN** a call names a destination ID issued in another project
- **THEN** Agenta SHALL return not found and SHALL NOT reveal anything about it.

#### Scenario: Destination ID from another agent's bot
- **WHEN** an agent names a destination that belongs to a bot bound to a different agent in the same project
- **THEN** Agenta SHALL return not found.

### Requirement: No credentials reach the model
Bot tokens, signing secrets, and other connection credentials SHALL NOT appear in tool schemas, tool results, delivery records, history rows, error messages, or logs. Provider error text SHALL be sanitized before it is returned.

#### Scenario: Provider rejects a post
- **WHEN** Slack returns an error for a send
- **THEN** the tool result SHALL contain a short reason such as `not_in_channel` and SHALL NOT contain the token or the raw request.
