# Channel agent tool access delta

## Purpose

Let a connected agent use channel tools from any run while the server, not the model, decides which bots it speaks for and what it may reach.

## ADDED Requirements

### Requirement: Channel tools are added to every run of a connected agent
Agenta SHALL offer `list_channel_destinations`, `send_channel_message`, `read_channel_messages`, and `search_channel_messages` as platform tools. Listing, reading, and searching SHALL be read-only. Sending SHALL be a write. When a run's agent is bound to an active, verified bot, Agenta SHALL add the four tools to that run's tool list, whatever started the run: a channel message, the playground, or an automation. Agenta SHALL NOT change the saved agent configuration or create a revision to do so. When the agent has no active bot, the tools SHALL NOT be added. A channel tool the author listed explicitly SHALL be kept as authored and SHALL NOT be added a second time. If the check for an active bot fails or times out, the run SHALL continue without the added tools.

#### Scenario: Connected agent in the playground
- **WHEN** an agent bound to an active Slack bot runs in the playground and its configuration lists no channel tool
- **THEN** the model SHALL be offered all four channel tools, and the saved configuration SHALL be unchanged.

#### Scenario: Automation run
- **WHEN** an automation runs an agent bound to an active Telegram bot
- **THEN** the run SHALL have the four channel tools and SHALL be able to post.

#### Scenario: Bot disconnected
- **WHEN** the agent's only bot is disconnected
- **THEN** the next run SHALL NOT be offered any automatically added channel tool.

#### Scenario: Author already listed a tool
- **WHEN** the author listed `send_channel_message` with permission `ask` and the agent is connected
- **THEN** the run SHALL contain exactly one `send_channel_message`, with permission `ask`.

#### Scenario: Availability check fails
- **WHEN** the check for an active bot times out
- **THEN** the run SHALL start without the added tools and SHALL log the failure.

### Requirement: Sending is allowed by default
`send_channel_message` SHALL default to `allow`, so the agent posts without an approval prompt. The default SHALL apply only when the author set no permission on the tool and the agent-wide permission mode is the default `allow_reads`. A per-tool `ask` or `deny` set by the author SHALL win. An agent-wide `ask` or `deny` mode SHALL win. The operator kill switch SHALL still stop the tool. The other three tools SHALL run without a prompt because they are read-only.

#### Scenario: Default posts without a prompt
- **WHEN** a connected agent with no author permission on the send tool calls it under the default mode
- **THEN** the message SHALL be posted without an approval prompt.

#### Scenario: Author sets ask
- **WHEN** the author sets `send_channel_message` to `ask`
- **THEN** every send SHALL wait for approval.

#### Scenario: Agent-wide ask mode
- **WHEN** the author sets the agent's permission mode to `ask` and leaves the send tool unset
- **THEN** every send SHALL wait for approval.

#### Scenario: Author denies the tool
- **WHEN** the author lists `send_channel_message` with permission `deny`
- **THEN** every send SHALL be refused, and the automatic addition SHALL NOT override it.

#### Scenario: Automation cannot answer an approval
- **WHEN** an automation runs an agent whose send tool is set to `ask` and nobody can answer
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
