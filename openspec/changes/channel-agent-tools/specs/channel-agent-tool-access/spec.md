# Channel agent tool access delta

## Purpose

Let a connected agent use channel tools from any run while the server, not the model, decides which bots it speaks for and what it may reach.

## ADDED Requirements

### Requirement: Channel tools are added to every run of a connected agent
Agenta SHALL offer `list_channel_destinations`, `send_channel_message`, `read_channel_messages`, and `search_channel_messages` as platform tools, grouped in the SDK op catalog as `CHANNEL_TOOL_OPS`. Listing, reading, and searching SHALL be read-only. Sending SHALL be a write. When the running agent's workflow artifact matches an active, verified bot, the agent runtime SHALL add the channel tools to that run, in every run type (playground, API, channel turns, and automations), without changing the saved configuration. `POST /api/channels/tools/availability` SHALL return `{"available": bool, "tools": [...]}`. The list SHALL hold `list_channel_destinations` while any bound bot is connected, `send_channel_message` while any bound bot has "Can post outside the conversation" on, and `read_channel_messages` and `search_channel_messages` while any bound bot's readable list is not empty. The SDK agent handler SHALL make this check under the same bounded deadline as the session context. A slow or failed check SHALL add no tools, SHALL log a warning, and SHALL NOT stop the run. When the author already lists `{"type": "platform", "op": "<name>"}` for one of the tools, the author's entry SHALL win, permission included, and the tool SHALL NOT be added twice. The bot settings SHALL also gate every call. The web app SHALL know the four tools as platform tools, in the chat and in the tool permission controls.

#### Scenario: Connected agent in the playground
- **WHEN** an agent is connected to an active Slack bot and runs in the playground with no channel tools in its configuration
- **THEN** the run SHALL have all four channel tools, and the saved configuration SHALL stay unchanged.

#### Scenario: Automation run
- **WHEN** an automation runs a connected agent
- **THEN** the run SHALL have the channel tools its bot settings allow.

#### Scenario: Bot disconnected
- **WHEN** the agent's only bot is disconnected or archived
- **THEN** the availability route SHALL return `{"available": false, "tools": []}`, the next run SHALL get no channel tools, and any call that still arrives SHALL be refused.

#### Scenario: Posting switched off
- **WHEN** the bot's posting setting is off
- **THEN** the run SHALL NOT get `send_channel_message`, and a send that still arrives SHALL be refused without calling the provider.

#### Scenario: Reading switched off
- **WHEN** the bot's readable list is empty
- **THEN** the run SHALL NOT get `read_channel_messages` or `search_channel_messages`.

#### Scenario: Author lists a channel tool
- **WHEN** the author lists `{"type": "platform", "op": "send_channel_message", "permission": "ask"}` in a connected agent's tools
- **THEN** the run SHALL have one send tool, with the author's `ask` permission.

#### Scenario: Availability check fails
- **WHEN** the availability check times out or returns an error
- **THEN** the run SHALL go on without added channel tools, and the handler SHALL log a warning.

### Requirement: Sending is allowed by default
`send_channel_message` SHALL default to `allow`, so the agent posts without an approval prompt. The default SHALL be carried by the optional `PlatformOp.default_permission` field. The SDK platform resolver SHALL apply it only when the author set no permission on the tool and the agent-wide permission mode is the default `allow_reads`. A per-tool `ask` or `deny` set by the author SHALL win. An agent-wide `ask` or `deny` mode SHALL win. The operator kill switch SHALL still stop the tool. The other three tools SHALL run without a prompt because they are read-only.

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
- **THEN** every send SHALL be refused, and the default SHALL NOT override it.

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
- **THEN** Agenta SHALL reject the call with HTTP 422 before reading or changing any channel data.

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

### Requirement: Refusals are readable and not-found reveals nothing
A refusal SHALL return HTTP 409 with a message written for the model. Refusals SHALL cover: no bot connected, an ambiguous binding, posting off, reading off, and a direct-message space. An unknown or foreign reference SHALL return HTTP 404 and SHALL NOT reveal anything about what it refers to.

#### Scenario: Reading turned off
- **WHEN** the agent reads a channel that the bot's readable list excludes
- **THEN** Agenta SHALL return HTTP 409 with a message that reading this channel is turned off in the bot's Channels settings.

#### Scenario: Unknown destination
- **WHEN** the agent passes a destination ID that does not resolve for it
- **THEN** Agenta SHALL return HTTP 404 with no platform, name, or other detail.

### Requirement: Project isolation
Every channel tool call SHALL stay inside the authenticated project and the running agent's bots. A destination, thread, or message ID from another project, or from a bot the agent is not bound to, SHALL be treated as not found. The response SHALL NOT reveal its platform, name, or existence.

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
