# Channel destination discovery delta

## Purpose

Give a running agent stable, permission-filtered destination choices without revealing raw provider locators or inaccessible conversations.

## ADDED Requirements

### Requirement: Opaque authorized destinations
`list_channel_destinations` SHALL return only active destinations for which the running agent currently has at least one requested action. Each result SHALL use an opaque Agenta destination ID and SHALL include its provider, kind, display label, supported actions, and whether threads and direct messages are supported. It SHALL NOT return credentials or raw Slack channel, Slack user, or Telegram chat identifiers.

#### Scenario: Agent lists its destinations
- **WHEN** a connected agent lists destinations
- **THEN** Agenta SHALL return only destinations from that agent's active deployments and current grants in the authenticated project.

#### Scenario: Destination loses its grant
- **WHEN** an editor removes all tool actions from a destination
- **THEN** a later destination listing SHALL omit it even if the provider installation can still access it.

### Requirement: Destination tokens are references, not authority
An opaque destination ID SHALL identify a stored destination but SHALL NOT grant access by possession. Every read and write SHALL re-resolve the destination under the authenticated project, running agent, active connection, and current grant.

#### Scenario: Token copied between agents
- **WHEN** another agent in the same project submits a destination token that it cannot use
- **THEN** Agenta SHALL refuse the operation without revealing the allowed agent's configuration.

#### Scenario: Archived connection
- **WHEN** a destination belongs to an archived or unverified connection
- **THEN** Agenta SHALL omit it from discovery and refuse new operations against its prior token.

### Requirement: Provider-specific discovery limits
Slack channel destinations SHALL come from configured conversations that the installation can access. Slack direct-message destinations SHALL require an explicitly authorized recipient and the scopes needed to open or use that conversation. Telegram destinations SHALL come only from chats that have already bound or self-registered with the connection because a Telegram bot cannot enumerate joined chats.

#### Scenario: Slack sees an unconfigured public channel
- **WHEN** the Slack installation can list a public channel but no active Channels destination and agent grant exist for it
- **THEN** the agent's destination tool SHALL NOT expose that channel.

#### Scenario: Telegram bot is installed in an unknown chat
- **WHEN** a Telegram chat has never bound or sent an event to Agenta
- **THEN** destination discovery SHALL NOT claim that the chat exists or can receive a message.

#### Scenario: Slack direct-message initiation lacks permission
- **WHEN** an authorized recipient has no existing direct conversation and the installation lacks the required direct-message scope
- **THEN** discovery SHALL report direct-message initiation as unavailable and SHALL NOT offer a sendable destination.

### Requirement: Destination capability reporting
Destination results SHALL state which of reply, search, proactive send, direct-message initiation, and scheduling are currently available. A result SHALL NOT claim a capability that the adapter, installation scopes, destination state, or agent grant cannot perform.

#### Scenario: Telegram search has limited coverage
- **WHEN** a Telegram destination is searchable only from observed events
- **THEN** its capability metadata SHALL identify search as observed-history only rather than complete provider history.

#### Scenario: Slack destination supports send but not search
- **WHEN** an agent has proactive-send permission but no search permission for a Slack channel
- **THEN** the destination SHALL remain sendable while search is absent from its available actions.
