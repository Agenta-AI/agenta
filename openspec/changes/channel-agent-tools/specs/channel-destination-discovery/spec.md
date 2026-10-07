# Channel destination discovery delta

## Purpose

Tell a running agent which channels it can post to or read, with opaque IDs and truthful capabilities, on Slack and on Telegram.

## ADDED Requirements

### Requirement: List channel destinations with opaque IDs
`list_channel_destinations` SHALL return the channel destinations the running agent can reach through its bots. It SHALL return channel destinations only. Each result SHALL have an opaque `destination_id`, a `type` of `channel`, the platform, a display name, and the flags `can_post`, `can_read`, `can_search`, and `supports_threads`. Results SHALL NOT contain credentials or raw Slack or Telegram IDs. The tool SHALL accept an optional type filter, an optional name filter, a limit of at most 100, and a cursor. Direct-message conversations SHALL NOT be listed.

#### Scenario: Agent lists its destinations
- **WHEN** a connected agent calls the list tool with no filters
- **THEN** Agenta SHALL return channel destinations from every bot bound to that agent in the project, and no others.

#### Scenario: Name filter
- **WHEN** the agent lists destinations with the query "release"
- **THEN** Agenta SHALL return only destinations whose name matches, a page at a time.

#### Scenario: Posting is off but reading is on
- **WHEN** the bot's posting setting is off and its channels are readable
- **THEN** channel results SHALL show `can_post` false and `can_read` true.

### Requirement: A destination ID is a reference, not a permission
A destination ID SHALL identify a stored channel space. Holding one SHALL NOT grant access. Every later call SHALL look it up again inside the caller's project and the running agent's bots and check the current settings.

#### Scenario: ID copied to another agent
- **WHEN** a second agent in the same project uses a destination ID listed for the first agent's bot
- **THEN** Agenta SHALL return not found.

#### Scenario: Channel archived in Slack
- **WHEN** a listed Slack channel is archived before the agent posts to it
- **THEN** the send SHALL fail with a sanitized reason, and later listings SHALL omit that channel.

### Requirement: Slack channel destinations
On Slack, channel destinations SHALL be the public and private channels the bot is a member of. Group DMs and direct messages SHALL NOT be listed. Agenta SHALL refresh the member list from Slack on demand and SHALL cache it in the API process for up to 120 seconds per connection, so it does not call Slack on every list request.

#### Scenario: Bot invited to a private channel
- **WHEN** someone invites the bot to a private channel and the agent lists destinations after the cache expires
- **THEN** that channel SHALL appear as a channel destination.

#### Scenario: Public channel the bot is not in
- **WHEN** a public channel exists but the bot is not a member
- **THEN** it SHALL NOT be listed, because the bot cannot post there.

#### Scenario: Two list calls in quick succession
- **WHEN** the agent lists destinations twice within 120 seconds on the same API process
- **THEN** Agenta SHALL call Slack's member listing at most once.

### Requirement: Telegram channel destinations
On Telegram, channel destinations SHALL be the group and supergroup chats that sent the bot an update or were bound to it, because a Telegram bot cannot list the chats it is in. Each group SHALL be named by the chat title that the Telegram adapter records. Agenta SHALL NOT claim that any other chat exists or can receive a message. The list SHALL explain this limit in a note when it returns Telegram results.

#### Scenario: Group the bot joined silently
- **WHEN** the bot was added to a group that has not sent it any update Agenta received
- **THEN** that group SHALL NOT be listed.

#### Scenario: Hosted Telegram bot
- **WHEN** the project uses the shared Agenta Telegram bot
- **THEN** only chats currently bound to this project's connection SHALL be listed.
